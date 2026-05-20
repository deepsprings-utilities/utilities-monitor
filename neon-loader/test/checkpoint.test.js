import test from "node:test";
import assert from "node:assert/strict";
import { checkpointPairKey, fetchProcessedPairSet, selectUnprocessedObjects } from "../src/checkpoint.js";

test("checkpointPairKey is stable for lookup", () => {
  assert.equal(
    checkpointPairKey("log-gz/abc/file.gz", "x"),
    "log-gz/abc/file.gz\0x",
  );
});

test("fetchProcessedPairSet queries in chunks and builds set", async () => {
  const calls = [];
  const pool = {
    query(sql, values) {
      calls.push({ sql, values });
      if (String(sql).includes("ingest_checkpoint") && String(sql).includes("IN ")) {
        return Promise.resolve({
          rows: [
            { r2_key: "a", etag: "1" },
            { r2_key: "b", etag: "2" },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    },
  };

  const pairs = [
    { r2Key: "a", etag: "1" },
    { r2Key: "b", etag: "2" },
    { r2Key: "c", etag: "3" },
  ];
  const set = await fetchProcessedPairSet(pool, pairs);
  assert.equal(set.size, 2);
  assert.ok(set.has(checkpointPairKey("a", "1")));
  assert.ok(set.has(checkpointPairKey("b", "2")));
  assert.ok(!set.has(checkpointPairKey("c", "3")));
  assert.equal(calls.length, 1);
});

test("selectUnprocessedObjects fills batch after skipping checkpointed candidates", async () => {
  const previousChunk = process.env.CHECKPOINT_LOOKUP_CHUNK;
  process.env.CHECKPOINT_LOOKUP_CHUNK = "2";
  const calls = [];
  const pool = {
    query(sql, values) {
      calls.push({ sql, values });
      const rows = [];
      for (let i = 0; i < values.length; i += 2) {
        const r2Key = values[i];
        const etag = values[i + 1];
        if (r2Key.startsWith("new-processed")) {
          rows.push({ r2_key: r2Key, etag });
        }
      }
      return Promise.resolve({ rows });
    },
  };

  try {
    const candidates = [
      { key: "new-processed-1", etag: "a" },
      { key: "new-processed-2", etag: "b" },
      { key: "old-unprocessed-1", etag: "c" },
      { key: "old-unprocessed-2", etag: "d" },
    ];

    const result = await selectUnprocessedObjects(pool, candidates, 2);

    assert.deepEqual(
      result.objects.map((o) => o.key),
      ["old-unprocessed-1", "old-unprocessed-2"],
    );
    assert.equal(result.examined, 4);
    assert.equal(result.checkpointed, 2);
    assert.equal(calls.length, 2);
  } finally {
    if (previousChunk === undefined) {
      delete process.env.CHECKPOINT_LOOKUP_CHUNK;
    } else {
      process.env.CHECKPOINT_LOOKUP_CHUNK = previousChunk;
    }
  }
});
