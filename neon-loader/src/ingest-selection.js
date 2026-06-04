import { checkpointPairKey } from "./checkpoint.js";

export function normalizeObjectLimit(maxKeys) {
  const n = Number(maxKeys);
  return Number.isFinite(n) && n > 0 ? n : 200;
}

export function checkpointPairsForObjects(objects) {
  return objects.map((object) => ({
    r2Key: object.key,
    etag: object.etag || "no_etag",
  }));
}

export function selectUnprocessedObjects(objects, processedSet, maxKeys) {
  const limit = normalizeObjectLimit(maxKeys);
  return objects
    .filter((object) => !processedSet.has(checkpointPairKey(object.key, object.etag || "no_etag")))
    .slice(0, limit);
}
