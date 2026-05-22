# Legacy Source Map

This file is the only place WP-A intentionally names legacy source projects.
The product code should use AdMatix names and contracts.

| New surface | Legacy influence | What carries forward |
| --- | --- | --- |
| `packages/schemas` | `chappieforge-cockpit` | Typed contracts, event discipline, tenant-aware records, and strict source-of-truth boundaries. |
| `packages/core` | `chappieforge-cockpit` | Deterministic metrics, trace IDs, content-addressed evidence, and replayable records. |
| `packages/evidence` | `matix-agent-builder-public` | Evidence-first recommendation framing, scored outputs, and transparent confidence labels. |
| `packages/policy` | `chappieforge-cockpit` | Approval gates, deny-by-default posture, audit events, and rollback discipline. |
| `packages/agents` | `matix-agent-builder-public` | Agent selection, tool routing, and human-readable execution plans. |
| `apps/cli` | `solenode` | Operator-first local workflows, doctor scripts, and dry-run command ergonomics. |
| `apps/mcp-server` | `matix-agent-builder-public` | Public-safe agent tooling exposed through narrow, typed surfaces. |
| `apps/api` | `chappieforge-cockpit` | Protected API pattern, source-of-truth writes outside the browser, and OpenAPI-ready contracts. |
| `apps/web` | `matix-agent-builder-public` | Demo-first UI, readable evidence cards, and approval-focused product storytelling. |
| `packages/evals` | `chappieforge-cockpit` | Benchmark harnesses, safety cases, and regression gates before promotion. |
