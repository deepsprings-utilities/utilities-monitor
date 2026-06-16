import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("scheduled ingest workflow exposes R2 listing truncation controls", async () => {
  const workflowPath = resolve(__dirname, "../../.github/workflows/ingest-r2-to-neon.yml");
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(
    workflow,
    /INGEST_LIST_SCAN_CAP:\s*\$\{\{\s*vars\.INGEST_LIST_SCAN_CAP\s*\|\|\s*'250000'\s*\}\}/,
  );
  assert.match(
    workflow,
    /FAIL_ON_TRUNCATED_LIST:\s*\$\{\{\s*vars\.FAIL_ON_TRUNCATED_LIST\s*\|\|\s*'1'\s*\}\}/,
  );
});
