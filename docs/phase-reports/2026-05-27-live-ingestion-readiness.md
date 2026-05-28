# Live Read-Only Ingestion Readiness

Date: 2026-05-27
Branch: `codex/live-ingestion-readiness`

## Executive Summary

This wave moves AdMatix from fixture-only proof artifacts toward a real read-only ingestion runway. It does not use live credentials, does not mutate ad accounts, and does not promote imported data to dashboard proof. The new surfaces stop at preview, manifest validation, dry-run persistence, and directional ingest audit.

## What Is Ready

- Google Ads read-only preview contract with sanitized cassette tests.
- Credential references for `env:`, `vault:app.connections/`, and `mcp:` forms.
- Raw secret material is rejected in credential fields and cassettes.
- CLI preview:
  - `admatix connectors capabilities --platform google_ads --json`
  - `admatix connectors preview --platform google_ads --cassette <path> --account <id> --window YYYY-MM-DD..YYYY-MM-DD --json`
- API preview:
  - `GET /api/v1/connectors/capabilities`
  - `POST /api/v1/connectors/preview`
- MCP preview:
  - `connector_capabilities`
  - `connector_preview`
- CSV/manual import persistence planning:
  - `admatix import --file <csv> ... --json`
  - `admatix import persist --dry-run ... --json`
  - `admatix import persist --confirm ... --connection-string-ref env:SUPABASE_DB_URL`
- Warehouse migration `0008_live_import_promotion.sql` links imported raw platform and conversion rows to connector import manifests.
- dbt live bronze views union fixture seed rows with `warehouse.raw_platform_reports` and `warehouse.raw_conversion_events`.
- Import quality mart `mart_import_quality_status` rolls up raw import readiness while keeping `proof_ready=false`.
- `admatix ingest audit --manifest <manifest.json> --json` reports directional-only status and emits no proof bundles.

## What Is Still Blocked

- No live Google Ads network request is made yet. Credential-ref previews intentionally stop before network access unless a live transport is explicitly wired.
- Meta, Shopify, Stripe, and GA4 are planned after the first Google Ads smoke. In the schema today, Shopify/Stripe/GA4 should land as `first_party` imports until platform-specific adapters exist.
- Imported platform ROAS and conversions are directional only. They cannot become proof without first-party outcomes and a pre-registered experiment.
- Dashboard proof promotion remains blocked until H0, policy, approval, verifier, quality, and claim-limit gates all pass.
- Quant/Alpaca remains separate from AdMatix paid-media ingestion.

## Claim Limits

- Read-only connector preview proves only source access shape and schema mapping.
- CSV/manual import quality proves only that a file is parseable and warehouse-ready.
- Passing import quality is not causal proof.
- Live paid-media lift requires a pre-registered randomized or geo/lift experiment and first-party outcome measurement.

## Operator-Gated Next Step

When ready, provide one of:

- A sanitized Google Ads reporting cassette.
- Or Google Ads OAuth/developer-token credential references and customer id for a single read-only smoke.
- Or CSV exports for platform report and first-party revenue/order rows.

Then run:

```powershell
$env:ADMATIX_MODE = "readonly"
pnpm --dir apps/cli admatix -- connectors preview --platform google_ads --cassette ../../packages/connectors/testdata/cassettes/google_ads/campaign_metrics.json --account 1234567890 --window 2026-05-20..2026-05-21 --json
pnpm --dir apps/cli admatix -- import persist --file <csv> --source google_ads_export --platform google_ads --object-type platform_report --tenant-uuid <tenant_uuid> --dry-run --json
pnpm --dir apps/cli admatix -- ingest audit --manifest <manifest.json> --json
```

Use `--confirm` only after the dry-run returns `quality_blocked=false`, the tenant UUID exists in Supabase, and raw data storage/privacy rules are accepted.
