/**
 * Portable ops alerts (Neon → Resend): parity with Grafana rules documented under
 * neon-loader/grafana/alerts/. Bundles stale data, hydro output, water due dates, alarm flags.
 *
 * GitHub Actions: NEON_DATABASE_URL, RESEND_API_KEY, ALERT_EMAIL_FROM, ALERT_EMAIL_TO.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDbPoolFromEnv } from "./db.js";

const __filename = fileURLToPath(import.meta.url);

function isMainModule() {
  const a = process.argv[1];
  if (!a) return false;
  try {
    return path.resolve(a) === __filename;
  } catch {
    return false;
  }
}

/** Dedupe key — bump if bundle shape changes materially. */
const ALERT_KEY = "email_ops_bundle_v1";

/** @param {string | undefined} raw */
export function parseRecipientList(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function envInt(name, defaultValue) {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : defaultValue;
}

function envFloat(name, defaultValue) {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultValue;
}

/** For NOTIFY_SEND_TEST one-shot probe (GitHub Secret = 1 during a manual run). */
function envTruthy(name) {
  const v = process.env[name];
  return v === "1" || v === "true" || v === "yes";
}

function iso(ts) {
  if (ts == null) return "null";
  return typeof ts === "string" ? ts : ts.toISOString();
}

/**
 * Stable dedupe fingerprint for the whole bundle.
 * Alarm rows omit record_ts so cooldown works while the same meters stay in alarm.
 */
export function buildBundlePayload(bundle) {
  const staleLines = bundle.stale
    .map((v) => `${v.physical_group}\t${iso(v.latest_ts)}`)
    .sort();
  let hydroPart = "norow";
  if (bundle.hydro != null) {
    const v =
      bundle.hydro.value != null && Number.isFinite(Number(bundle.hydro.value))
        ? Number(bundle.hydro.value).toFixed(2)
        : "";
    const mk = bundle.hydro.metric_key ?? "";
    hydroPart = `${bundle.hydro.fire ? "1" : "0"}|${v}|${mk}`;
  }
  const waterPart = `${bundle.water.skipped ? "skip" : "ok"}|${bundle.water.count}`;
  const alarmLines = bundle.alarms
    .map(
      (r) =>
        `${r.serial}|${r.metric_key}|${r.low_alarm}|${r.high_alarm}|${r.physical_group}`,
    )
    .sort();
  return ["STALE", staleLines.join(";"), "HYDRO", hydroPart, "WATER", waterPart, "ALRM", alarmLines.join(";")].join("\n");
}

export function bundleHasFire(bundle) {
  if (bundle.stale.length > 0) return true;
  if (bundle.hydro?.fire) return true;
  if (!bundle.water.skipped && bundle.water.count > 0) return true;
  if (bundle.alarms.length > 0) return true;
  return false;
}

/**
 * Latest row per physical_group older than threshold (matches previous neon-loader behavior).
 * @param {import('pg').PoolClient} client
 */
async function collectStaleGroups(client, staleAfterMinutes) {
  const { rows: countRows } = await client.query(
    "SELECT COUNT(*)::bigint AS n FROM utility_measurement_tall",
  );
  const n = Number(countRows[0]?.n ?? 0);
  if (n === 0) {
    return [{ physical_group: "(no rows)", latest_ts: null }];
  }

  const { rows } = await client.query(
    `
    SELECT COALESCE(physical_group, 'unknown') AS physical_group,
           MAX(record_ts) AS latest_ts
    FROM utility_measurement_tall
    GROUP BY COALESCE(physical_group, 'unknown')
    HAVING MAX(record_ts) < NOW() - ($1::numeric * INTERVAL '1 minute')
    ORDER BY physical_group
    `,
    [staleAfterMinutes],
  );
  return rows.map((r) => ({
    physical_group: r.physical_group,
    latest_ts: r.latest_ts,
  }));
}

/**
 * Grafana "Hydro Out": latest hydro kW < threshold only if reading is recent (see manifest evaluate_for).
 * Matches neon-loader/grafana/alerts/queries/hydro-out-alert.sql + threshold_kw 5.
 * @param {import('pg').PoolClient} client
 */
async function evaluateHydroOut(client, recentMinutes, minKw) {
  /** Match Grafana HUD / hydro-power (source_system OR physical_group, LIKE for metric). */
  const { rows } = await client.query(
    `
    SELECT metric_value, record_ts, metric_key
    FROM utility_measurement_tall
    WHERE (physical_group = 'hydro_plant' OR source_system = 'hydro_plant')
      AND unit = 'kW'
      AND metric_key LIKE 'power_instantaneous%'
    ORDER BY record_ts DESC
    LIMIT 1
    `,
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  const ts = row.record_ts instanceof Date ? row.record_ts : new Date(row.record_ts);
  const ageMs = Date.now() - ts.getTime();
  const ageMinutes = Math.round(ageMs / 60_000);
  const recent =
    ageMs <= recentMinutes * 60 * 1000 && ageMs >= -120_000;
  const value = Number(row.metric_value);
  if (!recent) {
    return {
      fire: false,
      value,
      record_ts: ts,
      metric_key: row.metric_key,
      reason: "reading_not_recent",
      ageMinutes,
    };
  }
  const fire = Number.isFinite(value) && value < minKw;
  return {
    fire,
    value,
    record_ts: ts,
    metric_key: row.metric_key,
    ageMinutes,
  };
}

/**
 * Grafana "Due within 45 days (backlog capped at 30d past)" — water-reporting-alert-count.sql
 * @param {import('pg').PoolClient} client
 */
async function countWaterDueSoon(client) {
  const reg = await client.query(
    `SELECT to_regclass('public.water_sampling_schedule') AS t`,
  );
  if (!reg.rows[0]?.t) {
    return { count: 0, skipped: true };
  }
  const { rows } = await client.query(`
    SELECT COUNT(*)::bigint AS count
    FROM water_sampling_schedule
    WHERE next_due_date IS NOT NULL
      AND next_due_date <= (CURRENT_DATE + INTERVAL '45 days')::date
      AND next_due_date >= (CURRENT_DATE - INTERVAL '30 days')::date
  `);
  const count = Number(rows[0]?.count ?? 0);
  return { count, skipped: false };
}

/**
 * Rows with low_alarm or high_alarm in lookback window.
 * @param {import('pg').PoolClient} client
 */
async function collectAlarmRows(client, lookbackMinutes, limit) {
  const { rows } = await client.query(
    `
    SELECT serial, metric_key, record_ts, low_alarm, high_alarm, physical_group
    FROM utility_measurement_tall
    WHERE (low_alarm OR high_alarm)
      AND record_ts >= NOW() - ($1::numeric * INTERVAL '1 minute')
    ORDER BY record_ts DESC
    LIMIT $2
    `,
    [lookbackMinutes, limit],
  );
  return rows.map((r) => ({
    serial: r.serial,
    metric_key: r.metric_key,
    record_ts: r.record_ts,
    low_alarm: r.low_alarm,
    high_alarm: r.high_alarm,
    physical_group: r.physical_group,
  }));
}

async function collectBundle(client, opts) {
  const stale = await collectStaleGroups(client, opts.staleAfterMinutes);
  const hydroRaw = await evaluateHydroOut(
    client,
    opts.hydroRecentMinutes,
    opts.hydroMinKw,
  );
  const water = await countWaterDueSoon(client);
  const alarms = await collectAlarmRows(
    client,
    opts.alarmLookbackMinutes,
    opts.alarmRowLimit,
  );

  return {
    stale,
    hydro: hydroRaw,
    water,
    alarms,
  };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string} payload
 * @param {number} cooldownMinutes
 * @returns {Promise<{ allow: boolean; reason?: string; lastSentAt?: Date }>}
 */
async function shouldSendAfterDedupe(client, payload, cooldownMinutes) {
  const { rows } = await client.query(
    `SELECT last_sent_at, last_payload FROM alert_notification_state WHERE alert_key = $1`,
    [ALERT_KEY],
  );
  const row = rows[0];
  if (!row) return { allow: true };
  const samePayload = row.last_payload === payload;
  const cooldownMs = cooldownMinutes * 60 * 1000;
  const last = new Date(row.last_sent_at).getTime();
  if (samePayload && Date.now() - last < cooldownMs) {
    return {
      allow: false,
      reason: "cooldown_same_bundle_payload",
      lastSentAt: row.last_sent_at,
    };
  }
  return { allow: true };
}

async function recordSent(client, payload) {
  await client.query(
    `
    INSERT INTO alert_notification_state (alert_key, last_sent_at, last_payload)
    VALUES ($1, NOW(), $2)
    ON CONFLICT (alert_key) DO UPDATE SET
      last_sent_at = EXCLUDED.last_sent_at,
      last_payload = EXCLUDED.last_payload
    `,
    [ALERT_KEY, payload],
  );
}

async function sendResendEmail({ apiKey, from, toList, subject, html, text }) {
  const body = {
    from,
    to: toList,
    subject,
    html,
    text,
  };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Resend HTTP ${res.status}: ${JSON.stringify(json).slice(0, 500)}`,
    );
  }
  return json;
}

async function sendTestProbeEmail({ apiKey, from, toList }) {
  const run = process.env.GITHUB_RUN_ID ?? "";
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const text = [
    "This is a manual NOTIFY_SEND_TEST probe from the Neon email alerts job.",
    "",
    `Time (UTC): ${new Date().toISOString()}`,
    repo ? `Repo: ${repo}` : "",
    run ? `Run: ${run}` : "",
    "",
    "Remove the NOTIFY_SEND_TEST secret (or set it empty) after you confirm delivery.",
  ]
    .filter(Boolean)
    .join("\n");
  const html = `<pre style="font-family:system-ui,sans-serif">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`;
  return sendResendEmail({
    apiKey,
    from,
    toList,
    subject: "[AcquiSuite] Email alerts probe (manual test)",
    html,
    text,
  });
}

function formatBundleEmail(bundle, opts) {
  const sections = [];

  sections.push(`Stale data (no row in last ${opts.staleAfterMinutes} min per physical_group):`);
  if (bundle.stale.length === 0) {
    sections.push("  (none)");
  } else {
    for (const v of bundle.stale) {
      sections.push(`  - ${v.physical_group}: latest ${iso(v.latest_ts)}`);
    }
  }

  sections.push("");
  sections.push(
    `Hydro out (< ${opts.hydroMinKw} kW if last reading within last ${opts.hydroRecentMinutes} min):`,
  );
  if (bundle.hydro == null || bundle.hydro.record_ts == null) {
    sections.push(
      "  (no hydro row: hydro_plant + kW + metric_key like power_instantaneous%)",
    );
  } else if (!bundle.hydro.fire && bundle.hydro.reason === "reading_not_recent") {
    sections.push(
      `  Latest ${bundle.hydro.metric_key ?? "?"} ${Number(bundle.hydro.value).toFixed(2)} kW (${bundle.hydro.ageMinutes ?? "?"} min ago) — too old for hydro-out rule (see stale section).`,
    );
  } else if (bundle.hydro.fire) {
    sections.push(
      `  ALERT: ${bundle.hydro.metric_key ?? "?"} ${Number(bundle.hydro.value).toFixed(2)} kW at ${iso(bundle.hydro.record_ts)}`,
    );
  } else {
    sections.push(
      `  OK: ${bundle.hydro.metric_key ?? "?"} ${Number(bundle.hydro.value).toFixed(2)} kW at ${iso(bundle.hydro.record_ts)}`,
    );
  }

  sections.push("");
  sections.push(
    "Water sampling due (45-day window, backlog floor 30 days past) — matches Grafana water-reporting-alert-count.sql:",
  );
  if (bundle.water.skipped) {
    sections.push("  (water_sampling_schedule not present — skipped)");
  } else if (bundle.water.count === 0) {
    sections.push("  (no rows in due window)");
  } else {
    sections.push(`  ALERT: ${bundle.water.count} row(s) due or overdue in window`);
  }

  sections.push("");
  sections.push(
    `Low/high alarm rows (last ${opts.alarmLookbackMinutes} min, max ${opts.alarmRowLimit} shown):`,
  );
  if (bundle.alarms.length === 0) {
    sections.push("  (none)");
  } else {
    for (const r of bundle.alarms) {
      const flags = [r.low_alarm ? "LOW" : null, r.high_alarm ? "HIGH" : null]
        .filter(Boolean)
        .join("+");
      sections.push(
        `  - ${r.physical_group} ${r.serial} ${r.metric_key} ${flags} @ ${iso(r.record_ts)}`,
      );
    }
  }

  sections.push("");
  sections.push(
    `Repository / run: ${process.env.GITHUB_REPOSITORY ?? "local"} ${process.env.GITHUB_RUN_ID ?? ""}`,
  );

  const text = sections.join("\n");
  const firing = bundleHasFire(bundle);
  const subject = firing
    ? `[AcquiSuite] Operations alert — issues detected`
    : `[AcquiSuite] Operations check — all clear`;
  const html = `<pre style="font-family:system-ui,sans-serif">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`;
  return { subject, text, html };
}

function logSnapshot(bundle, opts, firing) {
  const h = bundle.hydro;
  console.log(
    JSON.stringify({
      tag: "notify-email-alerts-snapshot",
      firing,
      staleGroupCount: bundle.stale.length,
      staleGroups: bundle.stale.map((s) => s.physical_group),
      hydro: h
        ? {
            fire: Boolean(h.fire),
            kw: h.value,
            metric_key: h.metric_key ?? null,
            ageMinutes: h.ageMinutes ?? null,
            reason: h.reason ?? null,
          }
        : { found: false },
      waterDueCount: bundle.water.count,
      waterSkipped: bundle.water.skipped,
      alarmRowCount: bundle.alarms.length,
      thresholds: {
        staleAfterMinutes: opts.staleAfterMinutes,
        hydroMinKw: opts.hydroMinKw,
        hydroRecentMinutes: opts.hydroRecentMinutes,
        alarmLookbackMinutes: opts.alarmLookbackMinutes,
      },
    }),
  );
}

async function main() {
  const dryRun = process.env.NOTIFY_DRY_RUN === "1" || process.env.NOTIFY_DRY_RUN === "true";
  const staleAfterMinutes = envInt("ALERT_STALE_AFTER_MINUTES", 240);
  const cooldownMinutes = envInt("ALERT_COOLDOWN_MINUTES", 360);
  const hydroRecentMinutes = envInt("ALERT_HYDRO_RECENT_MINUTES", 60);
  const hydroMinKw = envFloat("ALERT_HYDRO_MIN_KW", 5);
  const alarmLookbackMinutes = envInt("ALERT_ALARM_LOOKBACK_MINUTES", 240);
  const alarmRowLimit = envInt("ALERT_ALARM_ROW_LIMIT", 40);

  const toList = parseRecipientList(process.env.ALERT_EMAIL_TO);
  const from = process.env.ALERT_EMAIL_FROM?.trim();
  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (!toList.length) {
    console.error("Missing or empty ALERT_EMAIL_TO (comma-separated recipients).");
    process.exit(1);
  }
  if (!from) {
    console.error("Missing ALERT_EMAIL_FROM (verified sender domain in Resend).");
    process.exit(1);
  }
  if (!apiKey && !dryRun) {
    console.error("Missing RESEND_API_KEY.");
    process.exit(1);
  }

  const bundleOpts = {
    staleAfterMinutes,
    hydroRecentMinutes,
    hydroMinKw,
    alarmLookbackMinutes,
    alarmRowLimit,
  };

  const pool = createDbPoolFromEnv();
  const client = await pool.connect();
  try {
    const bundle = await collectBundle(client, bundleOpts);
    const payload = buildBundlePayload(bundle);
    const firing = bundleHasFire(bundle);
    logSnapshot(bundle, bundleOpts, firing);

    if (!firing) {
      console.log(
        `[notify-email-alerts] OK: no stale groups, hydro OK, no water due rows, no alarm rows in ${alarmLookbackMinutes}m window.`,
      );
      console.log(
        "[notify-email-alerts] Resend: no API call — nothing to alert (inbox empty in Resend).",
      );
      if (envTruthy("NOTIFY_SEND_TEST") && !dryRun) {
        const out = await sendTestProbeEmail({ apiKey, from, toList });
        console.log(
          `[notify-email-alerts] NOTIFY_SEND_TEST: sent probe. Resend id: ${out?.id ?? "(see response)"}`,
        );
      } else if (envTruthy("NOTIFY_SEND_TEST") && dryRun) {
        console.log(
          "[notify-email-alerts] NOTIFY_SEND_TEST set but NOTIFY_DRY_RUN — no email sent.",
        );
      }
      return;
    }

    const dedupe = envTruthy("NOTIFY_FORCE_SEND")
      ? { allow: true }
      : await shouldSendAfterDedupe(client, payload, cooldownMinutes);
    if (!dedupe.allow) {
      console.log(
        JSON.stringify({
          tag: "notify-email-alerts-dedupe",
          reason: dedupe.reason,
          lastSentAt: dedupe.lastSentAt,
          cooldownMinutes,
          hint:
            "Resend was not called. Same alert bundle was already emailed within cooldown. Delete NOTIFY_FORCE_SEND after one test send, or DELETE FROM alert_notification_state WHERE alert_key = 'email_ops_bundle_v1' in Neon, or wait.",
        }),
      );
      console.log(
        `[notify-email-alerts] Skip: cooldown (${cooldownMinutes} min) — Resend unchanged.`,
      );
      return;
    }

    if (envTruthy("NOTIFY_FORCE_SEND")) {
      console.log(
        "[notify-email-alerts] NOTIFY_FORCE_SEND — dedupe bypassed for this run.",
      );
    }

    const { subject, text, html } = formatBundleEmail(bundle, bundleOpts);

    if (dryRun) {
      console.log("[dry-run] would send:\n", text);
      return;
    }

    const resendOut = await sendResendEmail({
      apiKey,
      from,
      toList,
      subject,
      html,
      text,
    });
    await recordSent(client, payload);
    console.log(
      `[notify-email-alerts] Sent bundle alert to ${toList.length} recipient(s). Resend id: ${resendOut?.id ?? "n/a"}`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

if (isMainModule()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
