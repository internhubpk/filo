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
const r2Client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || "filo-uploads";

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
    Metadata: metadata,
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
