import test from "node:test";
import assert from "node:assert/strict";
import { checkpointPairKey } from "../src/checkpoint.js";
import { selectUnprocessedObjects } from "../src/ingest-selection.js";

function checkpointPool(processedPairs) {
  const processed = new Set(processedPairs);
  const calls = [];
  return {
    calls,
    async query(_sql, values) {
      calls.push(values);
      const rows = [];
      for (let i = 0; i < values.length; i += 2) {
        const r2Key = values[i];
        const etag = values[i + 1];
        if (processed.has(checkpointPairKey(r2Key, etag))) {
          rows.push({ r2_key: r2Key, etag });
        }
      }
      return { rows };
    },
  };
}

test("selectUnprocessedObjects applies batch limit after checkpoint filtering", async () => {
  const objects = [
    { key: "log-gz/newest-1.gz", etag: "a" },
    { key: "log-gz/newest-2.gz", etag: "b" },
    { key: "log-gz/older-1.gz", etag: "c" },
    { key: "log-gz/older-2.gz", etag: "d" },
  ];
  const pool = checkpointPool([
    checkpointPairKey("log-gz/newest-1.gz", "a"),
    checkpointPairKey("log-gz/newest-2.gz", "b"),
  ]);

  const selected = await selectUnprocessedObjects(pool, objects, 2, {
    lookupChunkSize: 2,
  });

  assert.deepEqual(
    selected.objects.map((o) => o.key),
    ["log-gz/older-1.gz", "log-gz/older-2.gz"],
  );
  assert.equal(selected.skippedAlreadyProcessed, 2);
  assert.equal(selected.examined, 4);
  assert.equal(pool.calls.length, 2);
});

test("selectUnprocessedObjects uses no_etag fallback consistently", async () => {
  const objects = [
    { key: "log-gz/no-etag.gz", etag: "" },
    { key: "log-gz/unprocessed.gz", etag: "x" },
  ];
  const pool = checkpointPool([checkpointPairKey("log-gz/no-etag.gz", "no_etag")]);

  const selected = await selectUnprocessedObjects(pool, objects, 1);

  assert.deepEqual(
    selected.objects.map((o) => o.key),
    ["log-gz/unprocessed.gz"],
  );
  assert.equal(selected.skippedAlreadyProcessed, 1);
});
