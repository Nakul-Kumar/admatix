# Ops Runtime Sync Report

Status: CI runtime branch implementation  
Date: 2026-05-25

## What Changed

- Updated GitHub Actions workflow jobs to Node 24-compatible actions:
  - `actions/checkout@v6`
  - `actions/setup-node@v6`
  - `actions/setup-python@v6`
  - `pnpm/action-setup@v6`
- CI Node jobs now install and test on Node 24.
- The Python service job now explicitly installs Node 24 before running pnpm
  helper scripts, instead of relying on the runner's ambient Node.
- The dashboard job now installs pnpm explicitly before using Node/npm tooling.

## Why

GitHub Actions is warning that Node 20-based JavaScript actions are being
deprecated. The fix is to move the action runtime to Node 24-compatible action
majors and test the repo under Node 24 in CI, while still allowing local
developers on Node 20+ until the product code itself requires a higher runtime.

## VPS And Dashboard Verification

The VPS was fast-forwarded from `0a134d5` to `9a5736a` before this branch was
merged. The secrets file exists at `/opt/admatix/.build/secrets.env`; values were
not printed.

VPS gates run on `/opt/admatix`:

- `CI=true pnpm install --frozen-lockfile --reporter=append-only` -- passed.
- `pnpm -r typecheck` -- passed.
- `pnpm exec turbo run test --concurrency=1` -- passed.
- `pnpm scan-secrets` -- passed.
- `pnpm audit:prod` -- passed.
- `pnpm test:python` -- passed for ingest, simulator, verifier, and validation.
- `pnpm demo` -- passed, 8/8 demo checks.

Dashboard gates run on `/opt/admatix/proof-dashboard`:

- `npm ci` -- passed after fixing root-owned `/opt/agentforge/.npm` cache
  ownership.
- `npm run validate:origin` -- passed.
- `npm run check:data` -- passed.
- `npm run typecheck` -- passed.
- `npm run build` -- passed.
- `npm run check:render` -- passed; `/benchmark` renders four line paths.

The fresh `proof-dashboard/dist/` matched `/var/www/admatix`, so no redeploy was
needed. Caddy was backed up, reformatted, reloaded, and cleaned up to remove the
deprecated `basicauth` spelling plus redundant `header_up X-Forwarded-*` lines.
`https://admatix.tech/`, `https://admatix.tech/artifacts`, and
`https://www.admatix.tech/artifacts` returned `200`; protected Cockpit and
`:8090` routes still returned `401` without credentials.
