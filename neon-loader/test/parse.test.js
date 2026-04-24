import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { parseGzipLog, parseUtcTime } from "../src/parse.js";

test("parseGzipLog parses key=value log lines", () => {
  const payload = [
    "ts=2026-03-20T00:00:00Z kwh=12.5 kw=3.2 status=ok",
    "ts=2026-03-20T00:15:00Z kwh=13.1 kw=3.4 status=ok",
  ].join("\n");
  const gzip = gzipSync(Buffer.from(payload, "utf8"));
  const result = parseGzipLog(gzip);

  assert.equal(result.lineCount, 2);
  assert.equal(result.rawRecords.length, 2);
  assert.equal(result.tallRows.length, 4);
  assert.equal(result.rawRecords[0].parsedJson.kwh, 12.5);
});

test("parseGzipLog parses acquisuite csv headers to normalized tall rows", () => {
  const payload = [
    "time(UTC),error,lowalarm,highalarm,Solar Array Power (kWh),Solar Array Power Demand (kW)",
    "2026-03-20T00:00:00Z,0,0,0,12.5,3.2",
  ].join("\n");
  const gzip = gzipSync(Buffer.from(payload, "utf8"));
  const result = parseGzipLog(gzip);

  assert.equal(result.rawRecords.length, 1);
  assert.equal(result.tallRows.length, 2);
  assert.equal(result.tallRows[0].sourceSystem, "solar_field");
  assert.equal(result.tallRows[0].unit, "kWh");
  assert.equal(result.measurableHeaders.length, 2);
});

test("parseUtcTime handles AcquiSuite space-separated UTC timestamps", () => {
  assert.equal(
    parseUtcTime("2026-02-23 14:30:00"),
    "2026-02-23T14:30:00.000Z",
  );
});

test("parseUtcTime handles single-digit hour (common in exports)", () => {
  assert.equal(
    parseUtcTime("2026-02-23 9:05:07"),
    "2026-02-23T09:05:07.000Z",
  );
});

test("parseUtcTime strips SQL-style quotes around timestamps", () => {
  assert.equal(
    parseUtcTime("'2026-02-23 20:45:00'"),
    "2026-02-23T20:45:00.000Z",
  );
});

test("parseGzipLog skips junk line before real header row", () => {
  const payload = [
    "# junk or comment line",
    "time(UTC)\terror\tlowalarm\thighalarm\tSolar Array Power (kWh)",
    "'2026-02-23 20:45:00'\t0\t0\t0\t12.5",
  ].join("\n");
  const gzip = gzipSync(Buffer.from(payload, "utf8"));
  const result = parseGzipLog(gzip);

  assert.equal(result.rawRecords.length, 1);
  assert.ok(result.tallRows.some((r) => r.metricKey !== "col_1" && !/^col_\d+$/i.test(r.metricKey)));
});

test("parseGzipLog uses columnOrder when there is no header row (headerless export)", () => {
  const columnOrder = [
    "time(UTC)",
    "error",
    "lowalarm",
    "highalarm",
    "Solar Array Power (kWh)",
  ];
  const payload = "'2026-02-23 20:45:00'\t0\t0\t0\t99.5";
  const gzip = gzipSync(Buffer.from(payload, "utf8"));
  const result = parseGzipLog(gzip, { columnOrder });

  assert.equal(result.rawRecords.length, 1);
  assert.equal(result.rawRecords[0].recordTs, "2026-02-23T20:45:00.000Z");
  assert.ok(result.tallRows.some((r) => r.sourceSystem === "solar_field"));
});

test("parseGzipLog handles tab-separated AcquiSuite CSV with quoted time cell", () => {
  const payload = [
    "time(UTC)\terror\tlowalarm\thighalarm\tSolar Array Power (kWh)",
    "'2026-02-23 20:45:00'\t0\t0\t0\t12.5",
  ].join("\n");
  const gzip = gzipSync(Buffer.from(payload, "utf8"));
  const result = parseGzipLog(gzip);

  assert.equal(result.rawRecords.length, 1);
  assert.equal(result.rawRecords[0].recordTs, "2026-02-23T20:45:00.000Z");
  assert.ok(result.tallRows.length >= 1);
});


test("parseGzipLog handles tab header with comma-separated data rows", () => {
  const payload = [
    "time(UTC)	error	lowalarm	highalarm	Solar Array Power (kWh)",
    "'2026-04-22 18:00:00',0,0,0,12.5",
  ].join("\n");
  const gzip = gzipSync(Buffer.from(payload, "utf8"));
  const result = parseGzipLog(gzip);

  assert.equal(result.rawRecords.length, 1);
  assert.equal(result.rawRecords[0].lineNo, 2);
  assert.equal(result.rawRecords[0].recordTs, "2026-04-22T18:00:00.000Z");
  assert.ok(result.tallRows.some((r) => r.metricValue === 12.5));
});

test("parseGzipLog disambiguates hydro Wyman intake vs F-1 bypass on mb-006 (flow_wyman_ vs flow_bypass_)", () => {
  const payload = [
    "time(UTC),error,lowalarm,highalarm,F-1 Reservoir By-pass Ave (Gpm),F2 - Wyman Creek Flow Ave (Gpm)",
    "2026-04-22T12:00:00Z,0,0,0,12,340",
  ].join("\n");
  const gzip = gzipSync(Buffer.from(payload, "utf8"));
  const result = parseGzipLog(gzip);

  const keys = new Set(result.tallRows.map((r) => r.metricKey));
  assert.ok(keys.has("flow_bypass_avg"));
  assert.ok(keys.has("flow_wyman_avg"));
  const wyman = result.tallRows.find((r) => r.metricKey === "flow_wyman_avg");
  assert.equal(wyman.metricValue, 340);
  assert.equal(wyman.sourceSystem, "hydro_plant");
});
