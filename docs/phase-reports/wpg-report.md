# WP-G CLI Report

## Shipped

- Added `apps/cli` as the `admatix` package with a Commander-based CLI.
- Implemented `init`, `doctor`, `fixtures seed`, `audit`, `plan`, `packet show`,
  `activate`, `approve`, `measure`, `reflect`, `rollback`, `benchmark run`, and
  `report build`.
- Kept activation dry-run only. `activate` refuses without `--dry-run`; dry-run
  activation produces an `ExecutionDiff` and never calls a platform write path.
- Added JSON output support for every command plus actionable JSON errors.
- Added CLI acceptance coverage and a golden audit snapshot.

## Acceptance Results

- `admatix audit --account fixture:agency-demo --json`: valid JSON, 3 findings.
- `admatix activate h0_001 --dry-run`: dry-run diff with 1 change; decision
  `needs_approval`; `dry_run: true`.
- `admatix activate h0_001` without `--dry-run`: refused with non-zero exit and
  `dry_run_required`.
- Invalid fixture account: refused with non-zero exit and an actionable
  `unknown_fixture_account` fix.
- `admatix benchmark run --suite safety-v1`: printed scorecard, 12/12 passed.

## Verification

```text
pnpm install
Done in 1s; lockfile up to date.

pnpm -r typecheck
All 8 workspace projects passed.

pnpm -r test
All recursive Vitest runs passed; each run reported 23 test files and 152 tests.

python3 -m venv .venv && . .venv/bin/activate && python -m pip install --upgrade pip pytest && pytest
1 passed.

pnpm scan-secrets
scan-secrets: no token-shaped secrets found.
```
