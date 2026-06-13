import { checkpointPairKey } from "./checkpoint.js";

export function processCapFromMaxKeys(maxKeys) {
  const n = Number(maxKeys);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200;
}

export function selectObjectsForIngest(objects, processedSet, maxKeys) {
  const processCap = processCapFromMaxKeys(maxKeys);
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
