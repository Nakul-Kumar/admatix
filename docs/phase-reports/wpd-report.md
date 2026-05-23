# WP-D Evidence Report

Branch: `wp/d-evidence`

## Shipped

- Added `@admatix/evidence` with the public API from `ARCHITECTURE-DEEP.md`:
  `DetectorInput`, `Detector`, `detectors`, `runAudit()`, and `buildH0Packets()`.
- Implemented pure deterministic detectors for tracking, pacing, budget waste,
  creative fatigue, and supply path quality.
- Implemented audit aggregation with the required directional caveat and
  `total_estimated_waste`.
- Implemented H0 packet building for every high/medium finding with dry-run-only
  proposals, pending approval, guardrails, evidence refs, and rollback blocks.
- Added fixture-backed acceptance tests, detector positive/negative tests, evidence
  coverage tests, and input mutation tests.

## Verification

Commands run from `/opt/admatix-wt/wpd`:

```text
pnpm install
Done in 1.5s

pnpm -r typecheck
Scope: 6 of 7 workspace projects
packages/schemas typecheck: Done
packages/policy typecheck: Done
packages/evals typecheck: Done
packages/core typecheck: Done
packages/connectors typecheck: Done
packages/evidence typecheck: Done

pnpm -r test
Scope: 6 of 7 workspace projects
packages/evidence test: Test Files 17 passed (17)
packages/evidence test: Tests 131 passed (131)
All workspace package test scripts completed successfully.

python3 -m venv /tmp/admatix-wpd-venv && . /tmp/admatix-wpd-venv/bin/activate && python -m pip install --upgrade pip pytest && pytest
collected 1 item
packages/evidence/test_pytest_smoke.py . [100%]
1 passed in 0.05s

pnpm scan-secrets
scan-secrets: no token-shaped secrets found.
```

Named WP-D acceptance coverage:

- Each detector has one positive fixture and one negative fixture test.
- `budget-waste` flags `campaign_a` in `agency-demo`.
- Every emitted `Finding` has non-empty evidence and directional causal status.
- `runAudit` on `agency-demo` yields 3 findings and non-zero estimated waste.
- Every packet from `buildH0Packets` passes `H0Packet.parse` and contains rollback.
- Detector mutation test confirms inputs are unchanged.
