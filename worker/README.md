# AcquiSuite ingest (Cloudflare Worker)

**Role in the monorepo:** this folder is the **only** Cloudflare Worker package. It is the **edge upload endpoint** for AcquiSuite; everything downstream (R2 listing, Neon load, Grafana) lives in other folders—see the root [`README.md`](../README.md).

This is the small **receiving** service that sits between your **AcquiSuite device** and **cloud storage**. When the device is set up for **HTTP/HTTPS upload**, it sends compressed log files here; the service checks that the request is allowed, then **saves the file** in a private bucket (Cloudflare R2) so the rest of your pipeline can use it.

You do not need to understand the cloud parts to understand what it does: **the device delivers logs; this service stores them and answers “ok”** so the device does not keep retrying.

## What it does, step by step

1. **Accepts uploads** from the device over normal web (HTTPS) when someone configures AcquiSuite to push logs to your URL.
2. **Verifies a shared secret** (an API key you configure). If the key is wrong or missing, the upload is rejected; if it is right, the service continues.
3. **Finds the log file** in the upload. AcquiSuite sends a form with a file field called **LOGFILE** (usually a `.log.gz` file). The service may also read simple text fields the device can send, such as a **serial number** and **timestamp**, to organize storage.
4. **Stores a copy in cloud storage** under a path that includes the date and, when available, the device’s serial number—so you can find files later without digging through one giant folder.
5. **Responds with success** in a way AcquiSuite expects, so the device treats the run as complete.

**Health checks:** Simple browser or monitoring requests that are not “upload this file” get a short **“SUCCESS - OK”** response so status checks do not look like errors.

## Why some uploads look like “data only” and others include a full spreadsheet header

AcquiSuite can send logs in **different ways** (for example, saving to a file share versus pushing over the web). Over **HTTP**, the file is often a **compressed block of data rows** without the top row that names each column. Over **other paths**, you might see a full CSV with a header line first. **This service does not remove headers** from what the device sent; it stores the payload as received.

**Optional behavior (on by default):** For HTTP uploads, the service can **add a single standard title row** at the top of the decompressed data when the file does not already contain that exact row, so downstream tools (and databases) that expect a **named header line** still work. It chooses which “column names” line to use based on hints in the **filename** (for example, an `mb-004`-style code) or a default you set in the Worker’s configuration if the filename has no such hint. If a matching header is already there, it **does not duplicate** it.

**Checking what happened:** In your bucket, each stored object can carry **metadata** flags such as whether a header was **matched** (already present) or **added**, and which device profile (`mb-…`) was used. That helps you confirm the behavior without opening every file.

## What you configure on the device (overview)

- **URL** — The HTTPS address your team gives you (often under your own domain) that points at this service.
- **How to send the key** — Either as part of the URL, or as a header, or as a password in basic auth, depending on what your team documented—**it must match the API key** stored for the Worker.
- **Same upload shape AcquiSuite already uses for HTTP** — A multipart form with the log as **LOGFILE**; optional fields like **SERIALNUMBER**, **FILETIME**, and **LOOPNAME** when your deployment uses them for naming or tracking.

If something fails (wrong key, wrong URL, or the device is not actually sending the log file in the form), the device may show an error or retry; your team can use Worker and bucket logs in Cloudflare to narrow it down.

## What’s in the `worker/` folder

| Path | Purpose |
|------|---------|
| [`src/index.js`](src/index.js) | Worker: multipart upload handler, R2 `put`, optional gzip + CSV header prepend. |
| [`src/mb-csv-header-lines.json`](src/mb-csv-header-lines.json) | Canonical first CSV line per ModBus-style device code—**do not hand-edit**; regenerate from `neon-loader` column orders (below). |
| [`scripts/build-mb-csv-headers.mjs`](scripts/build-mb-csv-headers.mjs) | Rebuilds `mb-csv-header-lines.json` from `../neon-loader/schema-column-orders.json` (`npm run build:worker-headers`). |
| [`test/`](test/) | Vitest: header matching, gzip, smoke `GET`. |
| [`wrangler.jsonc`](wrangler.jsonc) | Wrangler config (name, R2 **BUCKET** binding, vars). |
| [`package.json`](package.json) | `dev` / `deploy` / `test` / `build:worker-headers`. |

**Related (outside this folder):** GitHub deploy workflow is [`.github/workflows/deploy-worker.yml`](../.github/workflows/deploy-worker.yml) with `working-directory: worker`.

## For developers and operators

- **Code and behavior details:** `src/index.js` (Worker); canonical header list: `src/mb-csv-header-lines.json` (regenerated with `node scripts/build-mb-csv-headers.mjs` when column layouts change, then redeploy).
- **Tests (header matching, gzip):** from this directory, `npm test`.
- **Deploying this package:** `npm install` and Wrangler from the **`worker/`** directory; this repository also has CI that deploys on push. Broader monorepo notes (secrets, R2 binding name `BUCKET`): see the root [`README.md`](../README.md) and [`AGENTS.md`](../AGENTS.md).

### If you see two deploys or “Workers Builds: acquisuite-ingest” in email

The duplicate **“Workers Builds: acquisuite-ingest”** line is a Cloudflare **product label**, not the full error text. This repo is usually set up to deploy from **GitHub**; if the same Worker is also connected to **Git in the Cloudflare dashboard**, every push can trigger **two** builds. Use **one** path: turn off the Git-based Workers build for this worker, *or* point that build at the **`worker/`** root (and avoid running two CD systems at once). See [`AGENTS.md`](../AGENTS.md) for the monorepo layout.
