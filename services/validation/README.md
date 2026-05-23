# admatix-validation

Research-grade validation harness for the AdMatix verifier. See
[`docs/runbooks/validation.md`](../../docs/runbooks/validation.md) for
install + run instructions and gate thresholds.

Four harnesses (one per public surface):

- `run_sbc` — Simulation-Based Calibration (SIMULATION-VERIFICATION §3.1)
- `run_coverage` — empirical 95% CI coverage (§3.2)
- `run_rmse_bias` — point-estimate RMSE + bias (§3.3)
- `run_multiseed_variance` — multi-seed variance (§3.6)

Each is reachable through the CLI:

```
python -m admatix_validation sbc       --config configs/sbc-default.json
python -m admatix_validation coverage  --config configs/coverage-default.json
python -m admatix_validation rmse-bias --config configs/rmse-default.json
python -m admatix_validation multiseed --config configs/multiseed-default.json
python -m admatix_validation all       --config configs/phase4-gate.json
```
