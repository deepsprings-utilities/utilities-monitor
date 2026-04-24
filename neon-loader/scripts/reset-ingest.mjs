/**
 * Wipes AcquiSuite R2→Neon data so the next `npm run ingest` replays from scratch.
 * Does not touch `water_sampling_schedule` or other non-ingest tables.
 *
 * Usage:
 *   cd neon-loader && npm run reingest:from-scratch
 *   or: node scripts/reset-ingest.mjs --yes
 *   or: node scripts/reset-ingest.mjs --yes --ingest   (reset then run src/run.js)
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { createDbPoolFromEnv, withTransaction } from "../src/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const runJs = join(__dirname, "../src/run.js");

const args = new Set(process.argv.slice(2));
const hasYes = args.has("--yes");
const doIngest = args.has("--ingest");

if (!hasYes) {
  console.error(
    "This deletes all rows in ingest_raw_file, ingest_raw_record, utility_measurement_tall, and ingest_checkpoint.",
  );
  console.error("Re-run with:  node scripts/reset-ingest.mjs --yes");
  console.error("Re-run with ingest after reset:  node scripts/reset-ingest.mjs --yes --ingest");
  process.exit(1);
}

const pool = createDbPoolFromEnv();
await withTransaction(pool, async (client) => {
  await client.query(
    `TRUNCATE TABLE
       utility_measurement_tall,
       ingest_raw_record,
       ingest_raw_file
     RESTART IDENTITY CASCADE`,
  );
  await client.query("TRUNCATE TABLE ingest_checkpoint RESTART IDENTITY");
});
await pool.end();

console.log("reset: AcquiSuite ingest + checkpoint tables truncated (tall, raw, files, checkpoint).");

if (doIngest) {
  await new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [runJs], { stdio: "inherit", env: process.env });
    c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ingest exit ${code}`))));
  });
}
