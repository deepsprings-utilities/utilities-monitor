import test from "node:test";
import assert from "node:assert/strict";
import { checkpointPairKey } from "../src/checkpoint.js";
import { selectObjectsForIngest } from "../src/ingest-selection.js";

test("selectObjectsForIngest applies limit after checkpoint filtering", () => {
  const objects = [
    { key: "newest-processed.gz", etag: "1" },
    { key: "middle-processed.gz", etag: "2" },
    { key: "older-unprocessed-a.gz", etag: "3" },
    { key: "older-unprocessed-b.gz", etag: "4" },
  ];
  const processedSet = new Set([
    checkpointPairKey("newest-processed.gz", "1"),
    checkpointPairKey("middle-processed.gz", "2"),
  ]);

  const result = selectObjectsForIngest(objects, processedSet, 1);

  assert.deepEqual(result.selected.map((o) => o.key), ["older-unprocessed-a.gz"]);
  assert.equal(result.checkpointed, 2);
  assert.equal(result.unprocessedInScan, 2);
});
