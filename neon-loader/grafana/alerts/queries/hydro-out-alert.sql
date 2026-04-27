-- Grafana unified alerting — rule uid `bfjzr4dmq2mf4f` / group "Utilities Ops".
-- Title: "Hydro Out"
--
-- Query A: latest instantaneous hydro power (kW). Expression B reduces to last value;
-- condition C alerts when value < 5 kW (see Grafana threshold step, not in SQL).

SELECT record_ts AS "time", metric_value AS value
FROM public.utility_measurement_tall
WHERE physical_group = 'hydro_plant'
  AND metric_key = 'power_instantaneous'
  AND unit = 'kW'
  AND $__timeFilter(record_ts)
ORDER BY record_ts DESC
LIMIT 1;
