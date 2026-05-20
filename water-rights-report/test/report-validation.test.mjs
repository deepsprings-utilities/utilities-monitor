import test from "node:test";
import assert from "node:assert/strict";
import { assertReportRows } from "../report-validation.mjs";

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
