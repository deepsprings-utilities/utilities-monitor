import test from "node:test";
import assert from "node:assert/strict";
import { listR2Objects } from "../src/r2.js";

test("listR2Objects returns the scanned window sorted newest first without batch slicing", async () => {
  const oldEnv = process.env.INGEST_LIST_SCAN_CAP;
  delete process.env.INGEST_LIST_SCAN_CAP;
  try {
    const client = {
      async send(command) {
        assert.equal(command.input.Bucket, "bucket");
        assert.equal(command.input.Prefix, "log-gz/");
        return {
          IsTruncated: false,
          Contents: [
            {
              Key: "log-gz/serial/old.log.gz",
              ETag: "\"old\"",
              Size: 1,
              LastModified: new Date("2026-03-20T00:00:00Z"),
            },
            {
              Key: "log-gz/serial/new.log.gz",
              ETag: "\"new\"",
              Size: 1,
              LastModified: new Date("2026-03-21T00:00:00Z"),
            },
            {
              Key: "log-gz/serial/mid.log.gz",
              ETag: "\"mid\"",
              Size: 1,
              LastModified: new Date("2026-03-20T12:00:00Z"),
            },
          ],
        };
      },
    };

    const objects = await listR2Objects(client, {
      bucket: "bucket",
      prefix: "log-gz/",
      maxKeys: 1,
      listScanCap: 10,
    });

    assert.deepEqual(objects.map((o) => o.key), [
      "log-gz/serial/new.log.gz",
      "log-gz/serial/mid.log.gz",
      "log-gz/serial/old.log.gz",
    ]);
  } finally {
    if (oldEnv === undefined) {
      delete process.env.INGEST_LIST_SCAN_CAP;
    } else {
      process.env.INGEST_LIST_SCAN_CAP = oldEnv;
    }
  }
});
