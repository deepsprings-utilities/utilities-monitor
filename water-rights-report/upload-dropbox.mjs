#!/usr/bin/env node
/**
 * Uploads a file to Dropbox using a long-lived refresh token (works on GitHub Actions).
 *
 * One-time setup:
 * 1) https://www.dropbox.com/developers/apps → Create app → Scoped access
 * 2) Choose "App folder" (simpler, isolated) or "Full Dropbox" (pick a /path)
 * 3) Permissions: enable `files.content.write` (and `files.content.read` if you want to verify)
 * 4) Get a long-lived **refresh token** (one-time, human-in-the-loop): OAuth2 with
 *    `token_access_type=offline` and, for **scoped** apps, a **`scope=`** query on the
 *    authorize URL listing `files.content.write` (and optional `files.content.read`).
 *    Tokens issued **before** you enabled a permission in the App Console do **not** gain
 *    that scope until you **re-authorize** and replace `DROPBOX_REFRESH_TOKEN`.
 *    See: https://www.dropbox.com/developers/documentation/http/documentation#authorization
 *    (or search “Dropbox refresh token generator” for small helper tools; keep secrets out of git.)
 *
 * Env (GitHub: store sensitive values in Secrets; folder path can be a Variable):
 *   DROPBOX_APP_KEY       — App key
 *   DROPBOX_APP_SECRET    — App secret
 *   DROPBOX_REFRESH_TOKEN — long-lived refresh token
 *   UPLOAD_FILE           — local path (required)
 *   UPLOAD_NAME           — filename on Dropbox (default: basename of UPLOAD_FILE)
 *   DROPBOX_DEST_FOLDER   — e.g. "/WaterRights" or "" for app-folder root (default "")
 *
 *   Optional: if your SDK/runtime needs explicit fetch, Node 20 provides global fetch.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Dropbox } from "dropbox";

function joinDropboxPath(folder, name) {
  const base = (folder || "").replace(/\/+$/, "");
  const file = name.startsWith("/") ? name : `/${name}`;
  if (!base) return file;
  return `${base}${file}`;
}

/** GitHub / shell paste often adds spaces or wrapping quotes — Dropbox rejects those as malformed. */
function cleanDropboxSecret(raw) {
  if (raw == null || typeof raw !== "string") return "";
  let s = raw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

async function main() {
  const appKey = cleanDropboxSecret(process.env.DROPBOX_APP_KEY);
  const appSecret = cleanDropboxSecret(process.env.DROPBOX_APP_SECRET);
  const refreshToken = cleanDropboxSecret(process.env.DROPBOX_REFRESH_TOKEN);
  const localPath = process.env.UPLOAD_FILE;
  if (!appKey || !appSecret || !refreshToken) {
    throw new Error(
      "Set DROPBOX_APP_KEY, DROPBOX_APP_SECRET, and DROPBOX_REFRESH_TOKEN",
    );
  }
  if (!localPath || !fs.existsSync(localPath)) {
    throw new Error(`UPLOAD_FILE missing or not found: ${localPath || ""}`);
  }

  const name = process.env.UPLOAD_NAME || path.basename(localPath);
  const destFolder = (process.env.DROPBOX_DEST_FOLDER || "").trim();
  const dropboxPath = joinDropboxPath(destFolder, name);

  const dbx = new Dropbox({
    clientId: appKey,
    clientSecret: appSecret,
    refreshToken,
    fetch,
  });

  const contents = fs.readFileSync(localPath);
  const response = await dbx.filesUpload({
    path: dropboxPath,
    contents,
    mode: { ".tag": "overwrite" },
    autorename: false,
  });
  const meta = response.result;

  console.log(
    JSON.stringify(
      { ok: true, path: meta.path_display, id: meta.id, name: meta.name },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  const msg = String(err?.message || err);
  const nested = err?.error;
  const invalidGrant =
    (nested && typeof nested === "object" && nested.error === "invalid_grant") ||
    nested === "invalid_grant" ||
    msg.includes("invalid_grant") ||
    msg.includes("malformed");
  if (invalidGrant) {
    console.error(
      "\nDropbox invalid_grant / malformed refresh token — usual causes:\n" +
        "  • Secret value has extra spaces, line breaks, or wrapping quotes — re-paste the token in GitHub (no quotes).\n" +
        "  • Value is an access_token (short) instead of refresh_token from OAuth with token_access_type=offline.\n" +
        "  • Token was created for a different Dropbox app than DROPBOX_APP_KEY / DROPBOX_APP_SECRET.\n" +
        "  • Token was revoked in Dropbox or app settings changed — generate a new refresh token.\n",
    );
  }

  const tag = err?.error?.error?.[".tag"];
  const missingScope =
    err?.status === 401 &&
    (tag === "missing_scope" ||
      String(err?.error?.error_summary || "").includes("missing_scope")) ||
    msg.includes("missing_scope");
  if (missingScope) {
    const need = err?.error?.error?.required_scope || "files.content.write";
    console.error(
      `\nDropbox 401 missing_scope (needs ${need}) — the refresh token was issued without this scope.\n` +
        "  • In App Console → Permissions, enable the scope and **Submit**.\n" +
        "  • Re-run OAuth **authorize** with **scope** in the URL, e.g.:\n" +
        "    scope=files.content.write%20files.content.read\n" +
        "    (with token_access_type=offline). Exchange the new code for tokens.\n" +
        "  • Replace DROPBOX_REFRESH_TOKEN in GitHub with the **new** refresh_token.\n",
    );
  }

  console.error(err);
  process.exit(1);
});
