import test from "node:test";
import assert from "node:assert/strict";
import { checkpointPairKey } from "../src/checkpoint.js";
import { countProcessedObjects, selectObjectsForIngest } from "../src/ingest-selection.js";

test("selectObjectsForIngest applies batch limit after checkpoint filtering", () => {
  const objects = [
    { key: "newest", etag: "1" },
    { key: "middle", etag: "2" },
    { key: "oldest", etag: "3" },
  ];
  const processed = new Set([
    checkpointPairKey("newest", "1"),
    checkpointPairKey("middle", "2"),
  ]);

  assert.deepEqual(selectObjectsForIngest(objects, processed, 2), [
    { key: "oldest", etag: "3" },
  ]);
  assert.equal(countProcessedObjects(objects, processed), 2);
});

test("selectObjectsForIngest preserves newest-first order for unprocessed objects", () => {
  const objects = [
    { key: "newest", etag: "1" },
    { key: "next", etag: "2" },
    { key: "older", etag: "3" },
  ];

  assert.deepEqual(selectObjectsForIngest(objects, new Set(), 2), [
    { key: "newest", etag: "1" },
    { key: "next", etag: "2" },
  ]);
});
