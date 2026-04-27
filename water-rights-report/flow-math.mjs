/**
 * Trapezoidal GPM × minutes → gallons per reading interval (aligned with template rows).
 */

export function computeFlowIntervals(rows, startUtc) {
  const gallons = [];
  const dtMinutes = [];
  for (let i = 0; i < rows.length; i += 1) {
    const t = new Date(rows[i].record_ts).getTime();
    const f = Number(rows[i].metric_value);
    let dtMin;
    let fPrev;
    if (i === 0) {
      dtMin = (t - startUtc.getTime()) / 60000;
      fPrev = f;
    } else {
      const tPrev = new Date(rows[i - 1].record_ts).getTime();
      dtMin = (t - tPrev) / 60000;
      fPrev = Number(rows[i - 1].metric_value);
    }
    if (dtMin < 0) {
      gallons.push(0);
      dtMinutes.push(0);
      continue;
    }
    const avgGpm = i === 0 ? f : (f + fPrev) / 2;
    const gal = avgGpm * dtMin;
    gallons.push(Number.isFinite(gal) ? gal : 0);
    dtMinutes.push(dtMin);
  }
  return { gallons, dtMinutes };
}
