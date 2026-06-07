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
            Key: "log-gz/serial/old.gz",
            ETag: "\"old\"",
            Size: 1,
            LastModified: new Date("2026-01-01T00:00:00Z"),
          },
          {
            Key: "log-gz/serial/new.gz",
            ETag: "\"new\"",
            Size: 2,
            LastModified: new Date("2026-01-03T00:00:00Z"),
          },
          {
            Key: "log-gz/serial/mid.gz",
            ETag: "\"mid\"",
            Size: 3,
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
    objects.map((object) => object.key),
    ["log-gz/serial/new.gz", "log-gz/serial/mid.gz", "log-gz/serial/old.gz"],
  );
});

test("listR2Objects fails when the scan cap truncates the R2 listing", async () => {
  const client = {
    async send() {
      return {
        IsTruncated: true,
        NextContinuationToken: "next",
        Contents: [
          {
            Key: "log-gz/serial/a.gz",
            ETag: "\"a\"",
            Size: 1,
            LastModified: new Date("2026-01-01T00:00:00Z"),
          },
        ],
      };
    },
  };

  await assert.rejects(
    listR2Objects(client, {
      bucket: "bucket",
      prefix: "log-gz/",
      maxKeys: 1,
      listScanCap: 1,
    }),
    /list_r2_objects_truncated/,
  );
});
