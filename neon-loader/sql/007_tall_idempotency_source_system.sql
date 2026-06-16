DROP INDEX IF EXISTS uq_utility_measurement_tall_idempotent;

CREATE UNIQUE INDEX IF NOT EXISTS uq_utility_measurement_tall_idempotent
  ON utility_measurement_tall (
    serial,
    record_ts,
    metric_key,
    source_system,
    source_file_id
  );
