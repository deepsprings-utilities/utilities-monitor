import { checkpointPairKey } from "./checkpoint.js";

function processCapFrom(maxKeys) {
  const processLimit = Number(maxKeys);
  return Number.isFinite(processLimit) && processLimit > 0 ? processLimit : 200;
}

function objectCheckpointKey(object) {
  return checkpointPairKey(object.key, object.etag || "no_etag");
}

/**
 * Selects the next uncheckpointed R2 objects to ingest from a sorted scan window.
 * Checkpoint filtering must happen before the batch cap, or a backlog behind already
 * processed newest keys can starve forever.
 *
 * @param {Array<{ key: string, etag?: string }>} objects
 * @param {Set<string>} processedSet
 * @param {number | string | undefined} maxKeys
 */
export function selectObjectsForIngest(objects, processedSet, maxKeys) {
  const processCap = processCapFrom(maxKeys);
  const selected = [];
  let skipped = 0;

  for (const object of objects) {
    if (processedSet.has(objectCheckpointKey(object))) {
      skipped += 1;
      continue;
    }
    if (selected.length < processCap) {
      selected.push(object);
    }
  }

  return { selected, skipped, processCap };
}
