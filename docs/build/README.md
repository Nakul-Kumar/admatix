# AdMatix build package

This folder is the parallel-execution plan for building the AdMatix 72-hour MVP today
with 4-6 coding agents.

## Read in this order

1. [`00-BUILD-ORCHESTRATION.md`](00-BUILD-ORCHESTRATION.md) — the dispatch plan: work
   packages, dependency waves, GitHub workflow, how to launch agents.
2. [`../architecture/ARCHITECTURE-DEEP.md`](../architecture/ARCHITECTURE-DEEP.md) — the
   inter-package contracts every agent builds against.
3. [`../../AGENTS.md`](../../AGENTS.md) — the conventions and the ten golden rules.
4. Your work package — `WP-A` … `WP-K` below.

## Work packages

| WP | File | Owns |
| --- | --- | --- |
| A | [WP-A-bootstrap.md](WP-A-bootstrap.md) | bootstrap finalize |
| B | [WP-B-core.md](WP-B-core.md) | `packages/core` |
| C | [WP-C-connectors.md](WP-C-connectors.md) | `packages/connectors`, fixtures |
| D | [WP-D-evidence.md](WP-D-evidence.md) | `packages/evidence` |
| E | [WP-E-policy.md](WP-E-policy.md) | `packages/policy` |
| F | [WP-F-agents.md](WP-F-agents.md) | `packages/agents` |
| G | [WP-G-cli.md](WP-G-cli.md) | `apps/cli` |
| H | [WP-H-mcp.md](WP-H-mcp.md) | `apps/mcp-server` |
| I | [WP-I-evals.md](WP-I-evals.md) | `packages/evals`, benchmarks |
| J | [WP-J-api-web.md](WP-J-api-web.md) | `apps/api`, `apps/web` |
| K | [WP-K-integration.md](WP-K-integration.md) | integration & demo |

## Decision docs

- [`OPEN-SOURCE-AND-REVENUE.md`](OPEN-SOURCE-AND-REVENUE.md) — the open-core decision
  and the revenue model.
- [`TESTING-AND-COMPARISON.md`](TESTING-AND-COMPARISON.md) — the test strategy and the
  methodology for benchmarking AdMatix against Synter and platform AI.
