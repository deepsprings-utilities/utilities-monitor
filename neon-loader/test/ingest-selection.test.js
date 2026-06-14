import test from "node:test";
import assert from "node:assert/strict";
import { checkpointPairKey } from "../src/checkpoint.js";
import { ingestBatchLimit, selectObjectsForIngest } from "../src/ingest-selection.js";

test("ingestBatchLimit defaults invalid limits to 200", () => {
  assert.equal(ingestBatchLimit(undefined), 200);
  assert.equal(ingestBatchLimit("0"), 200);
  assert.equal(ingestBatchLimit("3"), 3);
});

test("selectObjectsForIngest applies batch limit after checkpoint filtering", () => {
  const objects = [
    { key: "log-gz/device/newest.gz", etag: "1" },
    { key: "log-gz/device/newer.gz", etag: "2" },
    { key: "log-gz/device/older.gz", etag: "3" },
    { key: "log-gz/device/oldest.gz", etag: "4" },
  ];
  const processedSet = new Set([
    checkpointPairKey("log-gz/device/newest.gz", "1"),
    checkpointPairKey("log-gz/device/newer.gz", "2"),
  ]);

  const result = selectObjectsForIngest(objects, processedSet, 2);

  assert.equal(result.skippedCheckpointed, 2);
  assert.deepEqual(
    result.selectedObjects.map((o) => o.key),
    ["log-gz/device/older.gz", "log-gz/device/oldest.gz"],
  );
});
