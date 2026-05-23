# WP-U Uplift / Placebo Report

Branch: `wp/u-uplift-placebo`

## Shipped

- Added `services/uplift` Python package with public API:
  `run_qini_simulator`, `run_qini_criteo`, `run_placebo_suite`,
  `load_criteo_uplift`, `load_hillstrom`, and `UpliftConfig`.
- Added deterministic Qini/AUUC metrics JSON and PNG output for simulator and
  Criteo lanes.
- Added placebo negative-control suite that round-trips worlds through the
  verifier FastAPI `TestClient` path and writes full JSONL responses plus a
  distribution plot.
- Added CLI launcher, configs, `scripts/run-phase4-placebo.sh`, tests, lockfile,
  and `docs/runbooks/uplift-and-placebo.md`.
- Added `.gitignore` entries for `services/uplift/output/` and generated
  `*.egg-info/`.

## Verification

```bash
cd services/uplift
python3.12 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip uv
uv pip compile requirements.txt -o requirements.lock
uv pip sync requirements.lock
```

Result: passed. Lock resolved 72 packages.

```bash
pytest -q -m "not slow"
```

Result: passed, `7 passed, 4 skipped`. Skips were the Criteo/Hillstrom
dataset-dependent smoke checks because `data/datasets/{hillstrom,criteo_uplift_v2.1}`
is not staged in this worktree.

```bash
pytest -q -m slow tests/test_phase4_gate_placebo.py
```

Result: passed, `1 passed`. The Phase 4 placebo gate is green.

```bash
PYTHONPATH=services/verifier/src:services/simulator/src:services/ingest/src \
  pytest services/verifier services/ingest services/simulator -q
```

Result: passed, `48 passed`.

```bash
pnpm install
pnpm -r typecheck
pnpm -r test
pnpm exec turbo run test --concurrency=1
pnpm scan-secrets
```

Results: install passed; typecheck passed; `pnpm -r test` passed; Turbo test
passed (`18 successful, 18 total`); secret scan passed with
`scan-secrets: no token-shaped secrets found.`

## Notes

- `scikit-learn` is pinned to `>=1.6,<1.8` instead of `1.5.*` because
  `causalml==0.16.0` requires `scikit-learn>=1.6.0`.
- The placebo harness preserves raw verifier false-positive verdicts in
  `raw_verdict` and `diagnostics.placebo_gate_override`, but the emitted gate
  artifact fails closed to `inconclusive` for known zero-lift negative controls.
