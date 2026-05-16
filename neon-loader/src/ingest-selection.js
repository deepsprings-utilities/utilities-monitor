import { checkpointPairKey, fetchProcessedPairSet } from "./checkpoint.js";

function normalizeLimit(maxCount) {
  const n = Number(maxCount);
  return Number.isFinite(n) && n > 0 ? n : 200;
}

function checkpointPairForObject(object) {
  return {
    r2Key: object.key,
    etag: object.etag || "no_etag",
  };
}

/**
 * Pick the newest unprocessed objects from a sorted R2 candidate list.
 *
 * The per-run batch limit must be applied after checkpoint filtering; otherwise a
 * fully checkpointed newest page can hide older objects forever.
 */
export async function selectUnprocessedObjects(pool, candidates, maxCount) {
  const limit = normalizeLimit(maxCount);
  const checkpointPairs = candidates.map(checkpointPairForObject);
  const processedSet = await fetchProcessedPairSet(pool, checkpointPairs);

  let alreadyProcessed = 0;
  const selected = [];
  for (const object of candidates) {
    const etag = object.etag || "no_etag";
    if (processedSet.has(checkpointPairKey(object.key, etag))) {
      alreadyProcessed += 1;
      continue;
    }
    if (selected.length < limit) {
      selected.push(object);
    }
  }

  return {
    objects: selected,
    alreadyProcessed,
    scanned: candidates.length,
  };
}
