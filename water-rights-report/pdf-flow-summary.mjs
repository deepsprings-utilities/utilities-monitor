/**
 * Monthly summary PDF: average GPM and acre-feet from the same interval math as Template A1.
 * US customary: 1 acre-foot = 325,851 US gallons.
 */

import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";

export const US_GALLONS_PER_ACRE_FOOT = 325851;

/** YYYY-MM for instant in tz. */
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
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(instant));
  return Object.fromEntries(
    parts
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  );
}

function timeZoneOffsetMs(instant, tz) {
  const p = dateTimePartsInTz(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - new Date(instant).getTime();
}

function localDateTimeToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, tz) {
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = localAsUtc - timeZoneOffsetMs(localAsUtc, tz);
  utc = localAsUtc - timeZoneOffsetMs(utc, tz);
  return new Date(utc);
}

function nextMonthStartUtc(instant, tz) {
  const p = dateTimePartsInTz(instant, tz);
  const nextMonth = p.month === 12 ? 1 : p.month + 1;
  const nextYear = p.month === 12 ? p.year + 1 : p.year;
  return localDateTimeToUtc({ year: nextYear, month: nextMonth, day: 1 }, tz);
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
 * Sum gallons and minutes per calendar month, splitting intervals that cross
 * local month boundaries.
 */
export function aggregateMonthly(rows, gallons, dtMinutes, tz, startUtc) {
  /** @type {Map<string, { gallons: number; minutes: number }>} */
  const map = new Map();
  for (let i = 0; i < rows.length; i += 1) {
    const intervalEnd = new Date(rows[i].record_ts);
    const intervalStart =
      i === 0
        ? new Date(startUtc)
        : new Date(rows[i - 1].record_ts);
    const startMs = intervalStart.getTime();
    const endMs = intervalEnd.getTime();
    const totalMs = endMs - startMs;
    const intervalGallons = Number(gallons[i] || 0);
    const intervalMinutes = Number(dtMinutes[i] || 0);
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      !Number.isFinite(totalMs) ||
      totalMs <= 0 ||
      !Number.isFinite(intervalGallons) ||
      !Number.isFinite(intervalMinutes)
    ) {
      continue;
    }

    let cursorMs = startMs;
    while (cursorMs < endMs) {
      const ym = yearMonthInTz(new Date(cursorMs), tz);
      const boundaryMs = nextMonthStartUtc(new Date(cursorMs), tz).getTime();
      const segmentEndMs = Math.min(endMs, boundaryMs);
      const ratio = (segmentEndMs - cursorMs) / totalMs;
      const cur = map.get(ym) || { gallons: 0, minutes: 0 };
      cur.gallons += intervalGallons * ratio;
      cur.minutes += intervalMinutes * ratio;
      map.set(ym, cur);
      cursorMs = segmentEndMs;
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
 *   startUtc: Date;
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
    startUtc,
  } = opts;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const firstYmd = `${year}-01-01`;
  const monthKeys = enumerateMonths(firstYmd, endInclusiveYmd);
  const byMonth = aggregateMonthly(rows, gallons, dtMinutes, tz, startUtc);

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
