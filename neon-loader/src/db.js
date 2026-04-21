import { Pool } from "pg";

/** Rows per INSERT statement; larger = fewer round-trips (default avoids huge queries when raw_text is large). */
function insertBatchSize() {
  const n = Number(process.env.INSERT_BATCH_ROWS ?? "250");
  return Number.isFinite(n) && n > 0 ? Math.min(n, 5000) : 250;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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
  const batchRows = insertBatchSize();
  const lc = label.labelCode;
  const ln = label.labelName;
  for (const batch of chunk(records, batchRows)) {
    let p = 1;
    const placeholders = [];
    const values = [];
    for (const record of batch) {
      placeholders.push(
        `($${p}, $${p + 1}, $${p + 2}, $${p + 3}::jsonb, $${p + 4}, $${p + 5}, $${p + 6})`,
      );
      p += 7;
      values.push(
        fileId,
        record.lineNo,
        record.rawText,
        JSON.stringify(record.parsedJson || {}),
        lc,
        ln,
        record.recordTs,
      );
    }
    await client.query(
      `INSERT INTO ingest_raw_record (
        file_id, line_no, raw_text, parsed_json, label_code, label_name, record_ts
      ) VALUES ${placeholders.join(", ")}`,
      values,
    );
  }
}

/**
 * Tall-row physical_group: prefer parser column semantics (source_system from header text)
 * when known, so mixed schemas (e.g. solar + hydro columns on one mb-005 file) roll up
 * hydro power under hydro_plant instead of only the filename device tag.
 */
export function physicalGroupForTallRow(row, label) {
  const inferred = row.sourceSystem;
  if (inferred && inferred !== "unknown") return inferred;
  return label.physicalGroup || "unknown";
}

export async function insertTallRows(client, fileId, serial, tallRows, label) {
  const rows = tallRows.filter((row) => row.recordTs);
  if (!rows.length) return;

  const batchRows = insertBatchSize();
  const dev = label.deviceAddress || "unknown";

  for (const batch of chunk(rows, batchRows)) {
    let p = 1;
    const placeholders = [];
    const values = [];
    for (const row of batch) {
      placeholders.push(
        `($${p}, $${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}, $${p + 8}, $${p + 9}, $${p + 10}, $${p + 11}, $${p + 12})`,
      );
      p += 13;
      values.push(
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
        dev,
        physicalGroupForTallRow(row, label),
      );
    }
    await client.query(
      `INSERT INTO utility_measurement_tall (
        serial, record_ts, metric_key, metric_value, unit, quality, source_file_id,
        source_system, error_flag, low_alarm, high_alarm, device_address, physical_group
      ) VALUES ${placeholders.join(", ")}
      ON CONFLICT (serial, record_ts, metric_key, source_file_id)
      DO NOTHING`,
      values,
    );
  }
}
