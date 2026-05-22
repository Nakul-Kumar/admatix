# AdMatix Build Orchestration

**Goal:** ship the 72-hour MVP **today** using 4-6 parallel coding agents (Claude Code + Codex).
**Scope:** fixtures-only, dry-run-only, read-only MCP. No live platform writes.
**Read first:** [`/AGENTS.md`](../../AGENTS.md) and [`docs/architecture/ARCHITECTURE-DEEP.md`](../architecture/ARCHITECTURE-DEEP.md).

This repo already ships a working scaffold: root config, the full `@admatix/schemas`
contract, seed fixtures, and the doctor script. Agents do **not** rebuild those — they
build the 11 work packages below against the frozen schema contract.

---

## 1. Definition of done — the 5-minute demo

The MVP is done when this flow runs end-to-end on fixtures:

1. `admatix audit --account fixture:agency-demo --json` → 3-5 evidence-backed findings.
2. `admatix plan --goal "reduce CAC 10% without MER below 3.0"` → H0 packets.
3. `admatix packet show h0_001` → hypothesis, evidence refs, guardrails, rollback.
4. `admatix activate h0_001 --dry-run` → a before/after diff, never a mutation.
5. PolicyGuard **blocks** an unsafe action (budget cap breach) with a clear reason.
6. `admatix benchmark run --suite safety-v1` → a scorecard; all unsafe tasks blocked.
7. An AI agent calls the same flow through the MCP server (read-only tools).
8. The local dashboard shows the audit, the packet, the approval queue, the scorecard.

If time runs short, cut WP-J (API/web) last — the CLI + MCP + benchmark flow is the
non-negotiable core.

---

## 2. Work packages

| WP | Name | Owns (disjoint) | Wave | Depends on |
| --- | --- | --- | --- | --- |
| **A** | Bootstrap finalize | root: `vitest.config.ts`, `.npmrc`, `scripts/*`, `docs/research/legacy-source-map.md` | 0 | scaffold |
| **B** | Core domain | `packages/core/**` | 1 | schemas |
| **C** | Connectors & fixtures | `packages/connectors/**`, `data/fixtures/**` | 1 | schemas |
| **D** | Evidence & detectors | `packages/evidence/**` | 2 | schemas, core |
| **E** | Policy & governance | `packages/policy/**` | 1 | schemas |
| **F** | Agent runtime & orchestrator | `packages/agents/**` | 2 | schemas, core, evidence, policy, connectors |
| **G** | CLI | `apps/cli/**` | 3 | schemas, core, evidence, policy, agents |
| **H** | MCP server | `apps/mcp-server/**` | 3 | schemas, agents, evidence |
| **I** | Benchmark harness | `packages/evals/**`, `data/benchmarks/**` | 1-2 | schemas, core |
| **J** | API & web cockpit | `apps/api/**`, `apps/web/**`, `packages/ui/**` | 3 | schemas, core, evidence, agents |
| **K** | Integration & demo | `tests/e2e/**`, `docs/runbooks/demo-script.md` | 4 | all |

Every WP owns a disjoint set of directories — agents never edit the same file. The only
shared, frozen file is `packages/schemas/**`: **do not change it.** If a schema is wrong,
stop, post it in the shared channel, and one person changes it on a `wp/schema-fix`
branch that everyone rebases on.

---

## 3. Dependency DAG

```
                     schemas (FROZEN — already built)
                          |
        +--------+--------+--------+--------+
        |        |        |        |        |
       B core  C conn   E policy  I evals  A bootstrap
        |        |        |        |
        +---+----+        |        |
            |             |        |
          D evidence      |        |
            |             |        |
            +------+------+--------+
                   |
                F agents + orchestrator
                   |
        +----------+----------+
        |          |          |
      G CLI     H MCP      J API+web
        |          |          |
        +----------+----------+
                   |
              K integration + demo
```

**Interface-first rule:** the first commit of every WP publishes `src/index.ts` with the
full exported function signatures (bodies `throw new Error("not implemented")`). Once
that commit lands, downstream WPs can typecheck against it and start in parallel —
they do not wait for the implementation. This is what makes waves overlap.

---

## 4. Wave plan (one working day)

