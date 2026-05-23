#!/bin/bash
# AdMatix generic work-package dispatcher.
# Creates an isolated git worktree and launches one headless build agent.
# Usage: dispatch-wp.sh <wp-id> <branch> <pkg-path> <spec> <model:opus|codex>
#   <spec> = a docs/build/WP-*.md filename, OR an instruction string naming a
#            section of docs/build/AUTONOMOUS-WAVE-PLAN.md.
set -u
export HOME=/home/agentforge
R=/opt/admatix
WTBASE=/opt/admatix-wt
WP="$1"; BR="$2"; PKG="$3"; SPEC="$4"; MODEL="${5:-opus}"
WT="$WTBASE/$WP"
sudo mkdir -p "$WTBASE" 2>/dev/null; sudo chown -R agentforge:agentforge "$WTBASE" 2>/dev/null

git -C "$R" fetch origin main -q 2>/dev/null
git -C "$R" worktree remove --force "$WT" 2>/dev/null
git -C "$R" branch -D "$BR" 2>/dev/null
git -C "$R" worktree add "$WT" -b "$BR" origin/main >/tmp/${WP}_wt.log 2>&1

# Phase 4 datasets (Criteo Uplift v2.1, Hillstrom) live in a shared,
# worktree-external staging dir so every WP can run real-data tests
# without re-downloading. Loaders (services/uplift) and conftests look
# for them under data/datasets/ — symlink the worktree's path at it.
DATA_SHARED=/opt/admatix-data/datasets
if [ -d "$DATA_SHARED" ] && [ ! -e "$WT/data/datasets" ]; then
  mkdir -p "$WT/data"
  ln -s "$DATA_SHARED" "$WT/data/datasets"
fi

cat > "$WT/_prompt.md" <<PEOF
You are building ONE work package of the AdMatix monorepo, autonomously and to completion.
Working directory: $WT  (a git worktree of github.com/Nakul-Kumar/admatix on branch $BR; git push auth is configured).

STEP 1 - Read IN FULL before writing any code:
  AGENTS.md ; docs/architecture/ARCHITECTURE-DEEP.md ; docs/architecture/PROOF-WAVE-MASTER-PLAN.md ;
  docs/build/AUTONOMOUS-WAVE-PLAN.md ; and your work-package spec: $SPEC
STEP 2 - Implement the work package ($PKG) EXACTLY to the spec and the contracts in those docs.
  First commit: the package public API (src/index.ts, or the module entry) with full exported
  signatures as stubs; then implement fully. Obey the ten golden rules in AGENTS.md.
STEP 3 - Verify, all must pass:
  TypeScript packages: pnpm install ; pnpm -r typecheck ; pnpm -r test
  Python services:     set up a venv and run pytest
  Every named acceptance test for this work package must pass.
STEP 4 - Ship: commit (conventional messages) ; git push -u origin $BR ;
  write a concise report (what shipped + the verification output) to
  docs/phase-reports/${WP}-report.md, commit it, and push again.
CONSTRAINTS: edit ONLY files belonging to this work package; NEVER edit packages/schemas;
  no live ad-platform calls anywhere (simulation / dry-run only); never commit secrets.
STOP when the work package is complete, its acceptance tests pass, and $BR is pushed.
Do not start any other work package.
PEOF

S=/tmp/${WP}_status.log
echo "STARTED $(date -u) model=$MODEL branch=$BR" > "$S"
if [ "$MODEL" = "codex" ]; then
  ( cd "$WT" && codex exec --dangerously-bypass-approvals-and-sandbox "$(cat _prompt.md)" \
        >/tmp/${WP}_out.log 2>/tmp/${WP}_err.log
    echo "EXIT=$? FINISHED $(date -u)" >>"$S"; git -C "$WT" log --oneline -6 >>"$S" 2>&1 ) &
else
  ( cd "$WT" && cat _prompt.md | claude -p --model opus --dangerously-skip-permissions --max-turns 300 \
        >/tmp/${WP}_out.log 2>/tmp/${WP}_err.log
    echo "EXIT=$? FINISHED $(date -u)" >>"$S"; git -C "$WT" log --oneline -6 >>"$S" 2>&1 ) &
fi
echo "dispatched $WP ($MODEL) branch=$BR worktree=$WT pid=$!"
