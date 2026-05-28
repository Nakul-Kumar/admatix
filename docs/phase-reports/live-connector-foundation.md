# Live Connector Foundation

Branch: `codex/live-connector-foundation`
Status: initial read-only build slice

## What Shipped

- Added a connector import manifest contract in `packages/connectors`.
- Added CSV/manual export parsing with deterministic source checksums.
- Added data-quality checks for:
  - empty files,
  - row counts,
  - duplicate columns,
  - missing required columns,
  - malformed CSV rows,
  - secret/PII-bearing columns,
  - negative numeric metrics,
  - non-ISO date columns,
  - duplicate semantic keys.
- Added conservative claim limits to every import manifest. CSV/manual imports are provenance inputs, not incrementality proof.
- Added a read-only connector capability/request contract for future OAuth/API/MCP adapters, including guards that reject write-like scopes and methods.
- Added `admatix import` as a read-only CLI preview command. It emits the manifest and fails closed when quality checks fail.
- Added migration `0007_connector_import_foundation.sql` for future Supabase persistence:
  - `app.connector_jobs`,
  - `app.connector_cursors`,
  - `app.connector_import_manifests`,
  - `app.connector_quality_checks`,
  - `warehouse.bronze_file_manifests`.
- Wired the new migration into `scripts/db/apply-migrations.ts`.

## What This Enables

This is the first production-shaped bridge from customer/platform exports into AdMatix evidence packets:

1. Customer exports or uploads CSV/manual ad/revenue data.
2. AdMatix emits a deterministic manifest with checksum, row count, columns, quality checks, and claim limits.
3. Passing manifests can later land in bronze storage and normalized silver/gold tables.
4. Only after H0, policy, approval, and measurement checks should a result become a proof bundle.

## What This Does Not Do

- It does not connect live OAuth APIs yet.
- It does not request mutate scopes.
- It does not execute ads.
- It does not store raw rows in Git.
- It does not claim incremental lift from CSV/platform attribution.

## Next Slice

1. Add Google Ads and Meta read-only report adapters behind the same manifest contract.
2. Add Shopify/Stripe/GA4 import paths so first-party revenue is available before spend decisions.
3. Add a proof/evidence packet builder that references import manifest IDs and row hashes.
4. Promote passing imports into `proof_bundles` only after explicit H0 and measurement gates.
5. Keep any future write-capable connector behind a separate executor and approval receipt path.
