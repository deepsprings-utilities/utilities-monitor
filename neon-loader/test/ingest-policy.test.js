import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import {
  hasMeasurableHeaders,
  isMeasurableTallRow,
  tallRowsForIngest,
} from "../src/ingest-policy.js";
import { parseGzipLog } from "../src/parse.js";

test("hasMeasurableHeaders detects parsed utility measurement headers", () => {
  assert.equal(hasMeasurableHeaders({ measurableHeaders: [] }), false);
  assert.equal(
    hasMeasurableHeaders({
      measurableHeaders: ["Power from SCE Main Power Pulse #1 (kWh)"],
    }),
    true,
  );
});

test("status-only labels still ingest measurable utility rows", () => {
  const powerRow = {
    recordTs: "2026-05-15T09:00:00.000Z",
    metricKey: "power_instantaneous",
    metricValue: 12,
  };
  const statusRow = {
    recordTs: "2026-05-15T09:00:00.000Z",
    metricKey: "status",
    metricValue: 1,
  };

  const rows = tallRowsForIngest(
    { hasData: false },
    {
      measurableHeaders: ["Power from SCE Main Power Pulse #1 Instantaneous (kW)"],
      tallRows: [powerRow, statusRow],
    },
  );

  assert.deepEqual(rows, [powerRow]);
});

test("status-only AcquiSuite power logs keep parsed power rows", () => {
  const payload = [
    "time(UTC),error,lowalarm,highalarm,Power from SCE Main Power Pulse #1 Instantaneous (kW)",
    "2026-05-15T09:00:00Z,0,0,0,42.5",
  ].join("\n");
  const parsed = parseGzipLog(gzipSync(Buffer.from(payload, "utf8")));

  assert.deepEqual(parsed.measurableHeaders, [
    "Power from SCE Main Power Pulse #1 Instantaneous (kW)",
  ]);

  const rows = tallRowsForIngest({ hasData: false }, parsed);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].metricKey, "power_instantaneous");
  assert.equal(rows[0].metricValue, 42.5);
});

test("status-only labels without measurable headers do not ingest tall rows", () => {
  const rows = tallRowsForIngest(
    { hasData: false },
    {
      measurableHeaders: [],
      tallRows: [{ metricKey: "status", metricValue: 1 }],
    },
  );

  assert.deepEqual(rows, []);
});

test("data labels keep all parser tall rows", () => {
  const tallRows = [
    { metricKey: "status", metricValue: 1 },
    { metricKey: "power_demand", metricValue: 2 },
  ];

  assert.equal(
    tallRowsForIngest({ hasData: true }, { measurableHeaders: [], tallRows }),
    tallRows,
  );
});

test("isMeasurableTallRow matches utility metric families", () => {
  assert.equal(isMeasurableTallRow({ metricKey: "energy_sum" }), true);
  assert.equal(isMeasurableTallRow({ metricKey: "power" }), true);
  assert.equal(isMeasurableTallRow({ metricKey: "flow_wyman_avg" }), true);
  assert.equal(isMeasurableTallRow({ metricKey: "pressure_max" }), true);
  assert.equal(isMeasurableTallRow({ metricKey: "status" }), false);
});
