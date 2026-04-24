# Water rights Template A1 (Excel from Neon)

This package **builds a filled “Template A1” (diversion to direct use) workbook** from flow data in **Neon**—for example Wyman Creek flow stored under a chosen metric (default `flow_C` for the hydro / `mb-006` line). It is **separate** from AcquiSuite HTTP ingest (`worker/`) and from the main R2→Neon log pipeline (`neon-loader/`), but it **reads the same database** the loader populates.

## What’s in this folder

| Path | Role |
|------|------|
| [`generate-a1-report.mjs`](generate-a1-report.mjs) | Queries Postgres, fills the Excel template, writes a dated `.xlsx` (configurable `OUT_PATH`). |
| [`upload-google-drive.mjs`](upload-google-drive.mjs) / [`upload-dropbox.mjs`](upload-dropbox.mjs) | Optional upload of the generated file (credentials via env; see script headers). |
| [`assets/template-a1.xlsx`](assets/template-a1.xlsx) | Excel layout the generator fills. |
| [`package.json`](package.json) | Scripts: `npm run generate`, `upload-drive`, `upload-dropbox`. |

## Requirements

- **Node 20+**
- **`NEON_DATABASE_URL`** (required for `generate`)
- Optional: **`WATER_RIGHTS_SERIAL`** to pin one AcquiSuite device when many rows exist; **`REPORT_YEAR`**, **`REPORT_END`**, **`REPORT_TZ`**, and other static columns (see top-of-file comment in `generate-a1-report.mjs`).

## Local run

```bash
cd water-rights-report
npm ci
export NEON_DATABASE_URL="postgresql://..."
npm run generate
```

## Automation

A **monthly** (and manual) GitHub Action runs in **`water-rights-report/`**: see [`.github/workflows/water-rights-a1-report.yml`](../.github/workflows/water-rights-a1-report.yml) for job env and secrets/variables (Neon URL, report year, flow metric, etc.).

## Monorepo context

See the root [`README.md`](../README.md) for how this folder fits next to `worker/`, `neon-loader/`, and `water-compliance/`.
