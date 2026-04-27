# Grafana alerting (documentation)

Unified alerting rules for this project live **in Grafana Cloud** (not file-provisioned from this repo). This folder holds **queries and metadata** so changes can be reviewed in git and reapplied manually or via API.

## Water reporting — overdue / due-soon spam fix

The rule **“Due within 45 days”** originally counted every row with `next_due_date <= today + 45 days`, which **includes very old past-due dates forever**, so `COUNT(*) > 0` never cleared.

The query now adds a **floor**: only rows with `next_due_date >= today - 30 days` are counted. Deadlines **more than ~30 days in the past** no longer drive the alert.

Authoritative SQL: [`queries/water-reporting-alert-count.sql`](queries/water-reporting-alert-count.sql).

## Rule inventory

See [`manifest.yaml`](manifest.yaml) for rule UIDs, folders, receivers, and linked dashboard UIDs.

## Keeping this folder in sync

1. Change the rule in **Grafana → Alerting → Alert rules** (or HTTP API / MCP).
2. Copy the updated SQL from the rule’s query **A** into the matching file under `queries/`.
3. Adjust `manifest.yaml` if titles, windows, or receivers change.

Provisioning from disk is possible with Grafana’s file provisioning, but this repo does **not** enable that automatically for Cloud; treat these files as **documentation + review artifacts**.
