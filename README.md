# AdMatix

**The evidence-gated operating layer for humans and AI agents running paid media.**

AdMatix audits paid-media accounts, produces hypothesis-backed **H0 packets**, proposes
changes, gates them against policy, dry-runs platform diffs, and records provenance so
every spend-touching decision is accountable. It ships as a CLI, an MCP server, and an
API ("software for agents"), plus a web cockpit for agencies.

> Agents propose. AdMatix gates. Humans approve. Adapters execute. Evidence decides what happens next.

## The operating loop

```
Plan  ->  Activate  ->  Measure  ->  Reflect
```

1. **Plan** — turn a business goal + account state into hypothesis-backed H0 packets.
2. **Activate** — dry-run or execute bounded platform actions through scoped tools.
3. **Measure** — reconcile platform metrics with first-party and experimental evidence.
4. **Reflect** — update trust, detect false positives, decide the next plan.

## Repo layout

```
apps/        api  web  mcp-server  cli
packages/    schemas  core  connectors  evidence  evals  ui
data/        fixtures  benchmarks
docs/        build  architecture  research  runbooks
scripts/     doctor  seed-fixtures  scan-secrets
```

`packages/schemas` is the **shared contract**. Every other package imports its types
and Zod validators and must never redefine them.

## Quick start

```bash
pnpm install
pnpm doctor          # environment + workspace health check
pnpm seed-fixtures   # load demo ad-account data
pnpm test
```

## Building AdMatix

This repo is being built by parallel coding agents. Start at
[`docs/build/00-BUILD-ORCHESTRATION.md`](docs/build/00-BUILD-ORCHESTRATION.md) — it
defines the work packages, the dependency waves, and how to dispatch agents.
Read [`AGENTS.md`](AGENTS.md) before writing any code.

## Status

The 72-hour MVP — Phase 1 of the Proof Wave — is **complete and demonstrable
end-to-end**: fixtures-only, dry-run-only, read-only MCP, no live platform
writes anywhere in the codebase.

| Work package | Owns | State |
| --- | --- | --- |
| WP-A bootstrap | root config, scripts, vitest | shipped |
| WP-B core | `packages/core` — Store, normalize, impact, hashing | shipped |
| WP-C connectors | `packages/connectors` — fixture adapters, `Connector` interface | shipped |
| WP-D evidence | `packages/evidence` — 5 detectors, audit report, H0 builder | shipped |
| WP-E policy | `packages/policy` — PolicyGuard, EvidenceLedger, events | shipped |
| WP-F agents | `packages/agents` — 9 MVP agents + orchestrator | shipped |
| WP-G cli | `apps/cli` — the `admatix` CLI | shipped |
| WP-H mcp | `apps/mcp-server` — 6 read-only MCP tools | shipped |
| WP-I evals | `packages/evals` — `safety-v1` benchmark harness | shipped |
| WP-J api+web | `apps/api`, `apps/web` — Fastify + React cockpit | shipped |
| **WP-K integration** | `scripts/demo.ts`, `tests/e2e/**`, this runbook | **shipped** |

Run the demo end-to-end:

```bash
pnpm install
pnpm tsx scripts/demo.ts   # or:  pnpm demo
```

The output is byte-deterministic against the fixtures. The walkthrough lives
at [`docs/runbooks/demo-script.md`](docs/runbooks/demo-script.md); the same
transcript is asserted line-for-line by `tests/e2e/demo-flow.test.ts`.

What the demo proves in one command, on fixtures, with no LLM in the loop:

1. **Audit** — three evidence-backed findings, every claim carrying source refs.
2. **Plan** — H0 packets with hypothesis, evidence, guardrails, rollback.
3. **Packet** — EvidenceLedger validates; missing refs would block.
4. **Activate** — a dry-run `ExecutionDiff` (never a mutation; enforced by Zod literal).
5. **Policy block** — a +60% budget shift against a 20% cap is **blocked** with a clear reason.
6. **Benchmark** — `safety-v1` scorecard (12/12 passed, 0 unsafe write attempts).
7. **MCP** — six read-only/propose-only tools; write-shaped tools fail closed without an `ApprovalReceipt`.
8. **ROI + cockpit** — recovered-waste math + the Fastify API surface the web cockpit consumes.

Phases 2-5 (Supabase data layer, Python simulator + verifier, validation
harness, proof package) are next on the Proof Wave plan — see
[`docs/build/AUTONOMOUS-WAVE-PLAN.md`](docs/build/AUTONOMOUS-WAVE-PLAN.md).
