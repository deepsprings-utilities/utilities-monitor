import test from "node:test";
import assert from "node:assert/strict";
import { checkpointPairKey } from "../src/checkpoint.js";
import { normalizeBatchLimit, selectObjectsForIngest } from "../src/ingest-selection.js";

test("selectObjectsForIngest applies batch limit after checkpoint filtering", () => {
  const objects = [
    { key: "log-gz/serial/newest.log.gz", etag: "1" },
    { key: "log-gz/serial/newer.log.gz", etag: "2" },
    { key: "log-gz/serial/older-pending.log.gz", etag: "3" },
    { key: "log-gz/serial/oldest-pending.log.gz", etag: "4" },
  ];
  const processedSet = new Set([
    checkpointPairKey("log-gz/serial/newest.log.gz", "1"),
    checkpointPairKey("log-gz/serial/newer.log.gz", "2"),
  ]);

  const selection = selectObjectsForIngest(objects, processedSet, 2);

  assert.deepEqual(selection.selected.map((o) => o.key), [
    "log-gz/serial/older-pending.log.gz",
    "log-gz/serial/oldest-pending.log.gz",
  ]);
  assert.equal(selection.skipped, 2);
  assert.equal(selection.pending, 2);
  assert.equal(selection.deferred, 0);
});

test("selectObjectsForIngest reports pending work deferred by the batch limit", () => {
  const objects = [
    { key: "a", etag: "1" },
    { key: "b", etag: "2" },
    { key: "c", etag: "3" },
  ];

  const selection = selectObjectsForIngest(objects, new Set(), 2);

  assert.deepEqual(selection.selected.map((o) => o.key), ["a", "b"]);
  assert.equal(selection.pending, 3);
  assert.equal(selection.deferred, 1);
});

test("normalizeBatchLimit falls back for invalid limits", () => {
  assert.equal(normalizeBatchLimit("50"), 50);
  assert.equal(normalizeBatchLimit("0"), 200);
  assert.equal(normalizeBatchLimit("not-a-number", 25), 25);
});
