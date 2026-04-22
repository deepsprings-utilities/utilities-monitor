/**
 * Import "LAST AND NEXT SAMPLE REPORT" exported as CSV from Excel.
 * Export from Excel: Sheet1 → Save As CSV UTF-8 (first row may be title; headers start at row 2).
 *
 * Usage:
 *   node scripts/import-schedule-csv.mjs path/to/report.csv [--source-name report1]
 *
 * Requires NEON_DATABASE_URL (same as neon-loader).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQ = !inQ;
      }
      continue;
    }
    if (!inQ && c === ",") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function normalizeHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseUsDate(s) {
  if (!s || String(s).trim() === "") return null;
  const t = String(s).trim();
  const m = t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    const y = Number(m[3]);
    return new Date(Date.UTC(y, mo - 1, d));
  }
  return null;
}

/** Next Due like 2028/12 or 2032/01 → last day of that month (UTC). */
function parseNextDueRaw(raw) {
  if (raw == null) return { date: null, raw: null };
  const s = String(raw).trim();
  if (!s || s.toLowerCase() === "none") return { date: null, raw: s || null };
  const m = s.match(/^(\d{4})\/(\d{1,2})$/);
  if (!m) return { date: null, raw: s };
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return { date: null, raw: s };
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { date: new Date(Date.UTC(y, mo - 1, lastDay)), raw: s };
}

function parseFrequencyMonths(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node import-schedule-csv.mjs <file.csv> [--source-name name]");
    process.exit(1);
  }
  let sourceName = path.basename(filePath);
  const extra = process.argv.slice(3);
  for (let i = 0; i < extra.length; i += 1) {
    if (extra[i] === "--source-name" && extra[i + 1]) {
      sourceName = extra[i + 1];
      i += 1;
    }
  }

  const conn = process.env.NEON_DATABASE_URL;
  if (!conn) throw new Error("Missing NEON_DATABASE_URL");

  let text = readFileSync(filePath, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);

  let headerIdx = -1;
  let headers = [];
  for (let i = 0; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]).map(normalizeHeader);
    if (cells.includes("ps codes") && cells.includes("next due")) {
      headerIdx = i;
      headers = parseCsvLine(lines[i]);
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error(
      "Could not find header row with PS Codes and Next Due. Export Sheet1 as CSV with headers.",
    );
  }

  const idx = {};
  headers.forEach((h, i) => {
    idx[normalizeHeader(h)] = i;
  });

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    if (!cells.length || !cells[idx["ps codes"]]?.trim()) continue;

    const nextRaw = cells[idx["next due"]] ?? null;
    const { date: nextDueDate, raw: nextDueParsed } = parseNextDueRaw(nextRaw);
    const lastSampled = parseUsDate(cells[idx["last sampled"]]);
    const notes = cells[idx["notes"]]?.trim() || null;

    rows.push({
      ps_code: cells[idx["ps codes"]]?.trim(),
      group_name: cells[idx["group name"]]?.trim() || null,
      analyte_number: cells[idx["analyte number"]]?.trim() || null,
      analyte_name: cells[idx["analyte name"]]?.trim() || null,
      last_sampled: lastSampled,
      frequency_months: parseFrequencyMonths(cells[idx["frequency"]]),
      next_due_date: nextDueDate,
      next_due_raw: (nextDueParsed ?? String(nextRaw ?? "").trim()) || null,
      notes,
    });
  }

  const pool = new Pool({ connectionString: conn });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM water_sampling_schedule WHERE source_file = $1", [sourceName]);
    for (const r of rows) {
      await client.query(
        `INSERT INTO water_sampling_schedule (
          ps_code, group_name, analyte_number, analyte_name,
          last_sampled, frequency_months, next_due_date, next_due_raw, notes, source_file
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          r.ps_code,
          r.group_name,
          r.analyte_number,
          r.analyte_name,
          r.last_sampled,
          r.frequency_months,
          r.next_due_date,
          r.next_due_raw,
          r.notes,
          sourceName,
        ],
      );
    }
    await client.query("COMMIT");
    console.log(`imported_rows=${rows.length} source=${sourceName}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
