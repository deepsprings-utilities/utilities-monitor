import { Pool } from "pg";

export function createDbPoolFromEnv() {
  const connectionString = process.env.NEON_DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing required env var: NEON_DATABASE_URL");
  }
  return new Pool({ connectionString });
}

export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function insertRawFile(client, row) {
  const sql = `
    INSERT INTO ingest_raw_file (
      r2_key, etag, serial, filetime, loopname, source, parse_status, error_text, ingested_at,
      device_address, physical_group, schema_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, $11)
    ON CONFLICT (r2_key, etag)
    DO UPDATE SET
      serial = EXCLUDED.serial,
      filetime = EXCLUDED.filetime,
      loopname = EXCLUDED.loopname,
      source = EXCLUDED.source,
      parse_status = EXCLUDED.parse_status,
      error_text = EXCLUDED.error_text,
      device_address = EXCLUDED.device_address,
      physical_group = EXCLUDED.physical_group,
      schema_id = EXCLUDED.schema_id
    RETURNING id
  `;
  const values = [
    row.r2Key,
    row.etag,
    row.serial || null,
    row.filetime || null,
    row.loopname || null,
    row.source || "acquisuite",
    row.parseStatus || "parsed",
    row.errorText || null,
    row.deviceAddress || null,
    row.physicalGroup || null,
    row.schemaId || null,
  ];
  const resp = await client.query(sql, values);
  return resp.rows[0].id;
}

export async function insertRawRecords(client, fileId, records, label) {
  if (!records.length) return;
  const sql = `
    INSERT INTO ingest_raw_record (
      file_id, line_no, raw_text, parsed_json, label_code, label_name, record_ts
    )
    VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
  `;
  for (const record of records) {
    await client.query(sql, [
      fileId,
      record.lineNo,
      record.rawText,
      JSON.stringify(record.parsedJson || {}),
      label.labelCode,
      label.labelName,
      record.recordTs,
    ]);
  }
}

export async function insertTallRows(client, fileId, serial, tallRows, label) {
  if (!tallRows.length) return;
  const sql = `
    INSERT INTO utility_measurement_tall (
      serial, record_ts, metric_key, metric_value, unit, quality, source_file_id,
      source_system, error_flag, low_alarm, high_alarm, device_address, physical_group
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (serial, record_ts, metric_key, source_file_id)
    DO NOTHING
  `;
  for (const row of tallRows) {
    if (!row.recordTs) continue;
    await client.query(sql, [
      serial,
      row.recordTs,
      row.metricKey,
      row.metricValue,
      row.unit,
      row.quality,
      fileId,
      row.sourceSystem || "unknown",
      row.errorFlag || false,
      row.lowAlarm || false,
      row.highAlarm || false,
      label.deviceAddress || "unknown",
      label.physicalGroup || "unknown",
    ]);
  }
}
