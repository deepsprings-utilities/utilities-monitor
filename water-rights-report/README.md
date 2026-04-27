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

### Dropbox upload (monthly A1 `.xlsx`)

1. **Dropbox app** — [Dropbox Developers](https://www.dropbox.com/developers/apps) → Create app → **Scoped access** → choose **App folder** (isolated tree) or **Full Dropbox** (you choose paths under `/`). Enable **`files.content.write`** (and read if you want). Note **App key** and **App secret**.
2. **Refresh token** — OAuth with `token_access_type=offline` so you get a **refresh token** (one-time human step). Store it only in GitHub Secrets, never in the repo. Details in [`upload-dropbox.mjs`](upload-dropbox.mjs) header comment.
3. **GitHub Secrets** (repository **Actions → Secrets**):  
   - `DROPBOX_APP_KEY`  
   - `DROPBOX_APP_SECRET`  
   - `DROPBOX_REFRESH_TOKEN`
4. **GitHub Variables** (repository **Actions → Variables**):  
   - `WATER_RIGHTS_USE_DROPBOX` = `true` (exact string — enables the upload step)  
   - `WATER_RIGHTS_DROPBOX_DEST_FOLDER` — destination **folder** only, Dropbox path style. Examples: `""` or empty / unset = app-folder root; `"/WaterRights/A1"` for Full Dropbox (leading slash, no filename). The workflow passes the generated `.xlsx` name; the script **overwrites** the same name each run unless you change naming in `generate-a1-report.mjs`.
5. **Run once** — **Actions → Water rights Template A1 report → Run workflow**. Confirm the **Upload to Dropbox** step runs and logs JSON with `"ok": true`.

**If Dropbox returns `invalid_grant` / `refresh_token is malformed`:** the string in **`DROPBOX_REFRESH_TOKEN`** is wrong for this app—not necessarily “your fault.” Re-paste with **no surrounding quotes**, no line breaks (GitHub Secrets are one line). Confirm you stored the **`refresh_token`** from an OAuth response with **`token_access_type=offline`**, not the short **`access_token`**. The refresh token must come from **the same** Dropbox app as `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET`. After rotating app secret or revoking access, generate a **new** refresh token.

**If uploads return `401` / `missing_scope` / `files.content.write`:** enabling **Write** in the App Console does **not** retroactively upgrade an old refresh token. You must **authorize again** with the **`scope`** query parameter on the Dropbox authorize URL (scoped apps), e.g. include `scope=files.content.write` (URL-encode spaces if you add multiple scopes). Then exchange the new `code` for a **new** `refresh_token` and update **`DROPBOX_REFRESH_TOKEN`** in GitHub.

If you use **Google Drive** as well, set `WATER_RIGHTS_GOOGLE_DRIVE_FOLDER_ID`; both upload steps can run when their conditions are met.

## Monorepo context

See the root [`README.md`](../README.md) for how this folder fits next to `worker/`, `neon-loader/`, and `water-compliance/`.
