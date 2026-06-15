import { checkpointPairKey } from "./checkpoint.js";

/**
 * Select uncheckpointed objects after the R2 scan is sorted newest-first.
 * The batch limit must apply after checkpoint filtering; otherwise a newest-first window full of
 * already-processed objects can permanently hide older unprocessed backlog.
 */
export function selectObjectsForIngest(objects, processedSet, maxKeys) {
  const requested = Number(maxKeys);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 200;
  const selected = [];
  let checkpointed = 0;

  for (const object of objects) {
    const etag = object.etag || "no_etag";
    if (processedSet.has(checkpointPairKey(object.key, etag))) {
      checkpointed += 1;
      continue;
    }
    if (selected.length < limit) {
      selected.push(object);
    }
  }

  return {
    selected,
    checkpointed,
    unprocessedInScan: objects.length - checkpointed,
  };
}
