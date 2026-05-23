#!/usr/bin/env bash
# Run the Phase 4 calibration slice (WP-T's contribution to the gate).
#
# Invokes `python -m admatix_validation all --config configs/phase4-gate.json`
# and exits 0 on green. The slow path; expect ~10 minutes on the VPS.

set -eu

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

if [ -f "$HERE/.venv/bin/activate" ]; then
  # shellcheck disable=SC1090
  . "$HERE/.venv/bin/activate"
fi

export PYTHONPATH="$HERE/src:${PYTHONPATH:-}"

python -m admatix_validation all --config "$HERE/configs/phase4-gate.json"
