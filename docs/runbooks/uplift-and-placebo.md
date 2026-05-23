# Uplift And Placebo

This runbook covers WP-U: Qini/AUUC uplift scoring and the placebo negative-control gate.

## Install

```bash
cd services/uplift
python3.12 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip uv
uv pip compile requirements.txt -o requirements.lock
uv pip sync requirements.lock
```

The package imports `services/simulator`, `services/verifier`, and `services/ingest` through the pytest `pythonpath` / working tree source paths. No ad-platform credentials or database connection are used.

`scikit-learn` is pinned to `>=1.6,<1.8` because `causalml==0.16.0` requires `scikit-learn>=1.6.0`; the WP-U statistical thresholds are unchanged.

## Commands

```bash
python -m admatix_uplift qini-sim --config configs/qini-simulator.json
python -m admatix_uplift qini-criteo --config configs/qini-criteo-sample.json
python -m admatix_uplift placebo --config configs/placebo-default.json
bash scripts/run-phase4-placebo.sh
```

Each command prints a JSON summary and writes metrics plus PNG figures under `services/uplift/output/`, which is gitignored.

## Gates

Qini simulator: `median(qini / oracle_qini) >= 0.5` on heterogeneous simulator worlds. Every metrics row carries the dataset (`simulator`), seed, world id, CATE model id, estimated Qini, oracle Qini, and AUUC.

Placebo: zero-lift worlds must have mean estimate within `[-0.05 * baseline_cr, +0.05 * baseline_cr]` and false-positive rate `<= 0.05`. The Phase 4 WP-U gate is:

```bash
pytest -q -m slow tests/test_phase4_gate_placebo.py
```

## Dataset Boundary

Criteo Uplift v2.1 is CC BY-NC-SA 4.0: internal R&D / benchmark use only, non-commercial, share-alike, with attribution to Diemert et al. AdKDD 2018. WP-U never commits raw Criteo rows. Criteo outputs are written only below `services/uplift/output/`.

The loaders default to `data/datasets`, `data/raw`, and `data/checksums`. In cross-worktree builds, point those roots at the WP-P staged directories or symlink `data/datasets` / `data/raw` from the staged location before running the Criteo lane.

Hillstrom is used for loader coverage in WP-U. The Hillstrom Qini back-test gate belongs to WP-V.

## Outputs

`qini-simulator/metrics.json`: simulator Qini rows, median ratio, pass flag, and curve PNG paths.

`criteo/metrics.json`: held-out Qini/AUUC for `visit` and `conversion`, train/test counts, CATE model, curve PNG paths, and the Criteo license note.

`placebo/metrics.json`: mean estimate, mean absolute estimate, tolerance, false-positive rate, pass flags, and per-world summaries.

`placebo/runs.jsonl`: full `/verify` responses from the FastAPI TestClient path, one line per world.

`placebo/distribution.png`: signed estimate histogram centered at zero with tolerance bands.

## Regenerating The Lock

```bash
cd services/uplift
. .venv/bin/activate
uv pip compile requirements.txt -o requirements.lock
```
