# WP-H — MCP server

**Owns:** `apps/mcp-server/**`
**Branch:** `wp/h-mcp` · **Wave:** 3 · **Depends on:** schemas, agents, evidence, core
**Suggested agent:** Codex · **Size:** medium

## Goal
The MCP server — the "software for agents" surface. Any MCP-speaking AI agent can call
AdMatix's safe tools **without ever touching raw platform credentials**. Read-only in
the MVP; write-shaped tools return dry-run diffs only.

## Files to create
- `apps/mcp-server/package.json` — deps: MCP TypeScript SDK, workspace packages.
- `apps/mcp-server/tsconfig.json`.
- `apps/mcp-server/src/index.ts`, `apps/mcp-server/src/server.ts` — stdio transport.
- `apps/mcp-server/src/tools/` — `audit-account.ts`, `create-plan.ts`,
  `show-h0-packet.ts`, `validate-h0-packet.ts`, `activate-dry-run.ts`, `run-benchmark.ts`.
- `apps/mcp-server/src/*.test.ts`.

## Contract
Stdio transport first. Tools are the read-only subset of master plan §7.3.
- `audit_account`, `create_plan`, `show_h0_packet`, `validate_h0_packet`,
  `run_benchmark` are read-only; `activate_dry_run` returns an `ExecutionDiff` only.
- **No write tools are registered.** There is no tool that can mutate a platform.
- Every tool input and output is validated with Zod (re-exported from `@admatix/schemas`).
  Unknown input fields are rejected.
- Every tool response includes `trace_id`, `source_refs`, and `risk_level`.

## Build notes
Tools delegate to `@admatix/agents` (`runWorkflow`) and `@admatix/evidence`
(`runAudit`). The server is a thin, safe wrapper — it adds no domain logic.
Document the client config (how to register the server in an MCP client) in
`apps/mcp-server/README.md`.

## Acceptance tests
1. The advertised tool list contains only the six approved read-only tools.
2. Calling an unknown tool returns a structured error, not a crash.
3. A write-shaped request without an approval receipt returns a `blocked` response.
4. Every tool output validates against its schema and carries a `trace_id`.
5. The server starts and responds over stdio.

## Definition of Done
Acceptance tests pass + global DoD. An AI agent can run audit → plan → dry-run through
MCP with no platform credentials.

## Dispatch
Generic dispatch prompt, `<ID>=H`.
