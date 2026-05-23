# WP-R — `services/verifier` phase report

**Phase:** 3 · **Wave:** 2 · **Branch:** `wp/r-verifier`
**Date:** 2026-05-23 · **Agent:** Claude Opus 4.7

## What shipped

A standalone FastAPI service at `services/verifier` implementing the
AdMatix independent verification engine, per `docs/build/WP-R-verifier.md`
and `docs/architecture/SIMULATION-VERIFICATION.md` §§1–4. The service
exposes:

- `GET /healthz` — returns the version and the resolved version of every
  pinned library (used by the smoke check and by uptime probes).
- `POST /verify` — takes `{ packet, data_uri, metadata_uri, action_log_uri,
  hint }`, loads the simulator-emitted events CSV from a local `file://`
  URI, runs the deterministic guardrail-compliance proof, picks the
  strongest causal method the available evidence supports (per §2.6), and
  returns the seven canonical fields (`estimate, ci_low, ci_high, method,
  causal_status, verdict, confounders`) alongside `ci_level`,
  `guardrail_proof`, `diagnostics`, `rejected_methods`, `packet_id`,
  `tx_id`.
- `POST /simulate` — thin wrapper over `services.simulator.generate_world`
  so WP-S can build a verifier integration test end-to-end through HTTP.

Methods, one module each (`services/verifier/src/admatix_verifier/methods/`):

| Layer | Module | Backend |
| --- | --- | --- |
| (a) Guardrail proof | `guardrail.py` | Pure Python; six built-in rules (`budget_cap`, `freq_cap`, `pacing_min`, `pacing_max`, `geo_allowlist`, `audience_allowlist`) + an `unknown_rule` predicate for novel keys. |
| (b) Pre/post BSTS | `bsts.py` | `statsmodels.UnobservedComponents` (Kalman-filter local-level + weekly seasonal + control covariate; posterior SE via the forecast distribution). |
| (c) CATE meta-learner | `cate.py` | `econml.dml.LinearDML` with gradient-boosting nuisance models and asymptotic CIs; falls back to `causalml.BaseTRegressor` with a bootstrap CI. Qini coefficient via `causalml.metrics`. |
| (d) Geo-holdout | `geo.py` | `statsmodels.OLS` two-way fixed-effects DiD with HC1 SE + `statsmodels.stats.power.TTestIndPower` for the pre-flight MDE/power check (returns `inconclusive` with `reason="underpowered"` if plausible_lift < MDE). |
| (e) OPE | `ope.py` | Numpy implementations of IPW, SNIPS, and Doubly-Robust estimators with influence-function-style asymptotic CIs; clipped weights; ESS-and-clip diagnostic returns `inconclusive` with `reason="extreme_weights"` on degeneracy. |

Method selector (`select.py`) follows SIMULATION-VERIFICATION §2.6 exactly,
and records every non-chosen method with a non-empty `reason` in the
response. The CLI launcher (`__main__.py`) boots uvicorn against the app
from CLI flags only (no env vars per spec).

## Deviations from the spec

The WP-R-verifier.md "Pinned stack" as written cannot be resolved — both
`tfcausalimpact==0.0.18` and `obp==0.5.*` pin `pandas<2.2`, mutually
incompatible with the spec's own `pandas==2.2.*` / `numpy==2.1.*` /
`econml 0.16.0` / `causalml 0.16.0` pins. Resolved by:

1. **`scipy>=1.14,<1.17`** instead of `scipy==1.14.*` — `causalml==0.16.0`
   requires `scipy>=1.16`. All other version pins follow the spec.
2. **`tfcausalimpact==0.0.18` dropped from the core lock**, kept available
   behind the `bsts-tfp` optional extra (which pulls `tfp-causalimpact`).
   The BSTS layer is implemented against `statsmodels.UnobservedComponents`
   — the standard non-TF state-space BSTS implementation, with a Kalman
   filter producing the posterior-style CI. Acceptance test 3 passes
   (CI brackets the recorded ATE on `clean_ab` and brackets zero on the
   placebo).
3. **`obp==0.5.*` dropped from the core lock**, replaced by direct
   numpy implementations of IPW / SNIPS / DR with influence-function-style
   asymptotic CIs. The spec's `diagnostics["estimators"]` shape (IPS, SNIPS,
   DR each with `value` + `ci_low` + `ci_high`) is preserved exactly.
   Acceptance test 6 passes.

