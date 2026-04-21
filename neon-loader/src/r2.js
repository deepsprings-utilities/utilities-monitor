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

/** S3/R2 ListObjects returns at most ~1000 keys per request; paginate until cap or exhaust. */
const LIST_PAGE_MAX = 1000;

export async function listR2Objects(client, { bucket, prefix, maxKeys }) {
  const limit = Number(maxKeys);
  const cap = Number.isFinite(limit) && limit > 0 ? limit : 200;

  const out = [];
  let continuationToken;

  while (true) {
    const remaining = cap - out.length;
    if (remaining <= 0) break;

    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: Math.min(remaining, LIST_PAGE_MAX),
      ContinuationToken: continuationToken,
    });
    const resp = await client.send(command);
    const list = resp.Contents || [];
    for (const obj of list) {
      if (!obj.Key) continue;
      out.push({
        key: obj.Key,
        etag: (obj.ETag || "").replaceAll("\"", ""),
        size: obj.Size || 0,
        lastModified: obj.LastModified || null,
      });
      if (out.length >= cap) break;
    }
    if (out.length >= cap) break;
    if (!resp.IsTruncated) break;
    continuationToken = resp.NextContinuationToken;
    if (!continuationToken) break;
  }

  return out;
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
