import test from "node:test";
import assert from "node:assert/strict";
import { aggregateMonthly } from "../pdf-flow-summary.mjs";

test("aggregateMonthly keeps intervals ending at a month boundary in the prior month", () => {
  const byMonth = aggregateMonthly(
    [{ record_ts: "2026-02-01T00:00:00.000Z" }],
    [600],
    [60],
    "UTC",
  );

  assert.equal(byMonth.get("2026-01").gallons, 600);
  assert.equal(byMonth.get("2026-01").minutes, 60);
  assert.equal(byMonth.has("2026-02"), false);
});

test("aggregateMonthly splits intervals across local timezone month boundaries", () => {
  const byMonth = aggregateMonthly(
    [{ record_ts: "2026-03-01T08:30:00.000Z" }],
    [600],
    [60],
    "America/Los_Angeles",
  );

  assert.equal(byMonth.get("2026-02").gallons, 300);
  assert.equal(byMonth.get("2026-02").minutes, 30);
  assert.equal(byMonth.get("2026-03").gallons, 300);
  assert.equal(byMonth.get("2026-03").minutes, 30);
});
