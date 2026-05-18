import { checkpointPairKey, fetchProcessedPairSet } from "./checkpoint.js";

const DEFAULT_PROCESS_CAP = 200;
const CHECKPOINT_LOOKUP_MIN_CHUNK = 500;

export function normalizeProcessCap(maxKeys) {
  const n = Number(maxKeys);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PROCESS_CAP;
}

export function selectUnprocessedObjects(objects, processedSet, maxKeys) {
  const processCap = normalizeProcessCap(maxKeys);
  const selected = [];
  let skippedProcessed = 0;

  for (const object of objects) {
    const etag = object.etag || "no_etag";
    if (processedSet.has(checkpointPairKey(object.key, etag))) {
      skippedProcessed += 1;
      continue;
    }
    selected.push(object);
    if (selected.length >= processCap) break;
  }

  return { selected, skippedProcessed };
}

export async function selectUnprocessedObjectsFromCheckpoints(pool, objects, maxKeys) {
  const processCap = normalizeProcessCap(maxKeys);
  const selected = [];
  let skippedProcessed = 0;
  let checkpointChecked = 0;
  const lookupChunkSize = Math.max(processCap, CHECKPOINT_LOOKUP_MIN_CHUNK);

  for (let i = 0; i < objects.length && selected.length < processCap; i += lookupChunkSize) {
    const chunk = objects.slice(i, i + lookupChunkSize);
    checkpointChecked += chunk.length;
    const checkpointPairs = chunk.map((o) => ({
      r2Key: o.key,
      etag: o.etag || "no_etag",
    }));
    const processedSet = await fetchProcessedPairSet(pool, checkpointPairs);
    const result = selectUnprocessedObjects(
      chunk,
      processedSet,
      processCap - selected.length,
    );
    selected.push(...result.selected);
    skippedProcessed += result.skippedProcessed;
  }

  return { selected, skippedProcessed, checkpointChecked };
}
