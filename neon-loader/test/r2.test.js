import test from "node:test";
import assert from "node:assert/strict";
import { listR2Objects } from "../src/r2.js";

function r2Object(key, lastModified) {
  return {
    Key: key,
    ETag: `"${key}"`,
    Size: 123,
    LastModified: new Date(lastModified),
  };
}

test("listR2Objects returns the sorted scan window, not only the process limit", async () => {
  const sentCommands = [];
  const client = {
    async send(command) {
      sentCommands.push(command.input);
      return {
        IsTruncated: false,
        Contents: [
          r2Object("log-gz/device/old.gz", "2026-01-01T00:00:00Z"),
          r2Object("log-gz/device/new.gz", "2026-01-03T00:00:00Z"),
          r2Object("log-gz/device/mid.gz", "2026-01-02T00:00:00Z"),
        ],
      };
    },
  };

  const objects = await listR2Objects(client, {
    bucket: "bucket",
    prefix: "log-gz/",
    maxKeys: 2,
    listScanCap: 3,
  });

  assert.equal(sentCommands.length, 1);
  assert.equal(sentCommands[0].MaxKeys, 3);
  assert.deepEqual(
    objects.map((o) => o.key),
    [
      "log-gz/device/new.gz",
      "log-gz/device/mid.gz",
      "log-gz/device/old.gz",
    ],
  );
});
