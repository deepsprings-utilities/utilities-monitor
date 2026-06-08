import { checkpointPairKey } from "./checkpoint.js";

function normalizeLimit(maxKeys) {
  const limit = Number(maxKeys);
  return Number.isFinite(limit) && limit > 0 ? limit : 200;
}

export function isCheckpointedObject(object, processedSet) {
  const etag = object.etag || "no_etag";
  return processedSet.has(checkpointPairKey(object.key, etag));
}

export function selectObjectsForIngest(objects, processedSet, maxKeys) {
  const limit = normalizeLimit(maxKeys);
  const selected = [];
  let skipped = 0;

  for (const object of objects) {
    if (isCheckpointedObject(object, processedSet)) {
      skipped += 1;
      continue;
    }
    if (selected.length < limit) {
      selected.push(object);
    }
  }

  return { selected, skipped };
}
