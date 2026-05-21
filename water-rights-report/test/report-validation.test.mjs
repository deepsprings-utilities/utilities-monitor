import test from "node:test";
import assert from "node:assert/strict";
import { assertReportRows, assertReportWindow } from "../report-validation.mjs";

test("assertReportWindow rejects report end before the report year", () => {
  assert.throws(
    () => assertReportWindow({ year: 2026, endInclusive: "2025-12-31" }),
    /must be within REPORT_YEAR 2026/,
  );
});

test("assertReportWindow rejects report end after the report year", () => {
  assert.throws(
    () => assertReportWindow({ year: 2025, endInclusive: "2026-01-02" }),
    /must be within REPORT_YEAR 2025/,
  );
});

test("assertReportWindow accepts report end inside the report year", () => {
  assert.doesNotThrow(() =>
    assertReportWindow({ year: 2026, endInclusive: "2026-05-19" }),
  );
});

test("assertReportRows rejects empty report data", () => {
  assert.throws(
    () =>
      assertReportRows([], {
        stream: "wyman",
        year: 2026,
        endInclusive: "2026-05-19",
        metricKey: "flow_wyman_avg",
        deviceAddress: "mb-006",
      }),
    /refusing to write an empty water-rights report/,
  );
});

test("assertReportRows accepts non-empty report data", () => {
  assert.doesNotThrow(() =>
    assertReportRows([{ record_ts: "2026-01-01T00:00:00Z" }], {
      stream: "wyman",
      year: 2026,
      endInclusive: "2026-05-19",
      metricKey: "flow_wyman_avg",
    }),
  );
});
