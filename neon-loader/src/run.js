import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDbPoolFromEnv, insertRawFile, insertRawRecords, insertTallRows, withTransaction } from "./db.js";
import { isProcessed, markProcessed } from "./checkpoint.js";
import { parseGzipLog } from "./parse.js";
import { createR2ClientFromEnv, getR2ObjectBytes, listR2Objects } from "./r2.js";
import { loadLabelMap, resolveLabel } from "./labeling.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadSchemaColumnOrders() {
  try {
    return JSON.parse(
      readFileSync(path.join(__dirname, "..", "schema-column-orders.json"), "utf8"),
    );
  } catch {
    return {};
  }
}

const schemaColumnOrders = loadSchemaColumnOrders();

async function main() {
  const runId = `${Date.now()}`;
  const bucket = mustGetEnv("R2_BUCKET_NAME");
  const prefix = process.env.INGEST_PREFIX || "log-gz/";
  const maxKeys = Number(process.env.INGEST_BATCH_LIMIT || "200");
  const dryRun = process.env.DRY_RUN === "1";

  const r2 = createR2ClientFromEnv();
  const db = createDbPoolFromEnv();
  const labelMapConfig = await loadLabelMap();

  const objects = await listR2Objects(r2, { bucket, prefix, maxKeys });
  const stats = {
    listed: objects.length,
    skipped: 0,
    succeeded: 0,
    failed: 0,
  };
  console.log(
    `run_id=${runId} prefix=${prefix} max_objects_this_run=${maxKeys} listed=${objects.length} dry_run=${dryRun}`,
  );

  for (const object of objects) {
    const etag = object.etag || "no_etag";
    const fileName = path.basename(object.key);
    const label = resolveLabel(labelMapConfig, fileName);
    const serial = serialFromKey(object.key);

    try {
      const skip = await withTransaction(db, (client) => isProcessed(client, object.key, etag));
      if (skip) {
        stats.skipped += 1;
        continue;
      }

      console.log(`processing key=${object.key}`);
      const bytes = await getR2ObjectBytes(r2, { bucket, key: object.key });
      const schema = (labelMapConfig.schemas || {})[label.schemaId] || {};
      // Strict header allowlists can drop every column if filenames/eras don't match exactly.
      // Default: parse all meter columns (like the legacy Python loader). Opt in with STRICT_SCHEMA=1.
      const strictSchema = process.env.STRICT_SCHEMA === "1";
      const columnOrder = schema.columnOrder || schemaColumnOrders[label.schemaId] || null;
      const parsed = parseGzipLog(bytes, {
        expectedHeaders: strictSchema ? schema.expectedHeaders || [] : [],
        headerAliases: strictSchema ? schema.headerAliases || {} : {},
        columnOrder,
      });
      if (!label.hasData && parsed.measurableHeaders && parsed.measurableHeaders.length > 0) {
        const preview = parsed.measurableHeaders.slice(0, 5).join(" | ");
        console.warn(
          `warning key=${object.key} device=${label.deviceAddress} hasData=false but measurable headers detected: ${preview}`,
        );
      }
      if (dryRun) {
        console.log(
          `dry_run key=${object.key} rows=${parsed.rawRecords.length} tall=${parsed.tallRows.length} label=${label.labelCode}`,
        );
        stats.succeeded += 1;
        continue;
      }

      await withTransaction(db, async (client) => {
        const fileId = await insertRawFile(client, {
          r2Key: object.key,
          etag,
          serial,
          filetime: object.lastModified ? object.lastModified.toISOString() : null,
          loopname: null,
          source: "acquisuite",
          parseStatus: "parsed",
          errorText: null,
          deviceAddress: label.deviceAddress,
          physicalGroup: label.physicalGroup,
          schemaId: label.schemaId,
        });

        await insertRawRecords(client, fileId, parsed.rawRecords, label);
        if (label.hasData) {
          const tallWithTs = parsed.tallRows.filter((r) => r.recordTs).length;
          if (parsed.rawRecords.length > 0 && parsed.tallRows.length === 0) {
            console.warn(
              `warning key=${object.key} device=${label.deviceAddress} schemaId=${label.schemaId} raw_rows=${parsed.rawRecords.length} tall_rows=0 (no measurable numeric columns — strict schema, loose parse, or non-numeric cells)`,
            );
          }
          if (parsed.tallRows.length > 0 && tallWithTs === 0) {
            const sample = parsed.rawRecords[0]?.parsedJson || {};
            console.warn(
              `warning key=${object.key} device=${label.deviceAddress} parsed ${parsed.tallRows.length} tall rows but none had record_ts; check time column sample=${JSON.stringify(sample)}`,
            );
          }
          await insertTallRows(client, fileId, serial, parsed.tallRows, label);
        } else {
          console.warn(
            `skip_utility_measurement_tall key=${object.key} label=${label.labelCode} device=${label.deviceAddress} reason=hasData_false (ingest_raw_record still written)`,
          );
        }
        await markProcessed(client, { r2Key: object.key, etag, runId });
      });
      stats.succeeded += 1;
      console.log(
        `ingested key=${object.key} rows=${parsed.rawRecords.length} tall=${parsed.tallRows.length} label=${label.labelCode}`,
      );
    } catch (error) {
      stats.failed += 1;
      console.error(`failed key=${object.key} message=${error.message}`);
      if (!dryRun) {
        await withTransaction(db, async (client) => {
          await insertRawFile(client, {
            r2Key: object.key,
            etag,
            serial,
            filetime: object.lastModified ? object.lastModified.toISOString() : null,
            loopname: null,
            source: "acquisuite",
            parseStatus: "error",
            errorText: String(error.message || error),
            deviceAddress: label.deviceAddress,
            physicalGroup: label.physicalGroup,
            schemaId: label.schemaId,
          });
        });
      }
    }
  }

  await db.end();
  console.log(
    `run_complete run_id=${runId} listed=${stats.listed} skipped=${stats.skipped} succeeded=${stats.succeeded} failed=${stats.failed}`,
  );
}

function serialFromKey(r2Key) {
  const parts = String(r2Key || "").split("/");
  return parts.length >= 2 ? parts[1] : "unknown_serial";
}

function mustGetEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
