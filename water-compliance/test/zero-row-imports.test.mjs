import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(__dirname, "..");

function runImporter(scriptName, fileName, csvText) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "water-compliance-"));
  const csvPath = path.join(dir, fileName);
  writeFileSync(csvPath, csvText, "utf8");

  return spawnSync(process.execPath, [path.join("scripts", scriptName), csvPath], {
    cwd: repoDir,
    env: {
      ...process.env,
      NEON_DATABASE_URL: "postgres://user:pass@127.0.0.1:1/db",
    },
    encoding: "utf8",
  });
}

test("schedule importer refuses zero parsed rows before deleting existing source rows", () => {
  const result = runImporter(
    "import-schedule-csv.mjs",
    "ACTIVE-LAST-AND-NEXT-SAMPLE-REPORT.csv",
    [
      "PS Codes,Next Due,Last Sampled,Group Name,Analyte Number,Analyte Name,Frequency,Notes",
      ",2028/12,,,,,,",
    ].join("\n"),
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Parsed 0 schedule rows/);
  assert.match(result.stderr, /refusing to delete existing rows/);
});

test("lead/copper importer refuses zero parsed rows before deleting existing source rows", () => {
  const result = runImporter(
    "import-lead-copper-csv.mjs",
    "lead-copper.csv",
    ["Analyte Name,Next Sampling Due By", ",2030-01-01"].join("\n"),
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Parsed 0 lead\/copper rows/);
  assert.match(result.stderr, /refusing to delete existing rows/);
});
