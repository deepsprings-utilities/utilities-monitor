import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";

export function createR2ClientFromEnv() {
  const accountId = mustGetEnv("CLOUDFLARE_ACCOUNT_ID");
  const accessKeyId = mustGetEnv("CLOUDFLARE_R2_ACCESS_KEY_ID");
  const secretAccessKey = mustGetEnv("CLOUDFLARE_R2_SECRET_ACCESS_KEY");
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export async function listR2Objects(client, { bucket, prefix, maxKeys }) {
  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
    MaxKeys: maxKeys,
  });
  const resp = await client.send(command);
  const list = resp.Contents || [];
  return list
    .filter((obj) => obj.Key)
    .map((obj) => ({
      key: obj.Key,
      etag: (obj.ETag || "").replaceAll("\"", ""),
      size: obj.Size || 0,
      lastModified: obj.LastModified || null,
    }));
}

export async function getR2ObjectBytes(client, { bucket, key }) {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  const resp = await client.send(command);
  if (!resp.Body) throw new Error(`Missing body for ${key}`);
  const bytes = await streamToBuffer(resp.Body);
  return new Uint8Array(bytes);
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function mustGetEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
