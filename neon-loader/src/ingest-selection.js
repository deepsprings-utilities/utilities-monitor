import { checkpointPairKey } from "./checkpoint.js";

export function normalizeEtag(etag) {
  return etag || "no_etag";
}

export function selectObjectsForIngest(objects, processedSet, maxKeys) {
  const limit = Number(maxKeys);
  const processCap = Number.isFinite(limit) && limit > 0 ? limit : 200;

  return objects
    .filter((object) => !processedSet.has(checkpointPairKey(object.key, normalizeEtag(object.etag))))
    .slice(0, processCap);
}

export function countProcessedObjects(objects, processedSet) {
  let count = 0;
  for (const object of objects) {
    if (processedSet.has(checkpointPairKey(object.key, normalizeEtag(object.etag)))) {
      count += 1;
    }
  }
  return count;
}
