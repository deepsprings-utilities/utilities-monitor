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

function normalizeEtag(etag) {
  return etag || "no_etag";
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

/**
 * Select up to `maxObjects` uncheckpointed objects from an already-prioritized scan window.
 * The batch cap has to be applied after checkpoint filtering; otherwise repeated runs can
 * keep selecting only recent, already-processed keys and never drain older backlog.
 *
 * @param {import("pg").Pool} pool
 * @param {Array<{ key: string, etag?: string }>} objects
 * @param {number} maxObjects
 * @returns {Promise<{ objects: Array<{ key: string, etag?: string }>, examined: number, checkpointed: number }>}
 */
export async function selectUnprocessedObjects(pool, objects, maxObjects) {
  const limit = Number(maxObjects);
  const maxSelected = Number.isFinite(limit) && limit > 0 ? limit : 200;
  const selected = [];
  let examined = 0;
  let checkpointed = 0;
  const chunkSize = checkpointLookupChunkSize();

  for (let i = 0; i < objects.length && selected.length < maxSelected; i += chunkSize) {
    const batch = objects.slice(i, i + chunkSize);
    const processedSet = await fetchProcessedPairSet(
      pool,
      batch.map((o) => ({
        r2Key: o.key,
        etag: normalizeEtag(o.etag),
      })),
    );

    for (const object of batch) {
      examined += 1;
      const key = checkpointPairKey(object.key, normalizeEtag(object.etag));
      if (processedSet.has(key)) {
        checkpointed += 1;
        continue;
      }
      selected.push(object);
      if (selected.length >= maxSelected) break;
    }
  }

  return { objects: selected, examined, checkpointed };
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
