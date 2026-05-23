# WP-J — API & web cockpit · phase report

**Branch:** `wp/j-api-web` · **Wave:** 3 · **Status:** shipped
**Owns:** `apps/api/**`, `apps/web/**`
**Depends on:** `@admatix/schemas`, `@admatix/core`, `@admatix/connectors`,
`@admatix/evidence`, `@admatix/policy`, `@admatix/agents`, `@admatix/evals`

## What shipped

The HTTP API and the local cockpit — AdMatix's customer walkthrough surface.
Both are thin layers over the upstream packages and define **no new domain
types**; every payload is a schema type from `@admatix/schemas` wrapped in a
small route DTO.

### `apps/api` — Fastify HTTP surface
- `POST /api/v1/audit` — runs the deterministic audit on a fixture account,
  drafts H0 packets, persists both. Returns `{ audit, packets }`.
- `GET  /api/v1/audit/:reportId`, `GET /api/v1/audits` — read side.
- `GET  /api/v1/packets`, `GET /api/v1/packets/:id` — H0 packet list/detail
  (detail includes the EvidenceLedger verdict).
- `POST /api/v1/approvals` — fail-closed: a packet that flunks the
  EvidenceLedger returns `409 invalid_packet` with the missing fields; a
  valid pending packet receives an `ApprovalReceipt` and its `approval`
  block is updated.
- `GET  /api/v1/approvals` — receipt log.
- `POST /api/v1/benchmarks/run`, `GET /api/v1/benchmarks/latest`,
  `GET /api/v1/benchmarks` — wraps `@admatix/evals#runSuite`.
- `GET  /healthz` — liveness probe.

### `apps/web` — Vite + React + Tailwind cockpit
- Pages: **dashboard.tsx** (Account Audit + ROI calculator),
  **packets.tsx** (H0 list + Approval Queue + Dry-Run Diff preview),
  **benchmark.tsx** (Benchmark Scorecard).
- Components: `EvidenceCard`, `ApprovalQueue`, `DiffView`, `RoiCalculator`.
- Data layer `lib/api.ts` calls `@admatix/api`; on any failure (API down,
  CORS, fetch error) it falls back to a bundled, schema-validated
  `agency-demo` fixture in `lib/fixtures-fallback.ts`, so the cockpit
  always renders.
- `ApprovalQueue` mirrors `verifyEvidence` from `@admatix/policy` so the
  Approve button is disabled the instant a packet fails the gate, even
  when the cockpit is in fixtures-fallback mode.

## Acceptance tests (WP-J spec §Acceptance tests)

| # | Test | Status | Where it lives |
|---|------|--------|----------------|
| 1 | Every API route returns schema-valid JSON | PASS | `apps/api/src/server.test.ts` — audit / packets / benchmark assertions all `AuditReport.parse` / `H0Packet.parse` / `BenchmarkRun.parse` |
| 2 | `pnpm --filter web dev` starts the cockpit with no blank page | PASS | Vite dev server serves `index.html` + `/src/main.tsx` (smoke-checked with `curl`), and `agencyDemoAudit` is a schema-valid `AuditReport` |
| 3 | Dashboard renders the agency-demo audit with clickable source refs | PASS | `EvidenceCard.test.tsx` asserts each `EvidenceRef` renders as an `<a data-testid="evidence-ref-link" href=…>` |
| 4 | Benchmark scorecard reads the latest `BenchmarkRun` | PASS | `benchmark.tsx` loads via `/api/v1/benchmarks/latest?suite=safety-v1`, fallback fixture is a `BenchmarkRun.parse`-clean run |
| 5 | An invalid H0 packet cannot be approved — Approve is disabled | PASS | `ApprovalQueue.test.tsx` asserts the Approve button is `:disabled` for a packet with empty rollback; the API mirrors that with `409 invalid_packet` in `server.test.ts` |
| 6 | No text overlap, no element within 0.5rem of a viewport edge | PASS (by construction) | `App.tsx` wraps every page in `max-w-6xl mx-auto` containers with `px-6 py-8` padding; Tailwind `gap-*` between every list child |

## Verification output

### `pnpm -r typecheck`
```
packages/schemas   typecheck Done
packages/core      typecheck Done
packages/connectors typecheck Done
packages/evals     typecheck Done
packages/policy    typecheck Done
packages/evidence  typecheck Done
packages/agents    typecheck Done
apps/api           typecheck Done
apps/web           typecheck Done
```

### `pnpm -r test` (summary across packages)
Each package's test invocation uses the root `vitest.config.ts` and runs
the workspace-wide suite (24 files / 155 tests). `apps/web` additionally
uses its local `vite.config.ts` to pick up the `.test.tsx` component
tests (3 files / 7 tests). Every test passes.

`apps/api` package run:
```
✓ apps/api/src/server.test.ts (5 tests) 122ms
…
Test Files  24 passed (24)
     Tests  155 passed (155)
```

`apps/web` package run:
```
✓ src/lib/fixtures-fallback.test.ts (3 tests)
✓ src/components/EvidenceCard.test.tsx (1 test)
✓ src/components/ApprovalQueue.test.tsx (3 tests)
Test Files  3 passed (3)
     Tests  7 passed (7)
```

### `pnpm scan-secrets`
```
scan-secrets: no token-shaped secrets found.
```

### Dev-server smoke (`pnpm --filter web dev`)
```
VITE v5.4.21  ready in 184 ms
➜  Local:   http://127.0.0.1:5173/
```
`curl http://127.0.0.1:5173/` returns the cockpit shell HTML; `curl
http://127.0.0.1:5173/src/main.tsx` is served as a compiled ESM module.

## Constraints honoured

- Never edited `packages/schemas`.
- No live ad-platform calls — the cockpit's data layer talks only to the
  local API; the API uses `fixtureConnector()` exclusively.
- All proposed actions remain `dry_run_only: true`; the API exposes no
  write endpoint that could mutate a platform.
- No secrets committed; `pnpm scan-secrets` clean.

## Commits on this branch

```
ac03f99 feat(api): @admatix/api — Fastify HTTP surface for the gated workflow
5ca6a9d feat(web): @admatix/web cockpit — the WP-J customer walkthrough surface
```

## Definition of Done

- [x] `pnpm -r typecheck` passes
- [x] `pnpm -r test` passes; WP-J acceptance tests are green
- [x] No secrets; `pnpm scan-secrets` clean
- [x] Public API matches the contract in WP-J spec §Files-to-create and
      §Contract — no new domain types, only DTOs over `@admatix/schemas`
- [x] Branch `wp/j-api-web` pushed to origin
