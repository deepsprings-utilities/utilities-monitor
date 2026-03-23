CREATE TABLE IF NOT EXISTS ingest_raw_file (
  id BIGSERIAL PRIMARY KEY,
  r2_key TEXT NOT NULL,
  etag TEXT NOT NULL,
  serial TEXT,
  filetime TIMESTAMPTZ,
  loopname TEXT,
  source TEXT NOT NULL DEFAULT 'acquisuite',
  parse_status TEXT NOT NULL DEFAULT 'parsed',
  error_text TEXT,
  device_address TEXT,
  physical_group TEXT,
  schema_id TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (r2_key, etag)
);

CREATE TABLE IF NOT EXISTS ingest_raw_record (
  id BIGSERIAL PRIMARY KEY,
  file_id BIGINT NOT NULL REFERENCES ingest_raw_file(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  raw_text TEXT NOT NULL,
  parsed_json JSONB NOT NULL,
  label_code TEXT NOT NULL,
  label_name TEXT NOT NULL,
  record_ts TIMESTAMPTZ
);
