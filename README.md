# AdMatix

**Evidence-gated control plane for AI-run paid media.**

AdMatix lets humans, LLM agents, and ad-ops tools propose campaign changes, but it does not trust proposals by default. Every spend-touching action must pass through evidence, policy, approval, dry-run diffing, tamper-evident logging, and independent measurement before it can become a claim.

> Agents propose. AdMatix gates. Humans approve. Evidence decides what can be claimed.

Learn more: [https://admatix.tech/](https://admatix.tech/)

Important boundary: the dashboard is an artifact-backed proof snapshot, not a continuous live ad-account feed. AdMatix has not proven live paid-media lift yet. The next milestone is a pre-registered live geo or holdout pilot.

## What Exists Today

AdMatix currently includes:

- A deterministic dry-run product loop over fixture ad-account data.
- H0 packets with hypotheses, evidence references, guardrails, rollback plans, and claim limits.
- Evidence and policy gates that block unsafe or unsupported actions before mutation.
- CLI, API, web cockpit, and read-only/propose-only MCP server surfaces.
- A Python simulator that creates seeded ad-campaign worlds with known ground truth.
- An independent verifier service that returns estimates, confidence intervals, methods, verdicts, confounders, guardrail audit results, and claim limits.
- Accepted aggregate proof artifacts from validation, real-LLM simulated benchmarking, and public RCT/backtest datasets.
- A Supabase/Postgres data-layer shape for ledger, app state, warehouse, simulator, benchmark, shadow connector syncs, pre-registered experiment designs, and immutable proof bundles.

## What The Proof Shows

| Evidence area | Artifact or command | Result | Honest claim | Not claimed |
| --- | --- | --- | --- | --- |
| Product loop | `pnpm demo`, `tests/e2e/demo-flow.test.ts` | Dry-run demo and e2e tests pass | AdMatix can audit fixture account data, build H0 packets, block unsafe budget changes, and produce dry-run diffs. | Live ad-account operation or autonomous spend mutation. |
| Safety gate | `packages/policy`, `packages/evidence` | PolicyGuard blocks a +60% budget shift against a 20% cap | Spend-touching proposals can be blocked by deterministic policy/evidence gates. | That every possible unsafe action has been proven impossible. |
| CX-2 validation | `docs/proof/artifacts/cx2-validation-summary.json` | PASS: empirical 95% CI coverage `0.964815`, SBC p-value `0.7598939812328932`, max wrong-claim rate `0.0`, placebo false-positive rate `0.05` | The verifier is calibrated on seeded simulator worlds within stated limits. | Simulation proves real-world lift. |
| CX-3 head-to-head | `docs/proof/artifacts/cx3-headtohead-summary.json` | READY: `28` real Claude subscription buyer rows, `0` fallback rows, `0` failed rows, simulated benchmark | The benchmark has real LLM lane accounting without fallback inflation. | Live-market superiority or causal lift on real ad accounts. |
| CX-4 public backtests | `docs/proof/artifacts/cx4-backtests-summary.json` | PASS: full Criteo Uplift v2.1 `13,979,592` rows and Hillstrom `64,000` rows, aggregate-only, with checksums | Public randomized/backtest datasets recover aggregate measured effects. | Public RCT data equals production account proof. |
| Dashboard | `proof-dashboard/` (access-controlled) | LIVE: artifact view uses `origin.kind = "artifact"`; Demo Lab pages stay illustrative | Vetted reviewers can inspect accepted aggregate proof artifacts and claim limits. | Continuous live ad-account telemetry. |
| Live-data readiness | `warehouse/migrations/0005_live_data_readiness.sql` | Disposable Postgres 17 migration apply/replay validated on the VPS | The schema is ready for shadow connector syncs, raw platform landings, experiment preregistration, and immutable proof bundles. | Connected live ad accounts or applied production migrations. |

## Claim Boundary

Safe external wording:

> AdMatix is an evidence-gated control plane for AI-run paid media. Agents can propose campaign changes, but deterministic evidence, policy, approval, and independent verifier gates decide whether an action can proceed. Today the system runs end-to-end in dry-run mode, blocks unsafe budget actions, exposes aggregate proof artifacts in the dashboard, and passes calibrated simulator plus public RCT/backtest gates. We are not claiming live spend lift yet; the next milestone is a pre-registered live geo or holdout pilot.

Do not claim:

- AdMatix has proven live spend lift.
- AdMatix guarantees ROAS or iROAS improvement.
- AdMatix autonomously changes customer spend today.
- The dashboard shows live paid-media proof.
- The simulator proves real-world lift.
- Every campaign decision has a rigorous causal estimate.
- Public RCT/backtest evidence is the same as production account proof.

## How The H0 Gate Works

Every proposed action needs an H0 packet:

1. **Hypothesis**: null, alternative, treatment, unit, target population, and metric.
2. **Evidence**: source references, baseline window, measurement window, data freshness, and known confounders.
3. **Guardrails**: budget caps, policy constraints, approval requirements, rollback checkpoints, and allowed action scope.
4. **Power and decision rule**: MDE, power, alpha, confidence interval rule, and claim limit.
5. **Verification**: independent verifier estimates effect only when the design supports it; weak evidence returns `inconclusive`.
6. **Ledger**: H0 packet, proposed action, policy result, diff, approval, and outcome are recorded for auditability.

This is the core product idea: an LLM can suggest a spend change, but AdMatix decides whether the evidence and policy envelope allow it.

## Data And Evidence Architecture

AdMatix separates raw data from proof:

- **Raw platform reports** land in warehouse bronze tables.
- **Entity snapshots** preserve campaign, ad set, ad, creative, keyword, audience, budget, and conversion-action history.
- **First-party conversion events** are the preferred source for live incrementality and iROAS claims.
- **Experiment designs** preregister control arms, measurement windows, MDE/power, placebo checks, and decision rules.
- **Proof bundles** promote only validated aggregate outputs to the dashboard/export layer.
- **Ledger events** preserve tamper-evident governance history.

See [docs/architecture/LIVE-DATA-EVIDENCE-ARCHITECTURE.md](docs/architecture/LIVE-DATA-EVIDENCE-ARCHITECTURE.md) for the full ER map, KPI taxonomy, dataset roadmap, and live pilot plan.

The first live/customer pilot should follow the read-only walled-garden plan in
[docs/architecture/WALLED-GARDEN-PILOT-READINESS.md](docs/architecture/WALLED-GARDEN-PILOT-READINESS.md).
Dataset and AD-Bench expansion is tracked in
[docs/build/DATASET-BENCHMARK-INTAKE-PLAN.md](docs/build/DATASET-BENCHMARK-INTAKE-PLAN.md).
Ongoing multi-agent development rules are in
[docs/architecture/ADMATIX-AGENT-OPERATING-MODEL.md](docs/architecture/ADMATIX-AGENT-OPERATING-MODEL.md).

## Dashboard

The public site is the landing page at [https://admatix.tech/](https://admatix.tech/).

The proof dashboard (`proof-dashboard/`) is a static React/Vite surface that is **access-controlled** and shared with vetted reviewers on request rather than published openly.

- Every dataset carries an origin badge: `artifact`, `demo`, `fixture`, `live`, or `unavailable`.
- The dashboard data contract is enforced by `npm run validate:origin` and `npm run check:data`.

Dashboard verification:

```bash
cd proof-dashboard
npm ci
npm run validate:origin
npm run check:data
npm run typecheck
npm run build
```

## Reproduce Locally

Requires Node 20+ and pnpm 9.12+.

```bash
pnpm install
pnpm -r typecheck
pnpm test
pnpm scan-secrets
pnpm audit:prod
pnpm demo
```

For Python service tests, install the relevant service requirements first, then run:

```bash
pnpm run setup:python
pnpm run test:python
```

The Python scripts create service-local virtual environments under `services/*/.venv`
and run tests with explicit `PYTHONPATH`, so local results do not depend on a
global Python install or accidentally shared packages.

Some full public-dataset backtests require local Criteo/Hillstrom datasets and are intentionally not committed to Git.

## Diligence Hardening

The approval and dry-run path is intentionally fail-closed:

- Approval receipts are HMAC-signed over receipt id, packet id, action id, caller identity, role, decision time, expiry, and decision.
- Activation requires the signed receipt to be persisted, unexpired, matched to the action re-derived from the H0 packet, and unused.
- Dry-run diffs are emitted only when the before-state is exact enough to preview. Unsupported action semantics are blocked until connector snapshots can model them faithfully.
- Future live connectors must log redacted credential-shaped payloads only and store credential references rather than raw OAuth tokens or API keys.

## Repo Layout

```text
apps/                 api, web cockpit, MCP server, CLI
packages/             schemas, core, connectors, evidence, policy, agents, evals
services/             ingest, simulator, verifier, validation, benchmark, backtests, uplift
warehouse/            Supabase/Postgres migrations and dbt project
docs/proof/           proof report, claims matrix, demo package, aggregate artifacts
docs/architecture/    system architecture, simulator/verifier, live-data roadmap
proof-dashboard/      static investor/proof dashboard
scripts/              doctor, demo, fixtures, DB migration runner, secret scan
tests/e2e/            deterministic demo flow tests
```

`packages/schemas` is the shared TypeScript contract. Runtime packages should import its types and Zod validators instead of redefining product schemas.

## Build And Deployment Notes

- GitHub branch prefix for Codex work: `codex/*`.
- Main branch is the source of truth after green checks and explicit merge.
- VPS mirror path: `/opt/admatix`.
- Public dashboard web root: `/var/www/admatix`, served by Caddy.
- Raw Criteo/Hillstrom data must remain untracked. Commit only checksums, aggregate metrics, manifests, and docs.

## Next Milestone

The next proof step is a self-owned or design-partner live pilot with human-approved changes only:

1. Run shadow replay first: compare recommendations from baseline agents and AdMatix without changing spend.
2. Pre-register a control arm: status-quo policy, matched control geos, platform lift-test control, or switchback control.
3. Use first-party incremental gross margin or revenue as the primary metric, not platform ROAS alone.
4. Apply strict safety gates: budget cap, max daily delta, no unapproved creative launch, no policy-sensitive targeting, and rollback checkpoints.
5. Claim success only if the confidence interval excludes zero and lower-bound iROAS clears break-even; otherwise report `inconclusive`.

That is the line between the current proof package and a real live spend-lift claim.
