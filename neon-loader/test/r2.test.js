import test from "node:test";
import assert from "node:assert/strict";
import { listR2Objects } from "../src/r2.js";

test("listR2Objects returns the sorted scan window instead of slicing to batch limit", async () => {
  const client = {
    async send(command) {
      assert.equal(command.input.Bucket, "bucket");
      assert.equal(command.input.Prefix, "log-gz/");
      return {
        IsTruncated: false,
        Contents: [
          {
            Key: "log-gz/serial/old.gz",
            ETag: "\"old\"",
            Size: 10,
            LastModified: new Date("2026-04-01T00:00:00Z"),
          },
          {
            Key: "log-gz/serial/newest.gz",
            ETag: "\"newest\"",
            Size: 10,
            LastModified: new Date("2026-04-04T00:00:00Z"),
          },
          {
            Key: "log-gz/serial/mid.gz",
            ETag: "\"mid\"",
            Size: 10,
            LastModified: new Date("2026-04-02T00:00:00Z"),
          },
          {
            Key: "log-gz/serial/new.gz",
            ETag: "\"new\"",
            Size: 10,
            LastModified: new Date("2026-04-03T00:00:00Z"),
          },
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
    [
      "log-gz/serial/newest.gz",
      "log-gz/serial/new.gz",
      "log-gz/serial/mid.gz",
      "log-gz/serial/old.gz",
    ],
  );
  assert.equal(objects[0].etag, "newest");
});

test("listR2Objects still fails when the scan cap truncates an R2 listing", async () => {
  const originalFailOnTruncatedList = process.env.FAIL_ON_TRUNCATED_LIST;
  delete process.env.FAIL_ON_TRUNCATED_LIST;
  const client = {
    async send() {
      return {
        IsTruncated: true,
        NextContinuationToken: "next",
        Contents: [
          {
            Key: "log-gz/serial/only-collected.gz",
            ETag: "\"etag\"",
            LastModified: new Date("2026-04-01T00:00:00Z"),
          },
        ],
      };
    },
  };

  try {
    await assert.rejects(
      listR2Objects(client, {
        bucket: "bucket",
        prefix: "log-gz/",
        maxKeys: 1,
        listScanCap: 1,
      }),
      /list_r2_objects_truncated/,
    );
  } finally {
    if (originalFailOnTruncatedList === undefined) {
      delete process.env.FAIL_ON_TRUNCATED_LIST;
    } else {
      process.env.FAIL_ON_TRUNCATED_LIST = originalFailOnTruncatedList;
    }
  }
});
