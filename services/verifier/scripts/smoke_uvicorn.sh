#!/usr/bin/env bash
# Boots the verifier under uvicorn, polls /healthz until 200 or 30 s elapses.
# Exits 0 only when /healthz returned 200; otherwise 1.

set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${VERIFIER_HOST:-127.0.0.1}"
PORT="${VERIFIER_PORT:-8088}"
LOG="${VERIFIER_LOG:-/tmp/admatix-verifier-smoke.log}"

if [ -f "$HERE/.venv/bin/activate" ]; then
  # shellcheck disable=SC1090
  . "$HERE/.venv/bin/activate"
fi

cd "$HERE"

python -m uvicorn admatix_verifier.app:app --host "$HOST" --port "$PORT" \
  --log-level warning >"$LOG" 2>&1 &
PID=$!

cleanup() {
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
}
trap cleanup EXIT

deadline=$(( $(date +%s) + 30 ))
status=1
while [ "$(date +%s)" -lt "$deadline" ]; do
  if curl -sf -o /dev/null "http://${HOST}:${PORT}/healthz"; then
    status=0
    break
  fi
  sleep 1
done

if [ "$status" -ne 0 ]; then
  echo "verifier did not respond on /healthz within 30s" >&2
  echo "--- uvicorn log ---" >&2
  cat "$LOG" >&2 || true
fi

exit "$status"
