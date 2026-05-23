# WP-C — Connectors & fixtures — phase report

**Branch:** `wp/c-connectors` · **Status:** complete · **Date:** 2026-05-23

## What shipped

### Package: `@admatix/connectors`
- `packages/connectors/package.json`, `tsconfig.json` — depends on `@admatix/schemas` only.
- `src/index.ts` — public surface: `Connector` (type), `fixtureConnector`, `resolveAccountRef`, `AccountRef`.
- `src/connector.ts` — read-only `Connector` interface (no write methods exist).
- `src/resolve-ref.ts` — parses `fixture:<id>` / `live:<id>` refs; rejects malformed input.
- `src/fixture-connector.ts` — loads `data/fixtures/<platform>/` plus `data/fixtures/first_party/`,
  joins creative metrics through the campaign→account map, and filters daily metrics by an
  inclusive `YYYY-MM-DD..YYYY-MM-DD` window. Uses `ADMATIX_FIXTURE_ROOT` as an env override
  for unusual deployments.

### Fixtures added under `data/fixtures/`
Each detector-driving fixture is paired with a clean negative-case fixture as required:
- `meta_ads/demo_creative_fatigue.json` — frequency 1.10 → 3.10, CTR 2.50% → 0.70% over 14 days.
- `meta_ads/demo_creative_healthy.json` — frequency holds 1.18–1.31, CTR steady ~2.35%.
- `google_ads/demo_tracking_break.json` — flat spend and clicks; conversions collapse from
  ~33/day to ~3–5/day on 2026-05-15; no UTM and no tracking template on the campaign.
- `google_ads/demo_tracking_clean.json` — same shape with stable conversions and a populated
  tracking template + UTM.
- `dv360/demo_supply_paths.json` — two MFA-flagged sellers and one low-viewability seller
  dominate spend; one premium seller is healthy.
- `dv360/demo_supply_paths_clean.json` — every seller non-MFA with viewability ≥ 0.76.

### Acceptance tests (all five WP-C criteria covered)
- `src/fixture-connector.test.ts` — #1 schema-valid `Campaign[]` / `CampaignDailyMetric[]` for
  the agency-demo dataset (plus window-filter sanity), #5 `healthCheck` returns
  `{ ok: boolean; detail: string }`, and #4 the returned `Connector` exposes only the contract
  read methods (no `create`/`update`/`delete`/`pause`/`activate`/etc.).
- `src/resolve-ref.test.ts` — #2 parses fixture/live refs and rejects malformed input
  (missing scheme, empty id, whitespace, non-string).
- `src/fixtures-valid.test.ts` — #3 walks `data/fixtures/` and parses every JSON file with
  the `@admatix/schemas` types for each typed section.

## Compliance with the ten golden rules

| Rule | Status |
| --- | --- |
| 1. schemas is the contract | ✅ all validation imports from `@admatix/schemas` |
| 2. fixtures first | ✅ no live calls; all data from `data/fixtures/` |
| 3. dry-run only | ✅ no write methods exist anywhere in the package |
| 4. evidence refs | n/a — packets/findings belong to WP-D |
| 5. rollback on every action | n/a — actions belong to WP-D/E |
| 6. mandatory gates | n/a — gates belong to WP-E |
| 7. read tools / write tools separated | ✅ acceptance test #4 enforces no write verbs |
| 8. deterministic | ✅ same fixtures → same output, no LLM in path |
| 9. no secrets / no PII | ✅ `pnpm scan-secrets` clean |
| 10. pin everything in evals | n/a — benchmarks belong to WP-I |

## Verification output

### `pnpm -r typecheck`
```
Scope: 2 of 3 workspace projects
packages/schemas typecheck$ tsc -p tsconfig.json --noEmit
packages/schemas typecheck: Done
packages/connectors typecheck$ tsc -p tsconfig.json --noEmit
packages/connectors typecheck: Done
```

### `pnpm -r test`
```
packages/connectors test$ vitest run
 ✓ packages/schemas/src/index.test.ts (5 tests) 7ms
 ✓ packages/connectors/src/fixtures-valid.test.ts (10 tests) 15ms
 ✓ packages/connectors/src/fixture-connector.test.ts (8 tests) 42ms
 ✓ packages/connectors/src/resolve-ref.test.ts (10 tests) 5ms

 Test Files  4 passed (4)
      Tests  33 passed (33)
   Duration  665ms
```

### `pnpm scan-secrets`
```
scan-secrets: no token-shaped secrets found.
```

### `pnpm seed-fixtures`
```
[fixture] data/fixtures/dv360/demo_supply_paths.json ok
[fixture] data/fixtures/dv360/demo_supply_paths_clean.json ok
[fixture] data/fixtures/first_party/demo_orders.json ok
[fixture] data/fixtures/google_ads/demo_campaigns.json ok
[fixture] data/fixtures/google_ads/demo_tracking_break.json ok
[fixture] data/fixtures/google_ads/demo_tracking_clean.json ok
[fixture] data/fixtures/meta_ads/demo_adsets.json ok
[fixture] data/fixtures/meta_ads/demo_creative_fatigue.json ok
[fixture] data/fixtures/meta_ads/demo_creative_healthy.json ok

seed-fixtures: validated 9 file(s), 75 record(s).
```

## Commits on `wp/c-connectors`
- `3a95422` feat(connectors): scaffold package with interface-first stubs
- `3a97cdd` feat(fixtures): add creative-fatigue, tracking-break, and supply-path fixtures
- `d4f8878` feat(connectors): implement fixtureConnector, resolveAccountRef, and acceptance tests

## Notes for downstream work packages

- WP-D (evidence/detectors) can consume `creative_daily_metrics` for fatigue, the
  `campaign_track_break` daily series for the tracking detector, and the
  `programmatic_supply_paths` array for the supply-path detector. The clean-case fixtures
  give each detector a "must-not-fire" baseline.
- WP-B (core) and WP-D should call `fixtureConnector(platform)` per platform and aggregate.
  First-party revenue is platform-agnostic and resolved automatically.
- `programmatic_supply_paths` has no `@admatix/schemas` type yet — those rows live as
  passthrough data inside the DV360 fixture envelope. Defining a `SupplyPathRow` schema
  belongs to whichever WP wires the supply-path detector (WP-A schemas + WP-D detector).
