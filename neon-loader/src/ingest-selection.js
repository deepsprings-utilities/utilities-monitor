import { checkpointPairKey } from "./checkpoint.js";

export function processLimitFromValue(value) {
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? limit : 200;
}

export function selectObjectsForIngest(objects, processedSet, maxKeys) {
  const processLimit = processLimitFromValue(maxKeys);
  const selected = [];
  let alreadyProcessed = 0;

  for (const object of objects) {
    const etag = object.etag || "no_etag";
    if (processedSet.has(checkpointPairKey(object.key, etag))) {
      alreadyProcessed += 1;
      continue;
    }
    if (selected.length < processLimit) selected.push(object);
  }

  return {
    objects: selected,
    alreadyProcessed,
    processLimit,
    candidates: objects.length,
  };
}
