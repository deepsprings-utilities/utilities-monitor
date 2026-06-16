import test from "node:test";
import assert from "node:assert/strict";
import { checkpointPairKey } from "../src/checkpoint.js";
import { selectPendingObjects } from "../src/ingest-selection.js";
import { listR2Objects } from "../src/r2.js";

test("listR2Objects returns the full scanned window sorted newest first", async () => {
  const client = {
    async send() {
      return {
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
    objects.map((o) => o.key),
    ["log-gz/device/new.gz", "log-gz/device/mid.gz", "log-gz/device/old.gz"],
  );
});

test("selectPendingObjects applies batch cap after checkpoint filtering", () => {
  const objects = [
    { key: "log-gz/device/new-1.gz", etag: "1" },
    { key: "log-gz/device/new-2.gz", etag: "2" },
    { key: "log-gz/device/old-unprocessed.gz", etag: "3" },
  ];
  const processed = new Set([
    checkpointPairKey("log-gz/device/new-1.gz", "1"),
    checkpointPairKey("log-gz/device/new-2.gz", "2"),
  ]);

  const result = selectPendingObjects(objects, processed, 2);

  assert.equal(result.skipped, 2);
  assert.deepEqual(result.selected, [
    { key: "log-gz/device/old-unprocessed.gz", etag: "3" },
  ]);
});
