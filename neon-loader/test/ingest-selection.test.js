import test from "node:test";
import assert from "node:assert/strict";
import { checkpointPairKey } from "../src/checkpoint.js";
import { processCapFromMaxKeys, selectObjectsForIngest } from "../src/ingest-selection.js";

test("selectObjectsForIngest applies batch cap after checkpoint filtering", () => {
  const objects = [
    { key: "log-gz/serial/newest-1.gz", etag: "1" },
    { key: "log-gz/serial/newest-2.gz", etag: "2" },
    { key: "log-gz/serial/older-unprocessed-1.gz", etag: "3" },
    { key: "log-gz/serial/older-unprocessed-2.gz", etag: "4" },
  ];
  const processedSet = new Set([
    checkpointPairKey("log-gz/serial/newest-1.gz", "1"),
    checkpointPairKey("log-gz/serial/newest-2.gz", "2"),
  ]);

  const selection = selectObjectsForIngest(objects, processedSet, 2);

  assert.equal(selection.skippedAlreadyProcessed, 2);
  assert.deepEqual(
    selection.selected.map((o) => o.key),
    [
      "log-gz/serial/older-unprocessed-1.gz",
      "log-gz/serial/older-unprocessed-2.gz",
    ],
  );
});

test("processCapFromMaxKeys defaults invalid limits to 200", () => {
  assert.equal(processCapFromMaxKeys(Number.NaN), 200);
  assert.equal(processCapFromMaxKeys(0), 200);
  assert.equal(processCapFromMaxKeys("3.9"), 3);
});
