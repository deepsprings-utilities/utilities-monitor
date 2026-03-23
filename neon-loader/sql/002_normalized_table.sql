CREATE TABLE IF NOT EXISTS utility_measurement_tall (
  id BIGSERIAL PRIMARY KEY,
  serial TEXT NOT NULL,
  record_ts TIMESTAMPTZ NOT NULL,
  metric_key TEXT NOT NULL,
  metric_value DOUBLE PRECISION NOT NULL,
  unit TEXT,
  quality TEXT,
  source_file_id BIGINT NOT NULL REFERENCES ingest_raw_file(id) ON DELETE CASCADE,
  source_system TEXT,
  error_flag BOOLEAN NOT NULL DEFAULT FALSE,
  low_alarm BOOLEAN NOT NULL DEFAULT FALSE,
  high_alarm BOOLEAN NOT NULL DEFAULT FALSE,
  device_address TEXT,
  physical_group TEXT
);

CREATE TABLE IF NOT EXISTS ingest_checkpoint (
  r2_key TEXT NOT NULL,
  etag TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_id TEXT NOT NULL,
  PRIMARY KEY (r2_key, etag)
);
