# utilities-monitor
2026 utilities monitoring update

## AcquiSuite ingest Worker

This branch adds a Cloudflare Worker (see `src/index.js`) that accepts uploads from an AcquiSuite device and stores the compressed log file in an R2 bucket.

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

## Deploy locally (Wrangler)

```bash
npm install
wrangler login
wrangler deploy
```

## Deploy on every push to `main` (GitHub Actions)

This repo includes a workflow at `.github/workflows/deploy-worker.yml`.

In your GitHub repo settings, add **Actions secrets**:

- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with **Workers:Edit** (and any R2 permissions you use)
- `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account id

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
