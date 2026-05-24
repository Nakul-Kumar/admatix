# CX-9 Proof Artifact Normalization Report

Branch: `codex/cx9-proof-artifacts`

## Summary

Normalized the accepted CX-2, CX-3, and CX-4 proof evidence into aggregate-only
tracked JSON under `docs/proof/artifacts/`. No raw Criteo or Hillstrom rows are
included.

## Artifact Sources

- CX-2 validation repair: `codex/cx2-validation-repair` at `b925370`.
- CX-3 head-to-head benchmark: `codex/cx3-headtohead-repair` at
  `b8028a03aca6d46a6f582733fe0deb39635a43d3`.
- CX-4 public RCT backtests: `codex/cx4-backtests-benchmarks` at
  `7f9a185e1711e39b673d3008c7b8fb5a93549502`.

## Key Evidence Captured

- CX-2: SBC p-value 0.7598939812328932; empirical coverage 0.964815;
  CATE coverage 0.9625; geo coverage 0.969444; RMSE/bias gates passed;
  multiseed wrong-claim rate max 0.0.
- CX-3: `proof_readiness_status=READY`, `real_llm_rows=28`,
  `deterministic_fallback_rows=0`, `failed_llm_rows=0`, `skipped_llm_rows=0`.
- CX-4: Criteo full gate used `criteo_sample_rows=null`,
  `rows_total=13979592`; Hillstrom rows 64000; slow pytest exit code 0.

## Claim Limits

These artifacts support the narrow proof claim: calibrated simulator plus public
RCT/backtest evidence supports evidence-gated verification behavior. They do not
claim live paid-media spend lift.

## Dashboard Note

The public dashboard remains honest as demo/unavailable data until the dashboard
schema is updated to display these artifact-native metrics directly. Do not
force these artifacts into the old demo-shaped dashboard fields if doing so
would invent business metrics.
