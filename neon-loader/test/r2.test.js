import test from "node:test";
import assert from "node:assert/strict";
import { listR2Objects } from "../src/r2.js";

test("listR2Objects returns the full sorted scan window, not only maxKeys", async () => {
  const client = {
    async send() {
      return {
        IsTruncated: false,
        Contents: [
          {
            Key: "older.gz",
            ETag: '"older"',
            Size: 1,
            LastModified: new Date("2026-01-01T00:00:00Z"),
          },
          {
            Key: "newer.gz",
            ETag: '"newer"',
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
    maxKeys: 1,
  });

  assert.deepEqual(
    objects.map((o) => o.key),
    ["newer.gz", "older.gz"],
  );
});
