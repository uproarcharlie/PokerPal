import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getEnv, type AppEnv } from "../config/env";

export interface UploadResult {
  url: string;
  key: string;
}

// One client per env object: the env is frozen, so a new config means a new object.
const clients = new WeakMap<AppEnv, S3Client | null>();

/** Cloudflare R2 (S3-compatible) client, or null when cloud storage is off or unconfigured. */
function r2Client(env: AppEnv): S3Client | null {
  let client = clients.get(env);
  if (client === undefined) {
    const wanted = env.NODE_ENV === "production" || env.USE_CLOUD_STORAGE;
    client =
      wanted && env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY
        ? new S3Client({
            region: "auto",
            endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
              accessKeyId: env.R2_ACCESS_KEY_ID,
              secretAccessKey: env.R2_SECRET_ACCESS_KEY,
            },
          })
        : null;
    clients.set(env, client);
  }
  return client;
}

export async function uploadToCloud(
  buffer: Buffer,
  contentType: string,
  entityType: string,
  filename: string
): Promise<UploadResult> {
  const env = getEnv();
  const client = r2Client(env);
  if (!client || !env.R2_BUCKET_NAME) {
    throw new Error("Cloud storage not configured");
  }

  const key = `${entityType}/${Date.now()}-${filename}`;

  const upload = new Upload({
    client,
    params: {
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    },
  });

  await upload.done();

  const publicUrl = env.R2_PUBLIC_URL
    ? `${env.R2_PUBLIC_URL}/${key}`
    : `https://${env.R2_BUCKET_NAME}.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;

  return {
    url: publicUrl,
    key: key,
  };
}

export function isCloudStorageEnabled(): boolean {
  return r2Client(getEnv()) !== null;
}
