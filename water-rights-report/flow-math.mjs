/**
 * Trapezoidal GPM x minutes -> gallons per reading interval (aligned with template rows).
 *
 * The first sampled value is not backfilled to the report start; without a prior
 * sample, doing so invents diversion volume. When an end bound is supplied, the
 * final sampled value is carried forward to close the report period.
 */

function timestampMs(row) {
  const t = new Date(row.record_ts).getTime();
  return Number.isFinite(t) ? t : null;
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function computeFlowIntervals(rows, startUtc, endUtc = null) {
  const gallons = Array(rows.length).fill(0);
  const dtMinutes = Array(rows.length).fill(0);
  const startMs = startUtc ? startUtc.getTime() : null;
  const endMs = endUtc ? endUtc.getTime() : null;

  for (let i = 1; i < rows.length; i += 1) {
    const tPrev = timestampMs(rows[i - 1]);
    const t = timestampMs(rows[i]);
    const fPrev = finiteNumber(rows[i - 1].metric_value);
    const f = finiteNumber(rows[i].metric_value);
    if (tPrev === null || t === null || fPrev === null || f === null) {
      continue;
    }

    const intervalStart = startMs === null ? tPrev : Math.max(tPrev, startMs);
    const dtMin = (t - intervalStart) / 60000;
    if (dtMin <= 0) {
      continue;
    }

    const gal = ((f + fPrev) / 2) * dtMin;
    gallons[i] = Number.isFinite(gal) ? gal : 0;
    dtMinutes[i] = dtMin;
  }

  if (rows.length > 0 && endMs !== null && Number.isFinite(endMs)) {
    const lastIdx = rows.length - 1;
    const tLast = timestampMs(rows[lastIdx]);
    const fLast = finiteNumber(rows[lastIdx].metric_value);
    if (tLast !== null && fLast !== null) {
      const intervalStart = startMs === null ? tLast : Math.max(tLast, startMs);
      const dtMin = (endMs - intervalStart) / 60000;
      if (dtMin > 0) {
        const gal = fLast * dtMin;
        gallons[lastIdx] += Number.isFinite(gal) ? gal : 0;
        dtMinutes[lastIdx] += dtMin;
      }
    }
  }

  return { gallons, dtMinutes };
}
