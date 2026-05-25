# AdMatix Walled-Garden Pilot Readiness

Status: implementation-ready operating plan  
Last updated: 2026-05-25

This document turns the live-data roadmap into a safe first-pilot plan for
Google, Meta, TikTok, Amazon Ads, and later programmatic channels. The rule is
simple: **read first, preregister measurement second, human-apply changes
third, and only then consider write automation.**

## Operating Position

AdMatix should not connect live ad-platform mutate scopes for the YC proof or
the first pilot. The first production-grade pilot is a shadow-mode evidence
pipeline:

1. Import reporting, entity snapshots, and first-party conversion/revenue data.
2. Produce H0 packets and proposed actions from frozen account snapshots.
3. Run PolicyGuard, dry-run diffs, approval receipts, and verifier measurement.
4. Let a human operator apply approved changes in the platform UI.
5. Promote only validated aggregate outcomes into immutable proof bundles.

Platform ROAS is a diagnostic. First-party revenue or gross margin is the
preferred truth source for incrementality and iROAS.

## Platform Plan

| Platform | First connector scope | Explicitly out of scope for first pilot | Key caveats |
| --- | --- | --- | --- |
| Google Ads | GAQL reporting, campaign/ad group/ad/asset/keyword snapshots, geo/device/search-term reports, experiment import metadata | Mutate operations, budget edits, creative launch, bidding strategy changes | Conversion lag, attribution-window drift, learning phase, account time zone, consent-mode modeled conversions |
| GA4 / BigQuery | First-party ecommerce/events export, source/medium/campaign dimensions, revenue/gross-margin joins when available | Client-side pixel rewrites, identity graph expansion | Sampling, consent-mode modeling, event dedupe, timezone alignment |
| Shopify / Stripe / Orders | Orders, refunds, gross margin proxy, new-customer flag, subscription events | Payment mutation or refund actions | Order edits/refunds, delayed fulfillment, tax/shipping treatment |
| Meta Ads | Insights reports, campaign/ad set/ad/creative snapshots, geo/device/breakdown reports where allowed, GeoLift design import | Campaign/ad set/ad mutate calls, targeting edits, creative launch | Aggregated Event Measurement, breakdown restrictions, SKAN, modeled conversions, attribution windows |
| TikTok Ads | Reporting API, campaign/adgroup/ad/creative snapshots, conversion report import | Writes, creative launch, budget/bid changes | Attribution windows, delayed conversions, reporting freshness, account timezone |
| Amazon Ads / retail media | Sponsored Products/Brands/Display reports, profiles/accounts, campaign/ad group/product/keyword snapshots | Writes, bid/budget changes, retail catalog mutation | Retail attribution, halo sales, product availability, buy-box effects |
| Programmatic later | iPinYou/AuctionGym first; later DV360/TTD reports and line-item snapshots | Real-time bid changes | Auction dynamics prove pacing/safety, not incrementality by themselves |

## Credential And Secret Rules

- Store only credential references in sync rows and proof artifacts.
- Never store access tokens, refresh tokens, authorization headers, cookies,
  passwords, client secrets, or API keys in raw payloads, logs, or dashboard
  data.
- Every connector must use the shared redaction utility before logging payloads
  or errors.
- OAuth scope requests must be documented before authorization and reviewed as
  read-only unless an operator explicitly approves a later write-scope phase.
- Token material belongs in the credential vault (`app.connections`) or a KMS
  equivalent, not in `connector_syncs`, raw warehouse tables, run logs, or proof
  bundles.

## Sync Contract

Every connector sync should write:

- `app.connector_syncs`: platform, account, sync type, API version, cursor,
  started/finished timestamps, status, row counts, freshness, checksum, and
  error class.
- `warehouse.raw_platform_reports`: lossless reporting rows at daily grain.
- `warehouse.raw_entity_snapshots`: campaign/ad set/ad/creative/keyword/
  placement/budget snapshots for SCD history and dry-run before-state.
- `warehouse.raw_conversion_events`: first-party conversion/order rows with
  privacy-safe IDs, revenue, gross margin, currency, attribution metadata, and
  raw hash.

No dashboard route should read raw tables directly. Dashboard-ready data must
come from a validated proof bundle.

## Pre-Registered Pilot Design

Minimum viable pilot design:

- H0: AdMatix-gated human-approved changes do not improve first-party
  incremental revenue or gross-margin iROAS versus the pre-registered control.
- Unit: geo, campaign, or time block, chosen before measurement begins.
- Primary metric: first-party incremental gross margin or revenue.
- Guardrails: total spend, max daily budget delta, CPA/CAC ceiling,
  no unapproved creative, no sensitive targeting, rollback checkpoint.
- Decision rule: claim success only if the confidence interval excludes zero
  and lower-bound iROAS clears break-even.
- Abstention rule: underpowered or confounded designs return `INCONCLUSIVE`.

Preferred designs, in order:

1. Matched geo holdout with pre-period fit and placebo checks.
2. In-platform lift/geo experiment imported into AdMatix.
3. Switchback when geo volume is too low and carryover is manageable.
4. Shadow replay only when live randomization is not possible.

## Legal, Privacy, And Safety Checklist

- Confirm platform terms allow the requested read-only data export.
- Confirm customer has rights to share first-party conversion/order data.
- Hash or pseudonymize user identifiers before ingestion.
- Do not ingest raw emails, phone numbers, IP addresses, or full addresses.
- Document retention and deletion rules per tenant.
- Do not infer or target protected classes.
- Keep all spend-touching actions human-approved until a separate write-scope
  safety review.
- Record rollback checkpoint and operator approval before each applied change.

## Pilot Readiness Gate

The first pilot is ready only when:

- Connector scopes are read-only and documented.
- A first-party outcome source is mapped.
- `app.experiment_designs` can store the preregistration.
- `app.proof_bundles` can export aggregate outcomes with claim limits.
- Dry-run diffs use exact before-state from entity snapshots.
- The operator has a budget cap and rollback path.
- The dashboard copy still says artifact-backed proof, not live lift.
