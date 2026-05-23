# WP-H MCP Server Report

Branch: `wp/h-mcp`

## What Shipped

- Added `@admatix/mcp-server` under `apps/mcp-server`.
- Registered exactly six MCP tools over stdio:
  - `audit_account`
  - `create_plan`
  - `show_h0_packet`
  - `validate_h0_packet`
  - `activate_dry_run`
  - `run_benchmark`
- Tool inputs use strict Zod validation; unknown input fields are rejected.
- Tool outputs are validated envelopes containing `trace_id`, `source_refs`,
  `risk_level`, `status`, and typed payload data.
- `activate_dry_run` requires an approved `approval_receipt`; otherwise it returns
  a `blocked` response. Approved calls return only an `ExecutionDiff` with
  `dry_run: true`.
- Added MCP client configuration docs in `apps/mcp-server/README.md`.

## Acceptance Tests

Named WP-H acceptance coverage is in `apps/mcp-server/src/server.test.ts`:

1. Tool list contains only the six approved tools.
2. Unknown tool calls return an MCP structured error and the server remains alive.
3. `activate_dry_run` without an approval receipt returns `blocked`.
4. Every direct tool output validates against the envelope schema and carries a
   `trace_id`.
5. A stdio MCP client runs audit -> plan -> blocked dry-run -> approved dry-run.

## Verification Output

```text
pnpm install
Already up to date

pnpm -r typecheck
packages/schemas typecheck: Done
packages/connectors typecheck: Done
packages/core typecheck: Done
packages/policy typecheck: Done
packages/evals typecheck: Done
packages/evidence typecheck: Done
packages/agents typecheck: Done
apps/mcp-server typecheck: Done

pnpm -r test
apps/mcp-server test: Test Files 23 passed (23)
apps/mcp-server test: Tests 152 passed (152)
All recursive package test tasks completed successfully.

python3 -m venv .venv && . .venv/bin/activate && python -m pip install --upgrade pip pytest && pytest
packages/evidence/test_pytest_smoke.py . [100%]
1 passed in 0.04s

pnpm scan-secrets
scan-secrets: no token-shaped secrets found.
```
