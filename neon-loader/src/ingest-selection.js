import { checkpointPairKey } from "./checkpoint.js";

/**
 * Pick up to maxKeys objects that have not already been checkpointed.
 *
 * The input is already sorted newest-first. The batch cap must be applied after checkpoint
 * filtering; otherwise a fully checkpointed newest page can hide older unprocessed objects.
 *
 * @param {Array<{ key: string, etag?: string }>} objects
 * @param {Set<string>} processedSet
 * @param {number} maxKeys
 * @returns {{ selected: Array<{ key: string, etag?: string }>, skipped: number }}
 */
export function chooseObjectsForIngest(objects, processedSet, maxKeys) {
  const limit = Number(maxKeys);
  const cap = Number.isFinite(limit) && limit > 0 ? limit : 200;
  const selected = [];
  let skipped = 0;

  for (const object of objects) {
    const etag = object.etag || "no_etag";
    if (processedSet.has(checkpointPairKey(object.key, etag))) {
      skipped += 1;
      continue;
    }
    if (selected.length < cap) selected.push(object);
  }

  return { selected, skipped };
}
