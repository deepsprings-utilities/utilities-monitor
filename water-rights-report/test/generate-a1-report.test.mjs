import test from "node:test";
import assert from "node:assert/strict";
import { ensureRowsPresent, flagEnabled } from "../generate-a1-report.mjs";

test("flagEnabled accepts explicit true values only", () => {
  assert.equal(flagEnabled("1"), true);
  assert.equal(flagEnabled("true"), true);
  assert.equal(flagEnabled("yes"), true);
  assert.equal(flagEnabled("0"), false);
  assert.equal(flagEnabled(""), false);
  assert.equal(flagEnabled(undefined), false);
});

test("ensureRowsPresent rejects zero-row reports by default", () => {
  assert.throws(
    () =>
      ensureRowsPresent([], {
        stream: "wyman",
        metricKey: "flow_wyman_avg",
        year: 2026,
        endInclusive: "2026-05-26",
        deviceAddress: "mb-006",
      }),
    /refusing to write an empty A1 report/,
  );
});

test("ensureRowsPresent permits non-empty or explicitly allowed empty reports", () => {
  assert.doesNotThrow(() =>
    ensureRowsPresent([{ record_ts: "2026-01-01T00:00:00Z" }]),
  );
  assert.doesNotThrow(() =>
    ensureRowsPresent([], { allowEmptyReport: "1" }),
  );
});
