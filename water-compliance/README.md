# Water sampling compliance (Grafana / Neon)

Loads **LAST AND NEXT SAMPLE REPORT** exports into Postgres (`water_sampling_schedule`) so you can build Grafana tables and alerts instead of relying on the DWW JSP pages alone.

## Your files

| File | Use |
|------|-----|
| `LAST AND NEXT SAMPLE REPORT*.xlsx` | Export **Sheet1** as **CSV UTF-8** (Excel: Save As → CSV). Row 1 may be a title row; the importer finds the header row containing **PS Codes** and **Next Due**. |
| Lead/Copper (two-column CSV) | Save a sheet with headers **`analyte_name`** and **`next_due_date`** (or **Analyte Name** / **Next Sampling Due By** — the importer detects them). Run `node scripts/import-lead-copper-csv.mjs` (see below). Optional env **`LEAD_COPPER_PS_CODE`** (default `DST_LCR`) sets `ps_code` in the table. |

## Database

The migration lives with the loader:

- `neon-loader/sql/005_water_sampling_schedule.sql`

Apply it with your usual Neon migration path (for example `npm run migrate` from `neon-loader/`).

## Import

From `water-compliance/`:

```bash
npm install
export NEON_DATABASE_URL="postgresql://..."
node scripts/import-schedule-csv.mjs "/path/to/ACTIVE-LAST-AND-NEXT-SAMPLE-REPORT.csv"
node scripts/import-schedule-csv.mjs "/path/to/STANDBY-LAST-AND-NEXT-SAMPLE-REPORT.csv"
```

Re-importing the same file name **replaces** rows for that source (full refresh), because
`source_file` is always set to the CSV filename.

### Active vs standby wells

- Keep `active` and `standby` in the CSV filenames.
- Import each well's schedule CSV separately.
- The imported `source_file` will match the filename exactly, so Grafana can filter/report by well.

### Lead/Copper two-column import

```bash
export NEON_DATABASE_URL="postgresql://..."
# optional: export LEAD_COPPER_PS_CODE="CA1400068_DST_LCR"
node scripts/import-lead-copper-csv.mjs "/path/to/active-lead-copper.csv"
node scripts/import-lead-copper-csv.mjs "/path/to/standby-lead-copper.csv"
```

Example CSV:

```csv
analyte_name,next_due_date
LEAD,09-30-2027
COPPER,09-30-2027
```

**Parsed fields:**

- **Next Due** values like `2028/12` are stored as **`next_due_date`** = last calendar day of that month (UTC).
- Rows with **Notes** such as `DUE NOW` keep `next_due_date` null; alert on `notes ILIKE '%DUE NOW%'` or `notes ILIKE '%Past Due%'` if you add that text to exports.

## Grafana

**Table panel — upcoming deadlines**

```sql
SELECT
  CASE
    WHEN LOWER(source_file) LIKE '%standby%' THEN 'standby'
    WHEN LOWER(source_file) LIKE '%active%' THEN 'active'
    ELSE 'unclassified'
  END AS well,
  ps_code,
  analyte_name,
  next_due_date,
  next_due_raw,
  last_sampled,
  notes,
  source_file
FROM water_sampling_schedule
WHERE next_due_date IS NOT NULL AND next_due_date <= CURRENT_DATE + INTERVAL '120 days'
ORDER BY well, next_due_date NULLS LAST, ps_code, analyte_name;
```

**Alert — order window (example: due within 45 days)**

Use Grafana Alerting on a query that returns rows you care about, e.g. count > 0:

```sql
SELECT COUNT(*) AS cnt
FROM water_sampling_schedule
WHERE next_due_date IS NOT NULL
  AND next_due_date <= CURRENT_DATE + INTERVAL '45 days'
  AND next_due_date >= CURRENT_DATE;
```

**Alert — due now / flagged in Notes**

```sql
SELECT COUNT(*) FROM water_sampling_schedule
WHERE notes IS NOT NULL AND (
  UPPER(notes) LIKE '%DUE NOW%'
  OR UPPER(notes) LIKE '%PAST DUE%'
);
```

Point the Grafana Postgres datasource at the same Neon database as your other panels.

## Disclaimer

Schedule exports are **operational aids**; official compliance is per regulatory rules and your district engineer. Refresh imports after DWW updates.
