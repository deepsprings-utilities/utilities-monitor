import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dummyEnv = {
  ...process.env,
  NEON_DATABASE_URL: "postgres://user:pass@127.0.0.1:1/db",
};

function runImporter(scriptName, csvText) {
  const dir = mkdtempSync(path.join(tmpdir(), "water-compliance-"));
  const filePath = path.join(dir, "empty.csv");
  writeFileSync(filePath, csvText);
  try {
    return spawnSync(process.execPath, [path.join(repoDir, "scripts", scriptName), filePath], {
      cwd: repoDir,
      env: dummyEnv,
      encoding: "utf8",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("schedule importer refuses a valid header with zero data rows", () => {
  const result = runImporter(
    "import-schedule-csv.mjs",
    "PS Codes,Group Name,Analyte Number,Analyte Name,Last Sampled,Frequency,Next Due,Notes\n",
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /parsed zero schedule rows/);
});

test("lead/copper importer refuses a valid header with zero data rows", () => {
  const result = runImporter(
    "import-lead-copper-csv.mjs",
    "Analyte Name,Next Sampling Due By\n",
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /parsed zero lead\/copper rows/);
});
