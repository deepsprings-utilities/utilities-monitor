/**
 * Portable freshness alerts: query Neon, send email via Resend HTTP API.
 * GitHub Actions: set NEON_DATABASE_URL, RESEND_API_KEY, ALERT_EMAIL_FROM, ALERT_EMAIL_TO.
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

const ALERT_KEY = "utility_data_stale";

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

/**
 * @param {{ physical_group: string, latest_ts: Date | string | null }[]} violations
 */
function stablePayload(violations) {
  const lines = violations
    .map((v) => {
      const ts =
        v.latest_ts == null
          ? "null"
          : typeof v.latest_ts === "string"
            ? v.latest_ts
            : v.latest_ts.toISOString();
      return `${v.physical_group}\t${ts}`;
    })
    .sort();
  return lines.join("\n");
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} staleAfterMinutes
 */
async function collectViolations(client, staleAfterMinutes) {
  const { rows: countRows } = await client.query(
    "SELECT COUNT(*)::bigint AS n FROM utility_measurement_tall",
  );
  const n = Number(countRows[0]?.n ?? 0);
  if (n === 0) {
    return [
      {
        physical_group: "(no rows)",
        latest_ts: null,
      },
    ];
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
 * @param {import('pg').PoolClient} client
 * @param {string} payload
 * @param {number} cooldownMinutes
 * @returns {Promise<boolean>} true if we should send
 */
async function shouldSendAfterDedupe(client, payload, cooldownMinutes) {
  const { rows } = await client.query(
    `SELECT last_sent_at, last_payload FROM alert_notification_state WHERE alert_key = $1`,
    [ALERT_KEY],
  );
  const row = rows[0];
  if (!row) return true;
  const samePayload = row.last_payload === payload;
  const cooldownMs = cooldownMinutes * 60 * 1000;
  const last = new Date(row.last_sent_at).getTime();
  if (samePayload && Date.now() - last < cooldownMs) return false;
  return true;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string} payload
 */
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

async function main() {
  const dryRun = process.env.NOTIFY_DRY_RUN === "1" || process.env.NOTIFY_DRY_RUN === "true";
  const staleAfterMinutes = envInt("ALERT_STALE_AFTER_MINUTES", 240);
  const cooldownMinutes = envInt("ALERT_COOLDOWN_MINUTES", 360);

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

  const pool = createDbPoolFromEnv();
  const client = await pool.connect();
  try {
    const violations = await collectViolations(client, staleAfterMinutes);
    if (violations.length === 0) {
      console.log(
        `OK: no stale physical_group (threshold ${staleAfterMinutes} min per group).`,
      );
      return;
    }

    const payload = stablePayload(violations);
    const send = await shouldSendAfterDedupe(client, payload, cooldownMinutes);
    if (!send) {
      console.log(
        `Skip: same stale snapshot within cooldown (${cooldownMinutes} min).`,
      );
      return;
    }

    const lines = violations
      .map((v) => {
        const ts =
          v.latest_ts == null
            ? "(none)"
            : typeof v.latest_ts === "string"
              ? v.latest_ts
              : v.latest_ts.toISOString();
        return `- ${v.physical_group}: latest record_ts ${ts}`;
      })
      .join("\n");

    const subject = `[AcquiSuite] Utility data stale — ${violations.length} group(s)`;
    const text = [
      `Freshness check failed: latest row per physical_group is older than ${staleAfterMinutes} minutes.`,
      "",
      lines,
      "",
      `Repository / run: ${process.env.GITHUB_REPOSITORY ?? "local"} ${process.env.GITHUB_RUN_ID ?? ""}`,
    ].join("\n");

    const html = `<pre style="font-family:system-ui,sans-serif">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`;

    if (dryRun) {
      console.log("[dry-run] would send:\n", text);
      return;
    }

    await sendResendEmail({
      apiKey,
      from,
      toList,
      subject,
      html,
      text,
    });
    await recordSent(client, payload);
    console.log(`Sent alert to ${toList.length} recipient(s).`);
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
