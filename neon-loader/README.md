# neon-loader (R2 → Neon Postgres)

**Role in the monorepo:** this folder is the **batch ingestion service** that turns objects already in **R2** (written by the [`worker/`](../worker/) Cloudflare Worker) into rows in **Neon**. It does **not** accept HTTP device uploads. Optional Grafana dashboard JSON and water-schedule table support share this package; water **CSV** importers for schedules live in [`../water-compliance/`](../water-compliance/).

## What’s in the `neon-loader/` folder

| Path | Purpose |
|------|---------|
| [`src/run.js`](src/run.js) | Entry: list R2, parse files, load DB, checkpoints. |
| [`src/parse.js`](src/parse.js) | CSV (tab/comma) parsing, header detection, tall metrics. |
| [`src/r2.js`](src/r2.js) | S3-compatible R2 listing and object reads. |
| [`src/db.js`](src/db.js) | Postgres writes (raw + normalized). |
| [`src/migrate.js`](src/migrate.js) | Runs SQL in `sql/` in order. |
| [`src/checkpoint.js`](src/checkpoint.js) | Idempotent `(r2_key, etag)` tracking. |
| [`src/labeling.js`](src/labeling.js) | Resolves `mb-…` in filenames via `label-map.json`. |
| [`sql/`](sql/) | Ordered Postgres migrations (ingest tables, tall table, water schedule, etc.). |
| [`test/`](test/) | Node test runner: parse, labeling, db helpers. |
| [`grafana/`](grafana/) | Dashboard JSON; [`scripts/push-grafana-dashboard.mjs`](scripts/push-grafana-dashboard.mjs) pushes them via API. |
| [`label-map.json`](label-map.json) | Device labels, `schemaId`, `hasData`, per-schema column rules. |
| [`schema-column-orders.json`](schema-column-orders.json) | Column order for headerless / strict parsing (also source for Worker's `mb-csv-header-lines.json`). |
| [`package.json`](package.json) | `ingest`, `migrate`, `test`, `grafana:*` scripts. |

**Related (outside this folder):** scheduled ingest is [`.github/workflows/ingest-r2-to-neon.yml`](../.github/workflows/ingest-r2-to-neon.yml). Root map: [`README.md`](../README.md).

---

## What the ETL does

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
- `physicalGroup` (for example `solar_field`, `hydro_plant`, `booster_pump`, `electrical_grid`, `modhopper_status`, `deep_well`)
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
  - `INGEST_BATCH_LIMIT` (default: `200`) — **maximum R2 objects to process in one ingest run**. Listing is paginated across the bucket; raise this (e.g. `2000`, `5000`) for backlog catch-up. Each scheduled ingest run (currently **every 2 hours** via [`.github/workflows/ingest-r2-to-neon.yml`](../.github/workflows/ingest-r2-to-neon.yml)) drains up to this many keys; backlog may need multiple runs or a larger limit (GitHub Actions jobs time out after **360 minutes** unless lowered).
  - `LABEL_MAP_PATH` (default: `./label-map.json`)
  - `DRY_RUN=1` (parse-only, no DB writes)
  - `STRICT_SCHEMA=1` (optional: only allow columns listed under `schemas` in `label-map.json`; default is **off** so parsing matches the legacy “all meter columns” behavior)
  - `INSERT_BATCH_ROWS` (default: `250`) — how many `ingest_raw_record` / `utility_measurement_tall` rows to send per `INSERT` (higher = fewer DB round-trips; cap 5000 to stay under Postgres parameter limits)

### Email alerts (Neon → Resend)

Portable freshness checks independent of Grafana: [`.github/workflows/neon-email-alerts.yml`](../.github/workflows/neon-email-alerts.yml) runs on a schedule (hourly UTC), runs `npm run migrate` (includes `alert_notification_state` for dedupe), then `npm run notify:email-alerts`. The script flags each `physical_group` whose latest `record_ts` in `utility_measurement_tall` is older than the threshold (or empty table).

**Actions secrets:** `NEON_DATABASE_URL`, `RESEND_API_KEY`, `ALERT_EMAIL_FROM` (verified domain in Resend), `ALERT_EMAIL_TO` (comma-separated addresses).

**Optional repository Variables:** `ALERT_STALE_AFTER_MINUTES` (default `240`), `ALERT_COOLDOWN_MINUTES` (default `360`). Optional env `NOTIFY_DRY_RUN=1` skips Resend (still queries Neon).

**Why Resend shows no emails when the workflow is green:** the job only calls Resend when it **sends** an alert (stale data) or a **manual probe** (below). If all `physical_group` values are fresh, the run succeeds but **Resend is never called** — check the job log for `Resend: no API call`. **One-shot test:** add a secret `NOTIFY_SEND_TEST` = `1`, run **Actions → Neon email alerts → Run workflow** once, confirm the probe in Resend and your inbox, then **delete** the secret (or clear it) so you do not send a test every hour.

**Setup checklist (DNS + Resend + GitHub)**

1. **Resend account** — Sign up at [resend.com](https://resend.com), open **API Keys**, create a key (store it temporarily; you will paste it into GitHub).
2. **Add your domain in Resend** — Domains → **Add domain** → enter the apex or subdomain you control (e.g. `example.com` or `mail.example.com`). Resend shows **DNS records** (usually DKIM CNAMEs and SPF/TXT). You do **not** need mailboxes or MX for sending only—just add those records at your DNS host (same place you manage A/CNAME today).
3. **Wait for verification** — In Resend, wait until the domain shows **verified** (DNS can take a few minutes to a few hours).
4. **Pick a From address** — Any address on that verified domain works, e.g. `alerts@example.com` (no inbox required). Put exactly that string in GitHub as `ALERT_EMAIL_FROM`.
5. **Recipients** — Put one or more real inboxes in `ALERT_EMAIL_TO` (comma-separated). Personal Gmail/iCloud is fine here.
6. **GitHub secrets** (repository **Settings → Secrets and variables → Actions → Secrets**):  
   - `NEON_DATABASE_URL` — same connection string as ingest (Neon dashboard → connection string).  
   - `RESEND_API_KEY` — the key from step 1.  
   - `ALERT_EMAIL_FROM` — e.g. `alerts@example.com`.  
   - `ALERT_EMAIL_TO` — e.g. `you@gmail.com` or `a@x.com,b@y.com`.
7. **Optional Variables** ( **Settings → Secrets and variables → Actions → Variables** ): `ALERT_STALE_AFTER_MINUTES`, `ALERT_COOLDOWN_MINUTES` if you want non-default thresholds.
8. **Merge the workflow** to your default branch so the schedule runs. Test anytime: **Actions → Neon email alerts → Run workflow**.

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

Templates live under `neon-loader/grafana/`. The push script substitutes `__DATASOURCE_UID__` in JSON with `GRAFANA_DATASOURCE_UID` before calling Grafana’s dashboard API.

| Script | Dashboard template |
|--------|-------------------|
| `npm run grafana:push` (default) | `grafana/dashboard.hydro-power.json` |
| `npm run grafana:push:water` | `grafana/dashboard.water-compliance.json` (water sampling / ops schedule views over `water_sampling_schedule`) |

```bash
npm run grafana:push
# or
npm run grafana:push:water
```

Required environment variables:

- `GRAFANA_URL` (for example `https://your-org.grafana.net`)
- `GRAFANA_TOKEN` (API token with dashboard write scope)
- `GRAFANA_DATASOURCE_UID` (Postgres datasource UID in Grafana; must match the DB that holds `utility_measurement_tall` / `water_sampling_schedule`)

In **GitHub**, add the same three as **Actions repository secrets** (or organization secrets) and run the **Push Grafana dashboard** workflow (`.github/workflows/push-grafana-dashboard.yml`) from the Actions tab.

Dry-run validation (no API write):

```bash
npm run grafana:dry-run
npm run grafana:push:water -- --dry-run
```

**Alert rules** (Postgres queries, rule UIDs, receivers) are documented under [`grafana/alerts/`](grafana/alerts/) for review in git; Grafana Cloud remains the source of truth.

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

### Replay GPM (flow) for the three flow devices only

Use this after **parser / Wyman / bypass / booster** fixes so you re-load **only** GPM `utility_measurement_tall` rows and raw lines for **mb-003, mb-006, mb-008**—not the whole table. Other devices, and non-Gpm columns on the same files (e.g. PSI, kW), are left in place. Clears checkpoints for those R2 objects so a normal `npm run ingest` re-fetches and re-parses them.

```bash
cd neon-loader
export NEON_DATABASE_URL='postgresql://...'
# R2 + account env vars as for a normal ingest (if you add --ingest):
export R2_BUCKET_NAME=...
export CLOUDFLARE_R2_ACCESS_KEY_ID=...
export CLOUDFLARE_R2_SECRET_ACCESS_KEY=...
export CLOUDFLARE_ACCOUNT_ID=...
export INGEST_BATCH_LIMIT=5000   # optional, so replay reaches those keys sooner

# DB cleanup only, then you run ingest (or wait for the scheduled ingest workflow):
npm run replay:flow
npm run ingest

# Or cleanup and run the loader in one go:
npm run replay:flow:ingest
```

Set `REPLAY_FLOW_DEVICES=mb-003,mb-006,mb-008` (or `FLOW_METER_DEVICE_ADDRESSES=…`) to override the default list.

**In-place fix (no delete):** if the error is only wrong `physical_group` / `source_system` (e.g. booster tagged as hydro on `mb-003`), you can `UPDATE` those rows. You cannot reliably split Wyman vs bypass or rename to `flow_wyman_avg` if two streams ever shared the same `metric_key` in `utility_measurement_tall` without re-parsing. See [`scripts/backfill-flow-tall-in-place.sql`](scripts/backfill-flow-tall-in-place.sql). A **Grafana** SQL layer can also apply `CASE` corrections for read-only display without changing stored rows.

### Full wipe (rare)

Truncates all AcquiSuite ingest tables and checkpoints. Use `npm run reset:ingest` and then `npm run ingest`, or `npm run reingest:from-scratch`. See `scripts/reset-ingest.mjs`. Does not touch `water_sampling_schedule`. Raise `INGEST_BATCH_LIMIT` if the R2 listing exceeds one batch; repeat runs or scheduled Actions will continue draining.
