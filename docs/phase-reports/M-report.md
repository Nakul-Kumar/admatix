# WP-M — Store on Supabase — Phase Report

**Branch:** `wp/m-store-supabase` · **Phase:** 2 · **Wave:** 1
**Spec:** `docs/build/WP-M-store-supabase.md`
**Status:** Shipped. Acceptance #1, #2, #3, #5 green; #4 deferred (notes below).

## What shipped

| File | Change |
| --- | --- |
| `packages/core/src/store-supabase.ts` | **NEW** — `createSupabaseStore({ connectionString, … })` returning a `Store`. Implements `put` (`INSERT … ON CONFLICT (id) DO UPDATE`), `get` (`SELECT body FROM <appSchema>.<collection> WHERE id = $1`), `list` (id-ASC ordering; jsonb-containment pushdown for scalar `{key:value}` filters; in-memory fallback otherwise), and `append` (routes to `<ledgerSchema>.action_events` with tenant_id, event_type, step, payload, payload_hash; trigger computes entry_hash / prev_hash). Lazy `pg.Pool`; sslmode pre-strip so the explicit `rejectUnauthorized: false` survives pg's connectionString override; graceful shutdown on exit/SIGINT/SIGTERM. |
| `packages/core/src/store-supabase.test.ts` | **NEW** — opt-in vitest suite. Skips with a clear message when `SUPABASE_DB_URL` is unset; against the live Supabase project provisions its own `admatix_test_app_<uniq>` + `admatix_test_ledger_<uniq>` schemas (never touches live data), runs all 10 acceptance scenarios, then drops the schemas in `afterAll`. |
| `packages/core/src/store.ts` | **EXTENDED** — `createStore()` and `createStore(rootDir)` continue to return the filesystem store unchanged. New options-object call `createStore({ backend: "supabase", connectionString, … })` selects Supabase. Env-driven routing: `ADMATIX_STORE=supabase` + `SUPABASE_DB_URL` transparently makes the zero/positional call return the Supabase store with no caller change. |
| `packages/core/src/index.ts` | Public surface: re-exports `createSupabaseStore` and the `SupabaseStoreOptions` / `CreateStoreOptions` types. The `Store` interface itself is unchanged. |
| `packages/core/package.json` | Adds `pg ^8.13.0` to dependencies and `@types/pg ^8.11.10` to devDependencies. `pg` is loaded via dynamic `import("pg")` so consumers that stay on the filesystem backend incur no runtime cost. |
| `pnpm-lock.yaml` | Regenerated for the new deps. |

`packages/schemas/**` is untouched. No other workspace package changed.

## Contract preserved

- The `Store` interface in `packages/core/src/store.ts` is identical: same
  four methods, same generics, same return types.
- `createStore()` with no arguments still returns the filesystem store rooted
  at `./data`.
- `createStore(rootDir)` (positional string) still returns the filesystem
  store rooted at `rootDir`.
- Every existing caller (`@admatix/agents`, `@admatix/policy`, `apps/api`,
  `apps/cli`, `apps/mcp-server`, the eval harness, the demo script) keeps
  compiling and keeps passing its tests untouched.

## Verification

### `pnpm -r typecheck`

Green across all 11 typechecked workspace projects:

```
Scope: 11 of 12 workspace projects
../schemas typecheck: Done
../../apps/web typecheck: Done
. typecheck: Done                  (packages/core)
../evals typecheck: Done
../connectors typecheck: Done
../policy typecheck: Done
../evidence typecheck: Done
../agents typecheck: Done
../../apps/cli typecheck: Done
../../apps/api typecheck: Done
../../apps/mcp-server typecheck: Done
```

### `pnpm -r test` with `SUPABASE_DB_URL` **unset** (acceptance #2)

```
 Test Files  27 passed | 1 skipped (28)
      Tests  175 passed | 1 skipped (176)
```

The Supabase suite skips with the message
*"skipped — set SUPABASE_DB_URL to run the Supabase round-trip suite"*; all
pre-existing tests stay green.

### `pnpm --filter @admatix/core test` with `SUPABASE_DB_URL` set (acceptance #3)

Run against project Solenode (`vmpclnajlyjywqyuifmj`), us-west-1, Postgres 17:

```
 ✓ packages/core/src/store-supabase.test.ts (10 tests) 5277ms
   ✓ round-trips put → get                                              747ms
   ✓ returns null for missing keys
   ✓ upserts on the same id (ON CONFLICT … DO UPDATE)
   ✓ lists all docs in a collection in id-ascending order               328ms
   ✓ list filters via jsonb containment pushdown
   ✓ list falls back to in-memory filter for non-scalar predicates
   ✓ append writes a ledger row and the server computes hash chaining
   ✓ rejects an append whose payload_hash does not match the canonical payload (negative case)
   ✓ createStore({ backend: 'supabase', … }) returns the same backend
   ✓ env-based selection: ADMATIX_STORE=supabase + SUPABASE_DB_URL routes via createStore()

 Test Files  28 passed (28)
      Tests  185 passed (185)
```

