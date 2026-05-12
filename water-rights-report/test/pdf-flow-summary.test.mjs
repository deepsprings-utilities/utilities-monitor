import assert from "node:assert/strict";
import test from "node:test";
import { aggregateMonthly } from "../pdf-flow-summary.mjs";

function rounded(value) {
  return Math.round(value * 1000) / 1000;
}

test("aggregateMonthly splits interval volume at local month boundary", () => {
  const byMonth = aggregateMonthly(
    [{ record_ts: "2026-02-01T09:00:00.000Z" }],
    [7200],
    [120],
    "America/Los_Angeles",
    new Date("2026-02-01T07:00:00.000Z"),
  );

  assert.equal(rounded(byMonth.get("2026-01").gallons), 3600);
  assert.equal(rounded(byMonth.get("2026-01").minutes), 60);
  assert.equal(rounded(byMonth.get("2026-02").gallons), 3600);
  assert.equal(rounded(byMonth.get("2026-02").minutes), 60);
});
