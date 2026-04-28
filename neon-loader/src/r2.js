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

/**
 * Lists objects under prefix, prioritizing **newest LastModified first** before applying
 * `maxKeys`. R2/S3 returns keys in **lexicographic key order**; without this, each run could
 * see the same first N keys (all already checkpointed) and never reach newer uploads.
 *
 * @param {object} opts
 * @param {number} [opts.maxKeys] — how many keys to return (process per run); default 200
 * @param {number} [opts.listScanCap] — max keys to list before sort+slice; default from INGEST_LIST_SCAN_CAP or 250000
 */
export async function listR2Objects(client, { bucket, prefix, maxKeys, listScanCap }) {
  const processLimit = Number(maxKeys);
  const processCap = Number.isFinite(processLimit) && processLimit > 0 ? processLimit : 200;

  const scanEnv = Number(process.env.INGEST_LIST_SCAN_CAP ?? "");
  const scanArg = listScanCap !== undefined ? Number(listScanCap) : NaN;
  const scanCandidate = Number.isFinite(scanArg) && scanArg > 0 ? scanArg : scanEnv;
  const scanCap = Math.max(
    processCap,
    Number.isFinite(scanCandidate) && scanCandidate > 0 ? scanCandidate : 250000,
  );

  const accum = [];
  let continuationToken;
  /** @type {{ IsTruncated?: boolean } | undefined} */
  let lastResp;

  while (true) {
    const remaining = scanCap - accum.length;
    if (remaining <= 0) break;

    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: Math.min(remaining, LIST_PAGE_MAX),
      ContinuationToken: continuationToken,
    });
    const resp = await client.send(command);
    lastResp = resp;
    const list = resp.Contents || [];
    for (const obj of list) {
      if (!obj.Key) continue;
      accum.push({
        key: obj.Key,
        etag: (obj.ETag || "").replaceAll("\"", ""),
        size: obj.Size || 0,
        lastModified: obj.LastModified || null,
      });
      if (accum.length >= scanCap) break;
    }
    if (accum.length >= scanCap) break;
    if (!resp.IsTruncated) break;
    continuationToken = resp.NextContinuationToken;
    if (!continuationToken) break;
  }

  if (accum.length >= scanCap && lastResp?.IsTruncated) {
    const message = `list_r2_objects_truncated prefix=${prefix} scan_cap=${scanCap} objects_collected=${accum.length} r2_list_truncated=true hint=raise_INGEST_LIST_SCAN_CAP`;
    if (process.env.FAIL_ON_TRUNCATED_LIST === "0") {
      console.warn(`${message} fail_on_truncated_list=false`);
    } else {
      throw new Error(`${message} fail_on_truncated_list=true`);
    }
  }

  accum.sort((a, b) => {
    const ta = a.lastModified instanceof Date ? a.lastModified.getTime() : 0;
    const tb = b.lastModified instanceof Date ? b.lastModified.getTime() : 0;
    return tb - ta;
  });

  return accum.slice(0, processCap);
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
