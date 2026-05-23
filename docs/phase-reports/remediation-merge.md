# Remediation merge — land three remediation branches onto `main`

Branch: `fix/remediation-merge`, cut off `origin/main` at HEAD
`5b51427` (end of Phase 3 / WP-S merge).

The three branches below were fully built, fully tested, but never
landed before Phase 3 closed. Phase 4 would have graded the verifier
against a still-broken simulator and an un-hardened Phase-1 surface.
This branch merges them in dependency order, resolves the conflicts
introduced by WP-S cutting in between, and re-runs the full
verification suite.

---

## Branches merged (in order)

1. **`origin/fix/sim-readiness`** (5 commits, clean merge)
   * findings #1–#3 (critical) — simulator root-cause rewrites of
     outcome, assignment, and panel; `confound_strength=0` is now
     honored verbatim (no falsy `or` fallback).
   * findings #6–#8 (high) — ingest checksums, pinned hashes,
     partial-cache rejection.
2. **`origin/fix/mcp-test-concurrency`** (1 commit, 1 conflict)
   * Serialises the MCP stdio integration test behind a filesystem
     lock to stop the two suites that boot stdio servers from
     trampling each other.
3. **`origin/fix/phase1-hardening`** (12 commits, 2 explicit
   conflicts + 3 auto-merged "both touched" files that needed
   semantic re-review)
   * F1–F13: HMAC-signed approval receipts, mandatory PolicyGuard on
     `activate_dry_run`, bearer-token auth + tenant isolation on the
     API, `ADMATIX_MODE=fixtures` enforced at every entry point,
     EvidenceLedger source-of-truth ref resolution, `runActivation`
     entry point for human-approved activation, fail-closed policy
     gate exhaustiveness, account/connector miss fail-closed, and
     several deterministic-id / off-by-one fixes.

---

## Conflict resolutions

Doctrine: every conflict exists because the `fix/*` branches were cut
**before** WP-S landed. In every conflict, **both** intents must
survive — the security hardening **and** the WP-S verifier wiring.
No side is dropped.

### Branch 2 — `fix/mcp-test-concurrency`

| File | Conflict | Resolution |
|------|----------|------------|
| `apps/mcp-server/src/server.test.ts` | stdio test body conflicts: HEAD asserts `APPROVED_TOOL_NAMES.filter(n!=="verify")` (WP-S gates `verify` behind `deps.verifierClient`); branch wraps the test in `withStdioTestLock` with explicit `requestOptions` timeouts. | Hand-wrote the union — kept the lock wrapper **and** the WP-S `verify`-filter assertion. Confirmed the lock helpers (`withStdioTestLock`, `acquireStdioTestLock`, `isErrnoException`) survive at the bottom of the file. |

### Branch 3 — `fix/phase1-hardening`

**Explicit conflicts (`<<<<<<<` markers):**

| File | Conflict | Resolution |
|------|----------|------------|
| `apps/mcp-server/src/server.test.ts` | Same stdio test body; phase-1 also adds `signApprovalReceipt` import + a `signedReceipt(...)` helper and updates every `approval_receipt` shape to be HMAC-signed. | Union: kept the lock wrapper + WP-S verify-filter + phase-1's signed receipt. The stdio test's `approval_receipt` is now `signedReceipt({...})`. Both helper functions (`withStdioTestLock` and `signedReceipt`) live at the bottom of the file. |
| `packages/agents/src/orchestrator.ts` (zone 1, ~line 124) | HEAD declared `const evidenceLedger = makeEvidenceLedgerAgent({ traceId })` early **and** WP-S's `measurementScientist` factory threading `verifierClient`. Phase-1's F2 deferred the EvidenceLedger creation until after campaigns + daily metrics load so the resolver can be wired in. | Dropped HEAD's early `evidenceLedger` declaration (it is redefined further down with `resolver: evidenceResolver` per phase-1's F2 design) and kept WP-S's `measurementScientist` factory spreading `deps: { verifierClient }`. |
| `packages/agents/src/orchestrator.ts` (zone 2, end of file) | HEAD had WP-S's `buildOutcomeMeasurement` + `canonicalVerifierPayload` helper functions. Phase-1 had the new exported `runActivation` (F6's human-approved activation entry point). | Kept **both** blocks: the WP-S helpers AND the exported `runActivation`. Independent functions, both belong on `main`. |

**Auto-merged "both touched" files re-read and confirmed coherent:**

| File | Both-side intents preserved? | Notes |
|------|------------------------------|-------|
| `apps/mcp-server/src/server.ts` | Yes — F8 `assertFixturesMode()` call **and** WP-S `VerifierClient` import both present. | Auto-merge correct. |
| `packages/agents/src/index.ts` | Yes — `runActivation` re-export (phase-1) **and** `createVerifierClient` / `VerifierClient` type re-exports (WP-S) both present. | Auto-merge correct. |
| `scripts/demo.ts` | Yes — phase-1's Bearer auth on `/api/v1/*` injects, removal of the legacy `aliasPackets` budget-units shim (F3/F4 made it unnecessary), **and** WP-S's `verify`-filter in step 7. | Auto-merge correct. WP-S's filter at `step7Mcp` survives at line 369. |

---

## Composition fix — `fix(orchestrator): defer verifier emit so F6 + WP-S compose`

After landing all three branches, the Phase 3 e2e gate
(`tests/e2e/phase3-gate.test.ts`) failed:

```
AssertionError: expected -1 to be greater than or equal to 0
  at tests/e2e/phase3-gate.test.ts:173:29
    const verifiedIdx = types.indexOf("measurement.verified");
    expect(verifiedIdx).toBeGreaterThanOrEqual(0);
```

### Root cause

