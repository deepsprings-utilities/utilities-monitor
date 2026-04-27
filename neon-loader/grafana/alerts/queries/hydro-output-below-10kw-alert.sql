-- Grafana unified alerting — rule uid `ffjt1vsgpmigwb` / folder Utilities (legacy dashboard `defqscp`).
-- Title: "Hydro Output Below 10 kW"
--
-- NOTE: This rule may reference an older Postgres datasource UID in Grafana; if evaluations
-- error with "data source not found", point query A at the same Neon datasource as other dashboards.
--
-- Query A returns time series; expression reduces to last value; alert when last < 10 kW.

SELECT record_ts AS time, metric_value AS value
FROM utility_measurement_tall
WHERE $__timeFilter(record_ts)
  AND source_system = 'hydro_plant'
  AND metric_key = 'power_instantaneous'
ORDER BY time;
