import test from "node:test";
import assert from "node:assert/strict";
import { checkpointPairKey } from "../src/checkpoint.js";
import { processLimitFromValue, selectObjectsForIngest } from "../src/ingest-selection.js";

test("selectObjectsForIngest applies process limit after checkpoint filtering", () => {
  const objects = [
    { key: "log-gz/newest.gz", etag: "newest" },
    { key: "log-gz/newer.gz", etag: "newer" },
    { key: "log-gz/backlog-1.gz", etag: "backlog-1" },
    { key: "log-gz/backlog-2.gz", etag: "backlog-2" },
  ];
  const processedSet = new Set([
    checkpointPairKey("log-gz/newest.gz", "newest"),
    checkpointPairKey("log-gz/newer.gz", "newer"),
  ]);

  const result = selectObjectsForIngest(objects, processedSet, 2);

  assert.equal(result.skippedAlreadyProcessed, 2);
  assert.deepEqual(
    result.selected.map((object) => object.key),
    ["log-gz/backlog-1.gz", "log-gz/backlog-2.gz"],
  );
});

test("processLimitFromValue defaults invalid values to 200", () => {
  assert.equal(processLimitFromValue(""), 200);
  assert.equal(processLimitFromValue("0"), 200);
  assert.equal(processLimitFromValue("10"), 10);
});
