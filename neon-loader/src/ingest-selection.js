import { checkpointPairKey } from "./checkpoint.js";

export function normalizeBatchLimit(value, fallback = 200) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function selectObjectsForIngest(objects, processedSet, maxObjects) {
  const limit = normalizeBatchLimit(maxObjects);
  const pending = [];
  let skipped = 0;

  for (const object of objects) {
    const etag = object.etag || "no_etag";
    if (processedSet.has(checkpointPairKey(object.key, etag))) {
      skipped += 1;
      continue;
    }
    pending.push(object);
  }

  const selected = pending.slice(0, limit);
  return {
    selected,
    skipped,
    pending: pending.length,
    deferred: Math.max(0, pending.length - selected.length),
  };
}
