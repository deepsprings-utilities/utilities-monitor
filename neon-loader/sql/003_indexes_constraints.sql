CREATE INDEX IF NOT EXISTS idx_ingest_raw_file_ingested_at
  ON ingest_raw_file (ingested_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingest_raw_record_file_id
  ON ingest_raw_record (file_id);

CREATE INDEX IF NOT EXISTS idx_ingest_raw_record_record_ts
  ON ingest_raw_record (record_ts);

CREATE INDEX IF NOT EXISTS idx_utility_measurement_tall_record_ts
  ON utility_measurement_tall (record_ts);

CREATE UNIQUE INDEX IF NOT EXISTS uq_utility_measurement_tall_idempotent
  ON utility_measurement_tall (serial, record_ts, metric_key, source_file_id);
