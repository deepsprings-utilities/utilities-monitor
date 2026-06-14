import test from "node:test";
import assert from "node:assert/strict";
import { checkpointPairKey } from "../src/checkpoint.js";
import { checkpointPairsForObjects, normalizeObjectLimit, selectUnprocessedObjects } from "../src/ingest-selection.js";

test("selectUnprocessedObjects applies batch limit after checkpoint filtering", () => {
  const objects = [
    { key: "log-gz/newest-1.gz", etag: "a" },
    { key: "log-gz/newest-2.gz", etag: "b" },
    { key: "log-gz/older-1.gz", etag: "c" },
    { key: "log-gz/older-2.gz", etag: "d" },
    { key: "log-gz/oldest.gz", etag: "e" },
  ];
  const processedSet = new Set([
    checkpointPairKey("log-gz/newest-1.gz", "a"),
    checkpointPairKey("log-gz/newest-2.gz", "b"),
  ]);

  const selected = selectUnprocessedObjects(objects, processedSet, 2);

  assert.deepEqual(
    selected.map((object) => object.key),
    ["log-gz/older-1.gz", "log-gz/older-2.gz"],
  );
});

test("selectUnprocessedObjects uses no_etag fallback for checkpoint lookup", () => {
  const objects = [
    { key: "log-gz/processed-no-etag.gz", etag: "" },
    { key: "log-gz/unprocessed.gz", etag: "" },
  ];
  const processedSet = new Set([
    checkpointPairKey("log-gz/processed-no-etag.gz", "no_etag"),
  ]);

  const selected = selectUnprocessedObjects(objects, processedSet, 200);

  assert.deepEqual(
    selected.map((object) => object.key),
    ["log-gz/unprocessed.gz"],
  );
});

test("checkpointPairsForObjects mirrors run.js checkpoint etag fallback", () => {
  assert.deepEqual(
    checkpointPairsForObjects([
      { key: "log-gz/a.gz", etag: "abc" },
      { key: "log-gz/b.gz", etag: "" },
    ]),
    [
      { r2Key: "log-gz/a.gz", etag: "abc" },
      { r2Key: "log-gz/b.gz", etag: "no_etag" },
    ],
  );
});

test("normalizeObjectLimit keeps the ingest default for invalid limits", () => {
  assert.equal(normalizeObjectLimit(undefined), 200);
  assert.equal(normalizeObjectLimit(""), 200);
  assert.equal(normalizeObjectLimit("3"), 3);
});
