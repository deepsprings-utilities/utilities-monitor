import assert from "node:assert";
import test from "node:test";
import {
  buildAlertSubject,
  buildBundlePayload,
  bundleHasFire,
  firingSectionLabels,
  parseRecipientList,
} from "../src/notify-email-alerts.js";

const testOpts = {
  staleAfterMinutes: 240,
  hydroMinKw: 5,
  hydroRecentMinutes: 60,
  alarmLookbackMinutes: 240,
  alarmRowLimit: 40,
};

test("parseRecipientList empty", () => {
  assert.deepStrictEqual(parseRecipientList(""), []);
  assert.deepStrictEqual(parseRecipientList(undefined), []);
});

test("parseRecipientList splits comma semicolon newline", () => {
  assert.deepStrictEqual(parseRecipientList("a@x.com,b@y.com"), [
    "a@x.com",
    "b@y.com",
  ]);
  assert.deepStrictEqual(parseRecipientList("a@x.com; b@y.com "), [
    "a@x.com",
    "b@y.com",
  ]);
  assert.deepStrictEqual(parseRecipientList("a@x.com\nb@y.com"), [
    "a@x.com",
    "b@y.com",
  ]);
});

test("buildBundlePayload ignores alarm record_ts for dedupe stability", () => {
  const a = {
    stale: [],
    hydro: null,
    water: { count: 0, skipped: false },
    alarms: [
      {
        serial: "s",
        metric_key: "m",
        record_ts: new Date("2026-01-01T00:00:00Z"),
        low_alarm: true,
        high_alarm: false,
        physical_group: "g",
      },
    ],
  };
  const b = {
    ...a,
    alarms: [
      {
        ...a.alarms[0],
        record_ts: new Date("2026-01-02T12:00:00Z"),
      },
    ],
  };
  assert.strictEqual(buildBundlePayload(a), buildBundlePayload(b));
});

test("buildAlertSubject lists only firing sections", () => {
  assert.strictEqual(
    buildAlertSubject(
      {
        stale: [{ physical_group: "solar_field", latest_ts: new Date() }],
        hydro: null,
        water: { count: 0, skipped: false },
        alarms: [],
      },
      testOpts,
    ),
    "[AcquiSuite] Alert: stale data",
  );
  assert.strictEqual(
    firingSectionLabels(
      {
        stale: [],
        hydro: { fire: true, value: 2, record_ts: new Date() },
        water: { count: 2, skipped: false },
        alarms: [],
      },
      testOpts,
    ).join(","),
    "hydro < 5 kW,water sampling due",
  );
});

test("bundleHasFire", () => {
  assert.strictEqual(
    bundleHasFire({
      stale: [],
      hydro: null,
      water: { count: 0, skipped: false },
      alarms: [],
    }),
    false,
  );
  assert.strictEqual(
    bundleHasFire({
      stale: [{ physical_group: "x", latest_ts: null }],
      hydro: null,
      water: { count: 0, skipped: false },
      alarms: [],
    }),
    true,
  );
});
