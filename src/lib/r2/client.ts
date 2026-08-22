import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// R2 Client configuration
const r2Client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
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
export async function fileExistsInR2(key: string): Promise<boolean> {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await r2Client.send(command);
    return true;
  } catch (error) {
    if ((error as { name?: string }).name === "NoSuchKey") {
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
