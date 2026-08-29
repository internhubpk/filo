import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// R2 Client configuration
// R2 compatibility pins (all three are the documented Cloudflare R2 setup):
//  - forcePathStyle: true          → path-style addressing (bucket in the
//    path, not a DNS prefix). Avoids virtual-host resolution surprises.
//  - requestChecksumCalculation /
//    responseChecksumValidation: "WHEN_REQUIRED" → the AWS SDK v3.729+
//    defaults to WHEN_SUPPORTED and stamps every PutObject with flexible
//    CRC32 checksum headers; R2 rejects those on many accounts with
//    HTTP 400 NotImplemented ("a header you provided implies functionality
//    that is not implemented") — which previously surfaced as an unclassified
//    503 UNKNOWN. WHEN_REQUIRED is also valid against AWS S3.
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";

// Boot-time credential sanity check. R2 Access Key IDs are EXACTLY 32
// characters and R2 validates the format BEFORE signature verification —
// a key from any other source (AWS IAM = 20 chars, the R2 token JWT, a
// Cloudflare API token, or a truncated/quoted paste) fails with HTTP 400
// InvalidArgument "Credential access key has length N, should be 32".
// Warn once at client construction so the cause is visible without a 503.
if (ACCESS_KEY_ID && ACCESS_KEY_ID.length !== 32) {
  console.warn(
    `[R2] R2_ACCESS_KEY_ID has length ${ACCESS_KEY_ID.length}, but R2 Access Key IDs are exactly 32 characters — ` +
      'verify you copied the "Access Key ID" (not the token JWT) from the R2 API token page, with no quotes/trailing spaces.'
  )
}

const r2Client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
  credentials: {
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || "filo-uploads";

// ==================== S3 METADATA HEADER SAFETY (root cause of the 97% stall) ====================
// S3 object metadata is transmitted as `x-amz-meta-*` HTTP request headers.
// Node's HTTP stack REJECTS header values containing characters outside the
// latin1 range (TypeError: "Invalid character in header content") — and every
// non-ASCII character in an artifact title or an uploaded filename (CJK,
// Arabic, emoji, …) used to crash the PutObject call DETERMINISTICALLY. The
// render route classified that as a retryable storage failure → HTTP 503 →
// the worker retried forever → jobs stuck at 97% ("Creating your file").
//
// Fix at the ONE choke point every upload passes through: percent-encode
// anything outside printable ASCII so the header is always valid, and
// decodeURIComponent() recovers the exact original value. Control characters
// (newlines, tabs, NUL) are folded to spaces — they are header-invalid too
// and are also an injection vector.
const S3_METADATA_MAX_VALUE_LENGTH = 900; // keep total x-amz-meta overhead well under S3's 2 KB limit

function sanitizeS3MetadataValue(raw: string): string {
  let out = "";
  for (const ch of String(raw ?? "")) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code <= 0x7e) {
      out += ch;
    } else if (code === 0x09 || code === 0x0a || code === 0x0d) {
      out += " "; // control chars → space
    } else {
      out += encodeURIComponent(ch); // CJK / latin-1 supplement / emoji → %XX%XX
    }
  }
  return out.slice(0, S3_METADATA_MAX_VALUE_LENGTH);
}

function sanitizeS3Metadata(
  metadata?: Record<string, string>
): Record<string, string> | undefined {
  if (!metadata) return undefined;
  const safe: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(metadata)) {
    // Metadata keys become header names: keep [A-Za-z0-9._-] only.
    const key = String(rawKey ?? "")
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .slice(0, 100);
    if (!key) continue;
    safe[key] = sanitizeS3MetadataValue(rawValue);
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

// Generate presigned URL for upload
export async function generateUploadUrl(
  key: string,
  contentType: string,
  maxSize: number = 50 * 1024 * 1024 // 50MB default
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
    // ContentLengthRange not supported in presigned URLs, validate on upload
  });

  const url = await getSignedUrl(r2Client, command, {
    expiresIn: 3600, // 1 hour
  });

  return url;
}

// Generate presigned URL for download
export async function generateDownloadUrl(
  key: string,
  expiresIn: number = 3600
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const url = await getSignedUrl(r2Client, command, { expiresIn });

  return url;
}

// Upload file to R2 (server-side)
export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array | Blob | string,
  contentType: string,
  metadata?: Record<string, string>
): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
    // Metadata values are derived from artifact titles / user filenames and
    // are frequently non-ASCII — unsanitized values crash the request inside
    // Node's HTTP client (see the header-safety block above).
    Metadata: sanitizeS3Metadata(metadata),
  });

  await r2Client.send(command);
}

// Delete file from R2
export async function deleteFromR2(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  await r2Client.send(command);
}

// Check if file exists in R2
// Uses HeadObject (metadata-only, no body transfer). Previously this used
// GetObject and DOWNLOADED the whole object just to check existence — for a
// 50MB document that wasted egress and could time out into a false 404.
// Mis-classification guard: ONLY a genuine 404/NoSuchKey/NotFound means
// "absent"; every other failure (bad credentials, network, 5xx) rethrows so
// callers can distinguish "file gone" from "storage unavailable".
export async function fileExistsInR2(key: string): Promise<boolean> {
  try {
    const command = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await r2Client.send(command);
    return true;
  } catch (error) {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    const name = err?.name ?? "";
    const status = err?.$metadata?.httpStatusCode;
    if (name === "NoSuchKey" || name === "NotFound" || status === 404) {
      return false;
    }
    throw error;
  }
}

// Generate unique R2 key for uploads
export function generateR2Key(
  userId: string,
  originalName: string,
  prefix: string = "uploads"
): string {
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 8);
  const sanitizedName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  
  return `${prefix}/${userId}/${timestamp}-${randomString}-${sanitizedName}`;
}

// ==================== OBJECT-KEY OWNERSHIP (spec §45) ====================
// Live object-key namespaces per user:
//   uploads/{userId}/...                      — user-uploaded files
//   users/{userId}/artifacts/{id}/v{n}/...    — generated artifact versions
// Every download/delete path derives authorization from ONE of these
// prefixes — a key outside the caller's namespaces is forbidden regardless
// of what the client claims.
export function ownsObjectKey(key: string, userId: string): boolean {
  const k = String(key || "");
  return k.startsWith(`uploads/${userId}/`) || k.startsWith(`users/${userId}/`);
}
