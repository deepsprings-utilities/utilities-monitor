#!/usr/bin/env node
/**
 * Fills Template A1 (Diversion to Direct Use) from Neon: Wyman Creek flow at hydro (mb-006 / hydro_flex_v1).
 *
 * Instantaneous flow is stored as metric_key `flow_C` (F2 - Wyman Creek Flow (Gpm)).
 * Optional: WATER_RIGHTS_SERIAL to pin one AcquiSuite serial if multiple rows exist.
 *
 * Env:
 *   NEON_DATABASE_URL (required)
 *   REPORT_YEAR — calendar year (default: current year)
 *   REPORT_END — inclusive end date YYYY-MM-DD in REPORT_TZ (default: yesterday)
 *   REPORT_TZ — IANA tz for DATE/TIME columns (default: America/Los_Angeles)
 *   WATER_RIGHTS_SERIAL — optional device serial filter
 *   WATER_RIGHTS_FLOW_METRIC — default flow_C
 *   FLOW_RATE_UNIT_TEXT — default "GALLONS PER MINUTE"
 *   VOLUME_UNIT_TEXT — default "GALLONS"
 *   BENEFICIAL_USE, WATER_RIGHT, REDIVERSION_STATUS, PLACE_OF_USE — optional static columns
 *   OUT_PATH — output xlsx path (default: ./dist/Template-A1-Wyman-{year}-asof-{end}.xlsx)
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function env(name, fallback = "") {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v;
}

/** Previous calendar day for the given tz’s “today” (YYYY-MM-DD). */
function yesterdayYmd(tz) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year").value);
  const mo = Number(parts.find((p) => p.type === "month").value);
  const d = Number(parts.find((p) => p.type === "day").value);
  const civil = new Date(Date.UTC(y, mo - 1, d));
  civil.setUTCDate(civil.getUTCDate() - 1);
  const yy = civil.getUTCFullYear();
  const mm = String(civil.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(civil.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function formatLocalDateTime(isoTs, tz) {
  const d = new Date(isoTs);
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const timeStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
  return { dateStr, timeStr };
}

async function loadRows(client, { year, endInclusiveYmd, serial, metricKey, tz }) {
  const startYmd = `${year}-01-01`;
  const {
    rows: [bounds],
  } = await client.query(
    `SELECT
       ($1 || ' 00:00:00')::timestamp AT TIME ZONE $3 AS t_start,
       (($2::date + 1)::text || ' 00:00:00')::timestamp AT TIME ZONE $3 AS t_end_exclusive`,
    [startYmd, endInclusiveYmd, tz],
  );
  const tStart = bounds.t_start;
  const tEndEx = bounds.t_end_exclusive;

  const params = [tStart, tEndEx, metricKey];
  let q = `
    SELECT record_ts, metric_value, serial
    FROM public.utility_measurement_tall
    WHERE physical_group = 'hydro_plant'
      AND metric_key = $3
      AND unit = 'Gpm'
      AND record_ts >= $1::timestamptz
      AND record_ts < $2::timestamptz
  `;
  if (serial) {
    params.push(serial);
    q += ` AND serial = $${params.length}`;
  }
  q += ` ORDER BY record_ts ASC`;

  const { rows } = await client.query(q, params);
  return { rows, startUtc: new Date(tStart) };
}

function incrementalGallons(rows, startUtc) {
  const out = [];
  for (let i = 0; i < rows.length; i += 1) {
    const t = new Date(rows[i].record_ts).getTime();
    const f = rows[i].metric_value;
    let dtMin;
    let fPrev;
    if (i === 0) {
      dtMin = (t - startUtc.getTime()) / 60000;
      fPrev = f;
    } else {
      const tPrev = new Date(rows[i - 1].record_ts).getTime();
      dtMin = (t - tPrev) / 60000;
      fPrev = rows[i - 1].metric_value;
    }
    if (dtMin < 0) continue;
    const avgGpm = i === 0 ? f : (f + fPrev) / 2;
    const gallons = avgGpm * dtMin;
    out.push(Number.isFinite(gallons) ? gallons : 0);
  }
  return out;
}

async function main() {
  const databaseUrl = process.env.NEON_DATABASE_URL;
  if (!databaseUrl || !String(databaseUrl).trim()) {
    console.error("NEON_DATABASE_URL is required");
    process.exit(1);
  }

  const tz = env("REPORT_TZ", "America/Los_Angeles");
  const year = Number(env("REPORT_YEAR", String(new Date().getFullYear())));
  if (!Number.isFinite(year) || year < 1970 || year > 2100) {
    throw new Error(`Invalid REPORT_YEAR: ${year}`);
  }
  const endInclusive = env("REPORT_END", yesterdayYmd(tz));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endInclusive)) {
    throw new Error(`Invalid REPORT_END: ${endInclusive} (expected YYYY-MM-DD)`);
  }
  const serial = env("WATER_RIGHTS_SERIAL");
  const metricKey = env("WATER_RIGHTS_FLOW_METRIC", "flow_C");
  const flowUnit = env("FLOW_RATE_UNIT_TEXT", "GALLONS PER MINUTE");
  const volUnit = env("VOLUME_UNIT_TEXT", "GALLONS");
  const beneficial = env("BENEFICIAL_USE");
  const waterRight = env("WATER_RIGHT");
  const rediversion = env("REDIVERSION_STATUS");
  const place = env("PLACE_OF_USE");

  const templatePath = path.join(__dirname, "assets", "template-a1.xlsx");
  if (!fs.existsSync(templatePath)) {
    console.error(`Missing template: ${templatePath}`);
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const { rows, startUtc } = await loadRows(pool, {
      year,
      endInclusiveYmd: endInclusive,
      serial: serial || null,
      metricKey,
      tz,
    });

    const gallons = incrementalGallons(rows, startUtc);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const sheet = workbook.getWorksheet("Data");
    if (!sheet) {
      throw new Error('Worksheet "Data" not found in template');
    }

    let excelRow = 2;
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const { dateStr, timeStr } = formatLocalDateTime(r.record_ts, tz);
      const line = sheet.getRow(excelRow);
      line.getCell(1).value = dateStr;
      line.getCell(2).value = timeStr;
      line.getCell(3).value = r.metric_value;
      line.getCell(4).value = flowUnit;
      line.getCell(5).value = Math.round(gallons[i] * 1000) / 1000;
      line.getCell(6).value = volUnit;
      if (beneficial) line.getCell(7).value = beneficial;
      if (waterRight) line.getCell(8).value = waterRight;
      if (rediversion) line.getCell(9).value = rediversion;
      if (place) line.getCell(10).value = place;
      excelRow += 1;
    }

    const dist = path.join(__dirname, "dist");
    fs.mkdirSync(dist, { recursive: true });
    const outPath =
      env("OUT_PATH") ||
      path.join(dist, `Template-A1-Wyman-${year}-asof-${endInclusive}.xlsx`);

    await workbook.xlsx.writeFile(outPath);
    console.log(
      JSON.stringify(
        {
          ok: true,
          rowsWritten: rows.length,
          outPath,
          year,
          endInclusive,
          metricKey,
          serial: serial || null,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
