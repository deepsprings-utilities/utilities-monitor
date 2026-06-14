import { checkpointPairKey } from "./checkpoint.js";

export function ingestBatchLimit(maxKeys) {
  const n = Number(maxKeys);
  return Number.isFinite(n) && n > 0 ? n : 200;
}

export function selectObjectsForIngest(objects, processedSet, maxKeys) {
  const limit = ingestBatchLimit(maxKeys);
  const selectedObjects = [];
  let skippedCheckpointed = 0;

  for (const object of objects) {
    const etag = object.etag || "no_etag";
    if (processedSet.has(checkpointPairKey(object.key, etag))) {
      skippedCheckpointed += 1;
      continue;
    }
    if (selectedObjects.length < limit) {
      selectedObjects.push(object);
    }
  }

  return { selectedObjects, skippedCheckpointed };
}
