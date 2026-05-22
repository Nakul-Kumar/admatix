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

72-hour MVP scope: fixtures-only, dry-run-only, read-only MCP. No live platform writes.
