import test from "node:test";
import assert from "node:assert/strict";
import { computeFlowIntervals } from "../flow-math.mjs";

test("computeFlowIntervals does not backfill volume before first observed row", () => {
  const rows = [
    { record_ts: "2026-01-01T12:00:00Z", metric_value: 10 },
    { record_ts: "2026-01-01T13:00:00Z", metric_value: 20 },
  ];

  const { gallons, dtMinutes } = computeFlowIntervals(
    rows,
    new Date("2026-01-01T00:00:00Z"),
  );

  assert.equal(dtMinutes[0], 0);
  assert.equal(gallons[0], 0);
  assert.equal(dtMinutes[1], 60);
  assert.equal(gallons[1], 900);
});
