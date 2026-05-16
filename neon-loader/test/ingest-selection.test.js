import test from "node:test";
import assert from "node:assert/strict";
import { selectUnprocessedObjects } from "../src/ingest-selection.js";

test("selectUnprocessedObjects applies batch limit after checkpoint filtering", async () => {
  const candidates = [
    { key: "log-gz/device/new.gz", etag: "new", lastModified: new Date("2026-01-03T00:00:00Z") },
    { key: "log-gz/device/mid.gz", etag: "mid", lastModified: new Date("2026-01-02T00:00:00Z") },
    { key: "log-gz/device/old.gz", etag: "old", lastModified: new Date("2026-01-01T00:00:00Z") },
  ];
  const pool = {
    query(_sql, _values) {
      return Promise.resolve({
        rows: [
          { r2_key: "log-gz/device/new.gz", etag: "new" },
          { r2_key: "log-gz/device/mid.gz", etag: "mid" },
        ],
      });
    },
  };

  const selection = await selectUnprocessedObjects(pool, candidates, 1);

  assert.deepEqual(selection.objects.map((o) => o.key), ["log-gz/device/old.gz"]);
  assert.equal(selection.alreadyProcessed, 2);
  assert.equal(selection.scanned, 3);
});

test("selectUnprocessedObjects normalizes missing etags the same way as run.js", async () => {
  const candidates = [
    { key: "log-gz/device/checkpointed.gz", etag: "" },
    { key: "log-gz/device/unprocessed.gz", etag: "" },
  ];
  const pool = {
    query(_sql, _values) {
      return Promise.resolve({
        rows: [{ r2_key: "log-gz/device/checkpointed.gz", etag: "no_etag" }],
      });
    },
  };

  const selection = await selectUnprocessedObjects(pool, candidates, 10);

  assert.deepEqual(selection.objects.map((o) => o.key), ["log-gz/device/unprocessed.gz"]);
  assert.equal(selection.alreadyProcessed, 1);
});
