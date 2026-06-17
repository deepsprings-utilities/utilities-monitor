import test from "node:test";
import assert from "node:assert/strict";
import { checkpointPairKey } from "../src/checkpoint.js";
import { selectObjectsForIngest } from "../src/ingest-selection.js";

test("selectObjectsForIngest filters checkpoints before applying batch cap", () => {
  const objects = [
    { key: "log-gz/serial/newest-1.gz", etag: "1" },
    { key: "log-gz/serial/newest-2.gz", etag: "2" },
    { key: "log-gz/serial/newest-3.gz", etag: "3" },
    { key: "log-gz/serial/backlog-1.gz", etag: "4" },
    { key: "log-gz/serial/backlog-2.gz", etag: "5" },
  ];
  const processedSet = new Set([
    checkpointPairKey("log-gz/serial/newest-1.gz", "1"),
    checkpointPairKey("log-gz/serial/newest-2.gz", "2"),
    checkpointPairKey("log-gz/serial/newest-3.gz", "3"),
  ]);

  const { selected, skipped, processCap } = selectObjectsForIngest(
    objects,
    processedSet,
    2,
  );

  assert.equal(processCap, 2);
  assert.equal(skipped, 3);
  assert.deepEqual(
    selected.map((o) => o.key),
    ["log-gz/serial/backlog-1.gz", "log-gz/serial/backlog-2.gz"],
  );
});

test("selectObjectsForIngest uses no_etag checkpoint key for missing etags", () => {
  const objects = [
    { key: "log-gz/serial/already.gz", etag: "" },
    { key: "log-gz/serial/unprocessed.gz", etag: "" },
  ];
  const processedSet = new Set([
    checkpointPairKey("log-gz/serial/already.gz", "no_etag"),
  ]);

  const { selected, skipped } = selectObjectsForIngest(objects, processedSet, 10);

  assert.equal(skipped, 1);
  assert.deepEqual(selected.map((o) => o.key), ["log-gz/serial/unprocessed.gz"]);
});
