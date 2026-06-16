function envFrom(envObj, name, fallback = "") {
  const v = envObj[name];
  if (v === undefined || v === "") return fallback;
  return v;
}

/** Previous calendar day for the given tz's "today" (YYYY-MM-DD). */
export function yesterdayYmd(tz, now = new Date()) {
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

export function resolveReportWindow(envObj = process.env, now = new Date()) {
  const tz = envFrom(envObj, "REPORT_TZ", "America/Los_Angeles");
  const endInclusive = envFrom(envObj, "REPORT_END", yesterdayYmd(tz, now));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endInclusive)) {
    throw new Error(`Invalid REPORT_END: ${endInclusive} (expected YYYY-MM-DD)`);
  }

  const defaultYear = endInclusive.slice(0, 4);
  const year = Number(envFrom(envObj, "REPORT_YEAR", defaultYear));
  if (!Number.isFinite(year) || year < 1970 || year > 2100) {
    throw new Error(`Invalid REPORT_YEAR: ${year}`);
  }

  const endYear = Number(defaultYear);
  if (endYear !== year) {
    throw new Error(
      `REPORT_END (${endInclusive}) must be in REPORT_YEAR (${year}); set both variables consistently`,
    );
  }

  return { tz, year, endInclusive };
}
