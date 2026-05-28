import test from "node:test";
import assert from "node:assert/strict";
import { listR2Objects } from "../src/r2.js";

test("listR2Objects returns the full sorted scan window before process limiting", async () => {
  const client = {
    async send() {
      return {
        IsTruncated: false,
        Contents: [
          {
            Key: "older.gz",
            ETag: "\"1\"",
            Size: 1,
            LastModified: new Date("2026-01-01T00:00:00Z"),
          },
          {
            Key: "newer.gz",
            ETag: "\"2\"",
            Size: 1,
            LastModified: new Date("2026-01-03T00:00:00Z"),
          },
          {
            Key: "middle.gz",
            ETag: "\"3\"",
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
    ["newer.gz", "middle.gz", "older.gz"],
  );
});
