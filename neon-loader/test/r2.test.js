import test from "node:test";
import assert from "node:assert/strict";
import { listR2Objects } from "../src/r2.js";

test("listR2Objects returns the full sorted scan window without maxKeys slicing", async () => {
  const sent = [];
  const client = {
    async send(command) {
      sent.push(command.input);
      return {
        Contents: [
          { Key: "log-gz/old.gz", ETag: '"old"', Size: 1, LastModified: new Date("2026-01-01T00:00:00Z") },
          { Key: "log-gz/new.gz", ETag: '"new"', Size: 1, LastModified: new Date("2026-01-03T00:00:00Z") },
          { Key: "log-gz/mid.gz", ETag: '"mid"', Size: 1, LastModified: new Date("2026-01-02T00:00:00Z") },
        ],
        IsTruncated: false,
      };
    },
  };

  const objects = await listR2Objects(client, {
    bucket: "bucket",
    prefix: "log-gz/",
    maxKeys: 2,
    listScanCap: 3,
  });

  assert.deepEqual(sent, [
    {
      Bucket: "bucket",
      Prefix: "log-gz/",
      MaxKeys: 3,
      ContinuationToken: undefined,
    },
  ]);
  assert.deepEqual(
    objects.map((object) => object.key),
    ["log-gz/new.gz", "log-gz/mid.gz", "log-gz/old.gz"],
  );
});

test("listR2Objects fails closed when the scan cap truncates a longer listing", async () => {
  const oldFail = process.env.FAIL_ON_TRUNCATED_LIST;
  delete process.env.FAIL_ON_TRUNCATED_LIST;
  const client = {
    async send() {
      return {
        Contents: [
          { Key: "log-gz/a.gz", ETag: '"a"', LastModified: new Date("2026-01-02T00:00:00Z") },
          { Key: "log-gz/b.gz", ETag: '"b"', LastModified: new Date("2026-01-01T00:00:00Z") },
        ],
        IsTruncated: true,
        NextContinuationToken: "next",
      };
    },
  };

  try {
    await assert.rejects(
      () => listR2Objects(client, {
        bucket: "bucket",
        prefix: "log-gz/",
        maxKeys: 1,
        listScanCap: 2,
      }),
      /list_r2_objects_truncated/,
    );
  } finally {
    if (oldFail === undefined) {
      delete process.env.FAIL_ON_TRUNCATED_LIST;
    } else {
      process.env.FAIL_ON_TRUNCATED_LIST = oldFail;
    }
  }
});
