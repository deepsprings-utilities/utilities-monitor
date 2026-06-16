import assert from "node:assert/strict";
import test from "node:test";
import { requireReportRows } from "../generate-a1-report.mjs";

test("requireReportRows rejects empty A1 report data", () => {
  assert.throws(
    () =>
      requireReportRows([], {
        stream: "wyman",
        metricKey: "flow_wyman_avg",
        year: 2026,
        endInclusive: "2026-05-08",
        serial: null,
        deviceAddress: "mb-006",
      }),
    /refusing to generate an empty compliance report/,
  );
});

test("requireReportRows allows report generation when rows are present", () => {
  assert.doesNotThrow(() =>
    requireReportRows(
      [{ record_ts: "2026-05-08T00:00:00.000Z", metric_value: 12.3 }],
      {
        stream: "wyman",
        metricKey: "flow_wyman_avg",
        year: 2026,
        endInclusive: "2026-05-08",
        serial: null,
        deviceAddress: "mb-006",
      },
    ),
  );
});
