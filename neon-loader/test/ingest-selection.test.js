import test from "node:test";
import assert from "node:assert/strict";
import { checkpointPairKey } from "../src/checkpoint.js";
import { selectObjectsForIngest } from "../src/ingest-selection.js";

test("selectObjectsForIngest applies batch limit after checkpoint filtering", () => {
  const objects = [
    { key: "log-gz/new-processed-1.gz", etag: "a" },
    { key: "log-gz/new-processed-2.gz", etag: "b" },
    { key: "log-gz/older-unprocessed-1.gz", etag: "c" },
    { key: "log-gz/older-unprocessed-2.gz", etag: "d" },
    { key: "log-gz/older-unprocessed-3.gz", etag: "e" },
  ];
  const processedSet = new Set([
    checkpointPairKey("log-gz/new-processed-1.gz", "a"),
    checkpointPairKey("log-gz/new-processed-2.gz", "b"),
  ]);

  const { selected, skipped } = selectObjectsForIngest(objects, processedSet, 2);

  assert.equal(skipped, 2);
  assert.deepEqual(
    selected.map((object) => object.key),
    ["log-gz/older-unprocessed-1.gz", "log-gz/older-unprocessed-2.gz"],
  );
});

test("selectObjectsForIngest treats missing etag as checkpoint no_etag", () => {
  const objects = [
    { key: "log-gz/processed-no-etag.gz", etag: "" },
    { key: "log-gz/unprocessed.gz", etag: "next" },
  ];
  const processedSet = new Set([
    checkpointPairKey("log-gz/processed-no-etag.gz", "no_etag"),
  ]);

  const { selected, skipped } = selectObjectsForIngest(objects, processedSet, 10);

  assert.equal(skipped, 1);
  assert.deepEqual(selected.map((object) => object.key), ["log-gz/unprocessed.gz"]);
});
