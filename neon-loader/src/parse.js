import { gunzipSync } from "node:zlib";

const numberPattern = /^-?\d+(\.\d+)?$/;
const numberPatternLoose = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const UNIT_RE = /\(([^()]*)\)\s*$/;
const RESERVED = new Set(["time(UTC)", "error", "lowalarm", "highalarm"]);

export function parseGzipLog(fileBytes, options = {}) {
  const text = stripBom(decodeFile(fileBytes));
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { lineCount: 0, rawRecords: [], tallRows: [], measurableHeaders: [] };
  }

  const headerMatch = findHeaderRow(lines);
  if (headerMatch) {
    const { headerOffset, splitRow, headers, timeCol } = headerMatch;
    return parseStructuredTable(lines, {
      firstLineIndex: headerOffset + 1,
      splitRow,
      headers,
      timeCol,
      options,
    });
  }

  // Headerless exports (e.g. Worker path): no title row — use fixed column order from label-map schema.
  if (options.columnOrder?.length) {
    const headers = options.columnOrder.map(normalizeCsvHeader);
    const timeCol = findTimeColumnHeader(headers);
    if (timeCol) {
      // Data lines have no "time(UTC)" text — do not use detectDelimiter() which requires a header match.
      const { splitRow } = detectDelimiterDataLine(lines[0]);
      return parseStructuredTable(lines, {
        firstLineIndex: 0,
        splitRow,
        headers,
        timeCol,
        options,
      });
    }
  }

  const loose = parseLooseLines(lines);
  return { ...loose, measurableHeaders: [] };
}

function parseStructuredTable(lines, { firstLineIndex, splitRow, headers, timeCol, options }) {
  const expectedHeaders = new Set(options.expectedHeaders || []);
  const headerAliases = options.headerAliases || {};
  const strictHeaders = expectedHeaders.size > 0;

  const measurableHeaders = [];
  const headerSpecs = headers.map((h) =>
    parseColumnSpec(h, { expectedHeaders, headerAliases, strictHeaders }),
  );
  headers.forEach((h, idx) => {
    if (headerSpecs[idx] && isMeasurableHeader(h)) {
      measurableHeaders.push(h);
    }
  });

  const rawRecords = [];
  const tallRows = [];
  const errIdx = headers.indexOf("error");
  const lowIdx = headers.indexOf("lowalarm");
  const highIdx = headers.indexOf("highalarm");
  const timeIdx = headers.indexOf(timeCol);

  for (let i = firstLineIndex; i < lines.length; i += 1) {
    const rawText = lines[i];
    let cols = splitRow(rawText);
    if (cols.length === 0) continue;

    // Some feeds mix delimiters (for example tab header row with comma data rows).
    // If header-selected splitter yields a single cell, retry using data-line detection.
    if (cols.length <= 1 && headers.length > 1) {
      const altSplit = detectDelimiterDataLine(rawText).splitRow;
      const altCols = altSplit(rawText);
      if (altCols.length > cols.length) cols = altCols;
    }

    cols = padOrTruncateCols(cols, headers.length);

    const row = buildRowObject(headers, cols);
    const recordTs = timeIdx >= 0 ? parseUtcTime(cols[timeIdx]) : null;
    const errorFlag = errIdx >= 0 ? parseBooleanFlag(cols[errIdx]) : false;
    const lowAlarm = lowIdx >= 0 ? parseBooleanFlag(cols[lowIdx]) : false;
    const highAlarm = highIdx >= 0 ? parseBooleanFlag(cols[highIdx]) : false;

    rawRecords.push({
      lineNo: i + 1,
      rawText,
      parsedJson: row,
      recordTs,
    });

    for (let colIdx = 0; colIdx < headers.length; colIdx += 1) {
      const header = headers[colIdx];
      if (RESERVED.has(header)) continue;
      const spec = headerSpecs[colIdx];
      if (!spec) continue;
      const value = coerceValue(cols[colIdx] ?? "");
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      tallRows.push({
        recordTs,
        metricKey: spec.metric,
        metricValue: value,
        unit: spec.unit,
        quality: null,
        sourceSystem: spec.source,
        errorFlag,
        lowAlarm,
        highAlarm,
      });
    }
  }

  return {
    lineCount: Math.max(lines.length - firstLineIndex, 0),
    rawRecords,
    tallRows,
    measurableHeaders,
  };
}

