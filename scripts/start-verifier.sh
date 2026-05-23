#!/usr/bin/env bash
# Boot the AdMatix verifier locally for the Phase 3 gate test and the
# WP-S runbook. Idempotent: if the PID file is already up, reuses it.
# Polls /healthz until it answers 200 (or fails after the timeout).
# Writes the PID to /tmp/admatix-verifier.pid and prints it to stdout.
#
# Usage:
#   scripts/start-verifier.sh             # default port 8088
#   ADMATIX_VERIFIER_PORT=18088 \
#     ADMATIX_VERIFIER_HOST=127.0.0.1 \
#     scripts/start-verifier.sh
#
# The verifier itself lives in services/verifier and is owned by WP-R.
# WP-S only boots it.

set -euo pipefail

PORT="${ADMATIX_VERIFIER_PORT:-8088}"
HOST="${ADMATIX_VERIFIER_HOST:-127.0.0.1}"
PID_FILE="${ADMATIX_VERIFIER_PID_FILE:-/tmp/admatix-verifier.pid}"
TIMEOUT_S="${ADMATIX_VERIFIER_BOOT_TIMEOUT:-60}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
verifier_dir="$repo_root/services/verifier"
venv="$verifier_dir/.venv"

if [[ ! -d "$venv" ]]; then
  echo "verifier venv not found at $venv — create it with:" >&2
  echo "  cd services/verifier && python3.12 -m venv .venv && . .venv/bin/activate && pip install -r requirements.lock" >&2
  exit 1
fi

# If the PID file exists and the process is alive, reuse it.
if [[ -f "$PID_FILE" ]]; then
  existing="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$existing" ]] && kill -0 "$existing" 2>/dev/null; then
    if curl -fsS "http://$HOST:$PORT/healthz" >/dev/null 2>&1; then
      echo "$existing"
      exit 0
    fi
  fi
fi

LOG_FILE="${ADMATIX_VERIFIER_LOG:-/tmp/admatix-verifier.log}"
cd "$verifier_dir"
# shellcheck disable=SC1091
. "$venv/bin/activate"
# Run from inside the venv so its deps resolve without a global PYTHONPATH
# hack; PYTHONPATH still adds services/simulator/src so /simulate can find
# admatix_simulator even when it is not pip-installed.
PYTHONPATH="$repo_root/services/verifier/src:$repo_root/services/simulator/src${PYTHONPATH:+:$PYTHONPATH}" \
  nohup python -m uvicorn admatix_verifier.app:app \
    --host "$HOST" --port "$PORT" \
    >"$LOG_FILE" 2>&1 &
pid=$!
echo "$pid" >"$PID_FILE"

# Poll /healthz until ready or the timeout fires.
deadline=$(( $(date +%s) + TIMEOUT_S ))
until curl -fsS "http://$HOST:$PORT/healthz" >/dev/null 2>&1; do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "verifier exited before /healthz answered — see $LOG_FILE" >&2
    rm -f "$PID_FILE"
    exit 1
  fi
  if [[ $(date +%s) -ge $deadline ]]; then
    echo "verifier failed to answer /healthz within ${TIMEOUT_S}s — see $LOG_FILE" >&2
    kill "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    exit 1
  fi
  sleep 1
done

echo "$pid"
