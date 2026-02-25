/**
 * AcquiSuite ingest worker
 * Ingests data from AcquiSuite into a Cloudflare R2 bucket. Configured by wrangler.jsonc.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // --- Always be friendly for non-upload methods (AcquiSuite test / ping) ---
    if (request.method !== "POST" && request.method !== "PUT") {
      return successAck();
    }

    // --- Auth: accept key from query OR x-api-key header OR Basic auth password (optional) ---
    const provided =
      url.searchParams.get("key") ||
      url.searchParams.get("password") ||
      request.headers.get("x-api-key") ||
      extractBasicAuthPassword(request.headers.get("authorization"));

    if (!env.API_KEY) return text("MISSING_API_KEY", 500);
    if (!provided || provided !== env.API_KEY) return text("FORBIDDEN", 403);

    if (!env.BUCKET) return text("MISSING_R2_BINDING", 500);

    const ct = request.headers.get("content-type") || "";

    // --- If it's NOT multipart, treat it like a connection test and ACK success ---
    if (!ct.toLowerCase().includes("multipart/form-data")) {
      return successAck();
    }

    const m = ct.match(/boundary=([^\s;]+)/i);
    if (!m) {
      return successAck();
    }
    const boundary = m[1];

    // Read entire request (AcquiSuite uploads are usually small)
    const bodyBuf = await request.arrayBuffer();
    const body = new Uint8Array(bodyBuf);

    // Primary LOGFILE (required for upload path)
    const filePart = extractMultipartFilePart(body, boundary, "LOGFILE");
    const allParts = extractAllMultipartFileParts(body, boundary);

    if (!filePart && !allParts.length) {
      return successAck();
    }

    const serial = extractMultipartTextField(body, boundary, "SERIALNUMBER") || "unknown_serial";
    const filetime = extractMultipartTextField(body, boundary, "FILETIME") || "";
    const loopname = extractMultipartTextField(body, boundary, "LOOPNAME") || "";

    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");

    const safeSerial = safeKey(serial);
    const meta = { serial, filetime, loopname, source: "acquisuite" };

    // Store primary LOGFILE
    if (filePart) {
      const safeName = safeKey(filePart.filename || `acq_${Date.now()}.log.gz`);
      const objectKey = `log-gz/${safeSerial}/${yyyy}/${mm}/${dd}/${safeName}`;
      await env.BUCKET.put(objectKey, filePart.fileBytes, {
        httpMetadata: { contentType: "application/gzip" },
        customMetadata: meta,
      });
    }

    // Store status and other file parts (e.g. status.txt)
    for (const part of allParts) {
      if (filePart && (part.fieldName || "").toLowerCase() === "logfile" && part.filename === (filePart.filename || "")) {
        continue;
      }
      const prefix = isStatusPart(part) ? "status" : "other";
      const safeName = safeKey(part.filename || `${part.fieldName || "part"}.bin`);
      const objectKey = `${prefix}/${safeSerial}/${yyyy}/${mm}/${dd}/${safeName}`;
      const contentType = part.filename && /\.txt$/i.test(part.filename) ? "text/plain" : "application/octet-stream";
      await env.BUCKET.put(objectKey, part.fileBytes, {
        httpMetadata: { contentType },
        customMetadata: { ...meta, fieldName: part.fieldName || "", originalFilename: part.filename || "" },
      });
    }

    return successAck();
  },
};

function successAck() {
  return new Response("SUCCESS - OK\r\n", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

function text(msg, status = 200) {
  return new Response(msg, { status, headers: { "content-type": "text/plain" } });
}

function extractBasicAuthPassword(authHeader) {
  if (!authHeader) return "";
  const m = authHeader.match(/^Basic\s+(.+)$/i);
  if (!m) return "";
  try {
    const decoded = atob(m[1]);
    const idx = decoded.indexOf(":");
    if (idx === -1) return "";
    return decoded.slice(idx + 1);
  } catch {
    return "";
  }
}

function extractMultipartFilePart(bodyU8, boundary, fieldName) {
  const headerNeedle = enc(`name="${fieldName}"`);
  const namePos = indexOfSubarray(bodyU8, headerNeedle, 0);
  if (namePos === -1) return null;

  const delimBytes = enc(`--${boundary}`);
  const partStart = lastIndexOfSubarray(bodyU8, delimBytes, namePos);
  if (partStart === -1) return null;

  const afterBoundary = partStart + delimBytes.length;
  const headersStart = skipCRLF(bodyU8, afterBoundary);

  const headerEndMarker = enc("\r\n\r\n");
  const headersEnd = indexOfSubarray(bodyU8, headerEndMarker, headersStart);
  if (headersEnd === -1) return null;

  const headersText = dec(bodyU8.slice(headersStart, headersEnd));
  let filename = "";
  const fnMatch = headersText.match(/filename="([^"]+)"/i);
  if (fnMatch && fnMatch[1]) filename = fnMatch[1].split("/").pop();

  const contentStart = headersEnd + headerEndMarker.length;

  const nextBoundaryNeedle = enc(`\r\n--${boundary}`);
  const contentEnd = indexOfSubarray(bodyU8, nextBoundaryNeedle, contentStart);
  if (contentEnd === -1) return null;

  const fileBytes = bodyU8.slice(contentStart, contentEnd);
  return { filename, fileBytes };
}

/**
 * Extract all file parts (with a filename) from multipart body.
 * Returns array of { fieldName, filename, fileBytes }.
 */
