# CX-2 Validation Repair Report

Branch: `codex/cx2-validation-repair`

## Summary

CX-2 was repaired as a science failure, not treated as runtime flakiness. The
original validation run mixed strict calibration with robustness scenarios,
validated geo worlds against the wrong estimand, used a geo-constant treatment
regression where a pre/post holdout design was required, and let CI miss the
validation service entirely.

This repair keeps the proof claim narrow: calibrated simulator plus public
RCT/backtest evidence supports evidence-gated verification behavior. It does not
claim proven live spend lift.

## Root Causes Fixed

- Geo simulator worlds were not true pre/post geo holdouts. Treated geos now
  have untreated pre-periods and treated post-periods; control geos are never
  treated.
- Geo verification compared a post-action estimate to diluted whole-panel ATE.
  Geo worlds now record `verification_target_ate`, and validation compares the
  verifier to that post-period estimand.
- The geo verifier regressed a geo-constant treatment indicator. It now uses a
  `treated_geo * post_period` DiD estimator with geo and period fixed effects
  and geo-clustered uncertainty.
- CATE intervals under-covered in finite samples. DML intervals now use a
  conservative finite-sample inflation and tests assert nominal recovery.
- Robustness worlds were forced through the same strict recovery gates as clean
  calibration worlds. The harness now separates `core` calibration from
  `robustness` reporting.
- Placebo/near-zero multiseed checks used CV, which is unstable around zero.
  They now gate on false-positive rate and absolute estimate dispersion.
- CI did not exercise `services/validation`. Root Python test scripts and
  GitHub Actions now include validation tests, and dashboard CI runs
  origin-validation, typecheck, and build.

## Verification Evidence

Fast gates:

- `pnpm install --frozen-lockfile` passed.
- `pnpm -r typecheck` passed.
- `pnpm exec turbo run test --concurrency=1 --force` passed: 18/18 tasks
  successful.
- `pnpm exec turbo run build --concurrency=1 --force` passed: 11/11 tasks
  successful.
- `pnpm scan-secrets` passed.
- `pnpm audit --prod --audit-level=moderate` passed.
- `pnpm run test:python` passed:
  - core: 45 passed
  - verifier: 41 passed
  - validation: 26 passed, 2 deselected
- `services\validation\.venv\Scripts\python -m pytest -q
  services\validation\tests -m "not slow"` passed: 26 passed, 2 deselected.
- `cd proof-dashboard && npm run validate:origin && npm run typecheck &&
  npm run build` passed.

Slow proof gates:

- `admatix_validation sbc --config services\validation\configs\phase4-gate.json`
  passed: 500 simulations, chi-square p-value 0.7598939812328932.
- `admatix_validation coverage --config
  services\validation\configs\phase4-gate.json` passed: empirical coverage
  0.964815 with nominal gate true.
- `admatix_validation rmse-bias --config
  services\validation\configs\phase4-gate.json` passed: bias and RMSE gates
  true; geo RMSE 0.01443585 against mean target lift 0.0614739399.
- `admatix_validation multiseed --config
  services\validation\configs\phase4-gate.json` passed: no confident wrong
  claims; maximum wrong-claim rate 0.0.
- `admatix_validation all --config services\validation\configs\phase4-gate.json`
  produced an output bundle with all sub-gate booleans true:
  SBC uniformity, coverage nominality, RMSE, bias, and multiseed all passed.

## Caveats

- The combined `all` command was run as a background process and the final
  process exit code was not captured by the launcher. The emitted JSON bundle
  was parsed and all sub-gate booleans were true.
- Robustness worlds are intentionally not forced to recover lift. Their proof
  obligation is no confident wrong claim: they may return `inconclusive` when
  evidence quality is insufficient.
- Dashboard data should remain `demo` or `unavailable` for CX-2 until normalized
  proof artifacts are published under `docs/proof/artifacts/` and redeployed.

## Remaining Release Work

- Normalize CX-2/CX-3/CX-4 accepted outputs into aggregate proof artifacts.
- Deploy dashboard artifact JSON with `origin.kind="artifact"` only for accepted
  artifacts.
- Produce the final Phase 5 proof report and YC/demo package from the accepted
  artifacts.
