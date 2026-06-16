import assert from "node:assert";
import test from "node:test";
import {
  assertRowsPresent,
  resolveReportYear,
} from "../generate-a1-report.mjs";

test("resolveReportYear defaults to REPORT_END year", () => {
  assert.strictEqual(resolveReportYear("", "2025-12-31"), 2025);
  assert.strictEqual(resolveReportYear(undefined, "2026-01-02"), 2026);
});

test("resolveReportYear preserves explicit REPORT_YEAR", () => {
  assert.strictEqual(resolveReportYear("2024", "2025-12-31"), 2024);
});

test("assertRowsPresent fails empty reports by default", () => {
  assert.throws(
    () =>
      assertRowsPresent([], {
        allowEmptyReport: false,
        stream: "wyman",
        metricKey: "flow_wyman_avg",
        year: 2026,
        endInclusive: "2026-06-30",
      }),
    /refusing to write an empty Template A1 report/,
  );
});

test("assertRowsPresent allows explicit diagnostics-only empty reports", () => {
  assert.doesNotThrow(() =>
    assertRowsPresent([], {
      allowEmptyReport: true,
      stream: "wyman",
      metricKey: "flow_wyman_avg",
      year: 2026,
      endInclusive: "2026-06-30",
    }),
  );
});
