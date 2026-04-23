#!/usr/bin/env node
/**
 * Uploads a file to a shared Google Drive folder using a service account.
 *
 * Prereqs:
 *   - Create a Google Cloud service account, enable Google Drive API.
 *   - Share the destination Drive folder with the service account email (Editor).
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
    const hint =
      e?.code === 404 || e?.response?.status === 404
        ? "\nHint: Folder not found or the service account cannot see it — in Drive, Share the folder with the JSON file’s client_email (Editor)."
        : e?.code === 403 || e?.response?.status === 403
          ? "\nHint: Permission denied — share that folder with client_email from the JSON (Editor). On a Shared drive, share the folder (or use Content manager on the drive if required)."
          : "";
    throw new Error(`${formatDriveError(e)}${hint}`, { cause: e });
  }

  console.log(JSON.stringify({ ok: true, file: created.data }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
