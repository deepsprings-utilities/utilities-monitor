-- Water quality compliance schedules (imported from DWW/lab CSV exports).
-- Separate from AcquiSuite R2 ingest; optional for Grafana compliance dashboards.

CREATE TABLE IF NOT EXISTS water_sampling_schedule (
  id BIGSERIAL PRIMARY KEY,
  ps_code TEXT NOT NULL,
  group_name TEXT,
  analyte_number TEXT,
  analyte_name TEXT,
  last_sampled DATE,
  frequency_months INTEGER,
  next_due_date DATE,
  next_due_raw TEXT,
  notes TEXT,
  source_file TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_water_sampling_schedule_next_due
  ON water_sampling_schedule (next_due_date);

CREATE INDEX IF NOT EXISTS idx_water_sampling_schedule_ps_code
  ON water_sampling_schedule (ps_code);

CREATE INDEX IF NOT EXISTS idx_water_sampling_schedule_source
  ON water_sampling_schedule (source_file);
