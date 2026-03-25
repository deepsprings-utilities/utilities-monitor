# AcquiSuite monorepo — agent context

Concise orientation for AI assistants working in this repository. Prefer linking to existing docs over duplicating them.

## Monorepo map

| Path | Role |
|------|------|
| [`worker/`](worker/) | Cloudflare Worker: AcquiSuite HTTP uploads → R2 (gzip logs; optional CSV header handling). Entry: `worker/src/index.js`, config: `worker/wrangler.jsonc`. |
| [`neon-loader/`](neon-loader/) | Node ETL: list/read R2, expand logs, map filename/device hints to schema, load **Neon Postgres**. |
| [`.github/workflows/deploy-worker.yml`](.github/workflows/deploy-worker.yml) | Deploy Worker on push (uses `working-directory: worker`). |
| [`.github/workflows/ingest-r2-to-neon.yml`](.github/workflows/ingest-r2-to-neon.yml) | Scheduled + manual ingest: R2 → `neon-loader` → Neon. |

Human-oriented detail: root [`README.md`](README.md), [`worker/README.md`](worker/README.md), [`neon-loader/README.md`](neon-loader/README.md).

## Worker deploy

- Run Wrangler and `npm install` / `npm ci` **from `worker/`** (or mirror that in CI with `working-directory: worker`).
- **Do not** run two uncoordinated deploy pipelines: either **GitHub Actions** (this repo’s workflow) **or** Cloudflare **Workers Builds** with **root directory** set to `worker`, not both without intent. Monorepo default (repo root) breaks Builds because `wrangler.jsonc` lives under `worker/`. Full table: [`worker/README.md`](worker/README.md) (“Workers Builds” section).
- Secrets / env: **`CLOUDFLARE_API_TOKEN`**, **`CLOUDFLARE_ACCOUNT_ID`**, **`CLOUDFLARE_R2_*`** — see deploy workflow and Worker / neon-loader READMEs.

## Data pipeline (R2 → Neon)

- **Flow:** devices → Worker → **R2** → **scheduled GitHub Action** → `neon-loader` → **Postgres (Neon)**.
- Architecture choice for this repo: **cron + Node on GitHub Actions** for ETL (heavier parsing, straightforward Neon drivers, clear logs). Event-driven or hybrid designs are future options if latency requirements change.
- When changing ingestion: preserve **idempotency** (avoid double-loading the same object), respect workflow env vars (`INGEST_PREFIX`, `INGEST_BATCH_LIMIT`, R2/Neon secrets — see [`ingest-r2-to-neon.yml`](.github/workflows/ingest-r2-to-neon.yml)).
- Schema and column-order sources live under `neon-loader/` (migrations, mapping JSON); align Worker CSV header behavior with loader expectations when editing headers.

## Future product direction (not implemented here)

- **Goal:** a **mobile-accessible** experience over data in **Neon**, surfacing **utility / meter status**, with **alerts to a single recipient** (operator).
- **Pragmatic v1:** expose a small API + simple UI or links; use **email or SMS** for notifications before investing in full push (APNs/FCM), unless the user specifies otherwise.
- New code for that should stay separate from the ingest Worker where possible (e.g. new app package or service), reusing Neon as the system of record.

## Conventions for changes

- **Node 20**, **`npm ci`** in the relevant subproject (`worker/` or `neon-loader/`) in CI — match existing workflows.
- Keep edits **scoped** to the task; avoid drive-by refactors and unrelated files.
- **CSV / MB device codes:** filename patterns and header logic are easy to break; extend [`worker/README.md`](worker/README.md) and tests under `worker/test/` when behavior changes.
- Prefer **complete sentences** in commit messages and user-facing docs; link full paths and workflow files when helpful.
