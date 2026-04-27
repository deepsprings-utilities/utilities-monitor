-- Dedupe/cooldown for portable Neon→email notifier (GitHub Actions).
CREATE TABLE IF NOT EXISTS alert_notification_state (
  alert_key TEXT PRIMARY KEY,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_payload TEXT NOT NULL DEFAULT ''
);
