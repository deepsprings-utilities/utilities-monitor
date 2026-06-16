import test from "node:test";
import assert from "node:assert/strict";
import { checkpointPairKey } from "../src/checkpoint.js";
import { selectObjectsForIngest } from "../src/ingest-selection.js";

test("selectObjectsForIngest applies process limit after checkpoint filtering", () => {
  const objects = [
    { key: "newest-processed.gz", etag: "1" },
    { key: "second-processed.gz", etag: "2" },
    { key: "older-unprocessed.gz", etag: "3" },
    { key: "oldest-unprocessed.gz", etag: "4" },
  ];
  const processedSet = new Set([
    checkpointPairKey("newest-processed.gz", "1"),
    checkpointPairKey("second-processed.gz", "2"),
  ]);

  const selection = selectObjectsForIngest(objects, processedSet, 1);

  assert.equal(selection.candidates, 4);
  assert.equal(selection.alreadyProcessed, 2);
  assert.equal(selection.processLimit, 1);
  assert.deepEqual(
    selection.objects.map((object) => object.key),
    ["older-unprocessed.gz"],
  );
});

test("selectObjectsForIngest matches checkpoint fallback for missing etags", () => {
  const objects = [
    { key: "already-seen.gz", etag: "" },
    { key: "next.gz", etag: "" },
  ];
  const processedSet = new Set([checkpointPairKey("already-seen.gz", "no_etag")]);

  const selection = selectObjectsForIngest(objects, processedSet, 200);

  assert.equal(selection.alreadyProcessed, 1);
  assert.deepEqual(selection.objects, [{ key: "next.gz", etag: "" }]);
});
