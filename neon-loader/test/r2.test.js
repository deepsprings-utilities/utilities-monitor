import test from "node:test";
import assert from "node:assert/strict";
import { listR2Objects } from "../src/r2.js";

test("listR2Objects returns the scanned newest-first candidate set", async () => {
  const client = {
    send(command) {
      assert.equal(command.input.Bucket, "bucket");
      assert.equal(command.input.Prefix, "log-gz/");
      return Promise.resolve({
        IsTruncated: false,
        Contents: [
          {
            Key: "log-gz/device/old.gz",
            ETag: '"old"',
            LastModified: new Date("2026-01-01T00:00:00Z"),
          },
          {
            Key: "log-gz/device/new.gz",
            ETag: '"new"',
            LastModified: new Date("2026-01-03T00:00:00Z"),
          },
          {
            Key: "log-gz/device/mid.gz",
            ETag: '"mid"',
            LastModified: new Date("2026-01-02T00:00:00Z"),
          },
        ],
      });
    },
  };

  const objects = await listR2Objects(client, {
    bucket: "bucket",
    prefix: "log-gz/",
    maxKeys: 2,
    listScanCap: 10,
  });

  assert.deepEqual(objects.map((o) => o.key), [
    "log-gz/device/new.gz",
    "log-gz/device/mid.gz",
    "log-gz/device/old.gz",
  ]);
  assert.deepEqual(objects.map((o) => o.etag), ["new", "mid", "old"]);
});
