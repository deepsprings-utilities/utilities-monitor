import test from "node:test";
import assert from "node:assert/strict";
import { resolveReportWindow } from "../report-window.mjs";

test("resolveReportWindow defaults REPORT_YEAR from REPORT_END in the report timezone", () => {
  const window = resolveReportWindow(
    { REPORT_TZ: "America/Los_Angeles" },
    new Date("2026-01-01T12:00:00Z"),
  );

  assert.deepEqual(window, {
    tz: "America/Los_Angeles",
    year: 2025,
    endInclusive: "2025-12-31",
  });
});

test("resolveReportWindow rejects inconsistent REPORT_YEAR and REPORT_END", () => {
  assert.throws(
    () =>
      resolveReportWindow({
        REPORT_TZ: "America/Los_Angeles",
        REPORT_YEAR: "2026",
        REPORT_END: "2025-12-31",
      }),
    /must be in REPORT_YEAR/,
  );
});
