# AdMatix Build — Multi-Actor Coordination

Several actors operate on this build **concurrently**. These rules keep them from
colliding. Every agent or human touching this repo must follow them.

## The actors

| Actor | Runs | Owns |
|-------|------|------|
| **Orchestrator** | cron `*/30 * * * *` → `scripts/orchestrator-tick.sh` | The ONLY actor that merges branches to `main`, dispatches work packages, advances phases, and writes `.build/STATE.md` + `.build/STATUS.md`. |
| **Build agents** | headless `claude`/`codex`, one per work package | Each works ONLY in its own git worktree under `/opt/admatix-wt/`, on its own branch `wp/<id>`. Never touches `main` or another package. |
| **Monitor** | Cowork scheduled task `admatix-build-monitor` | Read-only. Reports status. Collides with nothing. |
| **Codex / humans (ad-hoc)** | manual / interactive | Status checks and optional improvement work — under the rules below. |

## The rules

1. **Only the orchestrator merges to `main`.** No other actor commits to, or pushes, `main`.
2. **One mutex for main-tree git writes.** Any actor that must do a git write inside `/opt/admatix` (the main worktree) first acquires the lock: `exec 9>/tmp/admatix_orch.lock; flock 9`. The orchestrator already does. If you will not hold the lock, do not write to the main tree at all.
3. **Status checks are always safe.** Reading `.build/STATUS.md`, `.build/STATE.md`, `.build/orchestrator.log`, `git log`, `git ls-remote` collides with nothing — do them freely, no lock.
4. **Improvement / exploratory work goes on a new branch in a new worktree:** `git worktree add /opt/admatix-wt/<name> -b <branch> origin/main`. Push the branch. Let the orchestrator or a human merge it. Never edit files in the main tree directly.
5. **Do not re-dispatch** a work package that `.build/STATE.md` lists as running, merged, or done.
6. **`.build/STATE.md` and `.build/STATUS.md` are orchestrator-owned.** Other actors read them; never write them.

## TL;DR for Codex and any status-checker

- **To check the build:** read `/opt/admatix/.build/STATUS.md` and `.build/orchestrator.log`. Always safe.
- **To change code:** new branch + new worktree, never `main`.
- **The orchestrator owns `main` and the merge queue.** Stay out of its lane and nothing collides.
