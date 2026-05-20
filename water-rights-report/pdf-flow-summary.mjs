/**
 * Monthly summary PDF: average GPM and acre-feet from the same interval math as Template A1.
 * US customary: 1 acre-foot = 325,851 US gallons.
 */

import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";

export const US_GALLONS_PER_ACRE_FOOT = 325851;

/** YYYY-MM for instant in tz (calendar month bucket for interval end timestamp). */
export function yearMonthInTz(isoTs, tz) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(isoTs));
  const y = parts.find((p) => p.type === "year").value;
  const mo = parts.find((p) => p.type === "month").value;
  return `${y}-${mo}`;
}

function dateTimePartsInTz(instant, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type) => Number(parts.find((p) => p.type === type).value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function zonedDateTimeToUtcMs({ year, month, day, hour = 0, minute = 0, second = 0 }, tz) {
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let utcMs = targetAsUtc;
  for (let i = 0; i < 3; i += 1) {
    const parts = dateTimePartsInTz(new Date(utcMs), tz);
    const localAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const offsetMs = localAsUtc - utcMs;
    const nextUtcMs = targetAsUtc - offsetMs;
    if (Math.abs(nextUtcMs - utcMs) < 1) return nextUtcMs;
    utcMs = nextUtcMs;
  }
  return utcMs;
}

function nextMonthBoundaryUtcMs(instantMs, tz) {
  const parts = dateTimePartsInTz(new Date(instantMs), tz);
  let year = parts.year;
  let month = parts.month + 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return zonedDateTimeToUtcMs({ year, month, day: 1 }, tz);
}

/** Months from start month through end month inclusive (cross-year safe). */
export function enumerateMonths(firstYmd, lastYmd) {
  const months = [];
  const [y0, m0] = firstYmd.split("-").map(Number);
  const [y1, m1] = lastYmd.split("-").map(Number);
  let y = y0;
  let m = m0;
  while (y < y1 || (y === y1 && m <= m1)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

/**
 * Sum gallons and minutes per calendar month, splitting intervals at local
 * month boundaries so sparse readings do not move prior-month volume forward.
 */
export function aggregateMonthly(rows, gallons, dtMinutes, tz) {
  /** @type {Map<string, { gallons: number; minutes: number }>} */
  const map = new Map();
  for (let i = 0; i < rows.length; i += 1) {
    const minutes = Number(dtMinutes[i] || 0);
    const totalGallons = Number(gallons[i] || 0);
    const endMs = new Date(rows[i].record_ts).getTime();
    if (!Number.isFinite(endMs) || !Number.isFinite(minutes) || minutes <= 0) {
      continue;
    }

    const gallonsPerMinute = Number.isFinite(totalGallons) ? totalGallons / minutes : 0;
    let cursorMs = endMs - minutes * 60000;

    while (cursorMs < endMs) {
      const ym = yearMonthInTz(new Date(cursorMs + 1), tz);
      const boundaryMs = nextMonthBoundaryUtcMs(cursorMs + 1, tz);
      const sliceEndMs =
        Number.isFinite(boundaryMs) && boundaryMs > cursorMs
          ? Math.min(endMs, boundaryMs)
          : endMs;
      const sliceMinutes = (sliceEndMs - cursorMs) / 60000;
      const cur = map.get(ym) || { gallons: 0, minutes: 0 };
      cur.gallons += gallonsPerMinute * sliceMinutes;
      cur.minutes += sliceMinutes;
      map.set(ym, cur);
      cursorMs = sliceEndMs;
    }
  }
  return map;
}

function fmtNum(n, decimals) {
  if (!Number.isFinite(n)) return "—";
  const f = 10 ** decimals;
  return String(Math.round(n * f) / f);
}

function fmtInt(n) {
  if (!Number.isFinite(n)) return "—";
  return String(Math.round(n));
}

/**
 * @param {{
 *   outPath: string;
 *   streamLabel: string;
 *   year: number;
 *   endInclusiveYmd: string;
 *   tz: string;
 *   metricKey: string;
 *   flowScale: number;
 *   rows: unknown[];
 *   gallons: number[];
 *   dtMinutes: number[];
 * }} opts
 */
export async function writeFlowSummaryPdf(opts) {
  const {
    outPath,
    streamLabel,
    year,
    endInclusiveYmd,
    tz,
    metricKey,
    flowScale,
    rows,
    gallons,
    dtMinutes,
  } = opts;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const firstYmd = `${year}-01-01`;
  const monthKeys = enumerateMonths(firstYmd, endInclusiveYmd);
  const byMonth = aggregateMonthly(rows, gallons, dtMinutes, tz);

  const doc = new PDFDocument({ margin: 50, size: "LETTER" });
  const outStream = fs.createWriteStream(outPath);
  doc.pipe(outStream);

  doc.fontSize(16).text(`Flow diversion summary (${streamLabel})`, {
    underline: true,
  });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor("#333333");
  doc.text(
    `Reporting period: Jan 1–${endInclusiveYmd} (${tz}). Data through Neon metric "${metricKey}"; GPM scale ×${flowScale}.`,
    { align: "left" },
  );
  doc.fillColor("#000000");
  doc.moveDown(1);

  doc.fontSize(11).text(
    "Average GPM is total gallons diverted in the month ÷ minutes represented by those intervals. Acre-feet = US gallons ÷ 325,851.",
    { continued: false },
  );
  doc.moveDown(1);

  const tableLeft = 50;
  const colMonth = tableLeft;
  const colAvgGpm = tableLeft + 72;
  const colGal = tableLeft + 155;
  const colAf = tableLeft + 262;
  let y = doc.y;

  doc.fontSize(10).font("Helvetica-Bold");
  doc.text("Month", colMonth, y, { width: 68 });
  doc.text("Avg GPM", colAvgGpm, y, { width: 72 });
  doc.text("Gallons (approx.)", colGal, y, { width: 100 });
  doc.text("Acre-feet", colAf, y, { width: 80 });
  y += 18;
  doc.font("Helvetica");

  let totalGal = 0;
  let totalMin = 0;

  for (const ym of monthKeys) {
    const agg = byMonth.get(ym) || { gallons: 0, minutes: 0 };
    const avgGpm = agg.minutes > 0 ? agg.gallons / agg.minutes : null;
    const af = agg.gallons / US_GALLONS_PER_ACRE_FOOT;
    totalGal += agg.gallons;
    totalMin += agg.minutes;

    const label = ym;
    const avgStr =
      avgGpm === null ? "—" : fmtNum(avgGpm, 2);
    doc.text(label, colMonth, y, { width: 68 });
    doc.text(avgStr, colAvgGpm, y, { width: 72 });
    doc.text(fmtInt(agg.gallons), colGal, y, { width: 100 });
    doc.text(fmtNum(af, 4), colAf, y, { width: 80 });
    y += 14;
    if (y > 720) {
      doc.addPage();
      y = 50;
    }
  }

  y += 18;
  if (y > 680) {
    doc.addPage();
    y = 50;
  }
  doc.font("Helvetica-Bold").fontSize(10);
  const periodAvg =
    totalMin > 0 ? totalGal / totalMin : null;
  doc.text("Period total / avg", colMonth, y, { width: 68 });
  doc.text(
    periodAvg === null ? "—" : fmtNum(periodAvg, 2),
    colAvgGpm,
    y,
    { width: 72 },
  );
  doc.text(fmtInt(totalGal), colGal, y, { width: 100 });
  doc.text(fmtNum(totalGal / US_GALLONS_PER_ACRE_FOOT, 4), colAf, y, {
    width: 80,
  });
  doc.font("Helvetica");

  doc.end();

  await new Promise((resolve, reject) => {
    outStream.on("finish", resolve);
    outStream.on("error", reject);
  });
}
