import test from "node:test";
import assert from "node:assert/strict";
import { computeFlowIntervals } from "../flow-math.mjs";

test("computeFlowIntervals does not assign pre-first-reading volume", () => {
  const startUtc = new Date("2026-01-01T00:00:00Z");
  const rows = [
    { record_ts: "2026-01-10T00:00:00Z", metric_value: 100 },
    { record_ts: "2026-01-10T01:00:00Z", metric_value: 140 },
  ];

  const { gallons, dtMinutes } = computeFlowIntervals(rows, startUtc);

  assert.equal(dtMinutes[0], 0);
  assert.equal(gallons[0], 0);
  assert.equal(dtMinutes[1], 60);
  assert.equal(gallons[1], 7200);
});
