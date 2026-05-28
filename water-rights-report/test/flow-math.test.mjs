import test from "node:test";
import assert from "node:assert/strict";
import { computeFlowIntervals } from "../flow-math.mjs";

test("computeFlowIntervals does not assign volume before the first reading", () => {
  const rows = [
    { record_ts: "2026-01-01T01:00:00Z", metric_value: 10 },
    { record_ts: "2026-01-01T01:30:00Z", metric_value: 20 },
  ];

  const { gallons, dtMinutes } = computeFlowIntervals(
    rows,
    new Date("2026-01-01T00:00:00Z"),
  );

  assert.deepEqual(dtMinutes, [0, 30]);
  assert.deepEqual(gallons, [0, 450]);
});
