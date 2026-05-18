import test from "node:test";
import assert from "node:assert/strict";
import {
  selectUnprocessedObjects,
  selectUnprocessedObjectsFromCheckpoints,
} from "../src/ingest-selection.js";
import { checkpointPairKey } from "../src/checkpoint.js";

test("selectUnprocessedObjects applies the batch limit after checkpoint filtering", () => {
  const objects = [
    { key: "log-gz/newest-a.gz", etag: "a" },
    { key: "log-gz/newest-b.gz", etag: "b" },
    { key: "log-gz/older-a.gz", etag: "c" },
    { key: "log-gz/older-b.gz", etag: "d" },
  ];
  const processedSet = new Set([
    checkpointPairKey("log-gz/newest-a.gz", "a"),
    checkpointPairKey("log-gz/newest-b.gz", "b"),
  ]);

  const result = selectUnprocessedObjects(objects, processedSet, 2);

  assert.deepEqual(
    result.selected.map((o) => o.key),
    ["log-gz/older-a.gz", "log-gz/older-b.gz"],
  );
  assert.equal(result.skippedProcessed, 2);
});

test("selectUnprocessedObjectsFromCheckpoints keeps scanning until it fills the batch", async () => {
  const objects = [
    { key: "log-gz/newest-a.gz", etag: "a" },
    { key: "log-gz/newest-b.gz", etag: "b" },
    { key: "log-gz/older-a.gz", etag: "c" },
    { key: "log-gz/older-b.gz", etag: "d" },
  ];
  const pool = {
    query(_sql, values) {
      const rows = [];
      for (let i = 0; i < values.length; i += 2) {
        const r2Key = values[i];
        const etag = values[i + 1];
        if (r2Key.includes("newest")) rows.push({ r2_key: r2Key, etag });
      }
      return Promise.resolve({ rows });
    },
  };

  const result = await selectUnprocessedObjectsFromCheckpoints(pool, objects, 2);

  assert.deepEqual(
    result.selected.map((o) => o.key),
    ["log-gz/older-a.gz", "log-gz/older-b.gz"],
  );
  assert.equal(result.skippedProcessed, 2);
  assert.equal(result.checkpointChecked, 4);
});