### `pnpm scan-secrets`

```
scan-secrets: no token-shaped secrets found.
```

### Phase-1 demo with the filesystem store

```
$ pnpm tsx scripts/demo.ts
…
Demo complete — 8/8 steps green, 1 unsafe action blocked, 3 findings, 3 H0 packets.
exit=0
```

## Acceptance-test status

| # | Acceptance criterion | Status |
| - | --- | --- |
| 1 | `pnpm -r typecheck` green | ✅ |
| 2 | `pnpm -r test` green when `SUPABASE_DB_URL` is unset; existing 175 tests stay green; Supabase suite skips with a clear message | ✅ |
| 3 | With `SUPABASE_DB_URL` set, `pnpm --filter @admatix/core test` runs the Supabase suite and all round-trip + ordering + filter + append tests pass | ✅ |
| 4 | Toggling `ADMATIX_STORE=supabase` and re-running the Phase 1 demo still exits 0 with the same logical transcript | ⚠️ **deferred — pending WP-L.** See note below. |
| 5 | No file in `packages/schemas/**` is modified | ✅ — `git diff --stat origin/main` touches only `packages/core/**` and `pnpm-lock.yaml` |

### Why acceptance #4 is deferred

The Phase-1 demo writes string-typed ids (`h0_001`, `audit_001`, …) into
collections such as `h0_packets` and `audit_reports`. The Supabase Store
matches the WP-M spec's literal contract — `INSERT … (id, body)` and `SELECT
body FROM <appSchema>.<collection>` — i.e. it expects each table to expose
at least `(id text PK, body jsonb)`. The actual `app.*` tables in WP-L's DDL
use `uuid` primary keys and many additional `NOT NULL` typed columns; until
WP-L's migration shape and the Store's `(id, body)` contract are reconciled
(either by adding a `body jsonb` column + relaxing the id type on the app
tables, or by updating the Store to map every collection to its typed
columns), the env-toggle demo cannot persist Phase-1 payloads against the
production schema. The WP-M spec explicitly anticipated this — "if WP-L
hasn't merged yet, … acceptance #3 will run after WP-L lands" — and the
same gating applies to acceptance #4.

What is verified today:
- The env-routing wiring itself: test 10
  (`env-based selection: ADMATIX_STORE=supabase + SUPABASE_DB_URL routes
  via createStore()`) creates a Store via `createStore()` under the env
  toggle, writes an h0 packet, and reads it back. The toggle works; the
  open issue is only the production-table column shape that WP-L will
  define.
- The filesystem demo still exits 0 (run above) when no env is set, so
  no regression was introduced to Phase 1.

## Operational notes for the orchestrator / WP-L

1. The Store sends `event_type` and `step` as plain text. Postgres coerces
   them to `ledger.event_type` / `ledger.workflow_step` enums at insert time
   when those columns are enum-typed in production, and accepts them
   directly in the test schema. No code change needed when WP-L's enums
   land.
2. `pg`'s `connectionString` parser `Object.assign`s the parsed config over
   the explicit `Pool({...})` options, which would clobber `ssl: {
   rejectUnauthorized: false }` whenever `sslmode=require` appears in the
   URL. The Store strips `sslmode=` from the URL before constructing the
   pool so the explicit `ssl` option survives. This is what makes the live
   Supabase connection succeed against its self-signed chain.
3. `pg_catalog.sha256(bytea) -> bytea` is used by the test trigger because
   the `admatix` role has no USAGE on the Supabase `extensions` schema (so
   `extensions.digest(…)` fails with `permission denied for schema
   extensions`). When WP-L's real ledger trigger lands, it should either
   live in a schema that holds USAGE on `extensions` (the DDL anticipates
   `public.admatix_sha256_jsonb` for this reason) or use `pg_catalog.sha256`
   directly.
4. The Store's `append` computes `payload_hash` over a **Postgres-canonical
   jsonb text rendering** of the payload (`pgJsonbCanonical`: length-then-lex
   key sort, `": "` and `", "` separators). This is what makes a strict
   trigger that checks `payload_hash = sha256(payload::text)` accept the
   client-supplied hash. WP-L's `admatix_sha256_jsonb(p)` helper computes
   the same value via `digest(convert_to(p::text, 'UTF8'), 'sha256')`.

## Commits on the branch

```
cadc7b9 test(core): Supabase Store round-trip + ledger trigger negative-case suite
c2742ed feat(core): add Supabase Postgres Store behind the existing interface
```

Both pushed to `origin/wp/m-store-supabase`.
