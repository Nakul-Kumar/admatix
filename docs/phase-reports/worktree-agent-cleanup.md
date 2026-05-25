# Worktree And Agent Cleanup Report

Status: local cleanup applied with one Windows long-path residue  
Date: 2026-05-25

## Summary

The local AdMatix checkout had many historical proof-work worktrees still
attached after their branches were merged to `main`. This report records the
cleanup boundary and the cleanup result after removing only safe, clean, merged
local worktrees.
Remote proof branches should remain available through YC submission for audit
lineage.

## Keep

- `main-merge`: canonical local `main` worktree.
- `ops-runtime-sync`: active CI/VPS/dashboard branch.
- `db-replay-constraints`: active DB replay-safety branch.
- `live-pilot-readiness`: active live pilot, dataset, and agent architecture docs.
- `worktree-agent-cleanup`: this report branch.
- `cx2-validation`: dirty, contains ignored `output/` validation artifacts.
- `cx3-headtohead`: dirty, contains modified benchmark results and ignored
  `data/benchmark/` artifacts.
- `admatix-codex`: clean, but outside the `admatix-codex-wt` cleanup area; leave
  untouched to avoid surprising the operator.

## Dirty Artifact Snapshot

| Path | Status | Size |
| --- | --- | --- |
| `cx2-validation/output/` | ignored validation output | 8,931 files, ~1.86 GB |
| `cx3-headtohead/data/benchmark/` | ignored benchmark data | 190 files, ~41 MB |
| `cx3-headtohead/services/benchmark/results/` | modified tracked benchmark outputs | 2 files, ~260 KB |

These are not removed by the safe cleanup. They should be archived or reconciled
against `docs/proof/artifacts/` before deletion.

## Safe Local Worktrees Removed

The following worktrees are clean and their branch heads are merged to `main`:

- `cx1-dashboard`
- `cx2-repair`
- `cx4-backtests`
- `cx5-claims`
- `cx7-hygiene`
- `cx8-proof-integration`
- `diligence-hardening`
- `evidence-live-roadmap`

Git worktree metadata was removed for all of the above. The directories were
removed for all except `cx2-repair`, where Windows/OneDrive denied deletion of a
locked long-path native package file (`rolldown-binding.win32-x64-msvc.node`).
That leftover directory no longer has a `.git` file and is not an active
worktree.

## Remote Branch Policy

Do not delete remote proof/history branches yet. They provide useful audit
lineage for the proof package and YC diligence. Remote branch cleanup should be
a separate post-submission task.

## Future Agent Hygiene

Each future specialist agent should get:

- one branch and one worktree;
- explicit allowed and forbidden paths;
- logs under `admatix-codex-runs/agents/<timestamp>/`;
- a report under `docs/phase-reports/` when it changes product or proof state;
- no permission to merge `main`, write live ad accounts, or delete remote
  branches.
