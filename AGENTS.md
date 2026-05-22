# AGENTS.md — conventions for every coding agent on AdMatix

Read this fully before writing code. It applies to Claude Code, Codex, and humans.
If a work-package spec in `docs/build/` conflicts with this file, this file wins.

## What AdMatix is

AdMatix is the evidence-gated operating layer for paid media. It audits ad accounts,
produces hypothesis-backed **H0 packets**, gates proposed changes against policy,
dry-runs platform diffs, and records provenance. The product feeling is agentic; the
internal behaviour is a governed operating system: router, specialists, policy guards,
adapters, an evidence store, and eval gates.

## The ten golden rules

1. **The schema package is the contract.** Every type and validator lives in
   `packages/schemas`. Never redefine an H0 packet, metric, action, or agent shape
   anywhere else. Import it. If a schema is wrong, fix it in `packages/schemas` and
   open a PR that flags every dependent.
2. **Fixtures first.** The 72-hour MVP runs entirely on `data/fixtures/`. No live
   platform calls. `ADMATIX_MODE=fixtures` is the only supported mode for the MVP.
3. **Dry-run only.** No code path may write to a real ad platform. `activate` produces
   a diff, never a mutation. Write scopes do not exist yet.
4. **Every claim has source refs.** Any metric, finding, or recommendation must carry
   `evidence_refs` pointing at concrete source rows. No source ref → it does not ship.
5. **Every proposed action has a rollback.** An action without a `rollback` block is
   invalid and must fail schema validation.
6. **Two mandatory gates.** `PolicyGuard` and `EvidenceLedger` are not optional. If
   either fails, the workflow stops. Fail closed, never open.
7. **Read tools and write tools are separate.** Never expose a write-capable tool
   through the MCP server or CLI without an approval receipt in the call path.
8. **Deterministic where possible.** Detectors, normalizers, diff builders, and
   adapters are pure and deterministic. The same fixture always produces the same
   output. LLM calls are confined to the agent-reasoning layer and are never required
   for the MVP — a rules engine covers it.
9. **No secrets, no raw PII.** Never commit `.env*`. Never log OAuth tokens. Never send
   user-level identifiers to an LLM. `pnpm scan-secrets` must pass before every PR.
10. **Pin everything in evals.** Every benchmark result records fixture version, code
    version, policy version, and model version (or `none`).

## Stack

- TypeScript everywhere. Node >= 20. pnpm workspaces + Turbo.
- Validation: **Zod** (re-exported from `packages/schemas`).
- Tests: **Vitest**. Web: React + Vite + Tailwind. CLI: `commander`.
- MCP: official TypeScript MCP SDK, stdio transport first.
- DB: Postgres + Drizzle — but the MVP persists to JSON/JSONL under `data/` and the
  DB layer is stubbed behind a `Store` interface so it can be swapped later.

## Repo layout

| Path | Owns |
| --- | --- |
| `packages/schemas` | The shared contract. Types + Zod validators. Depends on nothing. |
| `packages/core` | Normalization, impact math, fixture loader, the `Store` interface. |
| `packages/connectors` | Platform adapters. Fixture adapters first; read-only live later. |
| `packages/evidence` | Detectors, the H0 builder, the audit report builder. |
| `packages/evals` | Benchmark harness, scorers, baselines. |
| `packages/ui` | Shared React components. |
| `apps/cli` | The `admatix` command-line tool. |
| `apps/mcp-server` | The MCP server exposing safe tools to agents. |
| `apps/api` | The HTTP API (Fastify). |
| `apps/web` | The cockpit. |

## Coding conventions

- Each package: `package.json`, `tsconfig.json` (extends `../../tsconfig.base.json`),
  `src/index.ts` as the only public entry point.
- Internal imports use the workspace name (`@admatix/schemas`), never relative paths
  across package boundaries.
- Every exported function that crosses a package boundary takes and returns a
  schema-validated type. Validate inputs at the boundary with `.parse()`.
- Errors are actionable: say what failed, which fixture/account, and how to fix it.
- No `any`. No unchecked index access (tsconfig enforces it).

## Git workflow

- Branch per work package: `wp/<id>-<slug>` (e.g. `wp/c-evidence-detectors`).
- Conventional commits: `feat(evidence): add creative-fatigue detector`.
- Open a PR into `main` when the work package's Definition of Done is met. The PR
  description pastes the WP's acceptance-test results.
- Rebase on `main` before opening the PR. `packages/schemas` changes are reviewed
  first and merged before dependents.
- Before any push, every agent runs this self-heal preamble so credential ownership
  never blocks the push:

  ```bash
  sudo chown -R "$(whoami)" .git 2>/dev/null || true
  chmod -R u+rw .git 2>/dev/null || true
  ```

## Definition of Done (applies to every work package)

- `pnpm typecheck` passes for the package and its dependents.
- `pnpm test` passes; the WP's named acceptance tests are green.
- No secrets; `pnpm scan-secrets` clean.
- Public API matches the contract in the WP spec and `docs/architecture/`.
- The PR is open with acceptance-test output pasted in.
