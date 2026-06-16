import test from "node:test";
import assert from "node:assert/strict";
import { listR2Objects } from "../src/r2.js";

test("listR2Objects returns the full scanned window sorted newest first", async () => {
  const sent = [];
  const client = {
    send(command) {
      sent.push(command.input);
      return Promise.resolve({
        IsTruncated: false,
        Contents: [
          { Key: "log-gz/old.gz", ETag: "\"old\"", Size: 10, LastModified: new Date("2026-01-01T00:00:00Z") },
          { Key: "log-gz/new.gz", ETag: "\"new\"", Size: 10, LastModified: new Date("2026-01-04T00:00:00Z") },
          { Key: "log-gz/older.gz", ETag: "\"older\"", Size: 10, LastModified: new Date("2025-12-31T00:00:00Z") },
          { Key: "log-gz/mid.gz", ETag: "\"mid\"", Size: 10, LastModified: new Date("2026-01-02T00:00:00Z") },
        ],
      });
    },
  };

  const objects = await listR2Objects(client, {
    bucket: "bucket",
    prefix: "log-gz/",
    maxKeys: 2,
    listScanCap: 4,
  });

  assert.deepEqual(
    objects.map((object) => object.key),
    ["log-gz/new.gz", "log-gz/mid.gz", "log-gz/old.gz", "log-gz/older.gz"],
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0].MaxKeys, 4);
});
