import test from "node:test";
import assert from "node:assert/strict";
import { listR2Objects } from "../src/r2.js";

test("listR2Objects returns the full sorted scan window before batch selection", async () => {
  const base = Date.parse("2026-01-01T00:00:00Z");
  const client = {
    async send() {
      return {
        IsTruncated: false,
        Contents: [
          { Key: "old.gz", ETag: "\"old\"", Size: 1, LastModified: new Date(base + 1000) },
          { Key: "new.gz", ETag: "\"new\"", Size: 1, LastModified: new Date(base + 3000) },
          { Key: "mid.gz", ETag: "\"mid\"", Size: 1, LastModified: new Date(base + 2000) },
        ],
      };
    },
  };

  const objects = await listR2Objects(client, {
    bucket: "bucket",
    prefix: "log-gz/",
    maxKeys: 2,
    listScanCap: 10,
  });

  assert.deepEqual(
    objects.map((object) => object.key),
    ["new.gz", "mid.gz", "old.gz"],
  );
});

test("listR2Objects fails by default when scan cap truncates an R2 listing", async () => {
  const client = {
    async send() {
      return {
        IsTruncated: true,
        NextContinuationToken: "next",
        Contents: [
          { Key: "a.gz", ETag: "\"a\"", Size: 1, LastModified: new Date("2026-01-01T00:00:00Z") },
          { Key: "b.gz", ETag: "\"b\"", Size: 1, LastModified: new Date("2026-01-01T00:01:00Z") },
        ],
      };
    },
  };

  await assert.rejects(
    () =>
      listR2Objects(client, {
        bucket: "bucket",
        prefix: "log-gz/",
        maxKeys: 1,
        listScanCap: 2,
      }),
    /list_r2_objects_truncated/,
  );
});