function extractAllMultipartFileParts(bodyU8, boundary) {
  const parts = [];
  const delimBytes = enc(`--${boundary}`);
  const headerEndMarker = enc("\r\n\r\n");
  let searchFrom = 0;

  while (true) {
    const partStart = indexOfSubarray(bodyU8, delimBytes, searchFrom);
    if (partStart === -1) break;

    let afterBoundary = partStart + delimBytes.length;
    if (bodyU8[afterBoundary] === 45 && bodyU8[afterBoundary + 1] === 45) break;

    const headersStart = skipCRLF(bodyU8, afterBoundary);
    const headersEnd = indexOfSubarray(bodyU8, headerEndMarker, headersStart);
    if (headersEnd === -1) break;

    const headersText = dec(bodyU8.slice(headersStart, headersEnd));
    const nameMatch = headersText.match(/name="([^"]+)"/i);
    const fieldName = nameMatch && nameMatch[1] ? nameMatch[1] : "";
    let filename = "";
    const fnMatch = headersText.match(/filename="([^"]+)"/i);
    if (fnMatch && fnMatch[1]) filename = fnMatch[1].split("/").pop();

    const contentStart = headersEnd + headerEndMarker.length;
    const nextBoundaryNeedle = enc(`\r\n--${boundary}`);
    let contentEnd = indexOfSubarray(bodyU8, nextBoundaryNeedle, contentStart);
    if (contentEnd === -1) contentEnd = bodyU8.length;

    const fileBytes = bodyU8.slice(contentStart, contentEnd);
    if (filename) parts.push({ fieldName, filename, fileBytes });

    searchFrom = contentEnd;
  }
  return parts;
}

function isStatusPart(part) {
  const name = (part.fieldName || "").toLowerCase();
  const fn = (part.filename || "").toLowerCase();
  return name.includes("status") || fn.includes("status") || fn.endsWith(".txt");
}

function extractMultipartTextField(bodyU8, boundary, fieldName) {
  const headerNeedle = enc(`name="${fieldName}"`);
  const namePos = indexOfSubarray(bodyU8, headerNeedle, 0);
  if (namePos === -1) return "";

  const delimBytes = enc(`--${boundary}`);
  const partStart = lastIndexOfSubarray(bodyU8, delimBytes, namePos);
  if (partStart === -1) return "";

  const afterBoundary = partStart + delimBytes.length;
  const headersStart = skipCRLF(bodyU8, afterBoundary);

  const headerEndMarker = enc("\r\n\r\n");
  const headersEnd = indexOfSubarray(bodyU8, headerEndMarker, headersStart);
  if (headersEnd === -1) return "";

  const contentStart = headersEnd + headerEndMarker.length;

  const nextBoundaryNeedle = enc(`\r\n--${boundary}`);
  const contentEnd = indexOfSubarray(bodyU8, nextBoundaryNeedle, contentStart);
  if (contentEnd === -1) return "";

  return dec(bodyU8.slice(contentStart, contentEnd)).replace(/^\s+|\s+$/g, "");
}

function safeKey(s) {
  return String(s || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
}

function enc(s) { return new TextEncoder().encode(s); }
function dec(u8) { return new TextDecoder("utf-8", { fatal: false }).decode(u8); }

function skipCRLF(u8, i) {
  if (u8[i] === 13 && u8[i + 1] === 10) return i + 2;
  return i;
}

function indexOfSubarray(haystack, needle, fromIndex = 0) {
  outer: for (let i = fromIndex; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function lastIndexOfSubarray(haystack, needle, beforeIndex) {
  const maxStart = Math.min(beforeIndex, haystack.length - needle.length);
  outer: for (let i = maxStart; i >= 0; i--) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
