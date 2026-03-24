# AcquiSuite ingest Worker

Cloudflare Worker (see `src/index.js`) that accepts uploads from an AcquiSuite device and stores the compressed log file in an R2 bucket.

Run **`npm install` / `wrangler deploy` from this `worker/` directory** (or set CI `working-directory` to `worker`).

### How the Worker behaves

- **Methods**
  - `POST` / `PUT`: treated as uploads.
  - Any other method (GET, HEAD, etc.): immediately returns a simple **200 "SUCCESS - OK"** so status checks don’t fail.
- **Authentication**
  - Accepts an API key from any of:
    - Query string `?key=...` or `?password=...`
    - Header `x-api-key: ...`
    - Basic auth password in `Authorization: Basic ...`
  - Compares against the `API_KEY` secret; if it doesn’t match, returns **403 FORBIDDEN**.
- **Multipart parsing**
  - If `Content-Type` is not `multipart/form-data`, the Worker just returns **SUCCESS - OK** (so odd test posts don’t error).
  - For multipart uploads, it:
    - Extracts file part named **`LOGFILE`** (expected `.log.gz`).
    - Extracts text fields `SERIALNUMBER`, `FILETIME`, `LOOPNAME` when present.
- **R2 storage**
  - Requires an R2 binding named **`BUCKET`**.
  - Stores the file as:
    - `log-gz/<SERIALNUMBER>/<YYYY>/<MM>/<DD>/<filename>`
  - Adds R2 metadata: `serial`, `filetime`, `loopname`, `source=acquisuite`.
  - Always ends with a **200 "SUCCESS - OK"** response so the device is happy.

### Why FTP CSVs have headers but HTTP uploads sometimes don’t

AcquiSuite uses **different export profiles** for “push to FTP/file server” vs “HTTP/HTTPS remote upload”. The **HTTP path often sends gzip-compressed body rows only** (no `time(UTC)` header line), while FTP exports often include the full CSV with a header row. The Worker **does not strip** headers— it stores what the device sends.

### CSV header prepending (optional, on by default)

The Worker can **prepend a tab-separated header line** that matches your site’s known column layouts (same source as `../neon-loader/schema-column-orders.json`), when:

1. The **LOGFILE** filename contains `mb-001` … `mb-009` (device id), and  
2. After gunzip, the payload **does not** already start with `time(UTC)`.

When a header is prepended, R2 object metadata includes `csv_header_prepended=true` and `csv_header_mb=<code>`.

- **Disable** in Cloudflare: Worker → Settings → Variables → `PREPEND_CSV_HEADERS` = `0` or `false`.
- **Regenerate** header strings after changing column lists:

```bash
node scripts/build-mb-csv-headers.mjs
```

Then redeploy the Worker.

## Deploy locally (Wrangler)

```bash
npm install
wrangler login
wrangler deploy
```

## Deploy on every push to `main` (GitHub Actions)

This repo includes a workflow at `.github/workflows/deploy-worker.yml`.

Under **Settings → Secrets and variables → Actions**:

**Common mistakes**

- **Secrets vs Variables:** The **API token** must be a **Secret** named `CLOUDFLARE_API_TOKEN`. The **Account ID** can be a **Secret or Variable** named `CLOUDFLARE_ACCOUNT_ID` (the workflow merges both in bash).
- **Environment-scoped secrets:** If the Account ID secret is attached to a GitHub **Environment** (e.g. `production`), it is **empty** unless the job declares `environment: production`. Either move the secret to repository-level, or add that key to `.github/workflows/deploy-worker.yml` under `jobs.deploy`.
- **Fallback:** Uncomment `"account_id"` in `wrangler.jsonc` and paste your 32-char hex Account ID (safe to commit; Wrangler uses it when `CLOUDFLARE_ACCOUNT_ID` is unset).

- `CLOUDFLARE_API_TOKEN` (**Secret**): Cloudflare API token with **Workers:Edit** (and any R2 permissions you use)
- `CLOUDFLARE_ACCOUNT_ID` (**Secret or Variable**): 32-character hex **Account ID** from the Cloudflare dashboard (Workers overview sidebar — not Zone ID)

## Required Worker config

- **Secret**: set `API_KEY` (Worker secret)
  - Locally: `wrangler secret put API_KEY`
  - Or in Cloudflare dashboard: Worker → Settings → Variables
- **R2 binding**: bind your R2 bucket to `BUCKET`
  - In Cloudflare dashboard: Worker → Settings → Bindings → R2 bucket → `BUCKET`

## Connect to a domain / route

In Cloudflare dashboard: Worker → Triggers → **Routes** → add a route for your zone (example: `example.com/acquisuite/*`).

## Pointing AcquiSuite at the Worker

Once the Worker is deployed and routed:

- Use a URL like: `https://example.com/acquisuite/upload` (whatever route you configured).
- Configure AcquiSuite to:
  - Use **HTTP/HTTPS** uploads to that URL.
  - Send either:
    - `?key=YOUR_API_KEY` on the URL, or
    - Header `x-api-key: YOUR_API_KEY`, or
    - A Basic auth password matching `API_KEY`.
  - Send the log as `multipart/form-data` with:
    - File field `LOGFILE` (the `.log.gz` file).
    - Optional text fields: `SERIALNUMBER`, `FILETIME`, `LOOPNAME`.
