-- Manual, optional: fix mis-tagged *tall* rows in place (no re-ingest).
-- Review in a transaction; adjust WHERE clauses to match your data.
-- Limitation: you cannot split two different physical meters that were stored
--   under the same (serial, record_ts, metric_key, source_file_id) from tall alone.

BEGIN;

-- 1) Booster (mb-003) was sometimes inferred as hydro: safe if every row
--    on that device in this result set is actually the booster.
UPDATE utility_measurement_tall
SET
  physical_group = 'booster_pump',
  source_system = 'booster_pump'
WHERE device_address = 'mb-003'
  AND (
    physical_group = 'hydro_plant'
    OR (physical_group = 'unknown' AND source_system = 'hydro_plant')
  );

-- 2) Rename a metric *only* if 100% of matching rows are the Wyman stream
--    (e.g. you verified bypass never shared this key for this period).
-- Example: legacy generic key you know maps only to Wyman.
-- UPDATE utility_measurement_tall
-- SET metric_key = 'flow_wyman_avg'
-- WHERE device_address = 'mb-006'
--   AND unit IS NOT NULL AND UPPER(unit) LIKE '%GPM%'
--   AND metric_key = 'flow_avg_C'
--   AND record_ts >= '2025-01-01';

COMMIT;
