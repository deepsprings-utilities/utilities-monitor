export function assertMeasurableTallRowsHaveTimestamps({ parsed, label, objectKey }) {
  if (!label.hasData || parsed.tallRows.length === 0) return;

  const tallWithTs = parsed.tallRows.filter((row) => row.recordTs).length;
  if (tallWithTs > 0) return;

  const sample = parsed.rawRecords[0]?.parsedJson || {};
  throw new Error(
    `Parsed ${parsed.tallRows.length} measurable tall rows but none had record_ts for key=${objectKey} device=${label.deviceAddress} schemaId=${label.schemaId}; refusing to checkpoint. Check the time column. sample=${JSON.stringify(sample)}`,
  );
}
