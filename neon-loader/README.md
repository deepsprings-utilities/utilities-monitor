## neon-loader

Durable scheduled ETL that:
- Reads new `log-gz/` objects from Cloudflare R2.
- Decompresses and parses AcquiSuite CSV log rows.
- Resolves filename device numbers (`mb-001` ... `mb-009`) to label, device address, schema id, and physical group via `label-map.json`.
- Normalizes legacy header typos/variants into stable metric keys.
- Applies schema-aware header filtering per device schema id (when `STRICT_SCHEMA=1`).
- Detects **tab-** or **comma-**separated AcquiSuite logs (tab is common in exports).
- Strips **SQL-style quotes** around cell values (e.g. `'2026-02-23 20:45:00'`).
- Scans the **first few lines** for the real header row (some files have a comment/junk line before `time(UTC)`).
- Avoids useless tall metrics named `col_1`…`col_N` from failed loose parsing (those rows are skipped in loose mode).
- **Headerless exports** (no `time(UTC)` title row — common for some upload paths): uses fixed column order from [`schema-column-orders.json`](schema-column-orders.json) by `schemaId` (from `label-map.json` / device). Override per schema with `schemas.<id>.columnOrder` in `label-map.json` if needed.
- Writes to Neon Postgres raw ingestion tables and a normalized tall table.
- Tracks processed `(r2_key, etag)` checkpoints for idempotent reruns.

## Label map structure

Each device entry should include:
- `labelName`
- `deviceAddress`
- `physicalGroup` (for example `solar_field`, `hydro_plant`, `electrical_grid`, `modhopper_status`, `deep_well`)
- `schemaId` (schema version marker for future parser evolution)
- Optional `hasData` flag. Set `false` for devices like ModHopper transceivers that do not produce utility measurements.

## Environment Variables

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_R2_ACCESS_KEY_ID`
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `NEON_DATABASE_URL`
- Optional:
  - `INGEST_PREFIX` (default: `log-gz/`)
  - `INGEST_BATCH_LIMIT` (default: `200`) — **maximum R2 objects to process in one ingest run**. Listing is paginated across the bucket; raise this (e.g. `2000`, `5000`) for backlog catch-up. Each hourly scheduled run drains up to this many keys; backlog may need multiple runs or a larger limit (GitHub Actions jobs time out after **360 minutes** unless lowered).
  - `LABEL_MAP_PATH` (default: `./label-map.json`)
  - `DRY_RUN=1` (parse-only, no DB writes)
  - `STRICT_SCHEMA=1` (optional: only allow columns listed under `schemas` in `label-map.json`; default is **off** so parsing matches the legacy “all meter columns” behavior)
  - `INSERT_BATCH_ROWS` (default: `250`) — how many `ingest_raw_record` / `utility_measurement_tall` rows to send per `INSERT` (higher = fewer DB round-trips; cap 5000 to stay under Postgres parameter limits)

## Local Run

```bash
npm install
npm run migrate
npm run ingest
```

Dry run:

```bash
DRY_RUN=1 npm run ingest
```

## Grafana dashboard automation

`neon-loader` includes a Grafana dashboard template at `grafana/dashboard.hydro-power.json` and an upsert script:

```bash
npm run grafana:push
```

Required environment variables:

- `GRAFANA_URL` (for example `https://grafana.example.com`)
- `GRAFANA_TOKEN` (API token with dashboard write scope)
- `GRAFANA_DATASOURCE_UID` (Grafana Postgres datasource UID)

Dry-run validation (no API write):

```bash
npm run grafana:dry-run
```

## Database Objects

Migrations create:
- `ingest_raw_file`
- `ingest_raw_record`
- `utility_measurement_tall`
- `ingest_checkpoint`
- `schema_migrations`
- optional: `water_sampling_schedule` (water compliance CSV imports — see [`../water-compliance/README.md`](../water-compliance/README.md))

## Raw rows but no `utility_measurement_tall` rows

Possible causes:

1. **`hasData: false`** in [`label-map.json`](label-map.json) for that `mb-XXX` device (ModHopper status devices). Raw rows are still inserted; **`utility_measurement_tall` is skipped intentionally.** Ingest logs: `skip_utility_measurement_tall … reason=hasData_false`.

2. **Parser produced no tall metrics** (`tall_rows=0`): strict header mode (`STRICT_SCHEMA=1`), loose `col_*` parsing only, headerless export without matching `schemaId` + `schema-column-orders.json`, or non-numeric meter cells.

3. **Tall metrics exist but no `record_ts`**: timestamps in the source column cannot be parsed; those rows are not inserted. Check ingest warnings mentioning `record_ts`.

Use this to compare counts per uploaded file:

```sql
SELECT f.id, f.r2_key, f.ingested_at,
  (SELECT COUNT(*) FROM ingest_raw_record r WHERE r.file_id = f.id) AS raw_rows,
  (SELECT COUNT(*) FROM utility_measurement_tall t WHERE t.source_file_id = f.id) AS tall_rows
FROM ingest_raw_file f
WHERE f.parse_status = 'parsed'
ORDER BY f.ingested_at DESC
LIMIT 50;
```

## Replay

To replay a file version, delete its checkpoint row:

```sql
DELETE FROM ingest_checkpoint
WHERE r2_key = 'log-gz/serial/2026/03/20/file.log.gz'
  AND etag = 'etag_here';
```
