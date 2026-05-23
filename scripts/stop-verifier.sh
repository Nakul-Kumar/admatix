#!/usr/bin/env bash
# Companion to scripts/start-verifier.sh: stops the verifier whose PID is
# recorded in /tmp/admatix-verifier.pid. Idempotent.

set -euo pipefail

PID_FILE="${ADMATIX_VERIFIER_PID_FILE:-/tmp/admatix-verifier.pid}"

if [[ ! -f "$PID_FILE" ]]; then
  exit 0
fi

pid="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ -z "$pid" ]]; then
  rm -f "$PID_FILE"
  exit 0
fi

if kill -0 "$pid" 2>/dev/null; then
  kill "$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
  fi
fi

rm -f "$PID_FILE"
