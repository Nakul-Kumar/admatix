# AdMatix Specialized Agent Operating Model

Status: proposed operating model for ongoing development  
Last updated: 2026-05-25

AdMatix should use specialist agents as narrow workers, not as a second
orchestrator that fights the repo. Each agent gets an isolated branch/worktree,
a strict file scope, required tests, a report artifact, and a stop condition.

## Runtime Defaults

- Local laptop: use `claude -p` for research, critique, docs, and judgment-heavy
  work where subscription auth is confirmed.
- VPS: use `/opt/admatix` for verification and dashboard deploys; use `codex
  exec` only after an auth smoke test confirms it works in the `agentforge`
  runtime home.
- Windows local Codex CLI: do not rely on it until the `codex.exe` access-denied
  issue is fixed. The Codex desktop session can still implement and push.
- Nakul PC: use for heavy backtests or long Python runs only; no secret writes.

## Required Agent Contract

Every agent prompt must include:

- branch and worktree path;
- allowed write paths;
- forbidden paths;
- exact commands to verify;
- whether raw data is allowed locally;
- no merge-to-main permission;
- no live ad-account writes;
- report path and machine-readable result path;
- stop condition.

Agents must not edit `main`, delete branches, print secrets, upload raw
datasets, or relabel demo data as live.

## Specialist Roster

| Agent | Owns | Best runtime | Stop condition |
| --- | --- | --- | --- |
| `admatix-release-ops` | GitHub Actions, VPS sync, Caddy, dashboard deploy, route checks | Claude for ops judgment, Codex for scripts/tests | Public routes verified and rollback noted |
| `admatix-db-guardian` | Supabase migrations, dbt, replay safety, schema docs | Codex for SQL/tests, Claude review for risk | Migration replayed in disposable DB |
| `admatix-measurement-scientist` | H0 doctrine, Geo/RCT, verifier, OPE, simulator truth | Claude for method critique, Codex for harnesses | No confident wrong claim on hard worlds |
| `admatix-walled-garden-integrator` | Google/Meta/TikTok/Amazon read-only connectors and OAuth scopes | Claude for docs ambiguity, Codex for connector code | Read-only sync produces redacted raw rows |
| `admatix-benchmark-curator` | AD-Bench, OBP, AuctionGym, dataset manifests | Codex for ingest/tests | Dataset claim type and license recorded |
| `admatix-security-privacy-counsel` | OAuth minimization, PII rules, secret scans, DPA checklist | Claude/Codex Security review | No secret/PII path to artifacts/logs |
| `admatix-proof-publisher` | Dashboard artifacts, README/proof report, claim boundaries | Codex for build/tests, Claude for wording review | Dashboard shows artifact/demo labels correctly |
| `admatix-code-critic` | Read-only adversarial review before merge | Code critic / reviewer | Findings filed or explicit no-issue note |

## Branch Rules

- Branch prefix: `codex/`.
- One agent per branch unless explicitly integrating.
- Never rewrite or delete another agent's branch.
- Main merges require green checks and an operator-approved final summary.
- Remote proof branches should stay through YC submission for auditability.

## Logging And Reports

Each run should write outside raw-data paths:

```text
admatix-codex-runs/
  agents/<timestamp>/<agent>.log
  agents/<timestamp>/<agent>.json
  archive/<timestamp>/worktree-audit.json
```

Repo reports should go under `docs/phase-reports/` when the result changes the
product, proof, architecture, or operating model.

## Suggested Near-Term Tasks

1. `admatix-release-ops`: keep CI on Node 24-compatible actions and VPS mirror
   current.
2. `admatix-db-guardian`: add DB-level replay constraints and migration replay
   tests.
3. `admatix-walled-garden-integrator`: write first Google Ads + GA4 read-only
   connector contract.
4. `admatix-benchmark-curator`: intake Open Bandit Dataset and AD-Bench as
   separate evidence lanes.
5. `admatix-security-privacy-counsel`: review OAuth scopes and PII retention
   before any pilot data lands.
