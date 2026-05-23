# CX-7 - Production Hygiene CI

Date: 2026-05-23
Branch: `codex/cx7-prod-hygiene-ci`

## Shipped Changes

- Added GitHub Actions CI at `.github/workflows/ci.yml`.
  - Pushes to `main` and `codex/**` now run CI, so future Codex work branches get immediate feedback.
  - Node job: install, `pnpm -r typecheck`, `pnpm exec turbo run test --concurrency=1`, build, secret scan, production dependency audit.
  - Python job: no-raw-dataset pytest for `services/ingest`, `services/simulator`, and `packages/evidence/test_pytest_smoke.py`, then installs verifier dependencies and runs `services/verifier/tests`.
- Added deterministic root scripts:
  - `pnpm test:python`
  - `pnpm test:python:core`
  - `pnpm test:python:verifier`
  - `pnpm audit:prod`
- Added production hard-fail coverage and implementation for:
  - `ADMATIX_API_TOKENS`: production boot rejects missing token config, demo default token keys, and empty production token maps.
  - `ADMATIX_APPROVAL_SECRET`: production signing rejects missing secret or the demo default.
- Upgraded `apps/api` Fastify from `^4.28.1` to `^5.8.3` and refreshed `pnpm-lock.yaml`.
  - Initial `pnpm audit --prod --audit-level=moderate` reported Fastify and fast-uri advisories.
  - Final audit output is clean.

No proof-dashboard files were changed. No CX-1 data-origin behavior was changed.

The branch also merged `codex/local-baseline-windows-demo-test` so it preserves the Windows `file://` verifier loader fix from the local baseline.

## Verification Output

### `pnpm install`

Exit code: 0

```text
Scope: all 12 workspace projects
Lockfile is up to date, resolution step is skipped
Already up to date

dependencies:
+ dotenv 17.4.2
+ pg 8.21.0

devDependencies:
+ @admatix/agents 0.1.0 <- packages\agents
+ @admatix/api 0.1.0 <- apps\api
+ @admatix/connectors 0.1.0 <- packages\connectors
+ @admatix/core 0.1.0 <- packages\core
+ @admatix/evals 0.1.0 <- packages\evals
+ @admatix/evidence 0.1.0 <- packages\evidence
+ @admatix/mcp-server 0.1.0 <- apps\mcp-server
+ @admatix/policy 0.1.0 <- packages\policy
+ @admatix/schemas 0.1.0 <- packages\schemas
+ @types/node 20.19.41
+ @types/pg 8.20.0
+ tsx 4.22.3
+ turbo 2.9.14
+ typescript 5.9.3
+ vitest 2.1.9

Done in 1.1s
```

### `pnpm -r typecheck`

Exit code: 0

```text
Scope: 11 of 12 workspace projects
packages/schemas typecheck: Done
packages/connectors typecheck: Done
packages/core typecheck: Done
packages/evals typecheck: Done
apps/web typecheck: Done
packages/policy typecheck: Done
packages/evidence typecheck: Done
packages/agents typecheck: Done
apps/cli typecheck: Done
apps/api typecheck: Done
apps/mcp-server typecheck: Done
```

### `pnpm exec turbo run test --concurrency=1`

Exit code: 0

```text
• Packages in scope: @admatix/agents, @admatix/api, @admatix/connectors, @admatix/core, @admatix/evals, @admatix/evidence, @admatix/mcp-server, @admatix/policy, @admatix/schemas, @admatix/web, admatix
• Running test in 11 packages
• Remote caching disabled, using shared worktree cache

@admatix/web:test:
Test Files  3 passed (3)
Tests       7 passed (7)

Root vitest workspace runs:
Test Files  31 passed | 2 skipped (33)
Tests       226 passed | 2 skipped (228)

Tasks:    18 successful, 18 total
Cached:    18 cached, 18 total
Time:    311ms >>> FULL TURBO
• turbo 2.9.14
```

Note: the existing React `act(...)` warning in `apps/web/src/components/ApprovalQueue.test.tsx` still appears in the cached test log, but the command exits 0.

### `pnpm exec turbo run build`

Exit code: 0

```text
• Packages in scope: @admatix/agents, @admatix/api, @admatix/connectors, @admatix/core, @admatix/evals, @admatix/evidence, @admatix/mcp-server, @admatix/policy, @admatix/schemas, @admatix/web, admatix
• Running build in 11 packages
• Remote caching disabled, using shared worktree cache

@admatix/web:build:
vite v5.4.21 building for production...
✓ 62 modules transformed.
✓ built in 1.40s

Tasks:    11 successful, 11 total
Cached:    11 cached, 11 total
Time:    254ms >>> FULL TURBO
• turbo 2.9.14
```

### `pnpm run test:python:core`

Exit code: 0

```text
> admatix@0.1.0 test:python:core C:\Users\nakul\OneDrive\Documents\Claude\Projects\admatix-codex-wt\cx7-hygiene
> python -m pytest services/ingest/tests services/simulator/tests packages/evidence/test_pytest_smoke.py

============================= test session starts =============================
platform win32 -- Python 3.12.1, pytest-8.3.5, pluggy-1.6.0
rootdir: C:\Users\nakul\OneDrive\Documents\Claude\Projects\admatix-codex-wt\cx7-hygiene
plugins: anyio-4.13.0
collected 45 items

services\ingest\tests\test_ingest.py .......                             [ 15%]
services\simulator\tests\test_robustness_worlds.py ..................... [ 62%]
.                                                                        [ 64%]
services\simulator\tests\test_simulator.py ...............               [ 97%]
packages\evidence\test_pytest_smoke.py .                                 [100%]

============================= 45 passed in 3.56s ==============================
```

### `pnpm run test:python:verifier`

Exit code: 0

```text
> admatix@0.1.0 test:python:verifier C:\Users\nakul\OneDrive\Documents\Claude\Projects\admatix-codex-wt\cx7-hygiene
> python -m pytest services/verifier/tests

.......................................                                  [100%]
39 passed in 60.49s (0:01:00)
```

### `pnpm scan-secrets`

Exit code: 0

```text
> admatix@0.1.0 scan-secrets C:\Users\nakul\OneDrive\Documents\Claude\Projects\admatix-codex-wt\cx7-hygiene
> tsx scripts/scan-secrets.ts

scan-secrets: no token-shaped secrets found.
```

### `pnpm audit --prod --audit-level=moderate`

Exit code: 0

```text
No known vulnerabilities found
```
