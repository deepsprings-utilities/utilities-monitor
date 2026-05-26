import test from "node:test";
import assert from "node:assert/strict";
import { assertMeasurableTallRowsHaveTimestamps } from "../src/ingest-validation.js";

const label = {
  hasData: true,
  deviceAddress: "mb-005",
  schemaId: "solar",
};

test("measurable tall rows without timestamps are rejected before checkpointing", () => {
  const parsed = {
    rawRecords: [{ parsedJson: { "time(UTC)": "", "Solar Array Power (kWh)": 12.5 } }],
    tallRows: [{ recordTs: null, metricKey: "solar_array_power", metricValue: 12.5 }],
  };

  assert.throws(
    () =>
      assertMeasurableTallRowsHaveTimestamps({
        parsed,
        label,
        objectKey: "log-gz/123/bad-time.csv.gz",
      }),
    /none had record_ts/,
  );
});

test("timestamp validation allows labels without measurable data and valid tall rows", () => {
  assert.doesNotThrow(() =>
    assertMeasurableTallRowsHaveTimestamps({
      parsed: {
        rawRecords: [],
        tallRows: [{ recordTs: null, metricKey: "status", metricValue: 1 }],
      },
      label: { ...label, hasData: false },
      objectKey: "log-gz/123/status.csv.gz",
    }),
  );

  assert.doesNotThrow(() =>
    assertMeasurableTallRowsHaveTimestamps({
      parsed: {
        rawRecords: [],
        tallRows: [
          {
            recordTs: "2026-05-26T10:00:00.000Z",
            metricKey: "solar_array_power",
            metricValue: 12.5,
          },
        ],
      },
      label,
      objectKey: "log-gz/123/good.csv.gz",
    }),
  );
});
