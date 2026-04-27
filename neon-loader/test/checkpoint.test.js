import test from "node:test";
import assert from "node:assert/strict";
import { checkpointPairKey, fetchProcessedPairSet } from "../src/checkpoint.js";

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
