/**
 * AcquiSuite → R2. Optional CSV header prepend from mb-csv-header-lines.json (see wrangler vars).
 */
import mbCsvHeaderLines from "./mb-csv-header-lines.json";

const te = new TextEncoder();
const td = new TextDecoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST" && request.method !== "PUT") return ack();

    const key =
      url.searchParams.get("key") ||
      url.searchParams.get("password") ||
      request.headers.get("x-api-key") ||
      basicPass(request.headers.get("authorization"));

    if (!env.API_KEY) return txt("MISSING_API_KEY", 500);
    if (!key || key !== env.API_KEY) return txt("FORBIDDEN", 403);
    if (!env.BUCKET) return txt("MISSING_R2_BINDING", 500);

    const ct = request.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("multipart/form-data")) return ack();

    const bm = ct.match(/boundary=([^\s;]+)/i);
    if (!bm) return ack();

    const body = new Uint8Array(await request.arrayBuffer());
    const b = bm[1];
    const log = part(body, b, "LOGFILE");
    const files = allFileParts(body, b);
    if (!log && !files.length) return ack();

    const serial = textPart(body, b, "SERIALNUMBER") || "unknown_serial";
    const filetime = textPart(body, b, "FILETIME") || "";
    const loopname = textPart(body, b, "LOOPNAME") || "";
    const d = new Date();
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const ser = safe(serial);
    const baseMeta = { serial, filetime, loopname, source: "acquisuite" };

    if (log) {
      const name = safe(log.fn || `acq_${Date.now()}.log.gz`);
      let bytes = log.data;
      let extra = {};
      if (env.PREPEND_CSV_HEADERS !== "0" && env.PREPEND_CSV_HEADERS !== "false") {
        const r = await prependHeader(bytes, log.fn, mbCsvHeaderLines, env);
        bytes = r.bytes;
        extra = r.meta;
      }
      await env.BUCKET.put(`log-gz/${ser}/${y}/${mo}/${day}/${name}`, bytes, {
        httpMetadata: { contentType: "application/gzip" },
        customMetadata: { ...baseMeta, ...extra },
      });
    }

    for (const p of files) {
      if (log && p.field.toLowerCase() === "logfile" && p.fn === (log.fn || "")) continue;
      const pre = statusish(p) ? "status" : "other";
      const nm = safe(p.fn || `${p.field || "part"}.bin`);
      await env.BUCKET.put(`${pre}/${ser}/${y}/${mo}/${day}/${nm}`, p.data, {
        httpMetadata: { contentType: /\.txt$/i.test(p.fn || "") ? "text/plain" : "application/octet-stream" },
        customMetadata: { ...baseMeta, fieldName: p.field || "", originalFilename: p.fn || "" },
      });
    }
    return ack();
  },
};

function ack() {
  return new Response("SUCCESS - OK\r\n", { status: 200, headers: { "content-type": "text/html" } });
}
function txt(m, s = 200) {
  return new Response(m, { status: s, headers: { "content-type": "text/plain" } });
}

function basicPass(h) {
  if (!h) return "";
  const m = h.match(/^Basic\s+(.+)$/i);
  if (!m) return "";
  try {
    const d = atob(m[1]);
    const i = d.indexOf(":");
    return i === -1 ? "" : d.slice(i + 1);
  } catch {
    return "";
  }
}

/** One multipart part by field name → { fn, data } or null */
function part(body, boundary, field) {
  const r = partBounds(body, boundary, field);
  if (!r) return null;
  const hdr = td.decode(body.subarray(r.h0, r.h1));
  const fn = hdr.match(/filename="([^"]+)"/i)?.[1]?.split("/").pop() || "";
  return { fn, data: body.subarray(r.c0, r.c1) };
}

function textPart(body, boundary, field) {
  const r = partBounds(body, boundary, field);
  return r ? td.decode(body.subarray(r.c0, r.c1)).trim() : "";
}

function partBounds(body, boundary, field) {
  const name = te.encode(`name="${field}"`);
  const np = find(body, name, 0);
  if (np === -1) return null;
  const bd = te.encode(`--${boundary}`);
  const ps = findLast(body, bd, np);
  if (ps === -1) return null;
  let h0 = skipNl(body, ps + bd.length);
  const sep = te.encode("\r\n\r\n");
  const h1 = find(body, sep, h0);
  if (h1 === -1) return null;
  const c0 = h1 + sep.length;
  const end = te.encode(`\r\n--${boundary}`);
  const c1 = find(body, end, c0);
  if (c1 === -1) return null;
  return { h0, h1, c0, c1 };
}

