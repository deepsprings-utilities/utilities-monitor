/**
 * Import a **two-column** Lead/Copper schedule CSV into `water_sampling_schedule`.
 *
 * Header row (first matching line) must name the analyte and the due date, for example:
 *   analyte_name,next_due_date
 *   Analyte Name,"Next Sampling Due By"
 *
 * Supported date cells: MM-DD-YYYY, M/D/YYYY, YYYY-MM-DD. Text like "Past Due" is stored in `notes`
 * with `next_due_date` left null.
 *
 * Usage:
 *   node scripts/import-lead-copper-csv.mjs path/to/lead-copper.csv
 *
 * Env:
 *   NEON_DATABASE_URL (required)
 *   LEAD_COPPER_PS_CODE (optional, default DST_LCR) — stored in ps_code for Grafana filtering
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

function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isAnalyteHeader(h) {
  const n = norm(h);
  return (
    n === "analyte_name" ||
    n === "analyte name" ||
    n === "analyte" ||
    n.includes("analyte") ||
    n === "metal"
  );
}

function isDueHeader(h) {
  const n = norm(h);
  return (
    n === "next_due_date" ||
    n === "next due date" ||
    n.includes("next sampling due") ||
    (n.includes("due") && (n.includes("next") || n.includes("sampling")))
  );
}

/** @returns {{ date: Date | null, notes: string | null }} */
function parseDueCell(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { date: null, notes: null };
  const q = s.replace(/^['"]|['"]$/g, "").trim();
  if (/past\s*due/i.test(q)) return { date: null, notes: "Past Due" };
  if (/due\s*now/i.test(q)) return { date: null, notes: "DUE NOW" };

  let m = q.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    const y = Number(m[3]);
    return { date: new Date(Date.UTC(y, mo - 1, d)), notes: null };
  }
  m = q.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    return { date: new Date(Date.UTC(y, mo - 1, d)), notes: null };
  }
  m = q.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    const y = Number(m[3]);
    return { date: new Date(Date.UTC(y, mo - 1, d)), notes: null };
  }

  const tryDate = new Date(q);
  if (!Number.isNaN(tryDate.getTime())) {
    return { date: new Date(Date.UTC(tryDate.getUTCFullYear(), tryDate.getUTCMonth(), tryDate.getUTCDate())), notes: null };
  }

  return { date: null, notes: q };
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(
      "Usage: node import-lead-copper-csv.mjs <file.csv>",
    );
    process.exit(1);
  }
  // Keep source_file aligned to the imported filename so active/standby
  // schedule files remain distinct and traceable in Grafana.
  const sourceName = path.basename(filePath);

  const conn = process.env.NEON_DATABASE_URL;
  if (!conn) throw new Error("Missing NEON_DATABASE_URL");

  const psCode = process.env.LEAD_COPPER_PS_CODE || "DST_LCR";

  let text = readFileSync(filePath, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);

  let headerIdx = -1;
  let colAnalyte = -1;
  let colDue = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length < 2) continue;
    for (let a = 0; a < cells.length; a += 1) {
      for (let b = 0; b < cells.length; b += 1) {
        if (a === b) continue;
        if (isAnalyteHeader(cells[a]) && isDueHeader(cells[b])) {
          headerIdx = i;
          colAnalyte = a;
          colDue = b;
          break;
        }
      }
      if (headerIdx >= 0) break;
    }
    if (headerIdx >= 0) break;
  }

  if (headerIdx < 0) {
    throw new Error(
      "Could not find a header row with analyte + due columns. Use headers like: analyte_name,next_due_date",
    );
  }

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    const name = cells[colAnalyte]?.trim();
    if (!name) continue;
    const dueRaw = cells[colDue] ?? "";
    const { date: nextDue, notes: dueNotes } = parseDueCell(dueRaw);
    rows.push({
      analyte_name: name,
      next_due_date: nextDue,
      next_due_raw: String(dueRaw).trim() || null,
      notes: dueNotes,
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
          psCode,
          "LEAD_COPPER",
          null,
          r.analyte_name,
          null,
          null,
          r.next_due_date,
          r.next_due_raw,
          r.notes,
          sourceName,
        ],
      );
    }
    await client.query("COMMIT");
    console.log(
      `imported_rows=${rows.length} source=${sourceName} ps_code=${psCode}`,
    );
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
