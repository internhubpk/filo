// =============================================================================
// GET/POST /api/admin/r2/status
// =============================================================================
// ADMIN CLOUDFLARE R2 DIAGNOSTICS — the storage twin of /api/admin/ai/status.
//
// GET  → configuration snapshot of the APP runtime (where R2 actually runs:
//        /api/files, signed-url, download and /api/generation/render all use
//        the R2_* env vars here — NOT in Convex). Reports which variables are
//        set, the derived endpoint, and the bucket name.
// POST → runs a LIVE probe against R2 from this same runtime:
//          - ListObjectsV2(maxKeys=1) on the configured bucket
//          - reports the exact S3 error name (InvalidAccessKeyId,
//            SignatureDoesNotMatch, AccessDenied, NoSuchBucket, …) so a
//            wrong token or a policy/permission problem is pinpointed
//            without touching Cloudflare logs
//
// Never returns the Access Key ID, Secret, or any credential material.
// Error details are limited to error NAMES and HTTP statuses.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminAccess, jsonError } from "@/lib/billing-server";
import {
  classifyR2Error,
  isR2Configured,
  R2_STORAGE_UNAVAILABLE_MESSAGE,
} from "@/lib/r2/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function configSnapshot() {
  const accountId = process.env.R2_ACCOUNT_ID || "";
  const bucket = process.env.R2_BUCKET_NAME || "filo-uploads";
  const endpoint = process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`;
  // Report the LENGTH of the Access Key ID — never its value. R2 Access Key
  // IDs are exactly 32 characters, so a credential from the wrong source
  // (the R2 token JWT, a Cloudflare account API token, an AWS IAM key, or a
  // truncated/quoted paste) is visible here as a wrong length with ZERO
  // secret exposure.
  const keyId = process.env.R2_ACCESS_KEY_ID || "";
  const keyIdReport = keyId
    ? keyId.length === 32
      ? "set (length 32 — correct R2 format)"
      : `set (length ${keyId.length} — R2 requires exactly 32; this value is NOT a valid R2 Access Key ID)`
    : "MISSING";
  return {
    configured: isR2Configured(),
    variables: {
      R2_ACCOUNT_ID: accountId ? "set" : "MISSING",
      R2_ACCESS_KEY_ID: keyIdReport,
      R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ? "set" : "MISSING",
      R2_BUCKET_NAME: bucket ? bucket : "MISSING (defaults to filo-uploads)",
      R2_ENDPOINT: process.env.R2_ENDPOINT ? "set (override)" : "derived from account id",
    },
    endpoint,
    bucket,
    unavailableMessage: R2_STORAGE_UNAVAILABLE_MESSAGE,
  };
}

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminAccess(request);
    if (!admin.ok) return admin.response;

    return NextResponse.json({ success: true, data: { mode: "config", ...configSnapshot() } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(502, `R2 diagnostics failed: ${message}`, "R2_STATUS_FAILED");
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminAccess(request);
    if (!admin.ok) return admin.response;

    const started = Date.now();
    if (!isR2Configured()) {
      return NextResponse.json({
        success: true,
        data: {
          mode: "probe",
          ok: false,
          kind: "NOT_CONFIGURED",
          latencyMs: Date.now() - started,
          ...configSnapshot(),
          hint: "Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME on this runtime (Vercel env / .env.local), then redeploy.",
        },
      });
    }

    // ---- LIVE probe: list 1 key (cheapest authenticated call) --------------
    const { S3Client, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const accountId = process.env.R2_ACCOUNT_ID || "";
    // Same R2 compatibility pins as src/lib/r2/client.ts — the probe must
    // obey the same rules as the client it is diagnosing, otherwise it can
    // report its OWN false failures: without forcePathStyle the SDK resolves
    // <bucket>.<account>.r2.cloudflarestorage.com (virtual-host style), which
    // does not exist on R2 → ENOTFOUND looks like a network outage; and SDK
    // v3.729+ checksum defaults can trigger request rejections.
    const client = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
      },
    });

    const bucket = process.env.R2_BUCKET_NAME || "filo-uploads";
    try {
      await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
      return NextResponse.json({
        success: true,
        data: {
          mode: "probe",
          ok: true,
          kind: "OK",
          latencyMs: Date.now() - started,
          ...configSnapshot(),
          hint: "R2 is reachable, the token is valid, and the bucket exists. Uploads and renders can proceed.",
        },
      });
    } catch (probeError) {
      const info = classifyR2Error(probeError);
      const name =
        (probeError as { name?: string }).name ||
        (probeError as { code?: string }).code ||
        "UnknownError";
      const status = (probeError as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      return NextResponse.json({
        success: true,
        data: {
          mode: "probe",
          ok: false,
          kind: info.kind,
          s3ErrorName: name,
          httpStatus: status ?? null,
          latencyMs: Date.now() - started,
          ...configSnapshot(),
          hint: hintFor(info.kind, String(name)),
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(502, `R2 probe failed: ${message}`, "R2_PROBE_FAILED");
  }
}

function hintFor(kind: string, s3ErrorName: string): string {
  switch (kind) {
    case "AUTH":
      if (s3ErrorName === "InvalidAccessKeyId")
        return "The Access Key ID is wrong or the API token was deleted. Create a new R2 API token (Object Read & Write, scoped to this bucket).";
      if (s3ErrorName === "InvalidArgument")
        return "The Access Key ID format is invalid (R2 Access Key IDs are exactly 32 characters). This is the token JWT or another non-R2 key — copy the 32-character \"Access Key ID\" from R2 → Manage API Tokens into R2_ACCESS_KEY_ID, with no quotes or spaces.";
      if (s3ErrorName === "SignatureDoesNotMatch")
        return "The Secret Access Key is wrong for this Access Key. Re-copy it from the R2 API token page.";
      if (s3ErrorName === "AccessDenied")
        return "The token lacks permission for this operation. Recreate it with 'Object Read & Write' scoped to the bucket.";
      return "R2 rejected the credentials. Verify the API token is still active and has Object Read & Write scope.";
    case "SERVICE":
      return "Cloudflare-side transient failure. Retry the probe; check cloudflarestatus.com if it persists.";
    case "NETWORK":
      return "This runtime cannot reach <account>.r2.cloudflarestorage.com. Check outbound network/egress rules.";
    case "NOT_FOUND":
      return "The probed object/path does not exist — unexpected for a bucket listing. Verify R2_BUCKET_NAME.";
    default:
      return "Unclassified R2 error — check the runtime logs for the full SDK error.";
  }
}
