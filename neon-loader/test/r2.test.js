import test from "node:test";
import assert from "node:assert/strict";
import { listR2Objects } from "../src/r2.js";

function commandInput(command) {
  return command?.input || {};
}

test("listR2Objects sorts newest across all paginated lexical pages", async () => {
  const calls = [];
  const client = {
    async send(command) {
      const input = commandInput(command);
      calls.push(input);
      if (!input.ContinuationToken) {
        return {
          IsTruncated: true,
          NextContinuationToken: "page-2",
          Contents: [
            {
              Key: "log-gz/a-old.log.gz",
              ETag: '"old"',
              LastModified: new Date("2026-01-01T00:00:00Z"),
            },
          ],
        };
      }
      return {
        IsTruncated: false,
        Contents: [
          {
            Key: "log-gz/z-new.log.gz",
            ETag: '"new"',
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
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(
    objects.map((o) => [o.key, o.etag]),
    [["log-gz/z-new.log.gz", "new"]],
  );
});
