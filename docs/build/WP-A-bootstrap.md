# WP-A — Bootstrap finalize

**Owns:** `vitest.config.ts`, `.npmrc`, `scripts/seed-fixtures.ts`, `scripts/scan-secrets.ts`, `docs/research/legacy-source-map.md`
**Branch:** `wp/a-bootstrap` · **Wave:** 0 · **Depends on:** scaffold (present)
**Suggested agent:** Codex · **Size:** small (~30 min, then this agent joins Wave 1)

## Goal
Make `pnpm install && pnpm typecheck && pnpm test` green so every other work package
can start. The root config, `@admatix/schemas`, fixtures, and `scripts/doctor.ts`
already exist — **do not modify them**. WP-A only adds what is missing.

## Files to create
- `vitest.config.ts` — workspace-wide Vitest config (projects glob `packages/*`, `apps/*`).
- `.npmrc` — `auto-install-peers=true`, `strict-peer-dependencies=false`.
- `scripts/seed-fixtures.ts` — loads every file in `data/fixtures/`, validates it against
  `@admatix/schemas`, prints a count; exits non-zero on any invalid fixture.
- `scripts/scan-secrets.ts` — greps the tree (excluding `node_modules`, `.git`, `dist`)
  for token-shaped strings (OAuth tokens, `sk-`, `AIza`, long base64); exits non-zero on a hit.
- `docs/research/legacy-source-map.md` — a table mapping each new package to which old
  repo (`chappieforge-cockpit`, `matix-agent-builder-public`, `solenode`) informed it.
  Pull the mapping from the master plan §3.1. Legacy names appear **only** in this file.

## Contract
Imports `@admatix/schemas` in `seed-fixtures.ts` for validation. Exports nothing.

## Acceptance tests
1. `pnpm install` completes with no error.
2. `pnpm -F @admatix/schemas test` is green (3+ tests pass).
3. `pnpm typecheck` passes for the workspace.
4. `pnpm doctor` exits 0.
5. `pnpm seed-fixtures` validates all fixtures and exits 0.
6. `pnpm scan-secrets` exits 0 on the clean tree.

## Definition of Done
Acceptance tests pass + the global DoD in `/AGENTS.md`. PR into `main` first — it
unblocks every other wave.

## Dispatch
Use the generic dispatch prompt in `00-BUILD-ORCHESTRATION.md` §7 with `<ID>=A`.
