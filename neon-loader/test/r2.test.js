import test from "node:test";
import assert from "node:assert/strict";
import { listR2Objects } from "../src/r2.js";

test("listR2Objects returns full newest-first scan window before process cap", async () => {
  const client = {
    async send() {
      return {
        IsTruncated: false,
        Contents: [
          {
            Key: "log-gz/serial/oldest.gz",
            ETag: '"a"',
            Size: 1,
            LastModified: new Date("2026-01-01T00:00:00Z"),
          },
          {
            Key: "log-gz/serial/newest.gz",
            ETag: '"b"',
            Size: 1,
            LastModified: new Date("2026-01-03T00:00:00Z"),
          },
          {
            Key: "log-gz/serial/middle.gz",
            ETag: '"c"',
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
    listScanCap: 3,
  });

  assert.deepEqual(
    objects.map((o) => o.key),
    [
      "log-gz/serial/newest.gz",
      "log-gz/serial/middle.gz",
      "log-gz/serial/oldest.gz",
    ],
  );
});