function padOrTruncateCols(cols, len) {
  const out = cols.slice();
  while (out.length < len) out.push("");
  while (out.length > len) out.pop();
  return out;
}

function buildRowObject(headers, cols) {
  const row = {};
  headers.forEach((h, idx) => {
    const v = cols[idx] ?? "";
    let key = h;
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      key = `${h}__${idx}`;
    }
    row[key] = v;
  });
  return row;
}

/**
 * Some exports have a junk/metadata line before the real header row.
 * Scan the first few lines for one that splits into a recognizable time(UTC) column.
 */
function findHeaderRow(lines) {
  const maxScan = Math.min(8, lines.length);
  for (let offset = 0; offset < maxScan; offset += 1) {
    const line = lines[offset];
    const { splitRow } = detectDelimiter(line);
    const headers = splitRow(line).map(normalizeCsvHeader);
    const timeCol = findTimeColumnHeader(headers);
    if (timeCol && headers.length >= 4) {
      return { headerOffset: offset, splitRow, headers, timeCol };
    }
  }
  return null;
}

function parseLooseLines(lines) {
  const rawRecords = [];
  const tallRows = [];
  for (let idx = 0; idx < lines.length; idx += 1) {
    const lineNo = idx + 1;
    const rawText = lines[idx];
    const parsed = parseLine(rawText);
    let recordTs = parsed.ts || parsed.timestamp || null;
    if (!recordTs && parsed.col_1 !== undefined && parsed.col_1 !== null) {
      const t = parseUtcTime(parsed.col_1);
      if (t) recordTs = t;
    }
    rawRecords.push({ lineNo, rawText, parsedJson: parsed, recordTs });
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        // Loose comma-split of TSV lines yields col_1..col_N — not real metric names; skip for tall table.
        if (/^col_\d+$/i.test(key)) continue;
        tallRows.push({
          recordTs,
          metricKey: key,
          metricValue: value,
          unit: null,
          quality: null,
          sourceSystem: "unknown",
          errorFlag: false,
          lowAlarm: false,
          highAlarm: false,
        });
      }
    }
  }
  return { lineCount: lines.length, rawRecords, tallRows };
}

function parseLine(line) {
  const kvPairs = line
    .split(/[,\s]+/)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .filter((piece) => piece.includes("="));

  if (kvPairs.length > 0) {
    const out = {};
    for (const pair of kvPairs) {
      const [k, ...rest] = pair.split("=");
      const key = (k || "").trim();
      const val = rest.join("=").trim();
      if (!key) continue;
      out[key] = coerceValue(val);
    }
    return out;
  }

  const csv = line.split(",").map((v) => v.trim());
  const out = {};
  csv.forEach((value, index) => {
    out[`col_${index + 1}`] = coerceValue(value);
  });
  return out;
}

function parseColumnSpec(columnName, context = {}) {
  if (!columnName) return null;
  const clean = String(columnName).trim();
  if (!clean || clean === "-" || RESERVED.has(clean)) return null;

  let unit = null;
  let base = clean;
  const unitMatch = clean.match(UNIT_RE);
  if (unitMatch) {
    unit = unitMatch[1].trim().replace("per minute", "/min").replace("per hour", "/hr");
    base = clean.slice(0, unitMatch.index).trim();
  }

  const canonicalBase = canonicalizeHeader(base, context.headerAliases || {});
  if (context.strictHeaders && !context.expectedHeaders.has(canonicalBase)) {
    return null;
  }

  let source = normalizeSource(canonicalBase);
  let metric = detectMetric(source, unit);
  const phase = detectPhase(source);
  if (phase) metric = `${metric}_${phase}`;

  source = inferSystem(source);
  return { source, metric, unit };
}

function canonicalizeHeader(header, aliases) {
  const key = String(header || "").trim().toLowerCase();
  const mapped = aliases[key];
  return mapped || String(header || "").trim();
}

