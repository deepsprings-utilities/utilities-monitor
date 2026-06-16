import test from "node:test";
import assert from "node:assert/strict";
import { computeFlowIntervals } from "../flow-math.mjs";

test("computeFlowIntervals does not credit volume before the first reading", () => {
  const startUtc = new Date("2026-01-01T08:00:00.000Z");
  const rows = [
    { record_ts: "2026-01-10T08:00:00.000Z", metric_value: 100 },
    { record_ts: "2026-01-10T08:15:00.000Z", metric_value: 200 },
  ];

  const { gallons, dtMinutes } = computeFlowIntervals(rows, startUtc);

  assert.deepEqual(dtMinutes, [0, 15]);
  assert.deepEqual(gallons, [0, 2250]);
});
