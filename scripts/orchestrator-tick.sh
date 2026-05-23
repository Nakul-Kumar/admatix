#!/bin/bash
# AdMatix build orchestrator — one cron tick. Runs Claude (Opus) as the
# orchestrator brain. flock guarantees ticks never overlap.
export HOME=/home/agentforge
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/home/agentforge/.local/bin
cd /opt/admatix || exit 1
mkdir -p /opt/admatix/.build
LOG=/opt/admatix/.build/orchestrator.log
LOCK=/tmp/admatix_orch.lock
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "$(date -u) tick skipped (previous tick still running)" >> "$LOG"
  exit 0
fi
echo "" >> "$LOG"
echo "===== TICK START $(date -u) =====" >> "$LOG"
cat /opt/admatix/scripts/orchestrator-prompt.md \
  | claude -p --model opus --dangerously-skip-permissions --max-turns 160 \
  >> "$LOG" 2>&1
echo "===== TICK END $(date -u) =====" >> "$LOG"