function normalizeSource(source) {
  const corrections = {
    pwer: "power",
    curent: "current",
    voltge: "voltage",
    frequncy: "frequency",
    enrgy: "energy",
    dmand: "demand",
    aparant: "apparent",
    reactve: "reactive",
    postive: "positive",
    negtive: "negative",
    sumation: "sum",
    avrage: "average",
    instntaneous: "instantaneous",
    facotr: "factor",
    hydo: "hydro",
  };
  let s = String(source || "").toLowerCase().trim().replace(/\s+/g, " ");
  for (const [wrong, right] of Object.entries(corrections)) {
    s = s.replaceAll(wrong, right);
  }
  return s;
}

function detectMetric(source, unit) {
  const patterns = [
    [/\bave\s*rate\b$/, "avg_rate"],
    [/\bavg\s*rate\b$/, "avg_rate"],
    [/\brate\b$/, "rate"],
    [/\binstantaneous\b$/, "instantaneous"],
    [/\bdemand\b$/, "demand"],
    [/\bave\b$/, "avg"],
    [/\bavg\b$/, "avg"],
    [/\baverage\b$/, "avg"],
    [/\bmin\b$/, "min"],
    [/\bmax\b$/, "max"],
    [/\btotal\b$/, "total"],
    [/\bcount\b$/, "count"],
    [/\blevel\b$/, "level"],
    [/\bstatus\b$/, "status"],
  ];
  for (const [regex, label] of patterns) {
    if (regex.test(source)) {
      const quantity = inferQuantity(source, unit);
      if (quantity && ["avg", "min", "max", "rate", "avg_rate", "instantaneous", "demand"].includes(label)) {
        return `${quantity}_${label}`;
      }
      return label;
    }
  }
  const quantity = inferQuantity(source, unit);
  if (quantity === "pulse") return "pulse_total";
  return quantity || "value";
}

function inferQuantity(source, unit) {
  const s = String(source || "").toLowerCase();
  const u = String(unit || "").toLowerCase();
  if (s.includes("pressure") || u.includes("psi")) return "pressure";
  if (s.includes("flow") || u.includes("gpm")) return "flow";
  if (s.includes("power") || u === "kw") return "power";
  if (s.includes("energy") || u === "kwh") return "energy";
  if (s.includes("pulse")) return "pulse";
  return null;
}

function detectPhase(source) {
  const phaseMap = new Map([
    [" a-b", "AB"],
    [" b-c", "BC"],
    [" a-c", "AC"],
    [" a", "A"],
    [" b", "B"],
    [" c", "C"],
    [" sum", "sum"],
    [" total", "sum"],
    [" ave", "avg"],
    [" average", "avg"],
  ]);
  for (const [key, value] of phaseMap.entries()) {
    if (source.includes(key)) return value;
  }
  return null;
}

function isMeasurableHeader(header) {
  const h = String(header || "").toLowerCase();
  return (
    h.includes("pulse") ||
    h.includes("power") ||
    h.includes("flow") ||
    h.includes("pressure") ||
    h.includes("energy")
  );
}

function inferSystem(source) {
  const mapping = {
    "wyman creek": "hydro_plant",
    "reservoir by-pass": "hydro_plant",
    bypass: "hydro_plant",
    "deep well pump": "deep_well",
    "booster pump": "hydro_plant",
    sce: "electrical_grid",
    "net meter": "electrical_grid",
    hydro: "hydro_plant",
    solar: "solar_field",
    modhopper: "modhopper_status",
  };
  for (const [key, value] of Object.entries(mapping)) {
    if (source.includes(key)) return value;
  }
  return "unknown";
}

function splitCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

function parseBooleanFlag(value) {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0;
}

/**
 * AcquiSuite CSVs often use `time(UTC)` like `2026-02-23 14:30:00` (space, no Z).
 * Without a T/Z, `new Date()` can be invalid or local-dependent; normalize to UTC ISO.
 */