| Wave | Window | Agents | Work packages |
| --- | --- | ---: | --- |
| 0 | 0:00-0:30 | 1 | **A**. Then `pnpm install && pnpm typecheck && pnpm test` must be green. |
| 1 | 0:30-3:30 | 4-5 | **B, C, E, I** in parallel. Agent that finished A joins. |
| 2 | 3:00-6:00 | 4-5 | **D** (core ready), **F** (starts on interfaces, implements as B/C/D/E land). |
| 3 | 5:30-8:30 | 3-4 | **G, H, J** in parallel against the agent runtime. |
| 4 | 8:00-10:00 | 1-2 | **K** integration, e2e test, record the demo. |

Waves overlap deliberately (interface-first). Wave 2 begins before Wave 1 fully ends.

---

## 5. Agent assignment

Flexible — adjust to how many of each you have. Suggested split:

| Agent | Best for | Suggested WPs |
| --- | --- | --- |
| **Codex** (VPS, sandboxed, PR-first) | well-scoped, contained, deterministic packages | A, B, C, E, I, H |
| **Claude Code** (PC, interactive) | integrative, judgment-heavy, cross-package wiring | D, F, G, J, K |

Codex handles the packages with crisp contracts and heavy unit testing. Claude Code
handles the detectors (domain judgment), the orchestrator (wiring), and the demo
(taste). With 6 agents, run 3 Codex + 3 Claude Code; with 4, run 2 + 2 and let Wave 3
reuse Wave 1 agents.

---

## 6. GitHub workflow

1. **Create the repo.** `gh repo create admatix --private --source=. --remote=origin`
   then `git add -A && git commit -m "chore: scaffold" && git push -u origin main`.
   (Nakul: paste the fine-grained PAT when prompted.)
2. **Branch per WP:** `wp/<id>-<slug>` — e.g. `wp/d-evidence-detectors`.
3. **Interface-first commit** lands on the branch and is pushed within the first 20
   minutes so dependents can pull the signatures.
4. **PR into `main`** when the WP's Definition of Done is met. The PR body pastes the
   acceptance-test output from the WP spec.
5. **Merge order:** A → (B, C, E, I) → D → F → (G, H, J) → K. A reviewer runs
   `pnpm install && pnpm typecheck && pnpm test` on the PR branch before merging.
6. **Integration checkpoint after each wave:** on `main`, run the full
   `pnpm typecheck && pnpm test`. Fix breakage before the next wave merges.
7. **Self-heal preamble** — every agent runs this before any git operation so
   credential ownership never blocks a push:

   ```bash
   sudo chown -R "$(whoami)" .git 2>/dev/null || true
   chmod -R u+rw .git 2>/dev/null || true
   ```

---

## 7. How to dispatch an agent

Give each agent exactly this, substituting the WP id:

```
You are building one work package of the AdMatix repo.

1. Read /AGENTS.md and docs/architecture/ARCHITECTURE-DEEP.md in full.
2. Read your work package: docs/build/WP-<ID>.md. It is your complete spec.
3. Run the git self-heal preamble, then create branch wp/<id>-<slug>.
4. First commit: publish src/index.ts with full exported signatures (stub bodies).
   Push immediately so dependents can typecheck against you.
5. Implement to the spec. Obey the ten golden rules in AGENTS.md.
6. Make every named acceptance test in the WP pass. Run `pnpm scan-secrets`.
7. Open a PR into main with the acceptance-test output pasted in the description.

Do not edit packages/schemas. Do not edit files outside your work package's
ownership list. Do not make live platform calls. Dry-run only.
```

---

## 8. Risk & fallback

| If... | Then... |
| --- | --- |
| Wave 1 slips | Hold Wave 3's WP-J (API/web). CLI + MCP + benchmark is the demo core. |
| A schema gap appears | Freeze it fast on `wp/schema-fix`, bump `SCHEMA_VERSION`, everyone rebases. Do not let WPs diverge. |
| An agent stalls on a package | Reassign the package; ownership is disjoint so handoff is clean. |
| `pnpm install` fails on a workspace | The owning WP's `package.json` is wrong — fix in that WP only. |
| Integration breaks at a wave checkpoint | Stop merging; the wave's last PR is the suspect. Revert, fix, re-merge. |

The demo must survive the day. Protect, in order: schemas (done) → core → evidence →
policy → agents → CLI → benchmark → MCP → API/web. Everything below "benchmark" is
cuttable for the YC application demo and recoverable in the post-application week.
