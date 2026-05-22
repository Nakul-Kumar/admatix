# WP-J — API & web cockpit

**Owns:** `apps/api/**`, `apps/web/**`, `packages/ui/**`
**Branch:** `wp/j-api-web` · **Wave:** 3 · **Depends on:** schemas, core, evidence, policy, agents
**Suggested agent:** Claude Code · **Size:** large

## Goal
The HTTP API and the local cockpit — the demo and customer walkthrough surface. This
is the **cuttable** work package: if Wave 1 slips, hold WP-J. The CLI + MCP +
benchmark flow is the non-negotiable core.

## Files to create
- `apps/api/package.json`, `apps/api/tsconfig.json`.
- `apps/api/src/server.ts` (Fastify), `apps/api/src/index.ts`.
- `apps/api/src/routes/` — `audit.ts`, `packets.ts`, `approvals.ts`, `benchmarks.ts`.
- `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/index.html`, `apps/web/vite.config.ts`.
- `apps/web/src/main.tsx`, `apps/web/src/App.tsx`.
- `apps/web/src/pages/` — `dashboard.tsx`, `packets.tsx`, `benchmark.tsx`.
- `apps/web/src/components/` — `EvidenceCard.tsx`, `ApprovalQueue.tsx`, `DiffView.tsx`, `RoiCalculator.tsx`.
- `packages/ui/**` — only if a component is genuinely shared; otherwise keep components in `apps/web`.

## Contract
The API is a thin surface over `@admatix/agents` (`runWorkflow`), `@admatix/evidence`
(`runAudit`), `@admatix/evals` (`runSuite`) — it defines **no new domain types**, only
route DTOs that wrap schema types. The web app calls the API, with a fixtures fallback
so the dashboard renders even with the API down. Stack: Vite + React + Tailwind.

## Screens
Account Audit · H0 Packet detail · Approval Queue · Dry-Run Diff · Benchmark Scorecard
· ROI / ARR Calculator. The ROI calculator turns `total_estimated_waste` into a monthly
recovered-spend and payback figure.

## Acceptance tests
1. The API returns schema-valid JSON on every route.
2. `pnpm --filter web dev` starts the cockpit locally with no blank page.
3. The dashboard renders the `agency-demo` audit with clickable source refs.
4. The benchmark scorecard is visible and reads the latest `BenchmarkRun`.
5. An invalid H0 packet cannot be approved — the approve control is disabled.
6. No text overlap, no element within 0.5rem of a viewport edge (visual QA).

## Definition of Done
Acceptance tests pass + global DoD.

## Dispatch
Generic dispatch prompt, `<ID>=J`.
