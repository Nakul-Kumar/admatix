# Chappie Patterns For AdMatix

## Decision

AdMatix should reuse Chappie's operating patterns, not its dirty VPS checkout or large route files.

The safe transfer is architectural:

- Public surfaces render safe previews and proof snapshots.
- Protected surfaces own ingestion, credentials, approvals, operator actions, and source-of-truth data.
- The browser never holds provider keys, database URLs, operator JWTs, or platform OAuth tokens.
- Deterministic readiness and policy checks run before any LLM summary or rerank.
- Every important operation carries a replayable `tx_id`.

## Public And Protected Split

AdMatix public surface:

- Landing page.
- Public proof dashboard.
- Artifact-backed `/artifacts` snapshot.
- Demo/illustrative pages clearly labeled as demo.

AdMatix protected surface:

- Connector credential references.
- Manual export persistence.
- H0 packet candidates from imported data.
- Approval queue.
- Dry-run diffs.
- Execution receipts.
- Outcome measurement.
- Rollback records.

The protected surface can follow the Chappie same-origin proxy pattern:

```text
browser -> /api/backend/* -> protected VPS API -> Supabase/Postgres
```

The proxy may hold an HttpOnly operator session. The browser must not receive raw backend credentials.

## Deterministic-First Readiness

Connector readiness should be computed before any model is allowed to summarize it:

- Credential reference type: `env:`, `vault:`, or `mcp:`, never raw token text.
- Source freshness.
- Schema completeness.
- Required columns present.
- PII/secret columns absent.
- Idempotency key present.
- Quality checks pass.
- Lineage fields present.
- Claim limit attached.

LLMs may explain or prioritize these results, but they must not override the readiness verdict.

## Source Catalog Pattern

AdMatix should maintain a protected source catalog similar to Chappie's artifact/source catalog:

| Source | First use | Claim type |
| --- | --- | --- |
| `google_ads` | read-only reporting preview | directional platform metrics |
| `meta_ads` | later read-only reporting preview | directional platform metrics |
| `shopify` | first-party orders/revenue | first-party outcome, not causal alone |
| `stripe` | first-party payments/revenue | first-party outcome, not causal alone |
| `ga4` | analytics/events import | attribution context, not causal alone |
| `csv` | manual exports | source provenance and smoke testing |
| `first_party` | revenue/gross margin truth | measurement input |

Each source needs:

- Scope and credential-reference policy.
- Last successful sync/import.
- Last quality status.
- Row count and checksum.
- Data freshness.
- Allowed claim limit.
- Cost and rate-limit notes.

## Operator Console Shape

The first private AdMatix operator console should be narrow:

1. Import health: manifests, row counts, checksums, quality checks.
2. Connector readiness: capabilities, scopes, credential ref type, last preview.
3. Directional findings: anomalies or opportunities from imported metrics.
4. H0 candidates: generated only after data quality passes.
5. Approval queue: human decision required before any live mutation.
6. Evidence log: `tx_id`, manifest id, packet id, decision id, diff id, outcome id.

This console is not a second public dashboard and should not use "live proof" language.

## What Not To Copy

Do not copy:

- Chappie's dirty VPS checkout.
- Chappie's large `agent_builder.py` wholesale.
- Chappie route files without extracting small services.
- Public Replit code into protected AdMatix logic.
- Any provider credential handling into browser code.
- Any model rerank path as a source of truth.

## Next Implementation Gate

After the manual export smoke passes, implement the protected operator console API with:

- `GET /api/v1/imports/manifests`
- `GET /api/v1/imports/manifests/:id`
- `POST /api/v1/ingest/audit`
- `GET /api/v1/connectors/capabilities`
- `POST /api/v1/connectors/preview`

All routes should require operator auth, return `tx_id`, redact credential references, and preserve `proof_ready=false` until a proof bundle is explicitly promoted.