Two test-level deviations driven by per-seed sampling SE bounds, *not* a
change to the engine's behaviour:

4. **`test_placebo_zero.py` n_users 4 000 → 50 000.** The §3.5 placebo
   tolerance (`|est| ≤ 0.05·baseline_cr = 0.0015`) is a population-mean
   criterion. At n=4000 with p=0.03 the per-seed estimator SE is ~0.005 —
   above the tolerance — so a single seed will routinely exceed it even
   though the engine returns `inconclusive` with a CI that brackets zero.
   Increasing n brings the per-seed estimate inside the tolerance without
   weakening any assertion; the `verdict != "lift_detected"` and
   `ci_low ≤ 0 ≤ ci_high` checks (the engine-behaviour assertions) are
   unchanged.
5. **`test_cate.py` adds a `large_placebo_world` fixture (n_users 30 000)**
   for the same reason — the placebo CATE point-estimate tolerance is
   population-level, infeasible at single-seed n=2000.

One root-level scaffold change to keep `pnpm scan-secrets` clean across
Python services:

6. **`scripts/scan-secrets.ts` adds `.venv` to `excludedDirs`** alongside
   `node_modules`/`.turbo`. Without this, sklearn's HTML pretty-print
   stylesheet (`_estimator_html_repr.css`) trips the OpenAI-key regex on
   a `--sk-` CSS variable. `.venv` is the Python analog of `node_modules`;
   this is a one-line change in the existing exclusion list.

## Verification commands

All six commands from §Verification commands exit 0 on this branch.

### 1. `pip compile` + `pip sync`

```
cd services/verifier
python3.12 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip uv
uv pip compile requirements.txt -o requirements.lock     # green
uv pip sync requirements.lock                            # 84 packages resolved
```

### 2. `pytest -q` (all nine acceptance tests)

```
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-8.3.5, pluggy-1.6.0
rootdir: /opt/admatix-wt/R/services/verifier
configfile: pyproject.toml
testpaths: tests

tests/test_api_contract.py .....                                         [ 19%]
tests/test_bsts.py ..                                                    [ 26%]
tests/test_cate.py ..                                                    [ 34%]
tests/test_coverage_on_simulator.py .                                    [ 38%]
tests/test_geo.py ..                                                     [ 46%]
tests/test_guardrail.py ....                                             [ 61%]
tests/test_ope.py ..                                                     [ 69%]
tests/test_placebo_zero.py ..                                            [ 76%]
tests/test_select.py ......                                              [100%]

============================= 26 passed in 37.15s ==============================
```

### 3. `bash scripts/smoke_uvicorn.sh`

Boots uvicorn, polls `/healthz`, exits 0 — `SMOKE OK`.

### 4. Sibling Python services unchanged

```
pytest services/ingest services/simulator -q
..........                                                               [100%]
10 passed in 0.18s
```

### 5. TypeScript monorepo unchanged

```
pnpm -r typecheck       # all 9 packages: Done
pnpm exec turbo run test --concurrency=1
# 18/18 tasks successful; 175 passed | 1 skipped (176)
```

### 6. `pnpm scan-secrets`

```
scan-secrets: no token-shaped secrets found.
```

## Phase 3 gate contribution

`tests/test_coverage_on_simulator.py` (acceptance test 9) materialises 20
`clean_ab` worlds at distinct seeds (101–120), `n_users=2000`,
`true_lift=0.04`, `noise_sd=0.0`, runs the full `/verify` pipeline through
the TestClient, and asserts:

- ≥ 0.85 of the 95% CIs contain `metadata.ground_truth.ate` — **green**.
- ≥ 0.85 of the verdicts are `lift_detected` — **green**.

This is the unit-level floor that contributes to the Phase 3 gate. The
strict `[0.93, 0.97]` band from SIMULATION-VERIFICATION §3.2 is WP-T's
multi-thousand-world harness, not this WP.

## What is now ready for WP-S

WP-S can wire `MeasurementScientistAgent` to `POST /verify` over HTTP
without any further change to this WP. The response shape matches
PROOF-WAVE-MASTER-PLAN §6.2 exactly. The `admatix.verify` MCP tool can
forward the request unchanged and consume the seven canonical fields.
