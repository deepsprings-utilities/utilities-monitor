#!/usr/bin/env node
/**
 * Uploads a file to Dropbox using a long-lived refresh token (works on GitHub Actions).
 *
 * One-time setup:
 * 1) https://www.dropbox.com/developers/apps → Create app → Scoped access
 * 2) Choose "App folder" (simpler, isolated) or "Full Dropbox" (pick a /path)
 * 3) Permissions: enable `files.content.write` (and `files.content.read` if you want to verify)
 * 4) Get a long-lived **refresh token** (one-time, human-in-the-loop): use OAuth2 with
 *    `token_access_type=offline` so the token response includes `refresh_token`.
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

async function main() {
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
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
  console.error(err);
  process.exit(1);
});
