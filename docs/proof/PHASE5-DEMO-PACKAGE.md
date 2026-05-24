# Phase 5 Demo Package

This package is the recordable proof sequence for AdMatix. It uses the real
merged artifacts and the dry-run product loop. It intentionally avoids YC
application materials, which Nakul is handling separately.

## Demo Goal

Show a complete, honest loop:

1. A simulated/ad-agent workflow finds an account issue.
2. AdMatix creates H0 packets with evidence metadata.
3. A safe action produces a dry-run diff.
4. An unsafe budget action is blocked by `PolicyGuard`.
5. The read-only MCP surface cannot bypass the gate.
6. The verifier/proof artifacts show accepted aggregate evidence.
7. The dashboard makes claim limits visible.

## Required Commands

```powershell
pnpm install --frozen-lockfile
pnpm exec vitest run tests/e2e/demo-flow.test.ts
pnpm demo
```

Expected terminal end state includes this line:

```text
Demo complete
```

Dashboard verification:

```powershell
cd proof-dashboard
npm ci
npm run validate:origin
npm run typecheck
npm run build
```

Public URL checks after deployment:

```powershell
curl.exe -I https://admatix.tech
curl.exe -I https://admatix.tech/artifacts
```

## Recordable Flow

| Segment | What to show | Proof point | Claim limit |
| --- | --- | --- | --- |
| Audit | `pnpm demo` step 1 | The system can inspect fixture account data and identify issues | Fixture data, not live account data |
| Plan | H0 packet creation | Proposals become falsifiable packets with evidence hashes | H0 packet quality depends on available evidence |
| Dry-run activation | Safe action diff | Spend-touching paths can be previewed without mutation | No platform mutation in this demo |
| Unsafe block | PolicyGuard block | Deterministic policy blocks unsafe action | Policy coverage is bounded by encoded rules |
| MCP | Read-only tool checks | Agents can inspect but not bypass mutation gates | MCP surface is read-only in this demo |
| Dashboard | `/artifacts` | CX-2/CX-3/CX-4 aggregate proof artifacts are visible | Not live paid-media lift |

## Accepted Artifact Numbers

Use only measured values from `docs/proof/artifacts/`:

- CX-2: empirical 95% CI coverage `0.964815`, SBC p-value `0.7598939812328932`,
  maximum wrong-claim rate `0.0`, placebo false-positive rate `0.05`.
- CX-3: `real_llm_rows=28`, `deterministic_fallback_rows=0`,
  `failed_llm_rows=0`, `proof_readiness_status=READY`.
- CX-4: Criteo full rows `13,979,592`, Hillstrom rows `64,000`, slow pytest
  exit code `0`.

## Forbidden Lines

Do not say:

- "AdMatix has proven live spend lift."
- "AdMatix guarantees ROAS improvement."
- "The simulator proves real-world lift."
- "Every decision has a rigorous causal estimate."
- "The dashboard is live account proof."

## Safe Close

"AdMatix has a working evidence-gated dry-run loop, calibrated
simulator/verifier evidence, real-LLM benchmark accounting, and public
RCT/backtest aggregate evidence. The next milestone is a pre-registered live
geo or holdout pilot."
