/**
 * Builds src/mb-csv-header-lines.json for the Worker (tab-separated header row per mb-XXX).
 * Run after changing neon-loader/schema-column-orders.json or device mapping.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Worker package root (`worker/`). */
const workerRoot = path.join(__dirname, "..");
/** Repo root: sibling `neon-loader/` lives next to `worker/`. */
const schemaPath = path.join(workerRoot, "..", "neon-loader", "schema-column-orders.json");

const orders = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

/**
 * Maps mb-XXX → schema id in schema-column-orders.json.
 * mb-002 / mb-007 are ModHopper (label-map status_only_v1); HTTP uploads still use the
 * same 14-column row shape as power_pulse_v1, so we reuse that header row for prepending.
 */
const MB_TO_SCHEMA = {
  "001": "power_pulse_v1",
  "002": "power_pulse_v1",
  "003": "booster_flex_v1",
  "004": "wattnode_64_v1",
  "005": "solar_hydro_pulse_v1",
  "006": "hydro_flex_v1",
  "007": "power_pulse_v1",
  "008": "deep_well_flex_v1",
  "009": "wattnode_64_v1",
};

const out = {};
for (const [mb, schemaId] of Object.entries(MB_TO_SCHEMA)) {
  const cols = orders[schemaId];
  if (cols?.length) out[mb] = cols.join("\t");
}

const outPath = path.join(workerRoot, "src", "mb-csv-header-lines.json");
fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log("wrote", outPath, Object.keys(out).length, "devices");
