# AcquiSuite ingest Worker

Cloudflare Worker (see `src/index.js`) that accepts uploads from an AcquiSuite device and stores the compressed log file in an R2 bucket.

Run **`npm install` / `wrangler deploy` from this `worker/` directory** (or set CI `working-directory` to `worker`).

### “Workers Builds: acquisuite-ingest” (dashboard / email)

That text is the **title** for Cloudflare’s **Workers Builds** product — the **Git-connected** deploy path in the dashboard — not the full error message.

This repo already deploys via **GitHub Actions** (`.github/workflows/deploy-worker.yml`). If you **also** connected the same GitHub repo under **Worker → Settings → Build**, **every push can run two deploys**; the Cloudflare one often **fails in monorepos** because Builds defaults to the **repository root**, where there is **no** `wrangler.jsonc` (it lives under `worker/`).

**Pick one:**

| Approach | What to do |
|----------|------------|
| **GitHub Actions only** (recommended here) | In Cloudflare: **Workers & Pages → acquisuite-ingest → Settings → Build** — **disconnect** the Git repo or disable automatic Workers Builds so only Actions deploys. |
| **Workers Builds only** | Same **Settings → Build**: set **Root directory** to `worker`, **Deploy command** to `npx wrangler deploy` (and **Build command** to `npm ci` if needed). You can then turn off the GitHub deploy workflow if you want a single pipeline. |

For the real failure reason, open **Deployments → View build history** (or the failed run) and read the **log lines below** that title — not the duplicated “Workers Builds: …” heading.

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

Canonical header lines per MB device are in **`src/mb-csv-header-lines.json`** (regenerated via `scripts/build-mb-csv-headers.mjs`).

When `PREPEND_CSV_HEADERS` is enabled (default):

1. The Worker picks the canonical row from **`mb-csv-header-lines.json`** using:
   - **`mb-001` … `mb-999` in the LOGFILE filename** (also `mb-1` → `001`), **or**
   - Worker variable **`DEFAULT_CSV_HEADER_MB`** (e.g. `004`) when filenames from AcquiSuite **do not** include `mb-…` — set this in **Wrangler `vars`** or Cloudflare **Worker → Settings → Variables** so HTTP uploads still get a header row.
2. After gunzip, the Worker **scans the first ~12 lines** for a row that **exactly matches** that canonical header (normalized: tab-separated, trimmed cells). If a match is found (including after a junk line before the real header), **nothing is prepended**; metadata includes `csv_header_matched=true` and `csv_header_mb=<code>`.
3. If **no** matching header row is found, the Worker **prepends** the canonical line from the JSON. Metadata includes `csv_header_prepended=true` and `csv_header_mb=<code>`.

- **No header row inside the `.log.gz` in R2?** Check R2 metadata on the object: if there is **no** `csv_header_prepended` / `csv_header_matched`, the Worker did not know which MB row to use (add **`DEFAULT_CSV_HEADER_MB`**) or prepending is off (`PREPEND_CSV_HEADERS`), or the file is not gzip.
- **Disable** prepending in Cloudflare: Worker → Settings → Variables → `PREPEND_CSV_HEADERS` = `0` or `false`.
- **Regenerate** header strings after changing column lists:

```bash
node scripts/build-mb-csv-headers.mjs
```

Then redeploy the Worker.

## Testing header matching and CSV prepending

**Automated (Vitest):** from `worker/`:

```bash
npm test
```

This runs `test/csv-header.spec.js` (normalized header equality, junk line before header, gzip + `maybePrependCsvHeader` matched vs prepended) and a small smoke test on `GET`.

**Manual (live Worker):** from `worker/`:

```bash
wrangler dev
```

Then send a multipart POST with a `LOGFILE` part (gzip body). Check R2 object metadata: `csv_header_matched` vs `csv_header_prepended`, or gunzip the object and confirm the first data line is the canonical header from `mb-csv-header-lines.json` when prepending ran.

## Deploy locally (Wrangler)

```bash
npm install
wrangler login
wrangler deploy
```

## Deploy on every push to `main` (GitHub Actions)

This repo includes a workflow at `.github/workflows/deploy-worker.yml`.

Under **Settings → Secrets and variables → Actions**:

**GitHub Actions secrets (case-sensitive):**

- **`CLOUDFLARE_API_TOKEN`** (**Secret**): API token with **Workers:Edit** (and R2 if needed).
- **`CLOUDFLARE_ACCOUNT_ID`** (**Secret or Variable**): 32-character hex **Account ID** (Workers overview sidebar — not Zone ID).

**Common issues**

- **Secrets vs Variables:** Account ID can be a **Variable** with the same name; the workflow merges secret first, then variable.
- **Environment-scoped secrets:** If a secret is only on a GitHub **Environment**, add `environment: <name>` to `jobs.deploy`, or use repository-level secrets.
- **Fallback:** Uncomment `"account_id"` in `wrangler.jsonc` if CI cannot provide `CLOUDFLARE_ACCOUNT_ID` (safe to commit).

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
