import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function mustEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/push-grafana-dashboard.mjs [--dashboard <path>] [--dry-run]",
    "",
    "Required env vars:",
    "  GRAFANA_URL                 e.g. https://grafana.example.com",
    "  GRAFANA_TOKEN               Grafana API token with dashboard write scope",
    "  GRAFANA_DATASOURCE_UID      Postgres datasource UID in Grafana",
  ].join("\n");
}

function parseArgs(argv) {
  let dashboardPath = path.join(projectRoot, "grafana", "dashboard.hydro-power.json");
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--dashboard") {
      dashboardPath = path.resolve(projectRoot, argv[i + 1] || "");
      i += 1;
      continue;
    }
  }
  return { dashboardPath, dryRun };
}

async function main() {
  const { dashboardPath, dryRun } = parseArgs(process.argv.slice(2));
  const grafanaUrl = mustEnv("GRAFANA_URL").replace(/\/+$/, "");
  const grafanaToken = mustEnv("GRAFANA_TOKEN");
  const datasourceUid = mustEnv("GRAFANA_DATASOURCE_UID");

  const raw = await readFile(dashboardPath, "utf8");
  const payload = JSON.parse(raw);

  // Replace placeholder datasource uid in the dashboard template.
  const text = JSON.stringify(payload).replaceAll("__DATASOURCE_UID__", datasourceUid);
  const body = JSON.parse(text);

  if (dryRun) {
    console.log(
      `dry_run grafana_url=${grafanaUrl} dashboard_uid=${body.dashboard?.uid || "new"} title="${body.dashboard?.title || ""}"`,
    );
    return;
  }

  const resp = await fetch(`${grafanaUrl}/api/dashboards/db`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${grafanaToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Grafana API error ${resp.status}: ${errText}`);
  }

  const json = await resp.json();
  console.log(`grafana_dashboard_upserted uid=${json.uid || "n/a"} url=${json.url || "n/a"}`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
