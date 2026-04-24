# acquisuite-worker

This repository is a **monorepo** for the AcquisSuite data path: **devices upload logs → cloud storage (R2) → batch jobs load a Postgres database (Neon)**. Optional tools also import **water sampling schedules** and generate **regulatory water-rights** spreadsheets from the same database.

**AI assistants and contributors:** see [`AGENTS.md`](AGENTS.md) for conventions, deploy notes, and pipeline expectations.

## What each top-level folder is for

| Folder | Function | What’s inside (overview) |
|--------|------------|----------------------------|
| [**`worker/`**](worker/) | **HTTP ingest.** Receives AcquiSuite uploads, optionally fixes CSV header lines, writes `.log.gz` objects to R2. | `src/` (Worker code, header JSON), `test/`, `wrangler.jsonc`, `scripts/` to regenerate header lines. See [`worker/README.md`](worker/README.md). |
| [**`neon-loader/`**](neon-loader/) | **R2 → Neon ETL.** Lists new R2 files, parses logs, runs SQL migrations, loads normalized data and checkpoints. | `src/` (ingest, parse, R2, DB, migrations runner), `sql/` (Postgres migrations), `test/`, `grafana/` (dashboard JSON), `label-map.json`, `schema-column-orders.json`, `scripts/` (Grafana push). See [`neon-loader/README.md`](neon-loader/README.md). |
| [**`water-compliance/`**](water-compliance/) | **CSV importers** for water sampling schedule tables in Neon (Grafana/ops; not the AcquiSuite log pipeline). | `scripts/` (schedule and lead/copper importers). Migration SQL lives under **`neon-loader/sql/`** (e.g. `005_water_sampling_schedule.sql`). See [`water-compliance/README.md`](water-compliance/README.md). |
| [**`water-rights-report/`**](water-rights-report/) | **Template A1 (diversion) report:** fills an Excel template from Neon flow data; optional upload to Drive/Dropbox. | `generate-a1-report.mjs`, `upload-*.mjs`, `assets/` (template). See [`water-rights-report/README.md`](water-rights-report/README.md). |
| [**.github/workflows/**](.github/workflows/) | **CI:** deploy Worker, scheduled R2→Neon ingest, optional monthly water-rights report. | `deploy-worker.yml`, `ingest-r2-to-neon.yml`, `water-rights-a1-report.yml`. |

There is **no single `package.json` at the repo root.** Use **`npm ci` / `npm install` inside each package** you work on (`worker/`, `neon-loader/`, `water-compliance/`, `water-rights-report/`).

## How the pieces connect

```text
AcquiSuite device ──HTTPS──▶ worker/ (Cloudflare) ──▶ R2 bucket (log-gz/…)
                                              │
                    scheduled GitHub Action ◀──┘
                                │
                                ▼
                         neon-loader/ ──▶ Neon Postgres
                                │              │
                    Grafana (dashboards) ◀─────┴──▶ water-compliance/ imports, water-rights-report/
```

- **Ingest path:** `worker` stores gzip logs → **`neon-loader`** reads them in batches, idempotently, into Postgres.  
- **Water sampling:** `water-compliance` scripts populate **`water_sampling_schedule`** (used by loader migration `005_…` and optional Grafana JSON in `neon-loader/grafana/`).  
- **Water rights:** `water-rights-report` queries Neon and produces **Excel** (and can upload) on a **separate** schedule or manually.

## Quick links

| Topic | Where to read |
|--------|----------------|
| Non-technical description of the Worker (uploads, headers, device config) | [`worker/README.md`](worker/README.md) |
| ETL behavior, env vars, DB tables, replay, Grafana push | [`neon-loader/README.md`](neon-loader/README.md) |
| Last/Next sample CSV imports, Grafana SQL examples | [`water-compliance/README.md`](water-compliance/README.md) |
| Template A1 report generation and env | [`water-rights-report/README.md`](water-rights-report/README.md) |
| Deploy Worker from CI | [`.github/workflows/deploy-worker.yml`](.github/workflows/deploy-worker.yml) |
| Scheduled R2 → Neon | [`.github/workflows/ingest-r2-to-neon.yml`](.github/workflows/ingest-r2-to-neon.yml) |
