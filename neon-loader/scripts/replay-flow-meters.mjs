/**
 * Replays only GPM/flow *tall* data for the configured Flex IO flow meters, then
 * (optionally) runs `npm run ingest` so R2 re-parses those object versions with
 * the current parser (Wyman / bypass / booster keys). Does not remove pressure,
 * power, or other units; does not delete whole-database ingest state.
 *
 * It deletes:
 * - `utility_measurement_tall` rows for the selected device addresses where
 *   the row is a flow (Gpm) measurement
 * - matching `ingest_raw_record` lines (so a replay does not duplicate raw)
 * - matching `ingest_checkpoint` for those files (so ingest will re-open them)
 *
 * Usage:
 *   REPLAY_FLOW_DEVICES=mb-003,mb-006,mb-008 node scripts/replay-flow-meters.mjs --yes
 *   node scripts/replay-flow-meters.mjs --yes --ingest
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { createDbPoolFromEnv, withTransaction } from "../src/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const runJs = join(__dirname, "../src/run.js");

const DEFAULT_DEVS = ["mb-003", "mb-006", "mb-008"];
const devsFromEnv = (process.env.REPLAY_FLOW_DEVICES || process.env.FLOW_METER_DEVICE_ADDRESSES || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const devs = devsFromEnv.length > 0 ? devsFromEnv : DEFAULT_DEVS;

const args = new Set(process.argv.slice(2));
const hasYes = args.has("--yes");
const doIngest = args.has("--ingest");

if (!hasYes) {
  console.error(
    "This deletes Gpm tall rows, raw line rows, and checkpoints for the flow device files, then you re-ingest. Devices:",
    devs.join(", "),
  );
  console.error("Override: REPLAY_FLOW_DEVICES=mb-003,mb-006,mb-008  node scripts/replay-flow-meters.mjs --yes");
  console.error("Run ingest after:  node scripts/replay-flow-meters.mjs --yes --ingest");
  process.exit(1);
}

const pool = createDbPoolFromEnv();

let tallDeleted = 0;
let rawDeleted = 0;
let ckptDeleted = 0;

await withTransaction(pool, async (client) => {
  const cRes = await client.query(
    "SELECT count(*)::int AS n FROM ingest_raw_file WHERE device_address = ANY($1::text[])",
    [devs],
  );
  const nFiles = cRes.rows[0]?.n ?? 0;
  console.log(`replay-flow: ${nFiles} ingest file(s) for device_address in (${devs.join(", ")})`);

  // GPM-only: flow; leaves PSI, kW, etc. on the same file for replay without duplicate raw+non-flow tall
  const tallRes = await client.query(
    `DELETE FROM utility_measurement_tall t
     USING ingest_raw_file f
     WHERE t.source_file_id = f.id
       AND f.device_address = ANY($1::text[])
       AND UPPER(COALESCE(t.unit, '')) LIKE '%GPM%'`,
    [devs],
  );
  tallDeleted = tallRes.rowCount ?? 0;

  const rawRes = await client.query(
    `DELETE FROM ingest_raw_record r
     WHERE r.file_id IN (SELECT id FROM ingest_raw_file WHERE device_address = ANY($1::text[]))`,
    [devs],
  );
  rawDeleted = rawRes.rowCount ?? 0;

  const ckptRes = await client.query(
    `DELETE FROM ingest_checkpoint c
     WHERE (c.r2_key, c.etag) IN (
       SELECT f.r2_key, f.etag FROM ingest_raw_file f WHERE f.device_address = ANY($1::text[])
     )`,
    [devs],
  );
  ckptDeleted = ckptRes.rowCount ?? 0;
});
await pool.end();

console.log(
  `replay-flow: deleted rows tall=${tallDeleted} raw_record=${rawDeleted} checkpoint=${ckptDeleted}. Re-run: npm run ingest (raise INGEST_BATCH_LIMIT to reach backlog).`,
);

if (doIngest) {
  await new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [runJs], { stdio: "inherit", env: process.env });
    c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ingest exit ${code}`))));
  });
}
