import test from "node:test";
import assert from "node:assert/strict";
import { computeFlowIntervals } from "../flow-math.mjs";

test("computeFlowIntervals does not backfill volume before the first sample", () => {
  const rows = [
    { record_ts: "2026-01-10T00:00:00Z", metric_value: 10 },
    { record_ts: "2026-01-10T00:10:00Z", metric_value: 30 },
  ];

  const { gallons, dtMinutes } = computeFlowIntervals(
    rows,
    new Date("2026-01-01T00:00:00Z"),
  );

  assert.deepEqual(dtMinutes, [0, 10]);
  assert.deepEqual(gallons, [0, 200]);
});
