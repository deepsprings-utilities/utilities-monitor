import test from "node:test";
import assert from "node:assert/strict";
import { checkpointPairKey } from "../src/checkpoint.js";
import { selectObjectsForIngest } from "../src/ingest-selection.js";

test("selectObjectsForIngest applies batch limit after checkpoint filtering", () => {
  const objects = [
    { key: "log-gz/serial/newest.gz", etag: "a" },
    { key: "log-gz/serial/newer.gz", etag: "b" },
    { key: "log-gz/serial/older-1.gz", etag: "c" },
    { key: "log-gz/serial/older-2.gz", etag: "d" },
    { key: "log-gz/serial/older-3.gz", etag: "e" },
  ];
  const processedSet = new Set([
    checkpointPairKey("log-gz/serial/newest.gz", "a"),
    checkpointPairKey("log-gz/serial/newer.gz", "b"),
  ]);

  const selection = selectObjectsForIngest(objects, processedSet, 2);

  assert.deepEqual(
    selection.selected.map((object) => object.key),
    ["log-gz/serial/older-1.gz", "log-gz/serial/older-2.gz"],
  );
  assert.equal(selection.skippedProcessed, 2);
  assert.equal(selection.deferred, 1);
});

test("selectObjectsForIngest matches checkpoint fallback etag", () => {
  const objects = [
    { key: "log-gz/serial/processed-no-etag.gz", etag: "" },
    { key: "log-gz/serial/pending.gz", etag: "x" },
  ];
  const processedSet = new Set([
    checkpointPairKey("log-gz/serial/processed-no-etag.gz", "no_etag"),
  ]);

  const selection = selectObjectsForIngest(objects, processedSet, 10);

  assert.deepEqual(
    selection.selected.map((object) => object.key),
    ["log-gz/serial/pending.gz"],
  );
  assert.equal(selection.skippedProcessed, 1);
  assert.equal(selection.deferred, 0);
});
