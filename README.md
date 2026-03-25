# acquisuite-worker

Monorepo for AcquiSuite → Cloudflare R2 → Neon ingestion.

Cursor / AI assistants: see [`AGENTS.md`](AGENTS.md) for unified project context (layout, deploy, pipeline, product direction).

| Package | Purpose |
|--------|---------|
| [**`worker/`**](worker/) | Cloudflare Worker: HTTP ingest from devices, store `.log.gz` in R2 (optional CSV header prepending). |
| [**`neon-loader/`**](neon-loader/) | Node ETL: list/read R2, parse logs, migrate DB, load Neon Postgres. |

## Quick links

- Deploy the Worker: see [`worker/README.md`](worker/README.md) and [`.github/workflows/deploy-worker.yml`](.github/workflows/deploy-worker.yml). If Cloudflare **Workers Builds** is also connected to this repo, see the **“Workers Builds”** section in `worker/README.md` (monorepo root vs `worker/`).
- Run the loader: see [`neon-loader/README.md`](neon-loader/README.md) and [`.github/workflows/ingest-r2-to-neon.yml`](.github/workflows/ingest-r2-to-neon.yml).

## Git

The repository root is this folder (`acquisuite-worker/`). Use `npm install` separately in `worker/` and `neon-loader/` as needed.
