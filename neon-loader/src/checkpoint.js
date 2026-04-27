/**
 * Stable map key for in-memory Sets; must stay aligned with `etag || "no_etag"` in run.js.
 * @param {string} r2Key
 * @param {string} etag
 */
export function checkpointPairKey(r2Key, etag) {
  return `${r2Key}\0${etag}`;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function checkpointLookupChunkSize() {
  const n = Number(process.env.CHECKPOINT_LOOKUP_CHUNK ?? "500");
  return Number.isFinite(n) && n > 0 ? Math.min(n, 5000) : 500;
}

/**
 * Which `(r2_key, etag)` pairs already exist in `ingest_checkpoint` — one query per chunk
 * (bounded by Postgres parameter limits), instead of one transaction per object.
 *
 * @param {import("pg").Pool} pool
 * @param {Array<{ r2Key: string, etag: string }>} pairs
 * @returns {Promise<Set<string>>} values from {@link checkpointPairKey}
 */
export async function fetchProcessedPairSet(pool, pairs) {
  const set = new Set();
  if (!pairs.length) return set;

  const chunkSize = checkpointLookupChunkSize();
  for (const batch of chunkArray(pairs, chunkSize)) {
    const values = [];
    let p = 1;
    const placeholders = batch.map(({ r2Key, etag }) => {
      values.push(r2Key, etag);
      const a = p++;
      const b = p++;
      return `($${a}, $${b})`;
    }).join(", ");

    const sql = `
      SELECT c.r2_key, c.etag
      FROM ingest_checkpoint c
      WHERE (c.r2_key, c.etag) IN (${placeholders})
    `;
    const resp = await pool.query(sql, values);
    for (const row of resp.rows) {
      set.add(checkpointPairKey(row.r2_key, row.etag));
    }
  }
  return set;
}

export async function markProcessed(client, { r2Key, etag, runId }) {
  const sql = `
    INSERT INTO ingest_checkpoint (r2_key, etag, run_id, processed_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (r2_key, etag)
    DO NOTHING
  `;
  await client.query(sql, [r2Key, etag, runId]);
}
