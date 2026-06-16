import test from "node:test";
import assert from "node:assert/strict";
import { listR2Objects } from "../src/r2.js";

function listClient(pages) {
  const queue = [...pages];
  return {
    async send() {
      const page = queue.shift();
      if (!page) throw new Error("unexpected extra ListObjectsV2 request");
      return page;
    },
  };
}

test("listR2Objects returns the sorted scan window, not a pre-checkpoint process slice", async () => {
  const client = listClient([
    {
      IsTruncated: false,
      Contents: [
        {
          Key: "log-gz/old.gz",
          ETag: '"old"',
          Size: 1,
          LastModified: new Date("2026-01-01T00:00:00Z"),
        },
        {
          Key: "log-gz/new.gz",
          ETag: '"new"',
          Size: 1,
          LastModified: new Date("2026-01-03T00:00:00Z"),
        },
        {
          Key: "log-gz/mid.gz",
          ETag: '"mid"',
          Size: 1,
          LastModified: new Date("2026-01-02T00:00:00Z"),
        },
      ],
    },
  ]);

  const objects = await listR2Objects(client, {
    bucket: "bucket",
    prefix: "log-gz/",
    maxKeys: 2,
    listScanCap: 3,
  });

  assert.deepEqual(
    objects.map((o) => o.key),
    ["log-gz/new.gz", "log-gz/mid.gz", "log-gz/old.gz"],
  );
});

test("listR2Objects fails by default when the scan window is truncated", async () => {
  const client = listClient([
    {
      IsTruncated: true,
      NextContinuationToken: "next",
      Contents: [
        {
          Key: "log-gz/only.gz",
          ETag: '"only"',
          Size: 1,
          LastModified: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    },
  ]);

  await assert.rejects(
    () =>
      listR2Objects(client, {
        bucket: "bucket",
        prefix: "log-gz/",
        maxKeys: 1,
        listScanCap: 1,
      }),
    /list_r2_objects_truncated/,
  );
});
