import { checkpointPairKey } from "./checkpoint.js";

function processCapFromMaxKeys(maxKeys) {
  const n = Number(maxKeys);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200;
}

export function selectObjectsForIngest(objects, processedSet, maxKeys) {
  const processCap = processCapFromMaxKeys(maxKeys);
  const pending = [];
  let skippedProcessed = 0;

  for (const object of objects) {
    const etag = object.etag || "no_etag";
    if (processedSet.has(checkpointPairKey(object.key, etag))) {
      skippedProcessed += 1;
    } else {
      pending.push(object);
    }
  }

  const selected = pending.slice(0, processCap);
  return {
    selected,
    skippedProcessed,
    deferred: pending.length - selected.length,
  };
}
