import test from "node:test";
import assert from "node:assert/strict";
import { computeFlowIntervals } from "../flow-math.mjs";

test("computeFlowIntervals does not invent volume before the first reading", () => {
  const rows = [
    {
      record_ts: "2026-02-15T00:00:00.000Z",
      metric_value: 100,
    },
    {
      record_ts: "2026-02-15T01:00:00.000Z",
      metric_value: 200,
    },
  ];

  const { gallons, dtMinutes } = computeFlowIntervals(
    rows,
    new Date("2026-01-01T00:00:00.000Z"),
  );

  assert.equal(dtMinutes[0], 0);
  assert.equal(gallons[0], 0);
  assert.equal(dtMinutes[1], 60);
  assert.equal(gallons[1], 9000);
});
