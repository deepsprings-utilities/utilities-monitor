/**
 * AcquiSuite ingest worker
 *
 * This worker is used to ingest data from AcquiSuite into a Cloudflare R2 bucket.
 *
 * It is configured by `wrangler.jsonc`.
 *
 * ## Deploy locally (Wrangler)
 *
 * ```bash
 * npm install
 * wrangler login
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

    const ct = request.headers.get("content-type") || "";

    // --- If it's NOT multipart, treat it like a connection test and ACK success ---
    // (You can optionally store the raw body for debugging, but do not fail the connection.)
    if (!ct.toLowerCase().includes("multipart/form-data")) {
      return successAck();
    }

    const m = ct.match(/boundary=([^\s;]+)/i);
    if (!m) {
      // Some devices send odd content-type; don't brick the connection
      return successAck();
    }
    const boundary = m[1];

    // Read entire request (AcquiSuite uploads are usually small)
    const bodyBuf = await request.arrayBuffer();
    const body = new Uint8Array(bodyBuf);

    // Extract LOGFILE bytes
    const filePart = extractMultipartFilePart(body, boundary, "LOGFILE");
    if (!filePart) {
      // If AcquiSuite sends metadata-only (or a test post), don't fail the connection
      return successAck();
    }

    if (!env.BUCKET) return text("MISSING_R2_BINDING", 500);

    const serial = extractMultipartTextField(body, boundary, "SERIALNUMBER") || "unknown_serial";
    const filetime = extractMultipartTextField(body, boundary, "FILETIME") || "";
    const loopname = extractMultipartTextField(body, boundary, "LOOPNAME") || "";

    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");

    const safeSerial = safeKey(serial);

    // Store extracted .log.gz under log-gz/...
    const objectKey = `log-gz/${safeSerial}/${yyyy}/${mm}/${dd}/${safeName}`;

    await env.BUCKET.put(objectKey, filePart.fileBytes, {
      httpMetadata: { contentType: "application/gzip" },
      customMetadata: { serial, filetime, loopname, source: "acquisuite" },
    });

    return successAck();
  },
};

function successAck() {
  // This pattern tends to satisfy AcquiSuite UI
  return new Response("SUCCESS - OK\r\n", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

function text(msg, status = 200) {
  return new Response(msg, { status, headers: { "content-type": "text/plain" } });
}

function extractBasicAuthPassword(authHeader) {
  // If AcquiSuite uses Basic auth, password might be in Authorization.
  // Format: "Basic base64(username:password)"
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

/**
 * Extract a file part from multipart/form-data by field name.
 * Returns { filename, fileBytes } or null.
 */
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

  // End at next boundary (preceded by CRLF)
  const nextBoundaryNeedle = enc(`\r\n--${boundary}`);
  const contentEnd = indexOfSubarray(bodyU8, nextBoundaryNeedle, contentStart);
  if (contentEnd === -1) return null;

  const fileBytes = bodyU8.slice(contentStart, contentEnd);
  return { filename, fileBytes };
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