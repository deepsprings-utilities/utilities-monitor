import test from "node:test";
import assert from "node:assert/strict";
import { listR2Objects } from "../src/r2.js";

test("listR2Objects returns full scan window sorted newest first", async () => {
  const sent = [];
  const client = {
    async send(command) {
      sent.push(command.input);
      return {
        IsTruncated: false,
        Contents: [
          {
            Key: "log-gz/older.gz",
            ETag: '"older"',
            Size: 1,
            LastModified: new Date("2026-01-01T00:00:00Z"),
          },
          {
            Key: "log-gz/newest.gz",
            ETag: '"newest"',
            Size: 1,
            LastModified: new Date("2026-01-03T00:00:00Z"),
          },
          {
            Key: "log-gz/middle.gz",
            ETag: '"middle"',
            Size: 1,
            LastModified: new Date("2026-01-02T00:00:00Z"),
          },
        ],
      };
    },
  };

  const objects = await listR2Objects(client, {
    bucket: "bucket",
    prefix: "log-gz/",
    maxKeys: 2,
    listScanCap: 3,
  });

  assert.deepEqual(
    objects.map((o) => o.key),
    ["log-gz/newest.gz", "log-gz/middle.gz", "log-gz/older.gz"],
  );
  assert.equal(sent[0].MaxKeys, 3);
});
