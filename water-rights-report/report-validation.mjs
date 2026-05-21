function parseYmdUtc(ymd, label) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd));
  if (!match) {
    throw new Error(`Invalid ${label}: ${ymd} (expected YYYY-MM-DD)`);
  }

  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid ${label}: ${ymd} (expected real calendar date)`);
  }
  return date;
}

export function assertReportWindow({ year, endInclusive }) {
  if (!Number.isFinite(year) || year < 1970 || year > 2100) {
    throw new Error(`Invalid REPORT_YEAR: ${year}`);
  }

  const end = parseYmdUtc(endInclusive, "REPORT_END");
  const start = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));
  if (end < start || end > yearEnd) {
    throw new Error(
      `REPORT_END ${endInclusive} must be within REPORT_YEAR ${year}`,
    );
  }
}

export function assertReportRows(rows, context) {
  if (rows.length > 0) return;

  const parts = [
    "No flow rows matched report filters; refusing to write an empty water-rights report.",
    `stream=${context.stream}`,
    `year=${context.year}`,
    `end=${context.endInclusive}`,
    `metric=${context.metricKey}`,
  ];
  if (context.deviceAddress) parts.push(`device=${context.deviceAddress}`);
  if (context.serial) parts.push(`serial=${context.serial}`);
  throw new Error(parts.join(" "));
}
