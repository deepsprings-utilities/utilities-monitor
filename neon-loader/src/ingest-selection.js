import { checkpointPairKey } from "./checkpoint.js";

export function processLimitFromValue(value) {
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? limit : 200;
}

export function selectObjectsForIngest(objects, processedSet, maxObjects) {
  const processCap = processLimitFromValue(maxObjects);
  const selected = [];
  let skippedAlreadyProcessed = 0;

  for (const object of objects) {
    const etag = object.etag || "no_etag";
    if (processedSet.has(checkpointPairKey(object.key, etag))) {
      skippedAlreadyProcessed += 1;
      continue;
    }

    if (selected.length < processCap) {
      selected.push(object);
    }
  }

  return { selected, skippedAlreadyProcessed };
}
