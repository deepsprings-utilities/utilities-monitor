import test from "node:test";
import assert from "node:assert/strict";
import { listR2Objects } from "../src/r2.js";

test("listR2Objects returns the full scanned window sorted by LastModified", async () => {
  const pages = [
    {
      IsTruncated: true,
      NextContinuationToken: "next",
      Contents: [
        { Key: "log-gz/a.gz", ETag: '"a"', Size: 1, LastModified: new Date("2026-01-01T00:00:00Z") },
        { Key: "log-gz/b.gz", ETag: '"b"', Size: 1, LastModified: new Date("2026-01-03T00:00:00Z") },
      ],
    },
    {
      IsTruncated: false,
      Contents: [
        { Key: "log-gz/c.gz", ETag: '"c"', Size: 1, LastModified: new Date("2026-01-02T00:00:00Z") },
      ],
    },
  ];
  const client = {
    calls: [],
    async send(command) {
      this.calls.push(command.input);
      return pages[this.calls.length - 1];
    },
  };

  const objects = await listR2Objects(client, {
    bucket: "bucket",
    prefix: "log-gz/",
    maxKeys: 2,
    listScanCap: 3,
  });

  assert.deepEqual(
    objects.map((o) => o.key),
    ["log-gz/b.gz", "log-gz/c.gz", "log-gz/a.gz"],
  );
  assert.equal(objects.length, 3);
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[0].MaxKeys, 3);
  assert.equal(client.calls[1].ContinuationToken, "next");
});

test("listR2Objects fails closed when the scan cap truncates the listing", async () => {
  const client = {
    async send() {
      return {
        IsTruncated: true,
        NextContinuationToken: "next",
        Contents: [
          { Key: "log-gz/a.gz", ETag: '"a"', Size: 1, LastModified: new Date("2026-01-01T00:00:00Z") },
          { Key: "log-gz/b.gz", ETag: '"b"', Size: 1, LastModified: new Date("2026-01-02T00:00:00Z") },
        ],
      };
    },
  };

  await assert.rejects(
    () =>
      listR2Objects(client, {
        bucket: "bucket",
        prefix: "log-gz/",
        maxKeys: 2,
        listScanCap: 2,
      }),
    /list_r2_objects_truncated/,
  );
});
