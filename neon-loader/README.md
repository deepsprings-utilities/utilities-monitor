## neon-loader

This folder is reserved for future code that will:

- Scan the AcquiSuite logs and status files stored in R2 by the `acquisuite-ingest` Worker.
- Parse and transform them into structured rows.
- Upload those rows into Neon (Postgres) on a schedule (for example via a GitHub Action).

Nothing here is wired up yet; you can treat this as a separate Node project when you’re ready (with its own `package.json`, tests, and CI).
