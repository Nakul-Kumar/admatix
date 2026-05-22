# WP-C — Connectors & fixtures

**Owns:** `packages/connectors/**`, `data/fixtures/**`
**Branch:** `wp/c-connectors` · **Wave:** 1 · **Depends on:** `@admatix/schemas`
**Suggested agent:** Codex · **Size:** medium

## Goal
Read-only connectors over a uniform `Connector` interface, plus the demo fixture set
that the detectors and benchmarks run on. **No write methods exist anywhere.**

## Files to create
- `packages/connectors/package.json` — `@admatix/connectors`, dep `@admatix/schemas`.
- `packages/connectors/tsconfig.json`.
- `packages/connectors/src/index.ts` — public surface.
- `packages/connectors/src/connector.ts` — the `Connector` interface.
- `packages/connectors/src/fixture-connector.ts` — `fixtureConnector()` reading `data/fixtures/`.
- `packages/connectors/src/resolve-ref.ts` — `resolveAccountRef()`.
- `packages/connectors/src/*.test.ts`.
- Expand `data/fixtures/` (see below).

## Fixtures to add
The seed fixtures (`google_ads/demo_campaigns.json`, `first_party/demo_orders.json`,
`meta_ads/demo_adsets.json`) exist. Add, all schema-valid:
- `meta_ads/` — a `creative_daily_metrics` series showing fatigue (rising frequency,
  falling CTR over ~14 days) for the creative-fatigue detector.
- `google_ads/demo_tracking_break.json` — a campaign with a sudden conversion drop +
  missing UTM pattern for the tracking detector.
- `dv360/demo_supply_paths.json` — `programmatic_supply_paths` rows with MFA flags and
  low-viewability sellers for the supply-path detector.
- Each fixture's positive case must be matched by a clean negative-case fixture so
  detectors can be tested both ways.

## Contract
Implement the `@admatix/connectors` surface in `ARCHITECTURE-DEEP.md` §3. `Connector`
has read methods only. `resolveAccountRef("fixture:agency-demo")` →
`{ kind: "fixture", id: "agency-demo" }`. `healthCheck()` returns `{ok:true}` for fixtures.

## Acceptance tests
1. `fixtureConnector()` returns schema-valid `Campaign[]` and `CampaignDailyMetric[]` for `agency-demo`.
2. `resolveAccountRef` parses both `fixture:` and `live:` refs; rejects malformed refs.
3. Every file under `data/fixtures/` validates against `@admatix/schemas`.
4. The `Connector` interface exposes no method that writes.
5. `healthCheck` returns a structured result.

## Definition of Done
Acceptance tests pass + global DoD.

## Dispatch
Generic dispatch prompt, `<ID>=C`.
