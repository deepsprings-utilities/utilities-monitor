# utilities-monitor
2026 utilities monitoring update

## AcquiSuite ingest Worker

This branch adds a Cloudflare Worker configured by `wrangler.jsonc`.

## Deploy locally (Wrangler)

```bash
npm install
wrangler login
wrangler deploy
```

## Deploy on every push to `main` (GitHub Actions)

This repo includes a workflow at `.github/workflows/deploy-worker.yml`.

In your GitHub repo settings, add **Actions secrets**:

- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with **Workers:Edit** (and any R2 permissions you use)
- `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account id

## Required Worker config

- **Secret**: set `API_KEY` (Worker secret)
  - Locally: `wrangler secret put API_KEY`
  - Or in Cloudflare dashboard: Worker → Settings → Variables
- **R2 binding**: bind your R2 bucket to `BUCKET`
  - In Cloudflare dashboard: Worker → Settings → Bindings → R2 bucket → `BUCKET`

## Connect to a domain / route

In Cloudflare dashboard: Worker → Triggers → **Routes** → add a route for your zone (example: `example.com/acquisuite/*`).
