import test from "node:test";
import assert from "node:assert/strict";
import { listR2Objects } from "../src/r2.js";

test("listR2Objects returns the full sorted scan window for checkpoint-aware batching", async () => {
  const sameTime = new Date("2026-05-30T11:00:00Z");
  const client = {
    async send(command) {
      assert.equal(command.input.Bucket, "bucket");
      assert.equal(command.input.Prefix, "log-gz/");
      return {
        IsTruncated: false,
        Contents: [
          { Key: "log-gz/serial/d.gz", ETag: '"4"', Size: 4, LastModified: sameTime },
          { Key: "log-gz/serial/b.gz", ETag: '"2"', Size: 2, LastModified: sameTime },
          { Key: "log-gz/serial/c.gz", ETag: '"3"', Size: 3, LastModified: sameTime },
          { Key: "log-gz/serial/a.gz", ETag: '"1"', Size: 1, LastModified: sameTime },
        ],
      };
    },
  };

  const objects = await listR2Objects(client, {
    bucket: "bucket",
    prefix: "log-gz/",
    maxKeys: 2,
    listScanCap: 4,
  });

  assert.deepEqual(
    objects.map((o) => o.key),
    [
      "log-gz/serial/a.gz",
      "log-gz/serial/b.gz",
      "log-gz/serial/c.gz",
      "log-gz/serial/d.gz",
    ],
  );
  assert.deepEqual(
    objects.map((o) => o.etag),
    ["1", "2", "3", "4"],
  );
});
