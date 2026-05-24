# Diligence Code Hardening Report

Date: 2026-05-24  
Branch: `codex/diligence-code-hardening`

## What Was Hardened

- Python tests now have a repo-owned setup and execution path:
  `pnpm run setup:python` creates service-local venvs and
  `pnpm run test:python` runs pinned service tests with explicit `PYTHONPATH`.
- Approval receipts now bind more state into the HMAC payload:
  `receipt_id`, `packet_id`, `action_id`, `decided_by`, `role`,
  `decided_at`, `expires_at`, and `decision`.
- Activation rejects receipts that are unsigned, malformed, expired,
  not stored, action-mismatched, or already used for a prior execution diff.
- The platform adapter now derives deterministic action ids from H0 packets,
  making the receipt/action binding check meaningful.
- Dry-run diffs fail closed when before-state is missing or the connector does
  not yet provide exact platform semantics for the action type.
- MCP tool schemas now have explicit prompt-bypass regression coverage.
- Connector redaction utilities now redact common OAuth/API-key/token/password
  fields recursively before future live connector logs or sync metadata use
  those payloads.

## Already Covered Before This Patch

- API bearer-token identity already overrode body-supplied `decidedBy` and
  `role`.
- Production API startup already failed closed on missing/default demo tokens.
- Dashboard proof claims already separated artifact-backed data from demo views.
- GitHub CI already ran Node, dashboard, and Python service tests; this patch
  makes the local and CI Python paths use the same repo-owned runner.

## Still Future Live-Pilot Work

- No live ad-account writes exist in this codebase.
- Live OAuth connectors still need scoped credential storage, rotation, sync
  freshness checks, and operator approval review before any customer pilot.
- Exact dry-run semantics for bids, negative keywords, and creative rotation
  should be re-enabled only after connector snapshots include the relevant
  before-state for each platform.
- Replay protection is enforced at the Store/read-before-write layer for the
  current MVP. A production database deployment should also add unique
  constraints around action activation records.

## Verification

Focused regression tests were added for:

- Approval receipt payload tampering, expiry, and malformed signatures.
- Duplicate API approvals.
- Stored receipt requirement, action mismatch, and replay rejection.
- Exact diff refusal for missing budget/status and unsupported action types.
- MCP strict-schema bypass attempts.
- Recursive connector secret redaction.
