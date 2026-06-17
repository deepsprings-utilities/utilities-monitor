import test from "node:test";
import assert from "node:assert/strict";
import { listR2Objects } from "../src/r2.js";

test("listR2Objects returns the sorted scan window, not the process cap slice", async () => {
  const client = {
    async send(command) {
      assert.equal(command.input.Bucket, "bucket");
      assert.equal(command.input.Prefix, "log-gz/");
      return {
        IsTruncated: false,
        Contents: [
          {
            Key: "log-gz/serial/old.gz",
            ETag: '"old"',
            Size: 1,
            LastModified: new Date("2026-01-01T00:00:00Z"),
          },
          {
            Key: "log-gz/serial/new.gz",
            ETag: '"new"',
            Size: 1,
            LastModified: new Date("2026-01-02T00:00:00Z"),
          },
          {
            Key: "log-gz/serial/mid.gz",
            ETag: '"mid"',
            Size: 1,
            LastModified: new Date("2026-01-01T12:00:00Z"),
          },
        ],
      };
    },
  };

  const objects = await listR2Objects(client, {
    bucket: "bucket",
    prefix: "log-gz/",
    maxKeys: 2,
  });

  assert.deepEqual(
    objects.map((o) => o.key),
    [
      "log-gz/serial/new.gz",
      "log-gz/serial/mid.gz",
      "log-gz/serial/old.gz",
    ],
  );
});
