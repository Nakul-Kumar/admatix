# WP-B — Core domain — phase report

**Branch:** `wp/b-core`
**Package:** `@admatix/core` (`packages/core/`)
**Depends on:** `@admatix/schemas`
**Mode:** fixtures-only, dry-run, no live calls.

## Summary

Implemented the deterministic core for AdMatix per the contract in
`docs/architecture/ARCHITECTURE-DEEP.md` §3 and the acceptance criteria in
`docs/build/WP-B-core.md`. Public surface is exposed from
`packages/core/src/index.ts`:

| Export | File | Purpose |
| --- | --- | --- |
| `sha256` | `src/hash.ts` | Stable hash; canonicalises keys recursively before digesting. |
| `newId(prefix)` | `src/id.ts` | ULID-shaped id; rejects unsafe prefixes; no extra deps. |
| `nowIso()` | `src/id.ts` | ISO-8601 UTC timestamp. |
| `Store` / `createStore` | `src/store.ts` | Filesystem-backed JSON+JSONL persistence; path-traversal guarded. |
| `normalizeMetrics` | `src/normalize.ts` | Aggregates `CampaignDailyMetric[]` into windowed `NormalizedMetrics`; account scope attaches first-party revenue, campaign scope leaves `mer`/`first_party_revenue` null. |
| `computeImpact` | `src/impact.ts` | Pure delta math over two `NormalizedMetrics` snapshots. |
| `ImpactResult` (type) | `src/impact.ts` | Result shape for `computeImpact`. |

Every boundary call validates with `.parse()` against
`@admatix/schemas` so the schema package remains the single source of truth.
No platform calls, no LLM, no write paths. Edits are confined to
`packages/core/**`.

## Acceptance tests (WP-B §"Acceptance tests")

| # | Requirement | Test file |
| --- | --- | --- |
| 1 | `normalizeMetrics` is deterministic — identical input yields byte-identical output. | `normalize.test.ts` → "produces byte-identical output for identical input" |
| 2 | `cac` is `null` when conversions are 0; never `Infinity` / `NaN`. | `normalize.test.ts` → "cac is null when conversions are 0" |
| 3 | `mer` uses first-party revenue; with no first-party data `mer` is `null`. | `normalize.test.ts` → three cases under "(mer uses first-party only)" |
| 4 | `Store` put → get → list → append round-trips correctly. | `store.test.ts` (7 cases) |
| 5 | Unknown platform fields on input survive into the `raw` field. | `normalize.test.ts` → "preserves unknown platform fields in the raw bag" |
| 6 | `sha256({a:1,b:2})` equals `sha256({b:2,a:1})`. | `hash.test.ts` → "is independent of object key insertion order" |

## Golden rules check (from `AGENTS.md`)

- **#1 Schema is the contract** — no new types in `packages/core`; all boundary
  values run through Zod parsers from `@admatix/schemas`.
- **#2 Fixtures first** — pure functions, no platform IO; `Store` writes to
  local filesystem only.
- **#3 Dry-run only** — no platform mutation surface added or referenced.
- **#8 Deterministic** — `normalizeMetrics` sorts entities and aggregates in a
  fixed order; `sha256` canonicalises keys recursively.
- **#9 No secrets** — `pnpm scan-secrets` clean.

## Verification

```text
$ pnpm --filter @admatix/core typecheck

> @admatix/core@0.1.0 typecheck /opt/admatix/packages/core
> tsc -p tsconfig.json --noEmit
```

```text
$ pnpm --filter @admatix/core test

> @admatix/core@0.1.0 test /opt/admatix/packages/core
> vitest run

 RUN  v2.1.9 /opt/admatix

 ✓ packages/core/src/store.test.ts      (7 tests)  25ms
 ✓ packages/schemas/src/index.test.ts   (5 tests)  10ms
 ✓ packages/core/src/normalize.test.ts (12 tests)  19ms
 ✓ packages/core/src/hash.test.ts       (5 tests)   8ms
 ✓ packages/core/src/impact.test.ts     (6 tests)   6ms
 ✓ packages/core/src/id.test.ts         (4 tests)   5ms

 Test Files  6 passed (6)
      Tests  39 passed (39)
```

```text
$ pnpm scan-secrets
scan-secrets: no token-shaped secrets found.
```

## Definition of Done

- [x] `pnpm --filter @admatix/core typecheck` passes.
- [x] `pnpm --filter @admatix/core test` passes; the six named WP-B acceptance
      tests are green.
- [x] `pnpm scan-secrets` clean — no secrets touched.
- [x] Public API of `@admatix/core` matches §3 of `ARCHITECTURE-DEEP.md`
      exactly.
- [x] Edits limited to `packages/core/**` (and this report).