export function parseUtcTime(value) {
  if (value === undefined || value === null) return null;
  const s = stripCellQuotes(value);
  if (!s) return null;

  // ISO / RFC3339 with explicit Z or offset (trust Date parser)
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  // YYYY-M-D H:M:S[.fff] — AcquiSuite often omits leading zeros on hour/month/day.
  // Treat as UTC because the column is named time(UTC).
  let m = s.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})(\.\d+)?$/,
  );
  if (m) {
    const [, y, mo, d, h, mi, sec, frac] = m;
    const ms = frac ? Number(frac) * 1000 : 0;
    const t = Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(sec),
      ms,
    );
    const out = new Date(t);
    if (!Number.isNaN(out.getTime())) return out.toISOString();
  }

  // YYYY-MM-DD HH:MM:SS[.fff] (padded) without TZ → UTC
  m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/);
  if (m) {
    const d = new Date(`${m[1]}T${m[2]}${m[3] || ""}Z`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  let d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();

  // MM/DD/YYYY HH:MM:SS
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
  if (m) {
    const [, mo, day, y, h, mi, sec] = m;
    d = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(day), Number(h), Number(mi), Number(sec)));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  // Unix epoch seconds or ms (pure digits)
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s);
    const ms = s.length <= 10 ? n * 1000 : n;
    d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  return null;
}

function decodeFile(fileBytes) {
  try {
    return gunzipSync(Buffer.from(fileBytes)).toString("utf8");
  } catch {
    return Buffer.from(fileBytes).toString("utf8");
  }
}

function stripBom(text) {
  return String(text).replace(/^\uFEFF/, "");
}

function normalizeCsvHeader(h) {
  return stripBom(String(h || "").trim()).replace(/^"|"$/g, "");
}

function findTimeColumnHeader(headers) {
  const list = headers || [];
  const exact = list.find((h) => h === "time(UTC)");
  if (exact) return exact;
  const lower = list.map((h) => h.toLowerCase());
  let idx = lower.findIndex((h) => h === "time(utc)" || h === "time (utc)");
  if (idx >= 0) return list[idx];
  idx = lower.findIndex((h) => h.includes("time") && h.includes("utc"));
  if (idx >= 0) return list[idx];
  return null;
}

/**
 * Prefer tab for AcquiSuite exports that are TSV; comma is typical .log.csv.
 * Only try tab/semicolon when those characters appear (otherwise tab-split breaks comma-only lines).
 */
function detectDelimiter(firstLine) {
  const strategies = [];
  if (firstLine.includes("\t")) {
    strategies.push({ splitRow: (line) => line.split("\t").map((c) => c.trim()) });
  }
  strategies.push({ splitRow: (line) => splitCsvLine(line) });
  if (firstLine.includes(";") && !firstLine.includes(",")) {
    strategies.push({ splitRow: (line) => line.split(";").map((c) => c.trim()) });
  }
  for (const { splitRow } of strategies) {
    const headers = splitRow(firstLine).map(normalizeCsvHeader);
    if (findTimeColumnHeader(headers)) {
      return { splitRow };
    }
  }
  return { splitRow: (line) => splitCsvLine(line) };
}

/**
 * Headerless rows are all data cells — pick tab vs comma vs semicolon without matching `time(UTC)` in a cell.
 */
function detectDelimiterDataLine(line) {
  if (line.includes("\t")) {
    return { splitRow: (l) => l.split("\t").map((c) => c.trim()) };
  }
  if (line.includes(";") && !line.includes(",")) {
    return { splitRow: (l) => l.split(";").map((c) => c.trim()) };
  }
  return { splitRow: (l) => splitCsvLine(l) };
}

function stripCellQuotes(value) {
  let t = String(value ?? "").trim();
  if (t.length >= 2 && ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"')))) {
    t = t.slice(1, -1);
  }
  return t.trim();
}

function coerceValue(value) {
  if (value === undefined || value === null) return "";
  const s = stripCellQuotes(value);
  if (s === "") return "";
  if (numberPattern.test(s)) return Number(s);
  // Do not use parseFloat() on arbitrary strings — e.g. parseFloat("2026-03-20T...") === 2026.
  if (numberPatternLoose.test(s)) return Number(s);
  return s;
}
