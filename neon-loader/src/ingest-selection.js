import { checkpointPairKey } from "./checkpoint.js";

export function normalizeProcessLimit(maxKeys) {
  const n = Number(maxKeys);
  return Number.isFinite(n) && n > 0 ? n : 200;
}

export function selectPendingObjects(objects, processedSet, maxKeys) {
  const limit = normalizeProcessLimit(maxKeys);
  const selected = [];
  let skipped = 0;

  for (const object of objects) {
    const etag = object.etag || "no_etag";
    if (processedSet.has(checkpointPairKey(object.key, etag))) {
      skipped += 1;
      continue;
    }
    if (selected.length < limit) {
      selected.push(object);
    }
  }

  return { selected, skipped };
}
