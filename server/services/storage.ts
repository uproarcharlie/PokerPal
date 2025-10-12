import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

// Use environment variables to determine if we should use cloud storage
const USE_CLOUD_STORAGE = process.env.NODE_ENV === 'production' || process.env.USE_CLOUD_STORAGE === 'true';

// Initialize S3 client for Cloudflare R2 (or any S3-compatible storage)
let s3Client: S3Client | null = null;

if (USE_CLOUD_STORAGE && process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
  s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

export interface UploadResult {
  url: string;
  key: string;
}

export async function uploadToCloud(
  file: Express.Multer.File,
  entityType: string
): Promise<UploadResult> {
  if (!s3Client || !process.env.R2_BUCKET_NAME) {
    throw new Error("Cloud storage not configured");
  }

  const key = `${entityType}/${Date.now()}-${file.originalname}`;

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    },
  });

  await upload.done();

  // Construct the public URL
  const publicUrl = process.env.R2_PUBLIC_URL
    ? `${process.env.R2_PUBLIC_URL}/${key}`
    : `https://${process.env.R2_BUCKET_NAME}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;

  return {
    url: publicUrl,
    key: key,
  };
}

export function isCloudStorageEnabled(): boolean {
  return USE_CLOUD_STORAGE && s3Client !== null;
}
