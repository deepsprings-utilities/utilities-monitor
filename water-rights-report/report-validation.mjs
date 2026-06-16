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