function allFileParts(body, boundary) {
  const out = [];
  const bd = te.encode(`--${boundary}`);
  const sep = te.encode("\r\n\r\n");
  const endM = te.encode(`\r\n--${boundary}`);
  let from = 0;
  for (;;) {
    const ps = find(body, bd, from);
    if (ps === -1) break;
    const a = ps + bd.length;
    if (body[a] === 45 && body[a + 1] === 45) break;
    let h0 = skipNl(body, a);
    const h1 = find(body, sep, h0);
    if (h1 === -1) break;
    const hdr = td.decode(body.subarray(h0, h1));
    const field = hdr.match(/name="([^"]+)"/i)?.[1] || "";
    const fn = hdr.match(/filename="([^"]+)"/i)?.[1]?.split("/").pop() || "";
    const c0 = h1 + sep.length;
    let c1 = find(body, endM, c0);
    if (c1 === -1) c1 = body.length;
    if (fn) out.push({ field, fn, data: body.subarray(c0, c1) });
    from = c1;
  }
  return out;
}

function statusish(p) {
  const n = (p.field || "").toLowerCase();
  const f = (p.fn || "").toLowerCase();
  return n.includes("status") || f.includes("status") || f.endsWith(".txt");
}

function safe(s) {
  return String(s || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 180);
}

async function prependHeader(bytes, filename, byMb, env) {
  if (!bytes?.length || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return { bytes, meta: {} };
  const mb =
    mbFromFn(filename) || defaultMb(env);
  const line = mb && byMb[mb];
  if (!line) return { bytes, meta: {} };
  try {
    const text = td.decode(await gunzip(bytes));
    if (headerIdx(text, line) != null) {
      return { bytes, meta: { csv_header_matched: "true", csv_header_mb: mb } };
    }
    const gz = await gzip(`${line}\n${text}`);
    return { bytes: gz, meta: { csv_header_prepended: "true", csv_header_mb: mb } };
  } catch {
    return { bytes, meta: {} };
  }
}

function mbFromFn(fn) {
  const m = String(fn || "").match(/mb[-_]?(\d{1,3})(?:\D|$)/i);
  return m ? m[1].padStart(3, "0") : null;
}

function defaultMb(env) {
  const v = env?.DEFAULT_CSV_HEADER_MB;
  if (v == null || String(v).trim() === "") return null;
  const t = String(v).trim();
  return /^\d{1,3}$/.test(t) ? t.padStart(3, "0") : null;
}

function normHeader(s) {
  const r = String(s || "")
    .replace(/^\uFEFF/, "")
    .trim();
  if (!r) return "";
  return r
    .split("\t")
    .map((c) => c.trim())
    .join("\t");
}

function headerIdx(text, canonical) {
  const want = normHeader(canonical);
  if (!want) return null;
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    const n = normHeader(lines[i]);
    if (n === want) return i;
  }
  return null;
}

async function gunzip(u8) {
  const ds = new DecompressionStream("gzip");
  const ab = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(ab);
}

async function gzip(str) {
  const u8 = te.encode(str);
  const cs = new CompressionStream("gzip");
  const ab = await new Response(new Blob([u8]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(ab);
}

function skipNl(u8, i) {
  return u8[i] === 13 && u8[i + 1] === 10 ? i + 2 : i;
}

function find(h, n, start = 0) {
  for (let i = start; i <= h.length - n.length; i++) {
    let j = 0;
    for (; j < n.length; j++) if (h[i + j] !== n[j]) break;
    if (j === n.length) return i;
  }
  return -1;
}

function findLast(h, n, before) {
  const max = Math.min(before, h.length - n.length);
  for (let i = max; i >= 0; i--) {
    let j = 0;
    for (; j < n.length; j++) if (h[i + j] !== n[j]) break;
    if (j === n.length) return i;
  }
  return -1;
}

export const findCanonicalHeaderLineInText = headerIdx;
export const normalizeCsvHeaderLine = normHeader;
export const maybePrependCsvHeader = prependHeader;
