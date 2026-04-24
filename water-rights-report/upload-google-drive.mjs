#!/usr/bin/env node
/**
 * Uploads a file to a Google Drive folder using a service account.
 *
 * Important: Service accounts have **no personal “My Drive” storage quota**.
 * The destination folder must live on a **Google Workspace Shared drive** (Team Drive),
 * and the service account must be added to that shared drive (at least Contributor) or
 * have access to a folder created inside it. Uploads to a folder in someone’s personal
 * My Drive fail with 403 storageQuotaExceeded even if the folder is “shared”.
 *
 * Prereqs:
 *   - Enable Google Drive API for the GCP project.
 *   - Target folder ID must be under a Shared drive; add the SA’s client_email to the drive or folder.
 *
 * Env:
 *   GOOGLE_SERVICE_ACCOUNT_JSON — full JSON key (GitHub Secret), or path via GOOGLE_SERVICE_ACCOUNT_JSON_FILE
 *   GOOGLE_DRIVE_FOLDER_ID — target folder id (from URL)
 *   GOOGLE_DRIVE_SCOPE — optional; space- or comma-separated OAuth scopes (default: full drive for reliable writes to shared folders)
 *   UPLOAD_FILE — path to xlsx (required)
 *   UPLOAD_NAME — destination filename (default: basename of UPLOAD_FILE)
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { google } from "googleapis";

function loadCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_FILE;
  if (raw) {
    try {
      return JSON.parse(raw.trim());
    } catch (e) {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON (check GitHub Secret: full key, no extra quotes wrapping the whole blob).",
        { cause: e },
      );
    }
  }
  if (file && fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  throw new Error(
    "Missing credentials: set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_JSON_FILE",
  );
}

/** Default scope works reliably when uploading into a folder shared with the service account. */
function driveScopes() {
  const s = process.env.GOOGLE_DRIVE_SCOPE;
  if (s && s.trim()) {
    return s.split(/[\s,]+/).filter(Boolean);
  }
  return ["https://www.googleapis.com/auth/drive"];
}

function formatDriveError(err) {
  const data = err?.response?.data;
  const status = err?.response?.status;
  const msg = err?.message;
  const parts = [
    msg,
    status && `HTTP ${status}`,
    data && typeof data === "object" ? JSON.stringify(data) : data,
  ].filter(Boolean);
  return parts.join(" — ");
}

function isStorageQuotaExceeded(err) {
  const body = err?.response?.data;
  const nested = body?.error?.errors;
  const flat = body?.errors;
  const list = Array.isArray(nested) ? nested : Array.isArray(flat) ? flat : [];
  if (list.some((x) => x?.reason === "storageQuotaExceeded")) return true;
  const msg = String(err?.message || body?.error?.message || "");
  return (
    msg.includes("storage quota") || msg.includes("storageQuotaExceeded")
  );
}

function hintForDriveError(err) {
  if (isStorageQuotaExceeded(err)) {
    return `\nHint: Service accounts cannot use personal My Drive space. Create or use a folder on a **Shared drive** (Google Workspace), add your service account to that shared drive (Manage members → Content manager or Contributor), set GOOGLE_DRIVE_FOLDER_ID to that folder’s id, and re-run.`;
  }
  if (err?.code === 404 || err?.response?.status === 404) {
    return `\nHint: Folder not found or the service account cannot see it — in Drive, Share the folder with the JSON file’s client_email (Editor).`;
  }
  if (err?.code === 403 || err?.response?.status === 403) {
    return `\nHint: Permission denied — share the folder with client_email from the JSON (Editor). On a Shared drive, add the service account to the drive or folder with write access.`;
  }
  return "";
}

async function main() {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const localPath = process.env.UPLOAD_FILE;
  if (!folderId || !localPath) {
    throw new Error("GOOGLE_DRIVE_FOLDER_ID and UPLOAD_FILE are required");
  }
  if (!fs.existsSync(localPath)) {
    throw new Error(`File not found: ${localPath}`);
  }

  const name =
    process.env.UPLOAD_NAME ||
    path.basename(localPath);

  const keys = loadCredentials();
  if (!keys.client_email || !keys.private_key) {
    throw new Error(
      "JSON key must include client_email and private_key (use the .json from Google, not the numeric key id).",
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials: keys,
    scopes: driveScopes(),
  });
  const drive = google.drive({ version: "v3", auth });

  const media = {
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: fs.createReadStream(localPath),
  };

  let created;
  try {
    created = await drive.files.create({
      requestBody: {
        name,
        parents: [folderId.trim()],
      },
      media,
      fields: "id, name, webViewLink, webContentLink, mimeType",
      supportsAllDrives: true,
    });
  } catch (e) {
    throw new Error(`${formatDriveError(e)}${hintForDriveError(e)}`, {
      cause: e,
    });
  }

  console.log(JSON.stringify({ ok: true, file: created.data }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
