-- Grafana unified alerting — rule uid `dfjzp1szlpzb4d` (Water Rights Compliance folder).
-- Title: "Due within 45 days (backlog capped at 30d past)"
--
-- Alert fires when COUNT(*) > 0 (expression chain: reduce last → threshold > 0).
-- Window: Postgres relative range 30d on the query (Grafana alert evaluation).
--
-- Rows counted:
--   - Due any time from 30 days ago through 45 days from today (inclusive intent).
-- Rows excluded:
--   - next_due_date more than ~30 days in the past (ancient backlog — stops repeat spam).
--   - next_due_date null.
--   - next_due_date more than 45 days in the future.

SELECT COUNT(*) AS count
FROM water_sampling_schedule
WHERE next_due_date IS NOT NULL
  AND next_due_date <= (CURRENT_DATE + INTERVAL '45 days')::date
  AND next_due_date >= (CURRENT_DATE - INTERVAL '30 days')::date;
