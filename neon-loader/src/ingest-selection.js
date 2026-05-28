import { checkpointPairKey } from "./checkpoint.js";

export function ingestBatchLimit(maxKeys) {
  const limit = Number(maxKeys);
  return Number.isFinite(limit) && limit > 0 ? limit : 200;
}

export function selectObjectsForProcessing(objects, processedSet, maxKeys) {
  const cap = ingestBatchLimit(maxKeys);
  const pending = [];
  let skippedProcessed = 0;

  for (const object of objects) {
    const etag = object.etag || "no_etag";
    if (processedSet.has(checkpointPairKey(object.key, etag))) {
      skippedProcessed += 1;
      continue;
    }
    pending.push(object);
  }

  return {
    objectsToProcess: pending.slice(0, cap),
    skippedProcessed,
    pendingTotal: pending.length,
    deferredPending: Math.max(0, pending.length - cap),
  };
}
