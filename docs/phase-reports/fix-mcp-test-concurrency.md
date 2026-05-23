# fix/mcp-test-concurrency

## Summary

Fixed the MCP stdio integration test flake seen under concurrent workspace test
runs. The stdio test starts a real `tsx` child process for
`apps/mcp-server/src/server.ts`; under `pnpm -r test`, the repo-level Vitest
config causes that test file to run from multiple workspace test processes at
the same time. The concurrent child servers could contend under load and hit MCP
stdio request timeouts.

## Changes

- Added a cross-process lock around the stdio integration test so only one MCP
  stdio child server is exercised at a time.
- Added explicit MCP request timeouts for the stdio client calls to tolerate
  parallel CI load.
- Wrapped the stdio client lifecycle in `try/finally` so the client transport is
  closed whether the test succeeds or fails before connection completes.
- Kept the change scoped to `apps/mcp-server/src/server.test.ts`; no product
  server behavior changed.

## Verification

- `pnpm install` passed.
- `pnpm --filter @admatix/mcp-server typecheck` passed.
- `pnpm --filter @admatix/mcp-server test` passed.
- `pnpm -r test` passed three consecutive times.
- `pnpm exec turbo run test --concurrency=1` passed.

Notes:

- The existing web test suite still emits the known React `act(...)` warning in
  `ApprovalQueue.test.tsx`; it does not fail the run.
- Turbo replayed cache for some unchanged packages during the serial run, while
  `@admatix/mcp-server:test` executed as a cache miss from this worktree and
  passed.
