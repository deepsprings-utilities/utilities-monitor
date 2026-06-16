import test from "node:test";
import assert from "node:assert/strict";
import { checkpointPairKey } from "../src/checkpoint.js";
import { selectObjectsForProcessing } from "../src/ingest-selection.js";

test("selectObjectsForProcessing filters checkpoints before applying the batch cap", () => {
  const objects = [
    { key: "newest-a.gz", etag: "1" },
    { key: "newest-b.gz", etag: "2" },
    { key: "older-unprocessed.gz", etag: "3" },
  ];
  const processedSet = new Set([
    checkpointPairKey("newest-a.gz", "1"),
    checkpointPairKey("newest-b.gz", "2"),
  ]);

  const selection = selectObjectsForProcessing(objects, processedSet, 1);

  assert.deepEqual(
    selection.objectsToProcess.map((o) => o.key),
    ["older-unprocessed.gz"],
  );
  assert.equal(selection.skippedProcessed, 2);
  assert.equal(selection.pendingTotal, 1);
  assert.equal(selection.deferredPending, 0);
});

test("selectObjectsForProcessing reports unprocessed objects deferred by the cap", () => {
  const objects = [
    { key: "a.gz", etag: "1" },
    { key: "b.gz", etag: "2" },
    { key: "c.gz", etag: "3" },
  ];

  const selection = selectObjectsForProcessing(objects, new Set(), 2);

  assert.deepEqual(
    selection.objectsToProcess.map((o) => o.key),
    ["a.gz", "b.gz"],
  );
  assert.equal(selection.skippedProcessed, 0);
  assert.equal(selection.pendingTotal, 3);
  assert.equal(selection.deferredPending, 1);
});
