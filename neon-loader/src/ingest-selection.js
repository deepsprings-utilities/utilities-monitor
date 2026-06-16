import { checkpointPairKey, fetchProcessedPairSet } from "./checkpoint.js";

function processCapFrom(maxKeys) {
  const n = Number(maxKeys);
  return Number.isFinite(n) && n > 0 ? n : 200;
}

function lookupChunkSizeFrom(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 5000) : 500;
}

/**
 * Select the next uncheckpointed objects from a newest-first scan window.
 *
 * The ingest batch limit must be applied after checkpoint filtering; otherwise
 * a full batch of already-processed newest objects can permanently hide older
 * unprocessed objects behind it.
 */
export async function selectUnprocessedObjects(
  db,
  objects,
  maxKeys,
  { lookupChunkSize = 500 } = {},
) {
  const processCap = processCapFrom(maxKeys);
  const chunkSize = lookupChunkSizeFrom(lookupChunkSize);
  const selected = [];
  let skippedAlreadyProcessed = 0;
  let examined = 0;

  for (let i = 0; i < objects.length; i += chunkSize) {
    const batch = objects.slice(i, i + chunkSize);
    const checkpointPairs = batch.map((o) => ({
      r2Key: o.key,
      etag: o.etag || "no_etag",
    }));
    const processedSet = await fetchProcessedPairSet(db, checkpointPairs);

    for (const object of batch) {
      examined += 1;
      const etag = object.etag || "no_etag";
      if (processedSet.has(checkpointPairKey(object.key, etag))) {
        skippedAlreadyProcessed += 1;
        continue;
      }

      selected.push(object);
      if (selected.length >= processCap) {
        return { objects: selected, skippedAlreadyProcessed, examined };
      }
    }
  }

  return { objects: selected, skippedAlreadyProcessed, examined };
}
