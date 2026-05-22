# WP-B — Core domain

**Owns:** `packages/core/**`
**Branch:** `wp/b-core` · **Wave:** 1 · **Depends on:** `@admatix/schemas`
**Suggested agent:** Codex · **Size:** medium

## Goal
The deterministic core: metric normalization, impact math, the `Store` persistence
abstraction, and shared utilities. No platform calls, no LLM, fully pure where possible.

## Files to create
- `packages/core/package.json` — name `@admatix/core`, dep `@admatix/schemas` (workspace:*).
- `packages/core/tsconfig.json` — extends `../../tsconfig.base.json`.
- `packages/core/src/index.ts` — public surface (interface-first commit).
- `packages/core/src/normalize.ts` — `normalizeMetrics()`.
- `packages/core/src/impact.ts` — `computeImpact()`.
- `packages/core/src/store.ts` — `Store` interface + `createStore()` (JSON/JSONL files under `data/state`, `data/events`).
- `packages/core/src/hash.ts` — `sha256()` (stable: sort keys before hashing).
- `packages/core/src/id.ts` — `newId()`, `nowIso()`.
- `packages/core/src/*.test.ts` — unit tests.

## Contract
Implement exactly the `@admatix/core` surface in `ARCHITECTURE-DEEP.md` §3. Key rules:
- `normalizeMetrics` aggregates `CampaignDailyMetric[]` over a window into one
  `NormalizedMetrics` per campaign and one per account. `cac = spend/conversions`
  (`null` if conversions = 0). `roas = platform_revenue/spend`. `mer` is computed from
  **first-party** revenue only — never from `platform_revenue`.
- `createStore` round-trips through the filesystem; `append` writes JSONL lines.
- `sha256` of the same JSON value is always identical regardless of key order.

## Acceptance tests
1. `normalizeMetrics` is deterministic — identical input yields byte-identical output.
2. `cac` is `null` when conversions are 0; never `Infinity` or `NaN`.
3. `mer` uses first-party revenue; with no first-party data `mer` is `null`.
4. `Store` put → get → list → append round-trips correctly.
5. Unknown platform fields on input survive into the `raw` field.
6. `sha256({a:1,b:2})` equals `sha256({b:2,a:1})`.

## Definition of Done
Acceptance tests pass + global DoD. `src/index.ts` matches the contract exactly.

## Dispatch
Generic dispatch prompt, `<ID>=B`. Publish `src/index.ts` signatures in the first commit.
