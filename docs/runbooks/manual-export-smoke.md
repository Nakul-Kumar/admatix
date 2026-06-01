# Manual Export Readiness Smoke

## Purpose

Prove the live-ingestion runway without credentials, OAuth, database writes, or proof promotion.

This smoke checks that AdMatix can:

- Preview the Google Ads read-only connector contract from a sanitized cassette.
- Parse a Google Ads campaign daily manual export.
- Parse a first-party order/revenue manual export.
- Plan warehouse persistence in dry-run mode.
- Audit the resulting manifests as directional-only inputs.

It does not prove live lift, ROAS improvement, or customer account performance.

## Input Files

Store input files outside Git. `.local/` is ignored and safe for temporary smoke artifacts.

Google Ads CSV, 7 to 14 days at campaign grain:

```csv
date,account_id,campaign_id,spend,impressions,clicks,conversions,platform_revenue,currency
2026-05-20,acc_1,campaign_1,100,1000,50,5,250,USD
```

First-party order/revenue CSV for the same date window:

```csv
date,external_account_id,order_id,revenue,gross_margin,currency
2026-05-20,store_1,order_1,200,80,USD
```

Reject files containing obvious PII or secrets:

```text
email, phone, full_name, address, ip_address, token, secret, authorization, cookie, api_key
```

## Commands

Run from the AdMatix repo root:

```powershell
$env:ADMATIX_MODE = "readonly"
$TenantUuid = "00000000-0000-0000-0000-000000000001"
$GoogleCsv = "C:\path\to\google_ads_campaign_daily.csv"
$RevenueCsv = "C:\path\to\first_party_orders.csv"
```

Verify connector surface without live credentials:

```powershell
pnpm --dir apps/cli admatix -- connectors capabilities --platform google_ads --json
pnpm --dir apps/cli admatix -- connectors preview --platform google_ads --cassette ../../packages/connectors/testdata/cassettes/google_ads/campaign_metrics.json --account 1234567890 --window 2026-05-20..2026-05-21 --json
```

Preview and dry-run Google Ads import:

```powershell
pnpm --dir apps/cli admatix -- import --file $GoogleCsv --source google_ads_export --platform google_ads --object-type platform_report --source-kind manual_export --account 1234567890 --required-columns "date,campaign_id,spend,impressions,clicks" --semantic-key "date,campaign_id" --out .\.local\smoke-google-ads-manifest.json --json

pnpm --dir apps/cli admatix -- import persist --file $GoogleCsv --source google_ads_export --platform google_ads --object-type platform_report --source-kind manual_export --account 1234567890 --tenant-uuid $TenantUuid --required-columns "date,campaign_id,spend,impressions,clicks" --semantic-key "date,campaign_id" --dry-run --json
```

Preview and dry-run first-party order import:

```powershell
pnpm --dir apps/cli admatix -- import --file $RevenueCsv --source first_party_orders_export --platform first_party --object-type order --source-kind manual_export --required-columns "date,order_id,revenue" --semantic-key "date,order_id" --out .\.local\smoke-first-party-manifest.json --json

pnpm --dir apps/cli admatix -- import persist --file $RevenueCsv --source first_party_orders_export --platform first_party --object-type order --source-kind manual_export --tenant-uuid $TenantUuid --required-columns "date,order_id,revenue" --semantic-key "date,order_id" --dry-run --json
```

Audit the local manifests:

```powershell
pnpm --dir apps/cli admatix -- ingest audit --manifest .\.local\smoke-google-ads-manifest.json --json
pnpm --dir apps/cli admatix -- ingest audit --manifest .\.local\smoke-first-party-manifest.json --json
```

After a confirmed database import exists, audit a persisted manifest id without promoting proof:

```powershell
pnpm --dir apps/cli admatix -- ingest audit --manifest <manifest_key_or_uuid> --tenant-uuid <tenant_uuid> --connection-string-ref env:SUPABASE_DB_URL --json
```

## Acceptance Criteria

- Google Ads capabilities return `status="available"`.
- Cassette preview returns `row_count > 0`, `proof_ready=false`, and `causal_status="directional_until_lift_test"`.
- Both import manifests return `quality.status="pass"`.
- Both persist commands use `--dry-run`, report `raw_rows_inserted=0`, and do not require `SUPABASE_DB_URL`.
- Both ingest audits return `proof_ready=false`, `causal_status="directional_until_lift_test"`, and `h0_packets=[]`.
- No command uses `--confirm` in the first smoke.
- No output is described as live lift, causal lift, ROAS improvement, or a proof bundle.

## Next Gate

If the smoke passes, the next operator decision is one of:

1. Apply migrations and persist the same manual exports with `--confirm`.
2. Build the explicit live Google Ads transport and run one read-only account/date-window preview.

Both gates still remain directional until a pre-registered experiment exists.
