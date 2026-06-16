import test from "node:test";
import assert from "node:assert/strict";
import { checkpointPairKey } from "../src/checkpoint.js";
import { chooseObjectsForIngest } from "../src/ingest-selection.js";

test("chooseObjectsForIngest applies batch cap after checkpoint filtering", () => {
  const objects = [
    { key: "newest-a.gz", etag: "a" },
    { key: "newest-b.gz", etag: "b" },
    { key: "older-c.gz", etag: "c" },
    { key: "older-d.gz", etag: "d" },
    { key: "older-e.gz", etag: "e" },
  ];
  const processedSet = new Set([
    checkpointPairKey("newest-a.gz", "a"),
    checkpointPairKey("newest-b.gz", "b"),
  ]);

  const { selected, skipped } = chooseObjectsForIngest(objects, processedSet, 2);

  assert.equal(skipped, 2);
  assert.deepEqual(
    selected.map((o) => o.key),
    ["older-c.gz", "older-d.gz"],
  );
});

test("chooseObjectsForIngest uses no_etag checkpoint sentinel", () => {
  const objects = [
    { key: "processed-without-etag.gz", etag: "" },
    { key: "unprocessed.gz", etag: "" },
  ];
  const processedSet = new Set([
    checkpointPairKey("processed-without-etag.gz", "no_etag"),
  ]);

  const { selected, skipped } = chooseObjectsForIngest(objects, processedSet, 200);

  assert.equal(skipped, 1);
  assert.deepEqual(
    selected.map((o) => o.key),
    ["unprocessed.gz"],
  );
});
