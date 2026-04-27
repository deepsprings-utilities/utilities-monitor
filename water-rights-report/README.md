# Water rights Template A1 (Excel from Neon)

This package **builds a filled “Template A1” (diversion to direct use) workbook** from flow GPM in **Neon** using the same Excel template. Two **streams** are supported:

- **Wyman** (`REPORT_FLOW_STREAM=wyman`, default): `hydro_plant` + `flow_wyman_avg` (mb-006 Wyman Creek).
- **Booster** (`REPORT_FLOW_STREAM=booster`): mb-003 flow columns `flow_avg_A` and `flow_avg` (same instant → `flow_avg_A` wins), plus legacy rows still tagged `hydro_plant` on mb-003 when the device filter matches.

It is **separate** from AcquiSuite HTTP ingest (`worker/`) and R2→Neon (`neon-loader/`), but **reads the same database** the loader populates.

## What’s in this folder

| Path | Role |
|------|------|
| [`generate-a1-report.mjs`](generate-a1-report.mjs) | Queries Postgres, fills the Excel template, writes a dated `.xlsx` (configurable `OUT_PATH`). |
| [`upload-google-drive.mjs`](upload-google-drive.mjs) / [`upload-dropbox.mjs`](upload-dropbox.mjs) | Optional upload of the generated file (credentials via env; see script headers). |
| [`assets/template-a1.xlsx`](assets/template-a1.xlsx) | Excel layout the generator fills. |
| [`package.json`](package.json) | Scripts: `generate`, `generate:wyman`, `generate:booster`, `upload-dropbox`. |

## Requirements

- **Node 20+**
- **`NEON_DATABASE_URL`** (required for `generate`)
- Flow rows must match tall table reality: default metric is **`flow_wyman_avg`** (Wyman Creek on mb-006 per ingest / Grafana). If your export used **`flow_C`**, set Variable **`WATER_RIGHTS_FLOW_METRIC`** accordingly.
- **`WATER_RIGHTS_FLOW_SCALE`** — multiply stored GPM before the workbook (CI defaults to **4** if Variable unset; set **`1`** to use raw Neon values).
- Optional: **`WATER_RIGHTS_SERIAL`** or **`WATER_RIGHTS_DEVICE_ADDRESS`** (e.g. `mb-006`); **`REPORT_YEAR`**, **`REPORT_END`**, **`REPORT_TZ`**, and static columns (see `generate-a1-report.mjs`).

## Local run

```bash
cd water-rights-report
npm ci
export NEON_DATABASE_URL="postgresql://..."
npm run generate
```

## Automation

A **monthly** (and manual) workflow runs **two jobs** from [`.github/workflows/water-rights-a1-report.yml`](../.github/workflows/water-rights-a1-report.yml):

| Job | Stream | Dropbox enable Variable | Folder Variable |
|-----|--------|-------------------------|-----------------|
| `a1-report` | Wyman | `WATER_RIGHTS_USE_DROPBOX` | `WATER_RIGHTS_DROPBOX_DEST_FOLDER` |
| `a1-booster-report` | Booster | `BOOSTER_USE_DROPBOX` | `BOOSTER_DROPBOX_DEST_FOLDER` |

Booster timing/year defaults fall back to the same **`WATER_RIGHTS_REPORT_*`** Variables if **`BOOSTER_REPORT_YEAR`** / **`BOOSTER_REPORT_END`** are unset. Booster-specific overrides: **`BOOSTER_FLOW_METRIC`**, **`BOOSTER_DEVICE_ADDRESS`**, **`BOOSTER_FLOW_SCALE`**, static column `BOOSTER_*` or fallback `WATER_RIGHTS_*`.

### Dropbox upload (monthly A1 `.xlsx`)

1. **Dropbox app** — [Dropbox Developers](https://www.dropbox.com/developers/apps) → Create app → **Scoped access** → choose **App folder** (isolated tree) or **Full Dropbox** (you choose paths under `/`). Enable **`files.content.write`** (and read if you want). Note **App key** and **App secret**.
2. **Refresh token** — OAuth with `token_access_type=offline` so you get a **refresh token** (one-time human step). Store it only in GitHub Secrets, never in the repo. Details in [`upload-dropbox.mjs`](upload-dropbox.mjs) header comment.
3. **GitHub Secrets** (repository **Actions → Secrets**):  
   - `DROPBOX_APP_KEY`  
   - `DROPBOX_APP_SECRET`  
   - `DROPBOX_REFRESH_TOKEN`
4. **GitHub Variables** (repository **Actions → Variables**):  
   - **Wyman job:** `WATER_RIGHTS_USE_DROPBOX` = `true`; `WATER_RIGHTS_DROPBOX_DEST_FOLDER` — folder path only (e.g. `"/WaterRights/Wyman"`).  
   - **Booster job:** `BOOSTER_USE_DROPBOX` = `true`; `BOOSTER_DROPBOX_DEST_FOLDER` — separate folder for booster outputs (e.g. `"/WaterRights/Booster"`).  
   Empty/unset folder = app-folder root; filenames are `Template-A1-Wyman-…` vs `Template-A1-Booster-…` so two jobs do not overwrite each other when using the same Dropbox app.
5. **Run once** — **Actions → Water rights Template A1 report → Run workflow**. Confirm the **Upload to Dropbox** step runs and logs JSON with `"ok": true`.

**If Dropbox returns `invalid_grant` / `refresh_token is malformed`:** the string in **`DROPBOX_REFRESH_TOKEN`** is wrong for this app—not necessarily “your fault.” Re-paste with **no surrounding quotes**, no line breaks (GitHub Secrets are one line). Confirm you stored the **`refresh_token`** from an OAuth response with **`token_access_type=offline`**, not the short **`access_token`**. The refresh token must come from **the same** Dropbox app as `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET`. After rotating app secret or revoking access, generate a **new** refresh token.

**If uploads return `401` / `missing_scope` / `files.content.write`:** enabling **Write** in the App Console does **not** retroactively upgrade an old refresh token. You must **authorize again** with the **`scope`** query parameter on the Dropbox authorize URL (scoped apps), e.g. include `scope=files.content.write` (URL-encode spaces if you add multiple scopes). Then exchange the new `code` for a **new** `refresh_token` and update **`DROPBOX_REFRESH_TOKEN`** in GitHub.

If you use **Google Drive** as well, set `WATER_RIGHTS_GOOGLE_DRIVE_FOLDER_ID`; both upload steps can run when their conditions are met.

## Monorepo context

See the root [`README.md`](../README.md) for how this folder fits next to `worker/`, `neon-loader/`, and `water-compliance/`.
