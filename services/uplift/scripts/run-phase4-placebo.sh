#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
python -m admatix_uplift placebo --config configs/placebo-gate.json
