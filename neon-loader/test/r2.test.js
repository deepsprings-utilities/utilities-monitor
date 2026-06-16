import test from "node:test";
import assert from "node:assert/strict";
import { listR2Objects } from "../src/r2.js";

test("listR2Objects returns the sorted scan window without pre-slicing to batch size", async () => {
  const responses = [
    {
      IsTruncated: false,
      Contents: [
        {
          Key: "old.gz",
          ETag: "\"old\"",
          Size: 1,
          LastModified: new Date("2026-01-01T00:00:00Z"),
        },
        {
          Key: "new.gz",
          ETag: "\"new\"",
          Size: 1,
          LastModified: new Date("2026-01-03T00:00:00Z"),
        },
        {
          Key: "middle.gz",
          ETag: "\"middle\"",
          Size: 1,
          LastModified: new Date("2026-01-02T00:00:00Z"),
        },
      ],
    },
  ];
  const client = {
    send() {
      return Promise.resolve(responses.shift());
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
    ["new.gz", "middle.gz", "old.gz"],
  );
});
