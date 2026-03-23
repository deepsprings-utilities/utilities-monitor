export async function isProcessed(client, r2Key, etag) {
  const sql = `
    SELECT 1
    FROM ingest_checkpoint
    WHERE r2_key = $1 AND etag = $2
    LIMIT 1
  `;
  const resp = await client.query(sql, [r2Key, etag]);
  return resp.rowCount > 0;
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
