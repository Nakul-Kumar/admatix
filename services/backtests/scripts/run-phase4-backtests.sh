#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
python -m admatix_backtests all --config configs/phase4-gate.json