A real composition conflict that the two original branches could not
have anticipated:

* **F6** (`fix/phase1-hardening`) added `if (decision.result ===
  "needs_approval") { ...; continue; }` to the per-packet loop.
  Per `ARCHITECTURE-DEEP §7`, an H0 packet must reach `approved`
  before any `ExecutionDiff` is built; `runWorkflow` now stops the
  loop iteration at `needs_approval` and waits for `runActivation`.
* **WP-S** placed the `measurement.verified` emit at the **bottom**
  of that same loop body — after `diff.built`.

The Phase 3 e2e test materialises a `clean_ab` world (verifier returns
`lift_detected` with CI containing the true lift of 0.04) and runs
`runWorkflow` against it. The first H0 packet produced by
`makeTestEvidenceDeps()` is a `budget_shift` (spend-touching), which
PolicyGuard routes to `needs_approval`. F6's `continue` short-circuits
the iteration before WP-S's `measurement.verified` emit fires →
`verifiedIdx === -1` → test red.

Both intents are valid in isolation. Both must survive the
composition.

### Resolution

`packages/agents/src/orchestrator.ts`:

1. Added `const pendingVerifications: { packetWithApproval; verification }[] = []`
   at loop top.
2. In every policy branch (`block`, `needs_approval`, `allow`),
   when `verification` is present, push `{ packetWithApproval,
   verification }` onto `pendingVerifications` (replacing the old
   in-loop persist+emit for the `allow` branch).
3. After the loop, drain `pendingVerifications`: for each entry
   call `buildOutcomeMeasurement`, `store.put("outcome_measurements",
   ...)`, emit `measurement.verified` with
   `sha256(canonicalVerifierPayload(verification))`, and push
   `verification.verdict` to `verifierVerdicts` (which Reflect maps
   into the trust update).

### Why this preserves both intents

* **F6**: no `ExecutionDiff` is built in `runWorkflow` for
  `needs_approval` packets — the `continue` and the existing
  `runActivation` entry point both stay byte-for-byte identical.
  F6's regression test (`F6: runWorkflow stops at needs_approval —
  does NOT build a diff for budget_shift packets that need approval`)
  still passes.
* **WP-S**: every verified packet still produces an
  `OutcomeMeasurement` row whose five required-for-round-trip fields
  (estimate, ci_low, ci_high, method, verdict) recover the verifier's
  response unchanged, and the `measurement.verified` event still
  carries `payload_hash = sha256(canonicalVerifierPayload(...))`.
  WP-S's §Acceptance 8 ordering constraint
  (`measurement.verified` appears after `diff.built` in the workflow's
  event stream) is satisfied for any mixed run that contains at least
  one allow-path packet — which is the Phase 3 e2e test case (3
  no_op packets in the same run are policy-allowed and reach
  `diff.built` before the post-loop drain emits
  `measurement.verified`).

The verifier's call itself was always observational (it ran during
`MeasurementScientist.review` at the **top** of the loop iteration,
before any of the policy/diff machinery). Deferring only the
**persistence + event emit** is the smallest change that lets F6's
no-diff guarantee and WP-S's verifier emit coexist.

---

## Verification

All commands run from the worktree root `/opt/admatix-wt/remediation`
with the orchestrator cron locked out for the full session.

| Step | Command | Result |
|------|---------|--------|
| 1 | `pnpm install` | ✓ 12 workspace projects, lockfile up to date |
| 2 | `pnpm -r typecheck` | ✓ all 11 packages with tsconfigs green |
| 3 | `pnpm exec turbo run test --concurrency=1` | ✓ **223 passed**, 1 skipped (`packages/core/src/store-supabase.test.ts` — Supabase, expected), Phase 3 e2e gate green |
| 4 | `pnpm scan-secrets` | ✓ no token-shaped secrets found |
| 5 | `pnpm tsx scripts/demo.ts` | ✓ exit 0, step 5 BLOCKS the unsafe 60% budget shift against the 20% cap |
| 6 | `services/simulator/.venv/bin/python -m pytest tests -q` | ✓ 15 passed |
| 6 | `services/ingest/.venv/bin/python -m pytest tests -q` | ✓ 7 passed |
| 6 | `services/verifier/.venv/bin/python -m pytest tests -q` | ✓ 26 passed (incl. `test_coverage_on_simulator` = Phase 3 coverage gate) |
| 7 | `services/simulator/.venv/bin/python -m pytest tests -q -k determinis` ×2 | ✓ identical pass both runs — simulator is deterministic |
| 8 | `grep -rn confound_strength services/simulator/src` | ✓ no `or`/`||` falsy fallback; `confound_strength=0` honored verbatim (`__init__.py:141 c = float(config.confound_strength)`) |

Phase 3 e2e gate (`tests/e2e/phase3-gate.test.ts`) is now green —
end-to-end loop boots `services/verifier`, materialises a clean_ab
world via `/simulate`, runs `runWorkflow` with the real verifier,
asserts exactly one `OutcomeMeasurement` row, round-trips the
verifier response, and confirms `ci_low ≤ 0.04 ≤ ci_high`.

---

## Commit history landing on `main`

```
b7e2bb0 fix(orchestrator): defer verifier emit so F6 + WP-S compose
5e52a35 merge fix/phase1-hardening — F1-F13 critical/high security fixes
7e333e3 merge fix/mcp-test-concurrency — serialize stdio integration test
941c531 merge fix/sim-readiness — Phase 1 critical fixes for simulator (#1-3) and ingest integrity (#6-8)
5b51427 (origin/main, prior HEAD)
```

The remediation merge is fast-forward only against `origin/main`
(the orchestrator cron held its lock for the full session, so
`main` did not move).
