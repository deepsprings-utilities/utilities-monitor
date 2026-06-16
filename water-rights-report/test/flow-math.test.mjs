import assert from "node:assert";
import test from "node:test";
import { computeFlowIntervals } from "../flow-math.mjs";

test("computeFlowIntervals does not backfill the first sample to report start", () => {
  const rows = [
    { record_ts: "2026-01-01T01:00:00.000Z", metric_value: 10 },
    { record_ts: "2026-01-01T02:00:00.000Z", metric_value: 20 },
  ];

  const { gallons, dtMinutes } = computeFlowIntervals(
    rows,
    new Date("2026-01-01T00:00:00.000Z"),
  );

  assert.deepStrictEqual(dtMinutes, [0, 60]);
  assert.deepStrictEqual(gallons, [0, 900]);
});

test("computeFlowIntervals carries the last sample forward to the report end", () => {
  const rows = [
    { record_ts: "2026-01-01T01:00:00.000Z", metric_value: 10 },
    { record_ts: "2026-01-01T02:00:00.000Z", metric_value: 20 },
  ];

  const { gallons, dtMinutes } = computeFlowIntervals(
    rows,
    new Date("2026-01-01T00:00:00.000Z"),
    new Date("2026-01-01T03:00:00.000Z"),
  );

  assert.deepStrictEqual(dtMinutes, [0, 120]);
  assert.deepStrictEqual(gallons, [0, 2100]);
});

test("computeFlowIntervals closes a single-sample report without pre-start volume", () => {
  const rows = [
    { record_ts: "2026-01-01T01:00:00.000Z", metric_value: 10 },
  ];

  const { gallons, dtMinutes } = computeFlowIntervals(
    rows,
    new Date("2026-01-01T00:00:00.000Z"),
    new Date("2026-01-01T03:00:00.000Z"),
  );

  assert.deepStrictEqual(dtMinutes, [120]);
  assert.deepStrictEqual(gallons, [1200]);
});
