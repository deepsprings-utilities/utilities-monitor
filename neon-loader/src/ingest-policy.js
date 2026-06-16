const MEASURABLE_METRIC_RE = /^(energy|power|flow|pressure|pulse)(?:_|$)/;

export function hasMeasurableHeaders(parsed) {
  return (parsed.measurableHeaders || []).length > 0;
}

export function isMeasurableTallRow(row) {
  return MEASURABLE_METRIC_RE.test(String(row?.metricKey || ""));
}

export function tallRowsForIngest(label, parsed) {
  const rows = parsed.tallRows || [];
  if (label.hasData) return rows;
  if (!hasMeasurableHeaders(parsed)) return [];

  // Some files arrive under status-only mb-* labels while carrying real power/flow
  // columns. Keep those utility measurements, but avoid status-only numeric noise.
  return rows.filter(isMeasurableTallRow);
}
