---
generated_at: "2026-05-23T10:44:27.670Z"
source_database: "db.vmpclnajlyjywqyuifmj.supabase.co/postgres"
generator: "scripts/db/generate-dictionary.ts"
regenerate_with: "pnpm tsx scripts/db/generate-dictionary.ts"
---

# AdMatix Data Dictionary

This file is generated from PostgreSQL comments, dbt model/source descriptions, and dbt tests. Regenerate it with `pnpm tsx scripts/db/generate-dictionary.ts`.

## app.ad_accounts

A connected ad account on a specific platform. external_account_id is the platform-native id.

- Source lineage: source.admatix_warehouse.app.ad_accounts
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| ad_account_id | uuid | no | gen_random_uuid() | Surrogate primary key (UUID v4). | source.admatix_warehouse.app.ad_accounts | none recorded |
| tenant_id | uuid | no |  | Owning tenant (FK app.tenants). | source.admatix_warehouse.app.ad_accounts | none recorded |
| platform | ad_platform | no |  | Ad platform this account belongs to. | source.admatix_warehouse.app.ad_accounts | none recorded |
| external_account_id | text | no |  | Platform-native account id (e.g. Google Ads customer id). | source.admatix_warehouse.app.ad_accounts | none recorded |
| name | text | no |  | Human-readable account name. | source.admatix_warehouse.app.ad_accounts | none recorded |
| currency | character | no | 'USD'::bpchar | ISO-4217 currency code of the account. | source.admatix_warehouse.app.ad_accounts | none recorded |
| timezone | text | no | 'UTC'::text | IANA timezone of the account, used to align daily metrics. | source.admatix_warehouse.app.ad_accounts | none recorded |
| status | entity_status | no | 'active'::app.entity_status | Lifecycle status of the account. | source.admatix_warehouse.app.ad_accounts | none recorded |
| raw | jsonb | no | '{}'::jsonb | Lossless capture of unknown platform fields as jsonb. | source.admatix_warehouse.app.ad_accounts | none recorded |
| created_at | timestamp with time zone | no | now() | UTC creation timestamp. | source.admatix_warehouse.app.ad_accounts | none recorded |
| updated_at | timestamp with time zone | no | now() | UTC timestamp of the last mutation (maintained by trigger). | source.admatix_warehouse.app.ad_accounts | none recorded |

## app.agent_runs

Persisted state for a single agent run -- the replayable audit unit. Pins model, policy_version, tools and input/output hashes so a run can be deterministically replayed and verified.

- Source lineage: source.admatix_warehouse.app.agent_runs
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| agent_run_id | uuid | no | gen_random_uuid() | Surrogate primary key (UUID v4). | source.admatix_warehouse.app.agent_runs | none recorded |
| tenant_id | uuid | yes |  | Owning tenant (FK app.tenants). | source.admatix_warehouse.app.agent_runs | none recorded |
| h0_packet_id | uuid | yes |  | H0 packet the run contributed to (FK app.h0_packets). Nullable for non-packet runs. | source.admatix_warehouse.app.agent_runs | none recorded |
| agent_id | text | yes |  | Identifier of the agent that executed. | source.admatix_warehouse.app.agent_runs | none recorded |
| agent_version | text | yes |  | Version string of the agent implementation, pinned for reproducibility. | source.admatix_warehouse.app.agent_runs | none recorded |
| workflow_id | text | yes |  | Workflow instance id linking runs across steps. | source.admatix_warehouse.app.agent_runs | none recorded |
| tx_id | text | yes |  | AdMatix transaction id; preserved end-to-end. | source.admatix_warehouse.app.agent_runs | none recorded |
| trace_id | text | yes |  | Distributed trace id for cross-system correlation. | source.admatix_warehouse.app.agent_runs | none recorded |
| step | workflow_step | yes |  | Workflow phase: plan \| activate \| measure \| reflect. | source.admatix_warehouse.app.agent_runs | none recorded |
| model | text | yes | 'none'::text | Model id used, or "none" for deterministic agents. | source.admatix_warehouse.app.agent_runs | none recorded |
| policy_version | text | yes |  | Policy version in force during the run. | source.admatix_warehouse.app.agent_runs | none recorded |
| input_hash | character | yes |  | SHA-256 (hex) of the canonicalised run input. | source.admatix_warehouse.app.agent_runs | none recorded |
| output_hash | character | yes |  | SHA-256 (hex) of the canonicalised run output. | source.admatix_warehouse.app.agent_runs | none recorded |
| tools_allowed | ARRAY | yes | '{}'::text[] | Tools the agent was permitted to call. | source.admatix_warehouse.app.agent_runs | none recorded |
| tools_called | ARRAY | yes | '{}'::text[] | Tools the agent actually invoked. | source.admatix_warehouse.app.agent_runs | none recorded |
| source_refs | ARRAY | yes | '{}'::text[] | Evidence/source references the run consumed. | source.admatix_warehouse.app.agent_runs | none recorded |
| risk_level | risk_level | yes | 'low'::app.risk_level | Risk classification of the run. | source.admatix_warehouse.app.agent_runs | none recorded |
| status | agent_run_status | yes |  | Terminal status: completed \| blocked \| error. | source.admatix_warehouse.app.agent_runs | none recorded |
| blocked_reason | text | yes |  | Reason the run was blocked; null unless status = blocked. | source.admatix_warehouse.app.agent_runs | none recorded |
| duration_ms | integer | yes |  | Wall-clock run duration in milliseconds. | source.admatix_warehouse.app.agent_runs | none recorded |
| created_at | timestamp with time zone | yes | now() | UTC timestamp the run record was written. | source.admatix_warehouse.app.agent_runs | none recorded |
| id | text | yes | (gen_random_uuid())::text | Generic Store collection identifier retained for compatibility with the filesystem Store contract. | source.admatix_warehouse.app.agent_runs | none recorded |
| body | jsonb | no | '{}'::jsonb | Generic Store collection body as jsonb, containing the schema-validated artifact payload. | source.admatix_warehouse.app.agent_runs | none recorded |

## app.approval_receipts

The human approval or rejection of a proposed action. One receipt per terminal human decision.

- Source lineage: source.admatix_warehouse.app.approval_receipts
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| approval_receipt_id | uuid | no | gen_random_uuid() | Surrogate primary key (UUID v4). | source.admatix_warehouse.app.approval_receipts | none recorded |
| h0_packet_id | uuid | yes |  | H0 packet the decision pertains to (FK app.h0_packets). | source.admatix_warehouse.app.approval_receipts | none recorded |
| proposed_action_id | uuid | yes |  | Specific action approved/rejected (FK app.proposed_actions). | source.admatix_warehouse.app.approval_receipts | none recorded |
| tenant_id | uuid | yes |  | Owning tenant (FK app.tenants), denormalised for filtering. | source.admatix_warehouse.app.approval_receipts | none recorded |
| decision | approval_decision | yes |  | Terminal decision: approved \| rejected. | source.admatix_warehouse.app.approval_receipts | none recorded |
| decided_by_user_id | uuid | yes |  | User who made the decision (FK app.users). Null if recorded outside the user table. | source.admatix_warehouse.app.approval_receipts | none recorded |
| decided_by | text | yes |  | Display name or identifier of the decider, captured at decision time. | source.admatix_warehouse.app.approval_receipts | none recorded |
| role | text | yes |  | Role the decider held when approving (e.g. "approver", "owner"). | source.admatix_warehouse.app.approval_receipts | none recorded |
| note | text | yes |  | Optional free-text rationale for the decision. | source.admatix_warehouse.app.approval_receipts | none recorded |
| decided_at | timestamp with time zone | yes | now() | UTC timestamp the decision was made. | source.admatix_warehouse.app.approval_receipts | none recorded |
| created_at | timestamp with time zone | yes | now() | UTC timestamp the receipt row was written. | source.admatix_warehouse.app.approval_receipts | none recorded |
| id | text | yes | (gen_random_uuid())::text | Generic Store collection identifier retained for compatibility with the filesystem Store contract. | source.admatix_warehouse.app.approval_receipts | none recorded |
| body | jsonb | no | '{}'::jsonb | Generic Store collection body as jsonb, containing the schema-validated artifact payload. | source.admatix_warehouse.app.approval_receipts | none recorded |

## app.audit_reports

Operational application source table app.audit_reports.

- Source lineage: database relation
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| id | text | no |  | Generic Store collection identifier retained for compatibility with the filesystem Store contract. | database relation | none recorded |
| body | jsonb | no | '{}'::jsonb | Generic Store collection body as jsonb, containing the schema-validated artifact payload. | database relation | none recorded |

## app.audits

Operational application source table app.audits.

- Source lineage: database relation
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| id | text | no |  | Generic Store collection identifier retained for compatibility with the filesystem Store contract. | database relation | none recorded |
| body | jsonb | no | '{}'::jsonb | Generic Store collection body as jsonb, containing the schema-validated artifact payload. | database relation | none recorded |

## app.benchmark_runs

Operational application source table app.benchmark_runs.

- Source lineage: database relation
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| id | text | no |  | Generic Store collection identifier retained for compatibility with the filesystem Store contract. | database relation | none recorded |
| body | jsonb | no | '{}'::jsonb | Generic Store collection body as jsonb, containing the schema-validated artifact payload. | database relation | none recorded |

## app.connections

Credential vault. Stores encrypted OAuth/API tokens for platform connections. Plaintext secrets are never persisted; token_ciphertext is AES-GCM ciphertext decrypted only in memory by the connector service.

- Source lineage: database relation
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| connection_id | uuid | no | gen_random_uuid() | Surrogate primary key (UUID v4). | database relation | none recorded |
| tenant_id | uuid | no |  | Owning tenant (FK app.tenants). | database relation | none recorded |
| ad_account_id | uuid | yes |  | Optional linked ad account (FK app.ad_accounts). Null for account-discovery connections. | database relation | none recorded |
| platform | ad_platform | no |  | Platform this credential authenticates against. | database relation | none recorded |
| status | connection_status | no | 'pending'::app.connection_status | Connection health: pending \| active \| expired \| revoked \| error. | database relation | none recorded |
| token_ciphertext | bytea | no |  | AES-GCM-encrypted credential blob (access + refresh token). Never plaintext. | database relation | none recorded |
| token_iv | bytea | no |  | Initialisation vector / nonce used to encrypt token_ciphertext. | database relation | none recorded |
| token_auth_tag | bytea | yes |  | AES-GCM authentication tag verifying ciphertext integrity. Null only for non-AEAD ciphers. | database relation | none recorded |
| key_id | text | no |  | Identifier of the KMS/envelope key used, enabling key rotation. | database relation | none recorded |
| scopes | ARRAY | no | '{}'::text[] | OAuth scopes granted to this credential. | database relation | none recorded |
| expires_at | timestamp with time zone | yes |  | UTC expiry of the access token; null if non-expiring. | database relation | none recorded |
| last_refreshed_at | timestamp with time zone | yes |  | UTC timestamp the token was last refreshed. | database relation | none recorded |
| last_error | text | yes |  | Last connection error message, for operator diagnostics. | database relation | none recorded |
| created_by | uuid | yes |  | User who created the connection (FK app.users). | database relation | none recorded |
| created_at | timestamp with time zone | no | now() | UTC creation timestamp. | database relation | none recorded |
| updated_at | timestamp with time zone | no | now() | UTC timestamp of the last mutation (maintained by trigger). | database relation | none recorded |

## app.execution_diffs

The before/after field-level preview produced by a dry-run activation. Never represents a real mutation (enforced by CHECK).

- Source lineage: source.admatix_warehouse.app.execution_diffs
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| execution_diff_id | uuid | no | gen_random_uuid() | Surrogate primary key (UUID v4). | source.admatix_warehouse.app.execution_diffs | none recorded |
| proposed_action_id | uuid | yes |  | Action the diff previews (FK app.proposed_actions). | source.admatix_warehouse.app.execution_diffs | none recorded |
| tenant_id | uuid | yes |  | Owning tenant (FK app.tenants), denormalised for filtering. | source.admatix_warehouse.app.execution_diffs | none recorded |
| entity_id | text | yes |  | Platform entity id the diff applies to. | source.admatix_warehouse.app.execution_diffs | none recorded |
| changes | jsonb | yes | '[]'::jsonb | jsonb array of FieldDiff objects (field, before, after). | source.admatix_warehouse.app.execution_diffs | none recorded |
| estimated_impact | jsonb | yes |  | Optional jsonb map of metric -> estimated numeric impact. | source.admatix_warehouse.app.execution_diffs | none recorded |
| dry_run | boolean | yes | true | Always true; the diff is a preview, not an applied change. | source.admatix_warehouse.app.execution_diffs | none recorded |
| created_at | timestamp with time zone | yes | now() | UTC creation timestamp. | source.admatix_warehouse.app.execution_diffs | none recorded |
| id | text | yes | (gen_random_uuid())::text | Generic Store collection identifier retained for compatibility with the filesystem Store contract. | source.admatix_warehouse.app.execution_diffs | none recorded |
| body | jsonb | no | '{}'::jsonb | Generic Store collection body as jsonb, containing the schema-validated artifact payload. | source.admatix_warehouse.app.execution_diffs | none recorded |

## app.h0_packets

The H0 packet -- the unit of trust in AdMatix. Bundles goal, hypothesis, null hypothesis, evidence, guardrails, proposal, rollback and approval into one verifiable record. body holds the full H0Packet jsonb; body_hash is its integrity digest.

- Source lineage: source.admatix_warehouse.app.h0_packets
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| h0_packet_id | uuid | no | gen_random_uuid() | Surrogate primary key (UUID v4). | source.admatix_warehouse.app.h0_packets | none recorded |
| tenant_id | uuid | yes |  | Owning tenant (FK app.tenants). | source.admatix_warehouse.app.h0_packets | none recorded |
| ad_account_id | uuid | yes |  | Ad account the packet operates on (FK app.ad_accounts). Nullable for account-agnostic packets. | source.admatix_warehouse.app.h0_packets | none recorded |
| workflow_id | text | yes |  | Workflow instance id linking the packet across plan/activate/measure/reflect. | source.admatix_warehouse.app.h0_packets | none recorded |
| tx_id | text | yes |  | AdMatix transaction id; preserved end-to-end and joined to the ledger. | source.admatix_warehouse.app.h0_packets | none recorded |
| trace_id | text | yes |  | Distributed trace id for cross-system correlation. | source.admatix_warehouse.app.h0_packets | none recorded |
| state | h0_state | yes | 'draft'::app.h0_state | Lifecycle state: draft \| validated \| pending_approval \| approved \| rejected \| measured \| reflected. | source.admatix_warehouse.app.h0_packets | none recorded |
| causal_status | causal_status | yes | 'directional_until_lift_test'::app.causal_status | Strength of the causal claim: directional_until_lift_test \| experimental \| causal. | source.admatix_warehouse.app.h0_packets | none recorded |
| goal | text | yes |  | Plain-language objective of the packet. | source.admatix_warehouse.app.h0_packets | none recorded |
| hypothesis | text | yes |  | The hypothesis being tested (the expected effect). | source.admatix_warehouse.app.h0_packets | none recorded |
| null_hypothesis | text | yes |  | The null hypothesis (no effect), required for honest measurement. | source.admatix_warehouse.app.h0_packets | none recorded |
| baseline_window | text | yes |  | The baseline measurement window (e.g. "2026-04-01..2026-04-30"). | source.admatix_warehouse.app.h0_packets | none recorded |
| success_metric | text | yes |  | The metric that determines whether the packet succeeded. | source.admatix_warehouse.app.h0_packets | none recorded |
| body | jsonb | no | '{}'::jsonb | Full H0Packet jsonb: evidence refs, guardrails, proposal, rollback, approval block. | source.admatix_warehouse.app.h0_packets | none recorded |
| body_hash | character | yes |  | SHA-256 (hex, 64 chars) of the canonicalised body, computed by trigger via admatix_sha256_jsonb(body). | source.admatix_warehouse.app.h0_packets | none recorded |
| created_by_agent | text | yes |  | Identifier of the agent that authored the packet. | source.admatix_warehouse.app.h0_packets | none recorded |
| created_at | timestamp with time zone | yes | now() | UTC creation timestamp. | source.admatix_warehouse.app.h0_packets | none recorded |
| updated_at | timestamp with time zone | yes | now() | UTC timestamp of the last mutation (maintained by trigger). | source.admatix_warehouse.app.h0_packets | none recorded |
| id | text | yes | (gen_random_uuid())::text | Generic Store collection identifier retained for compatibility with the filesystem Store contract. | source.admatix_warehouse.app.h0_packets | none recorded |

## app.outcome_measurements

The Measure-step result for an H0 packet: baseline vs observed, delta, confidence interval, and a pass/fail verdict.

- Source lineage: source.admatix_warehouse.app.outcome_measurements
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| outcome_measurement_id | uuid | no | gen_random_uuid() | Surrogate primary key (UUID v4). | source.admatix_warehouse.app.outcome_measurements | none recorded |
| h0_packet_id | uuid | yes |  | H0 packet measured (FK app.h0_packets). | source.admatix_warehouse.app.outcome_measurements | none recorded |
| tenant_id | uuid | yes |  | Owning tenant (FK app.tenants). | source.admatix_warehouse.app.outcome_measurements | none recorded |
| success_metric | text | yes |  | The metric measured, matching h0_packets.success_metric. | source.admatix_warehouse.app.outcome_measurements | none recorded |
| baseline_value | numeric | yes |  | Metric value over the baseline window; null if unavailable. | source.admatix_warehouse.app.outcome_measurements | none recorded |
| observed_value | numeric | yes |  | Metric value over the measurement window; null if unavailable. | source.admatix_warehouse.app.outcome_measurements | none recorded |
| delta_pct | numeric | yes |  | Percentage change from baseline to observed; null if not computable. | source.admatix_warehouse.app.outcome_measurements | none recorded |
| ci_low | numeric | yes |  | Lower bound of the confidence interval on the effect. | source.admatix_warehouse.app.outcome_measurements | none recorded |
| ci_high | numeric | yes |  | Upper bound of the confidence interval on the effect. | source.admatix_warehouse.app.outcome_measurements | none recorded |
| passed | boolean | yes |  | True if the measured outcome met the success criterion. | source.admatix_warehouse.app.outcome_measurements | none recorded |
| notes | ARRAY | yes | '{}'::text[] | Array of free-text caveats and observations. | source.admatix_warehouse.app.outcome_measurements | none recorded |
| evidence | jsonb | yes | '[]'::jsonb | jsonb array of EvidenceRef objects backing the measurement. | source.admatix_warehouse.app.outcome_measurements | none recorded |
| measured_at | timestamp with time zone | yes | now() | UTC timestamp the measurement was taken. | source.admatix_warehouse.app.outcome_measurements | none recorded |
| created_at | timestamp with time zone | yes | now() | UTC timestamp the row was written. | source.admatix_warehouse.app.outcome_measurements | none recorded |
| id | text | yes | (gen_random_uuid())::text | Generic Store collection identifier retained for compatibility with the filesystem Store contract. | source.admatix_warehouse.app.outcome_measurements | none recorded |
| body | jsonb | no | '{}'::jsonb | Generic Store collection body as jsonb, containing the schema-validated artifact payload. | source.admatix_warehouse.app.outcome_measurements | none recorded |

## app.policies

Versioned policy rule sets. Each PolicyDecision pins a policy_version so gating verdicts are reproducible. rules holds the array of PolicyRule objects.

- Source lineage: source.admatix_warehouse.app.policies
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| policy_id | uuid | no | gen_random_uuid() | Surrogate primary key (UUID v4). | source.admatix_warehouse.app.policies | none recorded |
| tenant_id | uuid | no |  | Owning tenant (FK app.tenants). | source.admatix_warehouse.app.policies | none recorded |
| policy_version | text | no |  | Semantic version string of the rule set; unique within a tenant. | source.admatix_warehouse.app.policies | none recorded |
| name | text | no |  | Human-readable policy name. | source.admatix_warehouse.app.policies | none recorded |
| description | text | yes |  | Optional description of the policy intent. | source.admatix_warehouse.app.policies | none recorded |
| is_active | boolean | no | true | True if this version is the one currently enforced. | source.admatix_warehouse.app.policies | none recorded |
| rules | jsonb | no | '[]'::jsonb | jsonb array of PolicyRule objects (rule_id, kind, params, severity). | source.admatix_warehouse.app.policies | none recorded |
| rules_hash | character | no |  | SHA-256 (hex, 64 chars) of the rules array, for integrity and change detection. | source.admatix_warehouse.app.policies | none recorded |
| effective_from | timestamp with time zone | no | now() | UTC timestamp this policy version becomes effective. | source.admatix_warehouse.app.policies | none recorded |
| effective_to | timestamp with time zone | yes |  | UTC timestamp this policy version is superseded; null while current. | source.admatix_warehouse.app.policies | none recorded |
| created_by | uuid | yes |  | User who authored the policy version (FK app.users). | source.admatix_warehouse.app.policies | none recorded |
| created_at | timestamp with time zone | no | now() | UTC creation timestamp. | source.admatix_warehouse.app.policies | none recorded |
| updated_at | timestamp with time zone | no | now() | UTC timestamp of the last mutation (maintained by trigger). | source.admatix_warehouse.app.policies | none recorded |

## app.policy_decisions

PolicyGuard verdict on a single proposed action. Pins the policy_version so the decision is reproducible.

- Source lineage: source.admatix_warehouse.app.policy_decisions
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| policy_decision_id | uuid | no | gen_random_uuid() | Surrogate primary key (UUID v4). | source.admatix_warehouse.app.policy_decisions | none recorded |
| proposed_action_id | uuid | yes |  | Action evaluated (FK app.proposed_actions). | source.admatix_warehouse.app.policy_decisions | none recorded |
| tenant_id | uuid | yes |  | Owning tenant (FK app.tenants), denormalised for filtering. | source.admatix_warehouse.app.policy_decisions | none recorded |
| policy_id | uuid | yes |  | Policy row used for the decision (FK app.policies). Nullable if the policy was later deleted. | source.admatix_warehouse.app.policy_decisions | none recorded |
| policy_version | text | yes |  | Version string of the policy applied; pinned for reproducibility. | source.admatix_warehouse.app.policy_decisions | none recorded |
| result | policy_result | yes |  | Verdict: allow \| block \| needs_approval. | source.admatix_warehouse.app.policy_decisions | none recorded |
| risk_level | risk_level | yes |  | Risk level assigned by the gate. | source.admatix_warehouse.app.policy_decisions | none recorded |
| matched_rules | ARRAY | yes | '{}'::text[] | Array of rule_ids that matched the action. | source.admatix_warehouse.app.policy_decisions | none recorded |
| reasons | ARRAY | yes | '{}'::text[] | Human-readable reasons explaining the verdict. | source.admatix_warehouse.app.policy_decisions | none recorded |
| decided_at | timestamp with time zone | yes | now() | UTC timestamp the verdict was rendered. | source.admatix_warehouse.app.policy_decisions | none recorded |
| id | text | yes | (gen_random_uuid())::text | Generic Store collection identifier retained for compatibility with the filesystem Store contract. | source.admatix_warehouse.app.policy_decisions | none recorded |
| body | jsonb | no | '{}'::jsonb | Generic Store collection body as jsonb, containing the schema-validated artifact payload. | source.admatix_warehouse.app.policy_decisions | none recorded |

## app.proposed_actions

A concrete change the system proposes against an ad entity. In the MVP every action is dry-run only (enforced by CHECK).

- Source lineage: source.admatix_warehouse.app.proposed_actions
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| proposed_action_id | uuid | no | gen_random_uuid() | Surrogate primary key (UUID v4). | source.admatix_warehouse.app.proposed_actions | none recorded |
| h0_packet_id | uuid | yes |  | Parent H0 packet (FK app.h0_packets). | source.admatix_warehouse.app.proposed_actions | none recorded |
| tenant_id | uuid | yes |  | Owning tenant (FK app.tenants), denormalised for filtering. | source.admatix_warehouse.app.proposed_actions | none recorded |
| action_type | action_type | yes |  | Kind of change: budget_shift \| pause_entity \| resume_entity \| bid_adjust \| add_negative_keyword \| creative_rotate \| no_op. | source.admatix_warehouse.app.proposed_actions | none recorded |
| target_entity_id | text | yes |  | Platform entity id the action targets (campaign/ad set/creative). | source.admatix_warehouse.app.proposed_actions | none recorded |
| params | jsonb | yes | '{}'::jsonb | Action parameters as jsonb (e.g. budget delta, bid multiplier). | source.admatix_warehouse.app.proposed_actions | none recorded |
| risk_level | risk_level | yes | 'low'::app.risk_level | Risk classification: low \| medium \| high. | source.admatix_warehouse.app.proposed_actions | none recorded |
| dry_run_only | boolean | yes | true | Always true in the MVP; the action is a preview, never an executed mutation. | source.admatix_warehouse.app.proposed_actions | none recorded |
| created_at | timestamp with time zone | yes | now() | UTC creation timestamp. | source.admatix_warehouse.app.proposed_actions | none recorded |
| updated_at | timestamp with time zone | yes | now() | UTC timestamp of the last mutation (maintained by trigger). | source.admatix_warehouse.app.proposed_actions | none recorded |
| id | text | yes | (gen_random_uuid())::text | Generic Store collection identifier retained for compatibility with the filesystem Store contract. | source.admatix_warehouse.app.proposed_actions | none recorded |
| body | jsonb | no | '{}'::jsonb | Generic Store collection body as jsonb, containing the schema-validated artifact payload. | source.admatix_warehouse.app.proposed_actions | none recorded |

## app.rollback_checkpoints

A captured snapshot of an entity state before a (dry-run) change, enabling deterministic restoration. Every H0 packet must reference a checkpoint.

- Source lineage: database relation
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| rollback_checkpoint_id | uuid | no | gen_random_uuid() | Surrogate primary key (UUID v4). | database relation | none recorded |
| h0_packet_id | uuid | yes |  | H0 packet that produced the checkpoint (FK app.h0_packets). Nullable if packet is deleted. | database relation | none recorded |
| tenant_id | uuid | yes |  | Owning tenant (FK app.tenants). | database relation | none recorded |
| entity_id | text | yes |  | Platform entity id the snapshot captures. | database relation | none recorded |
| method | text | yes | 'restore_previous_state'::text | The rollback method to apply (e.g. restore_previous_budget). | database relation | none recorded |
| snapshot | jsonb | yes | '{}'::jsonb | jsonb snapshot of the entity state at checkpoint time. | database relation | none recorded |
| snapshot_hash | character | yes |  | SHA-256 (hex, 64 chars) of the snapshot, computed by trigger. | database relation | none recorded |
| is_consumed | boolean | yes | false | True once the checkpoint has been used to roll back. | database relation | none recorded |
| created_at | timestamp with time zone | yes | now() | UTC creation timestamp. | database relation | none recorded |
| id | text | yes | (gen_random_uuid())::text | Generic Store collection identifier retained for compatibility with the filesystem Store contract. | database relation | none recorded |
| body | jsonb | no | '{}'::jsonb | Generic Store collection body as jsonb, containing the schema-validated artifact payload. | database relation | none recorded |

## app.tenants

Top-level customer organisation. Every other app row is scoped to a tenant.

- Source lineage: source.admatix_warehouse.app.tenants
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| tenant_id | uuid | no | gen_random_uuid() | Surrogate primary key (UUID v4). | source.admatix_warehouse.app.tenants | none recorded |
| slug | citext | no |  | Case-insensitive unique short identifier used in URLs and CLI. | source.admatix_warehouse.app.tenants | none recorded |
| name | text | no |  | Human-readable tenant / company name. | source.admatix_warehouse.app.tenants | none recorded |
| plan | text | no | 'free'::text | Subscription plan key (free, team, enterprise, ...). | source.admatix_warehouse.app.tenants | none recorded |
| is_active | boolean | no | true | False soft-disables the tenant without deleting data. | source.admatix_warehouse.app.tenants | none recorded |
| settings | jsonb | no | '{}'::jsonb | Tenant-level configuration as jsonb (feature flags, defaults). | source.admatix_warehouse.app.tenants | none recorded |
| created_at | timestamp with time zone | no | now() | UTC creation timestamp. | source.admatix_warehouse.app.tenants | none recorded |
| updated_at | timestamp with time zone | no | now() | UTC timestamp of the last mutation (maintained by trigger). | source.admatix_warehouse.app.tenants | none recorded |

## app.trust_score_history

Append-style history of every trust score change, giving an auditable trail of how trust accrued or decayed over time.

- Source lineage: database relation
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| trust_score_history_id | bigint | no |  | Surrogate primary key (identity). | database relation | none recorded |
| trust_score_id | uuid | no |  | The trust score row that changed (FK app.trust_scores). | database relation | none recorded |
| tenant_id | uuid | no |  | Owning tenant (FK app.tenants), denormalised for filtering. | database relation | none recorded |
| subject_type | trust_subject_type | no |  | Kind of subject: agent \| skill \| connector (denormalised). | database relation | none recorded |
| subject_id | text | no |  | Identifier of the trusted subject (denormalised). | database relation | none recorded |
| previous_score | numeric | yes |  | Score before this change; null for the first record. | database relation | none recorded |
| new_score | numeric | no |  | Score after this change. | database relation | none recorded |
| delta | numeric | no |  | new_score - previous_score (the signed change). | database relation | none recorded |
| reason | text | no |  | Why the score changed (e.g. "measurement_passed", "policy_violation"). | database relation | none recorded |
| related_h0_packet_id | uuid | yes |  | H0 packet that triggered the change, if any (FK app.h0_packets). | database relation | none recorded |
| recorded_at | timestamp with time zone | no | now() | UTC timestamp the change was recorded. | database relation | none recorded |

## app.trust_scores

Current trust score for an agent, skill, or connector. Trust rises with validated outcomes and decays with invalidated ones. One row per (tenant, subject_type, subject_id).

- Source lineage: database relation
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| trust_score_id | uuid | no | gen_random_uuid() | Surrogate primary key (UUID v4). | database relation | none recorded |
| tenant_id | uuid | yes |  | Owning tenant (FK app.tenants). | database relation | none recorded |
| subject_type | trust_subject_type | yes |  | Kind of subject: agent \| skill \| connector. | database relation | none recorded |
| subject_id | text | yes |  | Identifier of the trusted subject. | database relation | none recorded |
| score | numeric | yes | 0.5000 | Current trust score in [0,1]; defaults to 0.5 (neutral). | database relation | none recorded |
| validated_count | integer | yes | 0 | Number of outcomes that validated the subject. | database relation | none recorded |
| invalidated_count | integer | yes | 0 | Number of outcomes that invalidated the subject. | database relation | none recorded |
| updated_at | timestamp with time zone | yes | now() | UTC timestamp the score was last recomputed. | database relation | none recorded |
| created_at | timestamp with time zone | yes | now() | UTC timestamp the score row was first created. | database relation | none recorded |
| id | text | yes | (gen_random_uuid())::text | Generic Store collection identifier retained for compatibility with the filesystem Store contract. | database relation | none recorded |
| body | jsonb | no | '{}'::jsonb | Generic Store collection body as jsonb, containing the schema-validated artifact payload. | database relation | none recorded |

## app.users

A person with access to a tenant. approver-role users can sign approval receipts.

- Source lineage: database relation
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| user_id | uuid | no | gen_random_uuid() | Surrogate primary key (UUID v4). | database relation | none recorded |
| tenant_id | uuid | no |  | Owning tenant (FK app.tenants). | database relation | none recorded |
| email | citext | no |  | Case-insensitive email; unique within a tenant. | database relation | none recorded |
| display_name | text | yes |  | Optional human-readable name. | database relation | none recorded |
| role | user_role | no | 'viewer'::app.user_role | Tenant-scoped role: owner \| admin \| approver \| analyst \| viewer. | database relation | none recorded |
| auth_subject | text | yes |  | External auth provider subject id (Supabase auth.users.id), nullable for service accounts. | database relation | none recorded |
| is_active | boolean | no | true | False soft-disables the user. | database relation | none recorded |
| last_seen_at | timestamp with time zone | yes |  | UTC timestamp of last activity, for session/audit reporting. | database relation | none recorded |
| created_at | timestamp with time zone | no | now() | UTC creation timestamp. | database relation | none recorded |
| updated_at | timestamp with time zone | no | now() | UTC timestamp of the last mutation (maintained by trigger). | database relation | none recorded |

## bench.ground_truth

The canonical answer key for a benchmark task. For simulator-backed tasks it links to sim.true_effects so the scorer can compare an estimate against the known truth within tolerance.

- Source lineage: source.admatix_warehouse.bench.ground_truth
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| ground_truth_id | uuid | no | gen_random_uuid() | Surrogate primary key (UUID v4). | source.admatix_warehouse.bench.ground_truth | none recorded |
| task_id | uuid | no |  | The task this answer key belongs to (FK bench.tasks). | source.admatix_warehouse.bench.ground_truth | none recorded |
| scenario_id | uuid | yes |  | Simulator scenario backing the task, if any (FK sim.scenarios). | source.admatix_warehouse.bench.ground_truth | none recorded |
| true_effect_id | uuid | yes |  | The specific true effect this task is graded against (FK sim.true_effects). | source.admatix_warehouse.bench.ground_truth | none recorded |
| answer_key | jsonb | no | '{}'::jsonb | Full expected answer as jsonb. | source.admatix_warehouse.bench.ground_truth | none recorded |
| expected_verdict | text | no |  | The expected high-level verdict (e.g. "block", "allow", "flag_waste"). | source.admatix_warehouse.bench.ground_truth | none recorded |
| expected_lift | numeric | yes |  | The expected incremental lift value, where the task scores a numeric estimate. | source.admatix_warehouse.bench.ground_truth | none recorded |
| tolerance | numeric | no | 0 | Allowed absolute deviation of an estimate from expected_lift to still pass. | source.admatix_warehouse.bench.ground_truth | none recorded |
| rationale | text | yes |  | Explanation of why this is the correct answer. | source.admatix_warehouse.bench.ground_truth | none recorded |
| created_at | timestamp with time zone | no | now() | UTC creation timestamp. | source.admatix_warehouse.bench.ground_truth | none recorded |

## bench.results

The result of one task within one benchmark run. Captures the pass/fail verdict, score, and the safety counters that gate AdMatix release decisions.

- Source lineage: source.admatix_warehouse.bench.results
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| result_id | uuid | no | gen_random_uuid() | Surrogate primary key (UUID v4). | source.admatix_warehouse.bench.results | none recorded |
| run_id | uuid | no |  | The run this result belongs to (FK bench.runs). | source.admatix_warehouse.bench.results | none recorded |
| task_id | uuid | no |  | The task this result scores (FK bench.tasks). | source.admatix_warehouse.bench.results | none recorded |
| passed | boolean | no |  | True if the task passed. | source.admatix_warehouse.bench.results | none recorded |
| score | numeric | no | 0 | Continuous score in [0,1] for the task. | source.admatix_warehouse.bench.results | none recorded |
| unsafe_write_attempted | boolean | no | false | True if the system attempted an unsafe write (an automatic fail). | source.admatix_warehouse.bench.results | none recorded |
| budget_cap_violation | boolean | no | false | True if a budget cap was violated. | source.admatix_warehouse.bench.results | none recorded |
| hallucinated_id | boolean | no | false | True if the system referenced a non-existent entity id. | source.admatix_warehouse.bench.results | none recorded |
| evidence_coverage | numeric | no | 0 | Fraction of claims backed by valid evidence refs, in [0,1]. | source.admatix_warehouse.bench.results | none recorded |
| rollback_coverage | numeric | no | 0 | Fraction of actions carrying a valid rollback, in [0,1]. | source.admatix_warehouse.bench.results | none recorded |
| notes | ARRAY | no | '{}'::text[] | Array of free-text notes on the result. | source.admatix_warehouse.bench.results | none recorded |
| output | jsonb | no | '{}'::jsonb | Full system output for the task as jsonb, for inspection and replay. | source.admatix_warehouse.bench.results | none recorded |
| created_at | timestamp with time zone | no | now() | UTC timestamp the result was written. | source.admatix_warehouse.bench.results | none recorded |

## bench.runs

One execution of a benchmark suite. Pins fixture, code, policy and model versions so results are reproducible and comparable across runs.

- Source lineage: source.admatix_warehouse.bench.runs
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| run_id | uuid | no | gen_random_uuid() | Surrogate primary key (UUID v4). | source.admatix_warehouse.bench.runs | none recorded |
| suite | text | no |  | Benchmark suite executed. | source.admatix_warehouse.bench.runs | none recorded |
| fixture_version | text | no |  | Pinned fixture/dataset version. | source.admatix_warehouse.bench.runs | none recorded |
| code_version | text | no |  | Pinned AdMatix code version (git sha or tag). | source.admatix_warehouse.bench.runs | none recorded |
| policy_version | text | no |  | Pinned policy version in force during the run. | source.admatix_warehouse.bench.runs | none recorded |
| model | text | no |  | Pinned model id used during the run. | source.admatix_warehouse.bench.runs | none recorded |
| summary | jsonb | no | '{}'::jsonb | jsonb map of aggregate metric -> value for the run. | source.admatix_warehouse.bench.runs | none recorded |
| pass_count | integer | no | 0 | Number of tasks that passed. | source.admatix_warehouse.bench.runs | none recorded |
| fail_count | integer | no | 0 | Number of tasks that failed. | source.admatix_warehouse.bench.runs | none recorded |
| started_at | timestamp with time zone | no | now() | UTC timestamp the run began. | source.admatix_warehouse.bench.runs | none recorded |
| finished_at | timestamp with time zone | yes |  | UTC timestamp the run completed; null while in progress. | source.admatix_warehouse.bench.runs | none recorded |
| created_at | timestamp with time zone | no | now() | UTC timestamp the run row was written. | source.admatix_warehouse.bench.runs | none recorded |

## bench.tasks

A single benchmark task. Unsafe tasks (is_unsafe = true) MUST be blocked by the system to count as passed.

- Source lineage: source.admatix_warehouse.bench.tasks
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| task_id | uuid | no | gen_random_uuid() | Surrogate primary key (UUID v4). | source.admatix_warehouse.bench.tasks | none recorded |
| task_key | text | no |  | Stable human-readable task identifier, unique within a suite. | source.admatix_warehouse.bench.tasks | none recorded |
| suite | text | no |  | Benchmark suite the task belongs to. | source.admatix_warehouse.bench.tasks | none recorded |
| kind | task_kind | no |  | Task category: audit \| safety \| evidence \| state_diff \| policy. | source.admatix_warehouse.bench.tasks | none recorded |
| description | text | no |  | Human-readable description of what the task tests. | source.admatix_warehouse.bench.tasks | none recorded |
| fixture | text | no |  | Identifier of the fixture/dataset the task runs against. | source.admatix_warehouse.bench.tasks | none recorded |
| expected | jsonb | no | '{}'::jsonb | Expected outcome as jsonb, used to score a run. | source.admatix_warehouse.bench.tasks | none recorded |
| is_unsafe | boolean | no | false | True if the task represents an unsafe request the system must block. | source.admatix_warehouse.bench.tasks | none recorded |
| created_at | timestamp with time zone | no | now() | UTC creation timestamp. | source.admatix_warehouse.bench.tasks | none recorded |
| updated_at | timestamp with time zone | no | now() | UTC timestamp of the last mutation (maintained by trigger). | source.admatix_warehouse.bench.tasks | none recorded |

## ledger.action_events

Append-only hash-chained event ledger. One row per governance event. seq gives monotonic chain order; entry_hash chains each row to its predecessor via prev_hash. UPDATE/DELETE are revoked and trigger-blocked.

- Source lineage: source.admatix_warehouse.ledger.action_events
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| event_id | text | no |  | Primary key. ULID rendered as text (26-char Crockford base32), generated by the application. Sortable by creation time. | source.admatix_warehouse.ledger.action_events | none recorded |
| seq | bigint | no | nextval('ledger.action_events_seq_seq'::regclass) | Monotonic chain order (bigserial). Defines the canonical hash-chain sequence; ordering is strictly increasing. | source.admatix_warehouse.ledger.action_events | none recorded |
| tx_id | text | no |  | AdMatix transaction id tying together task, cost, route, trace and handoff records. Never null; preserved end-to-end. | source.admatix_warehouse.ledger.action_events | none recorded |
| workflow_id | text | no |  | Identifier of the plan/activate/measure/reflect workflow instance this event belongs to. | source.admatix_warehouse.ledger.action_events | none recorded |
| trace_id | text | no |  | Distributed trace id (Langfuse/OpenTelemetry) for cross-system correlation. | source.admatix_warehouse.ledger.action_events | none recorded |
| tenant_id | text | no |  | Owning tenant. Denormalised into the ledger so a tenant slice of the chain can be exported and verified independently. | source.admatix_warehouse.ledger.action_events | none recorded |
| event_type | event_type | no |  | Kind of event: proposal \| gate_decision \| approval \| execution_diff \| measurement \| reflection \| flag. | source.admatix_warehouse.ledger.action_events | none recorded |
| step | workflow_step | no |  | Workflow phase: plan \| activate \| measure \| reflect. | source.admatix_warehouse.ledger.action_events | none recorded |
| actor_agent_id | text | no |  | Identifier of the agent or human actor that produced the event (e.g. "policy-guard", "user:uuid"). | source.admatix_warehouse.ledger.action_events | none recorded |
| subject_id | text | yes |  | Identifier of the entity the event is about (h0_packet id, proposed_action id, etc.). Nullable for system-level events. | source.admatix_warehouse.ledger.action_events | none recorded |
| payload | jsonb | no | '{}'::jsonb | Full event payload as jsonb. Immutable. The canonical, hashable record of what happened. | source.admatix_warehouse.ledger.action_events | none recorded |
| payload_hash | character | no |  | SHA-256 (hex, 64 chars) of the canonicalised payload. Computed by trigger via admatix_sha256_jsonb(payload). | source.admatix_warehouse.ledger.action_events | none recorded |
| prev_hash | character | no |  | entry_hash of the immediately preceding row in seq order. The genesis row uses 64 zero characters. Set by trigger. | source.admatix_warehouse.ledger.action_events | none recorded |
| entry_hash | character | no |  | SHA-256 of the chain material (prev_hash \|\| event_id \|\| tx_id \|\| event_type \|\| step \|\| payload_hash \|\| created_at). Set by trigger. | source.admatix_warehouse.ledger.action_events | none recorded |
| signature | text | yes |  | Optional detached cryptographic signature over entry_hash (e.g. Ed25519, base64). Null when signing is not configured. | source.admatix_warehouse.ledger.action_events | none recorded |
| created_at | timestamp with time zone | no | now() | UTC timestamp the event was written. Part of the chain material; immutable. | source.admatix_warehouse.ledger.action_events | none recorded |

## ledger.merkle_anchors

Periodic Merkle anchoring of contiguous action_events ranges. Each row commits a verifiable digest of [from_seq, to_seq]. external_anchor optionally records an off-system commitment (blockchain tx, RFC-3161 timestamp) for independent verification.

- Source lineage: source.admatix_warehouse.ledger.merkle_anchors
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| anchor_id | bigint | no |  | Surrogate primary key (identity). | source.admatix_warehouse.ledger.merkle_anchors | none recorded |
| from_seq | bigint | no |  | Inclusive lower bound: the smallest action_events.seq covered by this anchor. | source.admatix_warehouse.ledger.merkle_anchors | none recorded |
| to_seq | bigint | no |  | Inclusive upper bound: the largest action_events.seq covered by this anchor. | source.admatix_warehouse.ledger.merkle_anchors | none recorded |
| merkle_root | character | no |  | SHA-256 (hex, 64 chars) Merkle root computed over the entry_hash values of all events in [from_seq, to_seq]. | source.admatix_warehouse.ledger.merkle_anchors | none recorded |
| event_count | integer | no |  | Number of events covered. Constrained to equal to_seq - from_seq + 1. | source.admatix_warehouse.ledger.merkle_anchors | none recorded |
| anchored_at | timestamp with time zone | no | now() | UTC timestamp the anchor was computed and recorded. | source.admatix_warehouse.ledger.merkle_anchors | none recorded |
| external_anchor | text | yes |  | Optional external commitment reference (blockchain tx hash, RFC-3161 token, OpenTimestamps proof URL). Null until externally anchored. | source.admatix_warehouse.ledger.merkle_anchors | none recorded |

## sim.campaigns

A synthetic campaign within a simulation scenario. Carries the base-rate parameters (CTR, CVR, AOV) the simulator draws events from.

- Source lineage: source.admatix_warehouse.sim.campaigns
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| sim_campaign_id | uuid | no | gen_random_uuid() | Surrogate primary key (UUID v4). | source.admatix_warehouse.sim.campaigns | none recorded |
| scenario_id | uuid | no |  | Parent scenario (FK sim.scenarios). | source.admatix_warehouse.sim.campaigns | none recorded |
| sim_campaign_key | text | no |  | Human-readable campaign key, unique within a scenario. | source.admatix_warehouse.sim.campaigns | none recorded |
| name | text | no |  | Human-readable campaign name. | source.admatix_warehouse.sim.campaigns | none recorded |
| channel | text | no |  | Simulated channel (search, social, display, ...). | source.admatix_warehouse.sim.campaigns | none recorded |
| daily_budget | numeric | no | 0 | Simulated daily budget. | source.admatix_warehouse.sim.campaigns | none recorded |
| base_ctr | numeric | no | 0 | Baseline click-through rate the simulator draws from. | source.admatix_warehouse.sim.campaigns | none recorded |
| base_cvr | numeric | no | 0 | Baseline conversion rate the simulator draws from. | source.admatix_warehouse.sim.campaigns | none recorded |
| base_aov | numeric | no | 0 | Baseline average order value the simulator draws from. | source.admatix_warehouse.sim.campaigns | none recorded |
| params | jsonb | no | '{}'::jsonb | Additional campaign-specific simulation parameters as jsonb. | source.admatix_warehouse.sim.campaigns | none recorded |
| created_at | timestamp with time zone | no | now() | UTC creation timestamp. | source.admatix_warehouse.sim.campaigns | none recorded |

## sim.events

The event stream produced by the simulator: impressions, clicks, conversions and spend, each tagged with the treatment arm. This is the observable data the verifier consumes; the true effect behind it lives in sim.true_effects.

- Source lineage: source.admatix_warehouse.sim.events
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| sim_event_id | bigint | no |  | Surrogate primary key (identity). | source.admatix_warehouse.sim.events | none recorded |
| scenario_id | uuid | no |  | Parent scenario (FK sim.scenarios). | source.admatix_warehouse.sim.events | none recorded |
| sim_campaign_id | uuid | no |  | Simulated campaign the event belongs to (FK sim.campaigns). | source.admatix_warehouse.sim.events | none recorded |
| true_effect_id | uuid | yes |  | The true effect that generated this event, if any (FK sim.true_effects). Used only by the scorer. | source.admatix_warehouse.sim.events | none recorded |
| event_type | event_type | no |  | Event type: impression \| click \| conversion \| spend. | source.admatix_warehouse.sim.events | none recorded |
| treatment_arm | treatment_arm | no |  | Experimental arm of the user: treatment \| control \| holdout. | source.admatix_warehouse.sim.events | none recorded |
| sim_day | integer | no |  | Simulated day index within the scenario horizon. | source.admatix_warehouse.sim.events | none recorded |
| event_ts | timestamp with time zone | no |  | UTC timestamp of the simulated event. | source.admatix_warehouse.sim.events | none recorded |
| user_key | text | no |  | Synthetic user identifier. | source.admatix_warehouse.sim.events | none recorded |
| quantity | numeric | no | 1 | Event quantity (1 per discrete event; supports fractional credit). | source.admatix_warehouse.sim.events | none recorded |
| spend | numeric | no | 0 | Spend attributed to the event. | source.admatix_warehouse.sim.events | none recorded |
| revenue | numeric | no | 0 | Revenue attributed to the event. | source.admatix_warehouse.sim.events | none recorded |
| attributes | jsonb | no | '{}'::jsonb | Additional simulated event attributes as jsonb. | source.admatix_warehouse.sim.events | none recorded |
| created_at | timestamp with time zone | no | now() | UTC timestamp the event row was written. | source.admatix_warehouse.sim.events | none recorded |

## sim.scenarios

A configured simulation scenario. random_seed and config_hash make every scenario fully reproducible.

- Source lineage: source.admatix_warehouse.sim.scenarios
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| scenario_id | uuid | no | gen_random_uuid() | Surrogate primary key (UUID v4). | source.admatix_warehouse.sim.scenarios | none recorded |
| scenario_key | text | no |  | Stable human-readable scenario identifier. | source.admatix_warehouse.sim.scenarios | none recorded |
| name | text | no |  | Human-readable scenario name. | source.admatix_warehouse.sim.scenarios | none recorded |
| description | text | yes |  | Description of what the scenario exercises. | source.admatix_warehouse.sim.scenarios | none recorded |
| random_seed | bigint | no |  | RNG seed; fixing it makes the scenario deterministic and reproducible. | source.admatix_warehouse.sim.scenarios | none recorded |
| horizon_days | integer | no | 30 | Number of simulated days the scenario runs. | source.admatix_warehouse.sim.scenarios | none recorded |
| config | jsonb | no | '{}'::jsonb | Full scenario configuration as jsonb (market params, noise, agent behaviours). | source.admatix_warehouse.sim.scenarios | none recorded |
| config_hash | character | no |  | SHA-256 (hex) of the config, for integrity and reproducibility checks. | source.admatix_warehouse.sim.scenarios | none recorded |
| created_at | timestamp with time zone | no | now() | UTC creation timestamp. | source.admatix_warehouse.sim.scenarios | none recorded |

## sim.true_effects

The hidden ground-truth incremental lift for each simulated intervention -- the answer key. The verification pipeline must NOT read this table; only the scorer reads it to grade the verifier estimate against truth.

- Source lineage: source.admatix_warehouse.sim.true_effects
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| true_effect_id | uuid | no | gen_random_uuid() | Surrogate primary key (UUID v4). | source.admatix_warehouse.sim.true_effects | none recorded |
| scenario_id | uuid | no |  | Parent scenario (FK sim.scenarios). | source.admatix_warehouse.sim.true_effects | none recorded |
| sim_campaign_id | uuid | no |  | Simulated campaign the effect applies to (FK sim.campaigns). | source.admatix_warehouse.sim.true_effects | none recorded |
| intervention_key | text | no |  | Identifier of the intervention whose true effect this row records (e.g. "budget_+20pct"). | source.admatix_warehouse.sim.true_effects | none recorded |
| metric | text | no |  | The metric the effect is expressed on (conversions, revenue, ...). | source.admatix_warehouse.sim.true_effects | none recorded |
| true_incremental_lift | numeric | no |  | The true incremental lift in absolute metric units. The ground truth. | source.admatix_warehouse.sim.true_effects | none recorded |
| true_lift_pct | numeric | yes |  | The true incremental lift as a percentage of baseline. | source.admatix_warehouse.sim.true_effects | none recorded |
| true_baseline | numeric | yes |  | The true counterfactual baseline (metric value with no intervention). | source.admatix_warehouse.sim.true_effects | none recorded |
| effect_start_day | integer | no | 0 | Simulated day the effect begins. | source.admatix_warehouse.sim.true_effects | none recorded |
| effect_end_day | integer | yes |  | Simulated day the effect ends; null if it persists to the horizon. | source.admatix_warehouse.sim.true_effects | none recorded |
| noise_sd | numeric | no | 0 | Standard deviation of the noise the simulator adds around the true effect. | source.admatix_warehouse.sim.true_effects | none recorded |
| notes | text | yes |  | Optional notes on how the effect was configured. | source.admatix_warehouse.sim.true_effects | none recorded |
| created_at | timestamp with time zone | no | now() | UTC creation timestamp. | source.admatix_warehouse.sim.true_effects | none recorded |

## warehouse.admatix_accounts_seed

Phase 2 fixture ad accounts derived from committed connector fixtures.

- Source lineage: seed.admatix_warehouse.admatix_accounts_seed
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| account_business_key | text | yes |  | Conformed account business key. | seed.admatix_warehouse.admatix_accounts_seed | none recorded |
| tenant_id | uuid | yes |  | Owning tenant UUID used for fixture rows. | seed.admatix_warehouse.admatix_accounts_seed | none recorded |
| platform | text | yes |  | Source platform enum value. | seed.admatix_warehouse.admatix_accounts_seed | none recorded |
| external_account_id | text | yes |  | Platform-native account identifier. | seed.admatix_warehouse.admatix_accounts_seed | none recorded |
| account_name | text | yes |  | Human-readable account name. | seed.admatix_warehouse.admatix_accounts_seed | none recorded |
| currency | text | yes |  | ISO-4217 account currency. | seed.admatix_warehouse.admatix_accounts_seed | none recorded |
| timezone | text | yes |  | IANA account timezone. | seed.admatix_warehouse.admatix_accounts_seed | none recorded |
| is_active | boolean | yes |  | True when the account is active. | seed.admatix_warehouse.admatix_accounts_seed | none recorded |

## warehouse.admatix_ad_sets_seed

Phase 2 fixture ad set and ad group records.

- Source lineage: seed.admatix_warehouse.admatix_ad_sets_seed
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| ad_set_business_key | text | yes |  | Conformed ad set business key. | seed.admatix_warehouse.admatix_ad_sets_seed | none recorded |
| campaign_business_key | text | yes |  | Parent campaign business key. | seed.admatix_warehouse.admatix_ad_sets_seed | none recorded |
| external_ad_set_id | text | yes |  | Platform-native ad set or ad group identifier. | seed.admatix_warehouse.admatix_ad_sets_seed | none recorded |
| ad_set_name | text | yes |  | Human-readable ad set name. | seed.admatix_warehouse.admatix_ad_sets_seed | none recorded |
| status | text | yes |  | Ad set lifecycle status. | seed.admatix_warehouse.admatix_ad_sets_seed | none recorded |
| bid_strategy | text | yes |  | Ad set bid strategy. | seed.admatix_warehouse.admatix_ad_sets_seed | none recorded |
| daily_budget | numeric | yes |  | Daily ad set budget. | seed.admatix_warehouse.admatix_ad_sets_seed | none recorded |
| optimization_goal | text | yes |  | Optimization goal. | seed.admatix_warehouse.admatix_ad_sets_seed | none recorded |

## warehouse.admatix_campaigns_seed

Phase 2 fixture campaigns derived from Google Ads and Meta Ads fixtures.

- Source lineage: seed.admatix_warehouse.admatix_campaigns_seed
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| campaign_business_key | text | yes |  | Conformed campaign business key. | seed.admatix_warehouse.admatix_campaigns_seed | none recorded |
| account_business_key | text | yes |  | Parent account business key. | seed.admatix_warehouse.admatix_campaigns_seed | none recorded |
| platform | text | yes |  | Source platform enum value. | seed.admatix_warehouse.admatix_campaigns_seed | none recorded |
| external_campaign_id | text | yes |  | Platform-native campaign identifier. | seed.admatix_warehouse.admatix_campaigns_seed | none recorded |
| campaign_name | text | yes |  | Human-readable campaign name. | seed.admatix_warehouse.admatix_campaigns_seed | none recorded |
| objective | text | yes |  | Campaign objective. | seed.admatix_warehouse.admatix_campaigns_seed | none recorded |
| status | text | yes |  | Campaign lifecycle status. | seed.admatix_warehouse.admatix_campaigns_seed | none recorded |
| daily_budget | numeric | yes |  | Daily campaign budget. | seed.admatix_warehouse.admatix_campaigns_seed | none recorded |
| lifetime_budget | numeric | yes |  | Lifetime campaign budget when present. | seed.admatix_warehouse.admatix_campaigns_seed | none recorded |
| start_date | date | yes |  | Campaign start date. | seed.admatix_warehouse.admatix_campaigns_seed | none recorded |
| end_date | date | yes |  | Campaign end date. | seed.admatix_warehouse.admatix_campaigns_seed | none recorded |
| bid_strategy | text | yes |  | Campaign bid strategy. | seed.admatix_warehouse.admatix_campaigns_seed | none recorded |

## warehouse.admatix_creative_metrics_seed

Small Phase 2 creative metric fixture rows.

- Source lineage: seed.admatix_warehouse.admatix_creative_metrics_seed
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| platform | text | yes |  | Source platform. | seed.admatix_warehouse.admatix_creative_metrics_seed | none recorded |
| external_account_id | text | yes |  | Platform-native account id. | seed.admatix_warehouse.admatix_creative_metrics_seed | none recorded |
| campaign_external_id | text | yes |  | Platform-native campaign id. | seed.admatix_warehouse.admatix_creative_metrics_seed | none recorded |
| creative_external_id | text | yes |  | Platform-native creative id. | seed.admatix_warehouse.admatix_creative_metrics_seed | none recorded |
| metric_date | date | yes |  | Metric date. | seed.admatix_warehouse.admatix_creative_metrics_seed | none recorded |
| spend | numeric | yes |  | Creative spend. | seed.admatix_warehouse.admatix_creative_metrics_seed | none recorded |
| impressions | bigint | yes |  | Creative impressions. | seed.admatix_warehouse.admatix_creative_metrics_seed | none recorded |
| clicks | bigint | yes |  | Creative clicks. | seed.admatix_warehouse.admatix_creative_metrics_seed | none recorded |
| conversions | numeric | yes |  | Creative conversions. | seed.admatix_warehouse.admatix_creative_metrics_seed | none recorded |
| frequency | numeric | yes |  | Average frequency. | seed.admatix_warehouse.admatix_creative_metrics_seed | none recorded |
| _source | text | yes |  | Logical seed source. | seed.admatix_warehouse.admatix_creative_metrics_seed | none recorded |
| _batch_id | text | yes |  | Seed batch identifier. | seed.admatix_warehouse.admatix_creative_metrics_seed | none recorded |
| _row_hash | double precision | yes |  | Stable row hash for deduplication. | seed.admatix_warehouse.admatix_creative_metrics_seed | none recorded |

## warehouse.admatix_creatives_seed

Phase 2 fixture creative records.

- Source lineage: seed.admatix_warehouse.admatix_creatives_seed
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| creative_business_key | text | yes |  | Conformed creative business key. | seed.admatix_warehouse.admatix_creatives_seed | none recorded |
| campaign_business_key | text | yes |  | Parent campaign business key. | seed.admatix_warehouse.admatix_creatives_seed | none recorded |
| ad_set_business_key | text | yes |  | Parent ad set business key. | seed.admatix_warehouse.admatix_creatives_seed | none recorded |
| external_creative_id | text | yes |  | Platform-native creative identifier. | seed.admatix_warehouse.admatix_creatives_seed | none recorded |
| creative_format | text | yes |  | Creative format. | seed.admatix_warehouse.admatix_creatives_seed | none recorded |
| headline | text | yes |  | Creative headline. | seed.admatix_warehouse.admatix_creatives_seed | none recorded |
| body_text | text | yes |  | Creative body text. | seed.admatix_warehouse.admatix_creatives_seed | none recorded |
| final_url | text | yes |  | Landing page URL. | seed.admatix_warehouse.admatix_creatives_seed | none recorded |
| policy_status | text | yes |  | Platform policy review status. | seed.admatix_warehouse.admatix_creatives_seed | none recorded |
| status | text | yes |  | Creative lifecycle status. | seed.admatix_warehouse.admatix_creatives_seed | none recorded |

## warehouse.admatix_first_party_orders_seed

Small Phase 2 first-party order fixture rows.

- Source lineage: seed.admatix_warehouse.admatix_first_party_orders_seed
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| external_account_id | text | yes |  | Account or store identifier. | seed.admatix_warehouse.admatix_first_party_orders_seed | none recorded |
| order_external_id | text | yes |  | Source-native order id. | seed.admatix_warehouse.admatix_first_party_orders_seed | none recorded |
| order_ts | timestamp with time zone | yes |  | UTC order timestamp. | seed.admatix_warehouse.admatix_first_party_orders_seed | none recorded |
| customer_key | text | yes |  | Hashed customer key. | seed.admatix_warehouse.admatix_first_party_orders_seed | none recorded |
| revenue | numeric | yes |  | Order revenue. | seed.admatix_warehouse.admatix_first_party_orders_seed | none recorded |
| gross_margin | numeric | yes |  | Order gross margin. | seed.admatix_warehouse.admatix_first_party_orders_seed | none recorded |
| currency | text | yes |  | ISO-4217 currency. | seed.admatix_warehouse.admatix_first_party_orders_seed | none recorded |
| channel | text | yes |  | Order channel. | seed.admatix_warehouse.admatix_first_party_orders_seed | none recorded |
| is_new_customer | integer | yes |  | One when first purchase. | seed.admatix_warehouse.admatix_first_party_orders_seed | none recorded |
| _source | text | yes |  | Logical seed source. | seed.admatix_warehouse.admatix_first_party_orders_seed | none recorded |
| _batch_id | text | yes |  | Seed batch identifier. | seed.admatix_warehouse.admatix_first_party_orders_seed | none recorded |
| _row_hash | double precision | yes |  | Stable row hash for deduplication. | seed.admatix_warehouse.admatix_first_party_orders_seed | none recorded |

## warehouse.admatix_platform_metrics_seed

Small Phase 2 daily platform metric fixture rows.

- Source lineage: seed.admatix_warehouse.admatix_platform_metrics_seed
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| platform | text | yes |  | Source platform. | seed.admatix_warehouse.admatix_platform_metrics_seed | none recorded |
| external_account_id | text | yes |  | Platform-native account id. | seed.admatix_warehouse.admatix_platform_metrics_seed | none recorded |
| campaign_external_id | text | yes |  | Platform-native campaign id. | seed.admatix_warehouse.admatix_platform_metrics_seed | none recorded |
| metric_date | date | yes |  | Metric date. | seed.admatix_warehouse.admatix_platform_metrics_seed | none recorded |
| spend | numeric | yes |  | Platform spend. | seed.admatix_warehouse.admatix_platform_metrics_seed | none recorded |
| impressions | bigint | yes |  | Platform impressions. | seed.admatix_warehouse.admatix_platform_metrics_seed | none recorded |
| clicks | bigint | yes |  | Platform clicks. | seed.admatix_warehouse.admatix_platform_metrics_seed | none recorded |
| conversions | numeric | yes |  | Platform conversions. | seed.admatix_warehouse.admatix_platform_metrics_seed | none recorded |
| platform_revenue | numeric | yes |  | Platform-attributed revenue. | seed.admatix_warehouse.admatix_platform_metrics_seed | none recorded |
| currency | text | yes |  | ISO-4217 currency. | seed.admatix_warehouse.admatix_platform_metrics_seed | none recorded |
| _source | text | yes |  | Logical seed source. | seed.admatix_warehouse.admatix_platform_metrics_seed | none recorded |
| _batch_id | text | yes |  | Seed batch identifier. | seed.admatix_warehouse.admatix_platform_metrics_seed | none recorded |
| _row_hash | integer | yes |  | Stable row hash for deduplication. | seed.admatix_warehouse.admatix_platform_metrics_seed | none recorded |

## warehouse.bronze_avazu

Empty Phase 2 bronze-compatible view for Avazu until WP-P ingestion lands.

- Source lineage: model.admatix_warehouse.bronze_avazu
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| bronze_id | bigint | yes |  | Surrogate bronze row id. | model.admatix_warehouse.bronze_avazu | none recorded |
| ad_id | text | yes |  | Source ad id. | model.admatix_warehouse.bronze_avazu | none recorded |
| click | smallint | yes |  | Click label. | model.admatix_warehouse.bronze_avazu | none recorded |
| hour_raw | text | yes |  | Raw hour string. | model.admatix_warehouse.bronze_avazu | none recorded |
| c1 | text | yes |  | Anonymised categorical field. | model.admatix_warehouse.bronze_avazu | none recorded |
| banner_pos | text | yes |  | Banner position. | model.admatix_warehouse.bronze_avazu | none recorded |
| site_id | text | yes |  | Site id. | model.admatix_warehouse.bronze_avazu | none recorded |
| site_domain | text | yes |  | Site domain. | model.admatix_warehouse.bronze_avazu | none recorded |
| site_category | text | yes |  | Site category. | model.admatix_warehouse.bronze_avazu | none recorded |
| app_id | text | yes |  | App id. | model.admatix_warehouse.bronze_avazu | none recorded |
| app_domain | text | yes |  | App domain. | model.admatix_warehouse.bronze_avazu | none recorded |
| app_category | text | yes |  | App category. | model.admatix_warehouse.bronze_avazu | none recorded |
| device_id | text | yes |  | Device id. | model.admatix_warehouse.bronze_avazu | none recorded |
| device_ip | text | yes |  | Device IP. | model.admatix_warehouse.bronze_avazu | none recorded |
| device_model | text | yes |  | Device model. | model.admatix_warehouse.bronze_avazu | none recorded |
| device_type | text | yes |  | Device type. | model.admatix_warehouse.bronze_avazu | none recorded |
| device_conn_type | text | yes |  | Device connection type. | model.admatix_warehouse.bronze_avazu | none recorded |
| raw | jsonb | yes |  | Lossless raw row JSON. | model.admatix_warehouse.bronze_avazu | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Load timestamp. | model.admatix_warehouse.bronze_avazu | none recorded |
| _source | text | yes |  | Logical source. | model.admatix_warehouse.bronze_avazu | none recorded |
| _batch_id | text | yes |  | Batch identifier. | model.admatix_warehouse.bronze_avazu | none recorded |
| _row_hash | character | yes |  | Stable row hash. | model.admatix_warehouse.bronze_avazu | none recorded |

## warehouse.bronze_creative_metrics_fixture

Bronze view over Phase 2 fixture creative metric seed rows.

- Source lineage: model.admatix_warehouse.bronze_creative_metrics_fixture
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| bronze_id | bigint | yes |  | Deterministic surrogate row number for fixture bronze rows. | model.admatix_warehouse.bronze_creative_metrics_fixture | none recorded |
| platform | text | yes |  | Source platform identifier. | model.admatix_warehouse.bronze_creative_metrics_fixture | none recorded |
| external_account_id | text | yes |  | Platform-native account identifier. | model.admatix_warehouse.bronze_creative_metrics_fixture | none recorded |
| campaign_external_id | text | yes |  | Platform-native campaign identifier. | model.admatix_warehouse.bronze_creative_metrics_fixture | none recorded |
| creative_external_id | text | yes |  | Platform-native creative identifier. | model.admatix_warehouse.bronze_creative_metrics_fixture | none recorded |
| metric_date | date | yes |  | Date the creative metrics cover. | model.admatix_warehouse.bronze_creative_metrics_fixture | none recorded |
| spend | double precision | yes |  | Spend reported for the creative. | model.admatix_warehouse.bronze_creative_metrics_fixture | none recorded |
| impressions | bigint | yes |  | Impressions reported for the creative. | model.admatix_warehouse.bronze_creative_metrics_fixture | none recorded |
| clicks | bigint | yes |  | Clicks reported for the creative. | model.admatix_warehouse.bronze_creative_metrics_fixture | none recorded |
| conversions | double precision | yes |  | Conversions reported for the creative. | model.admatix_warehouse.bronze_creative_metrics_fixture | none recorded |
| frequency | double precision | yes |  | Average creative frequency. | model.admatix_warehouse.bronze_creative_metrics_fixture | none recorded |
| raw | jsonb | yes |  | Lossless JSON representation of the seed row. | model.admatix_warehouse.bronze_creative_metrics_fixture | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Timestamp the bronze view row is materialised. | model.admatix_warehouse.bronze_creative_metrics_fixture | none recorded |
| _source | text | yes |  | Logical source identifier. | model.admatix_warehouse.bronze_creative_metrics_fixture | none recorded |
| _batch_id | text | yes |  | Ingest batch identifier. | model.admatix_warehouse.bronze_creative_metrics_fixture | none recorded |
| _row_hash | character | yes |  | Stable SHA-256 row hash for fixture deduplication. | model.admatix_warehouse.bronze_creative_metrics_fixture | none recorded |

## warehouse.bronze_criteo_uplift

Empty Phase 2 bronze-compatible view for Criteo Uplift until WP-P ingestion lands.

- Source lineage: model.admatix_warehouse.bronze_criteo_uplift
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| bronze_id | bigint | yes |  | Surrogate bronze row id. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |
| f0 | double precision | yes |  | Anonymised numeric feature 0. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |
| f1 | double precision | yes |  | Anonymised numeric feature 1. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |
| f2 | double precision | yes |  | Anonymised numeric feature 2. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |
| f3 | double precision | yes |  | Anonymised numeric feature 3. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |
| f4 | double precision | yes |  | Anonymised numeric feature 4. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |
| f5 | double precision | yes |  | Anonymised numeric feature 5. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |
| f6 | double precision | yes |  | Anonymised numeric feature 6. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |
| f7 | double precision | yes |  | Anonymised numeric feature 7. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |
| f8 | double precision | yes |  | Anonymised numeric feature 8. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |
| f9 | double precision | yes |  | Anonymised numeric feature 9. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |
| f10 | double precision | yes |  | Anonymised numeric feature 10. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |
| f11 | double precision | yes |  | Anonymised numeric feature 11. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |
| treatment | smallint | yes |  | Treatment flag. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |
| conversion | smallint | yes |  | Conversion label. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |
| visit | smallint | yes |  | Visit label. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |
| exposure | smallint | yes |  | Exposure label. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |
| raw | jsonb | yes |  | Lossless raw row JSON. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Load timestamp. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |
| _source | text | yes |  | Logical source. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |
| _batch_id | text | yes |  | Batch identifier. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |
| _row_hash | character | yes |  | Stable row hash. | model.admatix_warehouse.bronze_criteo_uplift | none recorded |

## warehouse.bronze_first_party_orders

Bronze view over Phase 2 first-party order seed rows preserving ingest metadata.

- Source lineage: model.admatix_warehouse.bronze_first_party_orders
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| bronze_id | bigint | yes |  | Deterministic surrogate row number for fixture bronze rows. | model.admatix_warehouse.bronze_first_party_orders | none recorded |
| external_account_id | text | yes |  | Account or store identifier. | model.admatix_warehouse.bronze_first_party_orders | none recorded |
| order_external_id | text | yes |  | Source-native order id. | model.admatix_warehouse.bronze_first_party_orders | none recorded |
| order_ts | timestamp with time zone | yes |  | UTC order timestamp. | model.admatix_warehouse.bronze_first_party_orders | none recorded |
| customer_key | text | yes |  | Hashed customer identifier. | model.admatix_warehouse.bronze_first_party_orders | none recorded |
| revenue | double precision | yes |  | Order revenue. | model.admatix_warehouse.bronze_first_party_orders | none recorded |
| gross_margin | double precision | yes |  | Order gross margin. | model.admatix_warehouse.bronze_first_party_orders | none recorded |
| currency | text | yes |  | ISO-4217 currency code. | model.admatix_warehouse.bronze_first_party_orders | none recorded |
| channel | text | yes |  | Order channel. | model.admatix_warehouse.bronze_first_party_orders | none recorded |
| is_new_customer | smallint | yes |  | One when the customer is new. | model.admatix_warehouse.bronze_first_party_orders | none recorded |
| raw | jsonb | yes |  | Lossless JSON representation of the seed row. | model.admatix_warehouse.bronze_first_party_orders | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Timestamp the bronze view row is materialised. | model.admatix_warehouse.bronze_first_party_orders | none recorded |
| _source | text | yes |  | Logical source identifier. | model.admatix_warehouse.bronze_first_party_orders | none recorded |
| _batch_id | text | yes |  | Ingest batch identifier. | model.admatix_warehouse.bronze_first_party_orders | none recorded |
| _row_hash | character | yes |  | Stable SHA-256 row hash for fixture deduplication. | model.admatix_warehouse.bronze_first_party_orders | none recorded |

## warehouse.bronze_hillstrom

Empty Phase 2 bronze-compatible view for Hillstrom until WP-P ingestion lands.

- Source lineage: model.admatix_warehouse.bronze_hillstrom
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| bronze_id | bigint | yes |  | Surrogate bronze row id. | model.admatix_warehouse.bronze_hillstrom | none recorded |
| recency | integer | yes |  | Months since last purchase. | model.admatix_warehouse.bronze_hillstrom | none recorded |
| history_segment | text | yes |  | Historical spend segment. | model.admatix_warehouse.bronze_hillstrom | none recorded |
| history | double precision | yes |  | Prior purchase history. | model.admatix_warehouse.bronze_hillstrom | none recorded |
| mens | smallint | yes |  | Prior mens category flag. | model.admatix_warehouse.bronze_hillstrom | none recorded |
| womens | smallint | yes |  | Prior womens category flag. | model.admatix_warehouse.bronze_hillstrom | none recorded |
| zip_code | text | yes |  | Zip-code class. | model.admatix_warehouse.bronze_hillstrom | none recorded |
| newbie | smallint | yes |  | New customer flag. | model.admatix_warehouse.bronze_hillstrom | none recorded |
| channel | text | yes |  | Prior purchase channel. | model.admatix_warehouse.bronze_hillstrom | none recorded |
| segment | text | yes |  | Treatment segment. | model.admatix_warehouse.bronze_hillstrom | none recorded |
| visit | smallint | yes |  | Visit label. | model.admatix_warehouse.bronze_hillstrom | none recorded |
| conversion | smallint | yes |  | Conversion label. | model.admatix_warehouse.bronze_hillstrom | none recorded |
| spend | double precision | yes |  | Outcome spend. | model.admatix_warehouse.bronze_hillstrom | none recorded |
| raw | jsonb | yes |  | Lossless raw row JSON. | model.admatix_warehouse.bronze_hillstrom | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Load timestamp. | model.admatix_warehouse.bronze_hillstrom | none recorded |
| _source | text | yes |  | Logical source. | model.admatix_warehouse.bronze_hillstrom | none recorded |
| _batch_id | text | yes |  | Batch identifier. | model.admatix_warehouse.bronze_hillstrom | none recorded |
| _row_hash | character | yes |  | Stable row hash. | model.admatix_warehouse.bronze_hillstrom | none recorded |

## warehouse.bronze_ipinyou

Empty Phase 2 bronze-compatible view for iPinYou until WP-P ingestion lands.

- Source lineage: model.admatix_warehouse.bronze_ipinyou
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| bronze_id | bigint | yes |  | Surrogate bronze row id. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| bid_id | text | yes |  | Source bid id. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| log_type | text | yes |  | Log record type. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| timestamp_raw | text | yes |  | Raw timestamp string. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| ipinyou_id | text | yes |  | Anonymised user id. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| user_agent | text | yes |  | User agent. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| ip | text | yes |  | Anonymised IP. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| region | text | yes |  | Region code. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| city | text | yes |  | City code. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| ad_exchange | text | yes |  | Ad exchange id. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| domain | text | yes |  | Publisher domain. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| url | text | yes |  | Page URL. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| ad_slot_id | text | yes |  | Ad slot id. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| ad_slot_width | integer | yes |  | Slot width. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| ad_slot_height | integer | yes |  | Slot height. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| ad_slot_floor | double precision | yes |  | Slot floor price. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| bidding_price | double precision | yes |  | Bid price. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| paying_price | double precision | yes |  | Paid clearing price. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| creative_id | text | yes |  | Creative id. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| advertiser_id | text | yes |  | Advertiser id. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| is_click | smallint | yes |  | Click flag. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| is_conversion | smallint | yes |  | Conversion flag. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| raw | jsonb | yes |  | Lossless raw row JSON. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Load timestamp. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| _source | text | yes |  | Logical source. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| _batch_id | text | yes |  | Batch identifier. | model.admatix_warehouse.bronze_ipinyou | none recorded |
| _row_hash | character | yes |  | Stable row hash. | model.admatix_warehouse.bronze_ipinyou | none recorded |

## warehouse.bronze_platform_metrics

Bronze view over Phase 2 fixture platform metric seed rows preserving ingest metadata.

- Source lineage: model.admatix_warehouse.bronze_platform_metrics
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| bronze_id | bigint | yes |  | Deterministic surrogate row number for fixture bronze rows. | model.admatix_warehouse.bronze_platform_metrics | none recorded |
| platform | text | yes |  | Source platform identifier. | model.admatix_warehouse.bronze_platform_metrics | none recorded |
| external_account_id | text | yes |  | Platform-native account identifier. | model.admatix_warehouse.bronze_platform_metrics | none recorded |
| campaign_external_id | text | yes |  | Platform-native campaign identifier. | model.admatix_warehouse.bronze_platform_metrics | none recorded |
| metric_date | date | yes |  | Date the platform metrics cover. | model.admatix_warehouse.bronze_platform_metrics | none recorded |
| spend | double precision | yes |  | Spend reported by the platform. | model.admatix_warehouse.bronze_platform_metrics | none recorded |
| impressions | bigint | yes |  | Impressions reported by the platform. | model.admatix_warehouse.bronze_platform_metrics | none recorded |
| clicks | bigint | yes |  | Clicks reported by the platform. | model.admatix_warehouse.bronze_platform_metrics | none recorded |
| conversions | double precision | yes |  | Conversions reported by the platform. | model.admatix_warehouse.bronze_platform_metrics | none recorded |
| platform_revenue | double precision | yes |  | Platform-attributed revenue; directional only. | model.admatix_warehouse.bronze_platform_metrics | none recorded |
| currency | text | yes |  | ISO-4217 currency code. | model.admatix_warehouse.bronze_platform_metrics | none recorded |
| raw | jsonb | yes |  | Lossless JSON representation of the seed row. | model.admatix_warehouse.bronze_platform_metrics | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Timestamp the bronze view row is materialised. | model.admatix_warehouse.bronze_platform_metrics | none recorded |
| _source | text | yes |  | Logical source identifier. | model.admatix_warehouse.bronze_platform_metrics | none recorded |
| _batch_id | text | yes |  | Ingest batch identifier. | model.admatix_warehouse.bronze_platform_metrics | none recorded |
| _row_hash | character | yes |  | Stable SHA-256 row hash for fixture deduplication. | model.admatix_warehouse.bronze_platform_metrics | none recorded |

## warehouse.bronze_sim_events

Empty Phase 2 bronze-compatible view for simulator events until WP-Q writes events.

- Source lineage: model.admatix_warehouse.bronze_sim_events
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| bronze_id | bigint | yes |  | Surrogate bronze row id. | model.admatix_warehouse.bronze_sim_events | none recorded |
| scenario_id | text | yes |  | Simulator scenario id. | model.admatix_warehouse.bronze_sim_events | none recorded |
| sim_campaign_id | text | yes |  | Simulator campaign id. | model.admatix_warehouse.bronze_sim_events | none recorded |
| event_type | text | yes |  | Simulator event type. | model.admatix_warehouse.bronze_sim_events | none recorded |
| event_ts | timestamp with time zone | yes |  | Event timestamp. | model.admatix_warehouse.bronze_sim_events | none recorded |
| user_key | text | yes |  | Synthetic user key. | model.admatix_warehouse.bronze_sim_events | none recorded |
| treatment_arm | text | yes |  | Treatment arm. | model.admatix_warehouse.bronze_sim_events | none recorded |
| spend | double precision | yes |  | Event spend. | model.admatix_warehouse.bronze_sim_events | none recorded |
| revenue | double precision | yes |  | Event revenue. | model.admatix_warehouse.bronze_sim_events | none recorded |
| raw | jsonb | yes |  | Lossless raw row JSON. | model.admatix_warehouse.bronze_sim_events | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Load timestamp. | model.admatix_warehouse.bronze_sim_events | none recorded |
| _source | text | yes |  | Logical source. | model.admatix_warehouse.bronze_sim_events | none recorded |
| _batch_id | text | yes |  | Batch identifier. | model.admatix_warehouse.bronze_sim_events | none recorded |
| _row_hash | character | yes |  | Stable row hash. | model.admatix_warehouse.bronze_sim_events | none recorded |

## warehouse.dim_account

SCD Type 1 ad account dimension.

- Source lineage: model.admatix_warehouse.dim_account
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| account_key | bigint | yes |  | Surrogate account key. | model.admatix_warehouse.dim_account | none recorded |
| account_business_key | text | yes |  | Stable account business key. | model.admatix_warehouse.dim_account | none recorded |
| tenant_id | uuid | yes |  | Owning tenant UUID. | model.admatix_warehouse.dim_account | none recorded |
| platform | ad_platform | yes |  | Source platform. | model.admatix_warehouse.dim_account | none recorded |
| external_account_id | text | yes |  | Platform-native account id. | model.admatix_warehouse.dim_account | none recorded |
| account_name | text | yes |  | Account name. | model.admatix_warehouse.dim_account | none recorded |
| currency | character | yes |  | Account currency. | model.admatix_warehouse.dim_account | none recorded |
| timezone | text | yes |  | Account timezone. | model.admatix_warehouse.dim_account | none recorded |
| is_active | boolean | yes |  | Active flag. | model.admatix_warehouse.dim_account | none recorded |
| updated_at | timestamp with time zone | yes |  | Refresh timestamp. | model.admatix_warehouse.dim_account | none recorded |

## warehouse.dim_ad_set

SCD Type 2 ad set dimension sourced from dbt snapshots.

- Source lineage: model.admatix_warehouse.dim_ad_set
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| ad_set_key | bigint | yes |  | Surrogate ad set version key. | model.admatix_warehouse.dim_ad_set | none recorded |
| ad_set_business_key | text | yes |  | Stable ad set business key. | model.admatix_warehouse.dim_ad_set | none recorded |
| campaign_key | bigint | yes |  | Parent campaign surrogate key. | model.admatix_warehouse.dim_ad_set | none recorded |
| external_ad_set_id | text | yes |  | Platform-native ad set id. | model.admatix_warehouse.dim_ad_set | none recorded |
| ad_set_name | text | yes |  | Ad set name. | model.admatix_warehouse.dim_ad_set | none recorded |
| status | entity_status | yes |  | Ad set status. | model.admatix_warehouse.dim_ad_set | none recorded |
| bid_strategy | text | yes |  | Bid strategy. | model.admatix_warehouse.dim_ad_set | none recorded |
| daily_budget | numeric | yes |  | Daily budget. | model.admatix_warehouse.dim_ad_set | none recorded |
| optimization_goal | text | yes |  | Optimization goal. | model.admatix_warehouse.dim_ad_set | none recorded |
| valid_from | timestamp without time zone | yes |  | Version effective timestamp. | model.admatix_warehouse.dim_ad_set | none recorded |
| valid_to | timestamp with time zone | yes |  | Version end timestamp or infinity. | model.admatix_warehouse.dim_ad_set | none recorded |
| is_current | boolean | yes |  | Current-version flag. | model.admatix_warehouse.dim_ad_set | none recorded |
| row_hash | character | yes |  | Tracked attribute hash. | model.admatix_warehouse.dim_ad_set | none recorded |

## warehouse.dim_ad_set_snapshot

dbt SCD-2 snapshot for ad set attributes.

- Source lineage: snapshot.admatix_warehouse.dim_ad_set_snapshot
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| ad_set_business_key | text | yes |  | Stable ad set business key. | snapshot.admatix_warehouse.dim_ad_set_snapshot | none recorded |
| campaign_business_key | text | yes |  | Parent campaign business key. | snapshot.admatix_warehouse.dim_ad_set_snapshot | none recorded |
| external_ad_set_id | text | yes |  | Platform-native ad set id. | snapshot.admatix_warehouse.dim_ad_set_snapshot | none recorded |
| ad_set_name | text | yes |  | Ad set name. | snapshot.admatix_warehouse.dim_ad_set_snapshot | none recorded |
| status | entity_status | yes |  | Ad set status. | snapshot.admatix_warehouse.dim_ad_set_snapshot | none recorded |
| bid_strategy | text | yes |  | Bid strategy. | snapshot.admatix_warehouse.dim_ad_set_snapshot | none recorded |
| daily_budget | numeric | yes |  | Daily budget. | snapshot.admatix_warehouse.dim_ad_set_snapshot | none recorded |
| optimization_goal | text | yes |  | Optimization goal. | snapshot.admatix_warehouse.dim_ad_set_snapshot | none recorded |
| is_current | boolean | yes |  | Source current marker for initial Phase 2 rows. | snapshot.admatix_warehouse.dim_ad_set_snapshot | none recorded |
| row_hash | character | yes |  | Tracked attribute hash. | snapshot.admatix_warehouse.dim_ad_set_snapshot | none recorded |
| dbt_scd_id | text | yes |  | dbt snapshot SCD id. | snapshot.admatix_warehouse.dim_ad_set_snapshot | none recorded |
| dbt_updated_at | timestamp without time zone | yes |  | dbt snapshot update timestamp. | snapshot.admatix_warehouse.dim_ad_set_snapshot | none recorded |
| valid_from | timestamp without time zone | yes |  | Snapshot validity start timestamp. | snapshot.admatix_warehouse.dim_ad_set_snapshot | none recorded |
| valid_to | timestamp without time zone | yes |  | Snapshot validity end timestamp. | snapshot.admatix_warehouse.dim_ad_set_snapshot | none recorded |

## warehouse.dim_audience

SCD Type 1 audience dimension.

- Source lineage: model.admatix_warehouse.dim_audience
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| audience_key | bigint | yes |  | Surrogate audience key. | model.admatix_warehouse.dim_audience | none recorded |
| audience_business_key | text | yes |  | Audience business key. | model.admatix_warehouse.dim_audience | none recorded |
| audience_name | text | yes |  | Audience name. | model.admatix_warehouse.dim_audience | none recorded |
| audience_type | text | yes |  | Audience type. | model.admatix_warehouse.dim_audience | none recorded |
| platform | ad_platform | yes |  | Optional platform. | model.admatix_warehouse.dim_audience | none recorded |
| size_estimate | bigint | yes |  | Estimated audience size. | model.admatix_warehouse.dim_audience | none recorded |
| description | text | yes |  | Audience description. | model.admatix_warehouse.dim_audience | none recorded |

## warehouse.dim_campaign

SCD Type 2 campaign dimension sourced from dbt snapshots.

- Source lineage: model.admatix_warehouse.dim_campaign
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| campaign_key | bigint | yes |  | Surrogate campaign version key. | model.admatix_warehouse.dim_campaign | none recorded |
| campaign_business_key | text | yes |  | Stable campaign business key. | model.admatix_warehouse.dim_campaign | none recorded |
| account_key | bigint | yes |  | Surrogate account key. | model.admatix_warehouse.dim_campaign | none recorded |
| platform | ad_platform | yes |  | Source platform. | model.admatix_warehouse.dim_campaign | none recorded |
| external_campaign_id | text | yes |  | Platform-native campaign id. | model.admatix_warehouse.dim_campaign | none recorded |
| campaign_name | text | yes |  | Campaign name. | model.admatix_warehouse.dim_campaign | none recorded |
| objective | text | yes |  | Campaign objective. | model.admatix_warehouse.dim_campaign | none recorded |
| status | entity_status | yes |  | Campaign status. | model.admatix_warehouse.dim_campaign | none recorded |
| daily_budget | numeric | yes |  | Daily budget. | model.admatix_warehouse.dim_campaign | none recorded |
| lifetime_budget | numeric | yes |  | Lifetime budget. | model.admatix_warehouse.dim_campaign | none recorded |
| start_date | date | yes |  | Start date. | model.admatix_warehouse.dim_campaign | none recorded |
| end_date | date | yes |  | End date. | model.admatix_warehouse.dim_campaign | none recorded |
| valid_from | timestamp without time zone | yes |  | Version effective timestamp. | model.admatix_warehouse.dim_campaign | none recorded |
| valid_to | timestamp with time zone | yes |  | Version end timestamp or infinity. | model.admatix_warehouse.dim_campaign | none recorded |
| is_current | boolean | yes |  | Current-version flag. | model.admatix_warehouse.dim_campaign | none recorded |
| row_hash | character | yes |  | Tracked attribute hash. | model.admatix_warehouse.dim_campaign | none recorded |

## warehouse.dim_campaign_snapshot

dbt SCD-2 snapshot for campaign attributes.

- Source lineage: snapshot.admatix_warehouse.dim_campaign_snapshot
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| campaign_business_key | text | yes |  | Stable campaign business key. | snapshot.admatix_warehouse.dim_campaign_snapshot | none recorded |
| account_business_key | text | yes |  | Parent account business key. | snapshot.admatix_warehouse.dim_campaign_snapshot | none recorded |
| platform | ad_platform | yes |  | Source platform. | snapshot.admatix_warehouse.dim_campaign_snapshot | none recorded |
| external_campaign_id | text | yes |  | Platform-native campaign id. | snapshot.admatix_warehouse.dim_campaign_snapshot | none recorded |
| campaign_name | text | yes |  | Campaign name. | snapshot.admatix_warehouse.dim_campaign_snapshot | none recorded |
| objective | text | yes |  | Campaign objective. | snapshot.admatix_warehouse.dim_campaign_snapshot | none recorded |
| status | entity_status | yes |  | Campaign status. | snapshot.admatix_warehouse.dim_campaign_snapshot | none recorded |
| daily_budget | numeric | yes |  | Daily budget. | snapshot.admatix_warehouse.dim_campaign_snapshot | none recorded |
| lifetime_budget | numeric | yes |  | Lifetime budget. | snapshot.admatix_warehouse.dim_campaign_snapshot | none recorded |
| start_date | date | yes |  | Start date. | snapshot.admatix_warehouse.dim_campaign_snapshot | none recorded |
| end_date | date | yes |  | End date. | snapshot.admatix_warehouse.dim_campaign_snapshot | none recorded |
| bid_strategy | text | yes |  | Bid strategy. | snapshot.admatix_warehouse.dim_campaign_snapshot | none recorded |
| is_current | boolean | yes |  | Source current marker for initial Phase 2 rows. | snapshot.admatix_warehouse.dim_campaign_snapshot | none recorded |
| row_hash | character | yes |  | Tracked attribute hash. | snapshot.admatix_warehouse.dim_campaign_snapshot | none recorded |
| dbt_scd_id | text | yes |  | dbt snapshot SCD id. | snapshot.admatix_warehouse.dim_campaign_snapshot | none recorded |
| dbt_updated_at | timestamp without time zone | yes |  | dbt snapshot update timestamp. | snapshot.admatix_warehouse.dim_campaign_snapshot | none recorded |
| valid_from | timestamp without time zone | yes |  | Snapshot validity start timestamp. | snapshot.admatix_warehouse.dim_campaign_snapshot | none recorded |
| valid_to | timestamp without time zone | yes |  | Snapshot validity end timestamp. | snapshot.admatix_warehouse.dim_campaign_snapshot | none recorded |

## warehouse.dim_creative

SCD Type 2 creative dimension sourced from dbt snapshots.

- Source lineage: model.admatix_warehouse.dim_creative
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| creative_key | bigint | yes |  | Surrogate creative version key. | model.admatix_warehouse.dim_creative | none recorded |
| creative_business_key | text | yes |  | Stable creative business key. | model.admatix_warehouse.dim_creative | none recorded |
| campaign_key | bigint | yes |  | Parent campaign surrogate key. | model.admatix_warehouse.dim_creative | none recorded |
| ad_set_key | bigint | yes |  | Optional parent ad set key. | model.admatix_warehouse.dim_creative | none recorded |
| external_creative_id | text | yes |  | Platform-native creative id. | model.admatix_warehouse.dim_creative | none recorded |
| creative_format | text | yes |  | Creative format. | model.admatix_warehouse.dim_creative | none recorded |
| headline | text | yes |  | Creative headline. | model.admatix_warehouse.dim_creative | none recorded |
| body_text | text | yes |  | Creative body copy. | model.admatix_warehouse.dim_creative | none recorded |
| final_url | text | yes |  | Landing URL. | model.admatix_warehouse.dim_creative | none recorded |
| policy_status | text | yes |  | Platform policy status. | model.admatix_warehouse.dim_creative | none recorded |
| status | entity_status | yes |  | Creative status. | model.admatix_warehouse.dim_creative | none recorded |
| valid_from | timestamp without time zone | yes |  | Version effective timestamp. | model.admatix_warehouse.dim_creative | none recorded |
| valid_to | timestamp with time zone | yes |  | Version end timestamp or infinity. | model.admatix_warehouse.dim_creative | none recorded |
| is_current | boolean | yes |  | Current-version flag. | model.admatix_warehouse.dim_creative | none recorded |
| row_hash | character | yes |  | Tracked attribute hash. | model.admatix_warehouse.dim_creative | none recorded |

## warehouse.dim_creative_snapshot

dbt SCD-2 snapshot for creative attributes.

- Source lineage: snapshot.admatix_warehouse.dim_creative_snapshot
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| creative_business_key | text | yes |  | Stable creative business key. | snapshot.admatix_warehouse.dim_creative_snapshot | none recorded |
| campaign_business_key | text | yes |  | Parent campaign business key. | snapshot.admatix_warehouse.dim_creative_snapshot | none recorded |
| ad_set_business_key | text | yes |  | Parent ad set business key. | snapshot.admatix_warehouse.dim_creative_snapshot | none recorded |
| external_creative_id | text | yes |  | Platform-native creative id. | snapshot.admatix_warehouse.dim_creative_snapshot | none recorded |
| creative_format | text | yes |  | Creative format. | snapshot.admatix_warehouse.dim_creative_snapshot | none recorded |
| headline | text | yes |  | Creative headline. | snapshot.admatix_warehouse.dim_creative_snapshot | none recorded |
| body_text | text | yes |  | Creative body text. | snapshot.admatix_warehouse.dim_creative_snapshot | none recorded |
| final_url | text | yes |  | Landing page URL. | snapshot.admatix_warehouse.dim_creative_snapshot | none recorded |
| policy_status | text | yes |  | Platform policy status. | snapshot.admatix_warehouse.dim_creative_snapshot | none recorded |
| status | entity_status | yes |  | Creative status. | snapshot.admatix_warehouse.dim_creative_snapshot | none recorded |
| is_current | boolean | yes |  | Source current marker for initial Phase 2 rows. | snapshot.admatix_warehouse.dim_creative_snapshot | none recorded |
| row_hash | character | yes |  | Tracked attribute hash. | snapshot.admatix_warehouse.dim_creative_snapshot | none recorded |
| dbt_scd_id | text | yes |  | dbt snapshot SCD id. | snapshot.admatix_warehouse.dim_creative_snapshot | none recorded |
| dbt_updated_at | timestamp without time zone | yes |  | dbt snapshot update timestamp. | snapshot.admatix_warehouse.dim_creative_snapshot | none recorded |
| valid_from | timestamp without time zone | yes |  | Snapshot validity start timestamp. | snapshot.admatix_warehouse.dim_creative_snapshot | none recorded |
| valid_to | timestamp without time zone | yes |  | Snapshot validity end timestamp. | snapshot.admatix_warehouse.dim_creative_snapshot | none recorded |

## warehouse.dim_date

Conformed calendar dimension.

- Source lineage: model.admatix_warehouse.dim_date
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| date_key | integer | yes |  | Smart YYYYMMDD key. | model.admatix_warehouse.dim_date | none recorded |
| full_date | date | yes |  | Calendar date. | model.admatix_warehouse.dim_date | none recorded |
| day_of_week | smallint | yes |  | ISO weekday number. | model.admatix_warehouse.dim_date | none recorded |
| day_name | text | yes |  | Weekday name. | model.admatix_warehouse.dim_date | none recorded |
| day_of_month | smallint | yes |  | Day of month. | model.admatix_warehouse.dim_date | none recorded |
| day_of_year | smallint | yes |  | Day of year. | model.admatix_warehouse.dim_date | none recorded |
| week_of_year | smallint | yes |  | Week of year. | model.admatix_warehouse.dim_date | none recorded |
| iso_week | smallint | yes |  | ISO week number. | model.admatix_warehouse.dim_date | none recorded |
| month_number | smallint | yes |  | Month number. | model.admatix_warehouse.dim_date | none recorded |
| month_name | text | yes |  | Month name. | model.admatix_warehouse.dim_date | none recorded |
| quarter | smallint | yes |  | Calendar quarter. | model.admatix_warehouse.dim_date | none recorded |
| year | smallint | yes |  | Calendar year. | model.admatix_warehouse.dim_date | none recorded |
| is_weekend | boolean | yes |  | Weekend flag. | model.admatix_warehouse.dim_date | none recorded |
| is_month_start | boolean | yes |  | Month-start flag. | model.admatix_warehouse.dim_date | none recorded |
| is_month_end | boolean | yes |  | Month-end flag. | model.admatix_warehouse.dim_date | none recorded |

## warehouse.dim_device

SCD Type 1 device dimension.

- Source lineage: model.admatix_warehouse.dim_device
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| device_key | smallint | yes |  | Surrogate device key. | model.admatix_warehouse.dim_device | none recorded |
| device_business_key | text | yes |  | Device business key. | model.admatix_warehouse.dim_device | none recorded |
| device_type | text | yes |  | Device type. | model.admatix_warehouse.dim_device | none recorded |
| device_category | text | yes |  | Device category. | model.admatix_warehouse.dim_device | none recorded |
| operating_system | text | yes |  | Operating system. | model.admatix_warehouse.dim_device | none recorded |

## warehouse.dim_geo

SCD Type 1 geography dimension.

- Source lineage: model.admatix_warehouse.dim_geo
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| geo_key | bigint | yes |  | Surrogate geography key. | model.admatix_warehouse.dim_geo | none recorded |
| geo_business_key | text | yes |  | Geography business key. | model.admatix_warehouse.dim_geo | none recorded |
| country_code | character | yes |  | ISO country code. | model.admatix_warehouse.dim_geo | none recorded |
| country_name | text | yes |  | Country name. | model.admatix_warehouse.dim_geo | none recorded |
| region | text | yes |  | Region name. | model.admatix_warehouse.dim_geo | none recorded |
| region_code | text | yes |  | Region code. | model.admatix_warehouse.dim_geo | none recorded |
| city | text | yes |  | City name. | model.admatix_warehouse.dim_geo | none recorded |
| metro_code | text | yes |  | Metro code. | model.admatix_warehouse.dim_geo | none recorded |
| postal_code | text | yes |  | Postal code. | model.admatix_warehouse.dim_geo | none recorded |

## warehouse.dim_platform

SCD Type 1 platform lookup dimension.

- Source lineage: model.admatix_warehouse.dim_platform
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| platform_key | smallint | yes |  | Surrogate platform key. | model.admatix_warehouse.dim_platform | none recorded |
| platform_code | ad_platform | yes |  | Platform enum code. | model.admatix_warehouse.dim_platform | none recorded |
| platform_name | text | yes |  | Platform display name. | model.admatix_warehouse.dim_platform | none recorded |
| platform_family | text | yes |  | Platform family. | model.admatix_warehouse.dim_platform | none recorded |
| is_truth_source | boolean | yes |  | True for first-party truth source. | model.admatix_warehouse.dim_platform | none recorded |

## warehouse.fct_campaign_action

Governance bridge fact linking H0 packets, proposed actions, policy decisions, approvals, outcomes, and ledger transaction ids.

- Source lineage: source.admatix_warehouse.app.approval_receipts, source.admatix_warehouse.app.execution_diffs, source.admatix_warehouse.app.h0_packets, source.admatix_warehouse.app.outcome_measurements, source.admatix_warehouse.app.policy_decisions, source.admatix_warehouse.app.proposed_actions, source.admatix_warehouse.ledger.action_events
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| campaign_action_id | bigint | yes |  | Surrogate campaign action fact key. | model.admatix_warehouse.fct_campaign_action | none recorded |
| proposed_date_key | integer | yes |  | Proposed action date key. | model.admatix_warehouse.fct_campaign_action | none recorded |
| decided_date_key | integer | yes |  | Policy or approval decision date key. | model.admatix_warehouse.fct_campaign_action | none recorded |
| measured_date_key | integer | yes |  | Outcome measurement date key. | model.admatix_warehouse.fct_campaign_action | none recorded |
| account_key | bigint | yes |  | Account dimension key. | model.admatix_warehouse.fct_campaign_action | none recorded |
| campaign_key | bigint | yes |  | Campaign dimension key. | model.admatix_warehouse.fct_campaign_action | none recorded |
| platform_key | smallint | yes |  | Platform dimension key. | model.admatix_warehouse.fct_campaign_action | none recorded |
| h0_packet_id | uuid | yes |  | Originating H0 packet id. | model.admatix_warehouse.fct_campaign_action | none recorded |
| proposed_action_id | uuid | yes |  | Proposed action id. | model.admatix_warehouse.fct_campaign_action | none recorded |
| tx_id | text | yes |  | Ledger transaction id. | model.admatix_warehouse.fct_campaign_action | none recorded |
| action_type | action_type | yes |  | Proposed action type. | model.admatix_warehouse.fct_campaign_action | none recorded |
| risk_level | risk_level | yes |  | Policy risk level. | model.admatix_warehouse.fct_campaign_action | none recorded |
| policy_result | policy_result | yes |  | PolicyGuard result. | model.admatix_warehouse.fct_campaign_action | none recorded |
| approval_decision | approval_decision | yes |  | Human approval decision. | model.admatix_warehouse.fct_campaign_action | none recorded |
| estimated_impact | numeric | yes |  | Estimated impact. | model.admatix_warehouse.fct_campaign_action | none recorded |
| realized_impact | numeric | yes |  | Realized measured impact. | model.admatix_warehouse.fct_campaign_action | none recorded |
| was_measured | boolean | yes |  | True once measured. | model.admatix_warehouse.fct_campaign_action | none recorded |
| _source | text | yes |  | Logical source. | model.admatix_warehouse.fct_campaign_action | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Materialisation timestamp. | model.admatix_warehouse.fct_campaign_action | none recorded |

## warehouse.fct_clicks

Event-grain click fact represented by deterministic Phase 2 fixture micro-batches.

- Source lineage: model.admatix_warehouse.fct_clicks
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| click_id | bigint | yes |  | Surrogate click fact key. | model.admatix_warehouse.fct_clicks | none recorded |
| date_key | integer | yes |  | Click date key. | model.admatix_warehouse.fct_clicks | none recorded |
| account_key | bigint | yes |  | Account dimension key. | model.admatix_warehouse.fct_clicks | none recorded |
| campaign_key | bigint | yes |  | Campaign dimension key. | model.admatix_warehouse.fct_clicks | none recorded |
| ad_set_key | bigint | yes |  | Optional ad set dimension key. | model.admatix_warehouse.fct_clicks | none recorded |
| creative_key | bigint | yes |  | Optional creative dimension key. | model.admatix_warehouse.fct_clicks | none recorded |
| platform_key | smallint | yes |  | Platform dimension key. | model.admatix_warehouse.fct_clicks | none recorded |
| geo_key | bigint | yes |  | Geography dimension key. | model.admatix_warehouse.fct_clicks | none recorded |
| audience_key | bigint | yes |  | Audience dimension key. | model.admatix_warehouse.fct_clicks | none recorded |
| device_key | smallint | yes |  | Device dimension key. | model.admatix_warehouse.fct_clicks | none recorded |
| click_ts | timestamp with time zone | yes |  | UTC click timestamp. | model.admatix_warehouse.fct_clicks | none recorded |
| clicks | bigint | yes |  | Additive clicks. | model.admatix_warehouse.fct_clicks | none recorded |
| cost | numeric | yes |  | Additive media cost. | model.admatix_warehouse.fct_clicks | none recorded |
| _source | text | yes |  | Logical source. | model.admatix_warehouse.fct_clicks | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Materialisation timestamp. | model.admatix_warehouse.fct_clicks | none recorded |

## warehouse.fct_conversions

Event-grain conversion fact from first-party conversion rows.

- Source lineage: model.admatix_warehouse.fct_conversions
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| conversion_id | bigint | yes |  | Surrogate conversion fact key. | model.admatix_warehouse.fct_conversions | none recorded |
| date_key | integer | yes |  | Conversion date key. | model.admatix_warehouse.fct_conversions | none recorded |
| account_key | bigint | yes |  | Account dimension key. | model.admatix_warehouse.fct_conversions | none recorded |
| campaign_key | bigint | yes |  | Optional campaign dimension key. | model.admatix_warehouse.fct_conversions | none recorded |
| ad_set_key | bigint | yes |  | Optional ad set dimension key. | model.admatix_warehouse.fct_conversions | none recorded |
| creative_key | bigint | yes |  | Optional creative dimension key. | model.admatix_warehouse.fct_conversions | none recorded |
| platform_key | smallint | yes |  | Platform dimension key. | model.admatix_warehouse.fct_conversions | none recorded |
| geo_key | bigint | yes |  | Geography dimension key. | model.admatix_warehouse.fct_conversions | none recorded |
| audience_key | bigint | yes |  | Audience dimension key. | model.admatix_warehouse.fct_conversions | none recorded |
| device_key | smallint | yes |  | Device dimension key. | model.admatix_warehouse.fct_conversions | none recorded |
| conversion_ts | timestamp with time zone | yes |  | UTC conversion timestamp. | model.admatix_warehouse.fct_conversions | none recorded |
| conversions | numeric | yes |  | Additive conversion count. | model.admatix_warehouse.fct_conversions | none recorded |
| revenue | numeric | yes |  | Additive conversion revenue. | model.admatix_warehouse.fct_conversions | none recorded |
| is_first_party | boolean | yes |  | First-party truth-source flag. | model.admatix_warehouse.fct_conversions | none recorded |
| attribution_model | text | yes |  | Attribution model name. | model.admatix_warehouse.fct_conversions | none recorded |
| _source | text | yes |  | Logical source. | model.admatix_warehouse.fct_conversions | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Materialisation timestamp. | model.admatix_warehouse.fct_conversions | none recorded |

## warehouse.fct_impressions

Event-grain impression fact represented by deterministic Phase 2 fixture micro-batches.

- Source lineage: model.admatix_warehouse.fct_impressions
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| impression_id | bigint | yes |  | Surrogate impression fact key. | model.admatix_warehouse.fct_impressions | none recorded |
| date_key | integer | yes |  | Impression date key. | model.admatix_warehouse.fct_impressions | none recorded |
| account_key | bigint | yes |  | Account dimension key. | model.admatix_warehouse.fct_impressions | none recorded |
| campaign_key | bigint | yes |  | Campaign dimension key. | model.admatix_warehouse.fct_impressions | none recorded |
| ad_set_key | bigint | yes |  | Optional ad set dimension key. | model.admatix_warehouse.fct_impressions | none recorded |
| creative_key | bigint | yes |  | Optional creative dimension key. | model.admatix_warehouse.fct_impressions | none recorded |
| platform_key | smallint | yes |  | Platform dimension key. | model.admatix_warehouse.fct_impressions | none recorded |
| geo_key | bigint | yes |  | Geography dimension key. | model.admatix_warehouse.fct_impressions | none recorded |
| audience_key | bigint | yes |  | Audience dimension key. | model.admatix_warehouse.fct_impressions | none recorded |
| device_key | smallint | yes |  | Device dimension key. | model.admatix_warehouse.fct_impressions | none recorded |
| impression_ts | timestamp with time zone | yes |  | UTC impression timestamp. | model.admatix_warehouse.fct_impressions | none recorded |
| impressions | bigint | yes |  | Additive impressions. | model.admatix_warehouse.fct_impressions | none recorded |
| cost | numeric | yes |  | Additive media cost. | model.admatix_warehouse.fct_impressions | none recorded |
| _source | text | yes |  | Logical source. | model.admatix_warehouse.fct_impressions | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Materialisation timestamp. | model.admatix_warehouse.fct_impressions | none recorded |

## warehouse.fct_outcome

Outcome fact with estimated lift, confidence bounds, and simulator ground truth when available.

- Source lineage: source.admatix_warehouse.app.h0_packets, source.admatix_warehouse.app.outcome_measurements, source.admatix_warehouse.app.proposed_actions, source.admatix_warehouse.sim.true_effects
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| outcome_id | bigint | yes |  | Surrogate outcome fact key. | model.admatix_warehouse.fct_outcome | none recorded |
| date_key | integer | yes |  | Measurement date key. | model.admatix_warehouse.fct_outcome | none recorded |
| account_key | bigint | yes |  | Account dimension key. | model.admatix_warehouse.fct_outcome | none recorded |
| campaign_key | bigint | yes |  | Optional campaign dimension key. | model.admatix_warehouse.fct_outcome | none recorded |
| platform_key | smallint | yes |  | Platform dimension key. | model.admatix_warehouse.fct_outcome | none recorded |
| h0_packet_id | uuid | yes |  | Originating H0 packet id. | model.admatix_warehouse.fct_outcome | none recorded |
| tx_id | text | yes |  | Ledger transaction id. | model.admatix_warehouse.fct_outcome | none recorded |
| success_metric | text | yes |  | Measured success metric. | model.admatix_warehouse.fct_outcome | none recorded |
| baseline_value | numeric | yes |  | Baseline metric value. | model.admatix_warehouse.fct_outcome | none recorded |
| observed_value | numeric | yes |  | Observed metric value. | model.admatix_warehouse.fct_outcome | none recorded |
| delta_pct | numeric | yes |  | Percent delta. | model.admatix_warehouse.fct_outcome | none recorded |
| estimated_lift | numeric | yes |  | Estimated lift. | model.admatix_warehouse.fct_outcome | none recorded |
| lift_ci_low | numeric | yes |  | Confidence interval lower bound. | model.admatix_warehouse.fct_outcome | none recorded |
| lift_ci_high | numeric | yes |  | Confidence interval upper bound. | model.admatix_warehouse.fct_outcome | none recorded |
| ground_truth_lift | numeric | yes |  | Simulator ground truth when known. | model.admatix_warehouse.fct_outcome | none recorded |
| causal_status | causal_status | yes |  | Causal claim status. | model.admatix_warehouse.fct_outcome | none recorded |
| passed | boolean | yes |  | Outcome pass flag. | model.admatix_warehouse.fct_outcome | none recorded |
| _source | text | yes |  | Logical source. | model.admatix_warehouse.fct_outcome | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Materialisation timestamp. | model.admatix_warehouse.fct_outcome | none recorded |

## warehouse.fct_spend_daily

Daily spend fact at campaign grain.

- Source lineage: model.admatix_warehouse.fct_spend_daily
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| spend_daily_id | bigint | yes |  | Surrogate spend fact key. | model.admatix_warehouse.fct_spend_daily | none recorded |
| date_key | integer | yes |  | Spend date key. | model.admatix_warehouse.fct_spend_daily | none recorded |
| account_key | bigint | yes |  | Account dimension key. | model.admatix_warehouse.fct_spend_daily | none recorded |
| campaign_key | bigint | yes |  | Campaign dimension key. | model.admatix_warehouse.fct_spend_daily | none recorded |
| ad_set_key | bigint | yes |  | Optional ad set dimension key. | model.admatix_warehouse.fct_spend_daily | none recorded |
| platform_key | smallint | yes |  | Platform dimension key. | model.admatix_warehouse.fct_spend_daily | none recorded |
| spend | numeric | yes |  | Additive daily spend. | model.admatix_warehouse.fct_spend_daily | none recorded |
| impressions | bigint | yes |  | Additive daily impressions. | model.admatix_warehouse.fct_spend_daily | none recorded |
| clicks | bigint | yes |  | Additive daily clicks. | model.admatix_warehouse.fct_spend_daily | none recorded |
| conversions | numeric | yes |  | Additive daily conversions. | model.admatix_warehouse.fct_spend_daily | none recorded |
| platform_revenue | numeric | yes |  | Directional platform-attributed revenue. | model.admatix_warehouse.fct_spend_daily | none recorded |
| currency | character | yes |  | ISO-4217 currency. | model.admatix_warehouse.fct_spend_daily | none recorded |
| _source | text | yes |  | Logical source. | model.admatix_warehouse.fct_spend_daily | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Materialisation timestamp. | model.admatix_warehouse.fct_spend_daily | none recorded |

## warehouse.mart_agent_safety

Agent and benchmark safety mart combining operational agent runs with benchmark result scoring.

- Source lineage: source.admatix_warehouse.app.agent_runs, source.admatix_warehouse.app.h0_packets, source.admatix_warehouse.app.policy_decisions, source.admatix_warehouse.app.proposed_actions, source.admatix_warehouse.bench.results, source.admatix_warehouse.bench.runs, source.admatix_warehouse.bench.tasks
- dbt tests: assert_mart_agent_safety_bounds

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| run_id | text | yes |  | Agent run UUID or benchmark run UUID rendered as text. | model.admatix_warehouse.mart_agent_safety | none recorded |
| agent_id | text | yes |  | Agent identifier for the operational run or benchmark output. | model.admatix_warehouse.mart_agent_safety | none recorded |
| tenant_id | uuid | yes |  | Tenant UUID for operational runs; null for benchmark-only rows. | model.admatix_warehouse.mart_agent_safety | none recorded |
| workflow_id | text | yes |  | Workflow id for operational agent runs. | model.admatix_warehouse.mart_agent_safety | none recorded |
| tx_id | text | yes |  | Ledger transaction id for operational agent runs. | model.admatix_warehouse.mart_agent_safety | none recorded |
| step | text | yes |  | Workflow step or benchmark task kind. | model.admatix_warehouse.mart_agent_safety | none recorded |
| model | text | yes |  | Model id pinned for the run | model.admatix_warehouse.mart_agent_safety | none recorded |
| policy_version | text | yes |  | Policy version pinned for the run. | model.admatix_warehouse.mart_agent_safety | none recorded |
| risk_level | text | yes |  | Risk level assigned to the run. | model.admatix_warehouse.mart_agent_safety | none recorded |
| status | text | yes |  | Terminal run status. | model.admatix_warehouse.mart_agent_safety | none recorded |
| blocked_reason | text | yes |  | Reason the run or benchmark row was blocked. | model.admatix_warehouse.mart_agent_safety | none recorded |
| duration_ms | integer | yes |  | Wall-clock duration for operational agent runs. | model.admatix_warehouse.mart_agent_safety | none recorded |
| created_at | timestamp with time zone | yes |  | Timestamp the source run or benchmark result was written. | model.admatix_warehouse.mart_agent_safety | none recorded |
| policy_decisions | bigint | yes |  | Count of policy decisions associated with the operational run. | model.admatix_warehouse.mart_agent_safety | none recorded |
| blocked_policy_decisions | bigint | yes |  | Count of blocked policy decisions associated with the operational run. | model.admatix_warehouse.mart_agent_safety | none recorded |
| suite | text | yes |  | Benchmark suite name for benchmark rows. | model.admatix_warehouse.mart_agent_safety | none recorded |
| benchmark_score | numeric | yes |  | Continuous benchmark score in the interval [0,1]. | model.admatix_warehouse.mart_agent_safety | none recorded |
| benchmark_passed | boolean | yes |  | True when the benchmark task passed. | model.admatix_warehouse.mart_agent_safety | none recorded |
| unsafe_write_attempted | boolean | yes |  | True when an unsafe write was attempted during the benchmark. | model.admatix_warehouse.mart_agent_safety | none recorded |
| budget_cap_violation | boolean | yes |  | True when the benchmark detected a budget cap violation. | model.admatix_warehouse.mart_agent_safety | none recorded |
| hallucinated_id | boolean | yes |  | True when the benchmark detected a nonexistent entity id. | model.admatix_warehouse.mart_agent_safety | none recorded |
| evidence_coverage | numeric | yes |  | Fraction of benchmark claims backed by valid evidence refs, in [0,1]. | model.admatix_warehouse.mart_agent_safety | none recorded |
| rollback_coverage | numeric | yes |  | Fraction of benchmark actions carrying rollback coverage, in [0,1]. | model.admatix_warehouse.mart_agent_safety | none recorded |
| policy_block_rate | numeric | yes |  | Fraction of policy decisions blocked for the operational run. | model.admatix_warehouse.mart_agent_safety | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Timestamp when the mart row was materialized. | model.admatix_warehouse.mart_agent_safety | none recorded |

## warehouse.mart_campaign_performance

Denormalized campaign by day performance mart for cockpit reporting, with platform and first-party efficiency metrics.

- Source lineage: model.admatix_warehouse.mart_campaign_performance
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| date_key | integer | yes |  | Smart YYYYMMDD key for the metric date. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| metric_date | date | yes |  | Calendar date for the performance row. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| account_key | bigint | yes |  | Account dimension surrogate key. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| tenant_id | uuid | yes |  | Tenant UUID that owns the account. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| platform | ad_platform | yes |  | Platform enum code for the account. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| external_account_id | text | yes |  | Platform-native account identifier. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| account_name | text | yes |  | Human-readable account name. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| platform_key | smallint | yes |  | Platform dimension surrogate key. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| platform_name | text | yes |  | Human-readable platform name. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| platform_family | text | yes |  | Platform family such as search | model.admatix_warehouse.mart_campaign_performance | none recorded |
| campaign_key | bigint | yes |  | Campaign dimension surrogate key. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| campaign_business_key | text | yes |  | Stable conformed campaign business key. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| external_campaign_id | text | yes |  | Platform-native campaign identifier. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| campaign_name | text | yes |  | Human-readable campaign name. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| objective | text | yes |  | Campaign objective from the SCD-2 campaign dimension. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| campaign_status | entity_status | yes |  | Campaign lifecycle status from the SCD-2 campaign dimension. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| currency | character | yes |  | ISO-4217 currency code for spend and platform revenue. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| spend | numeric | yes |  | Daily media spend from the spend fact. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| impressions | bigint | yes |  | Daily impressions from the spend fact. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| clicks | bigint | yes |  | Daily clicks from the spend fact. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| platform_conversions | numeric | yes |  | Daily platform-attributed conversions. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| first_party_orders | bigint | yes |  | First-party order count for the account and day. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| platform_revenue | numeric | yes |  | Daily platform-attributed revenue. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| first_party_revenue | numeric | yes |  | First-party revenue for the account and day. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| gross_margin | numeric | yes |  | First-party gross margin for the account and day. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| new_customers | bigint | yes |  | First-party new customer count for the account and day. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| ctr | numeric | yes |  | Click-through rate | model.admatix_warehouse.mart_campaign_performance | none recorded |
| cvr | numeric | yes |  | Conversion rate | model.admatix_warehouse.mart_campaign_performance | none recorded |
| platform_roas | numeric | yes |  | Platform-attributed revenue divided by spend. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| first_party_roas | numeric | yes |  | First-party revenue divided by spend. | model.admatix_warehouse.mart_campaign_performance | none recorded |
| cac | numeric | yes |  | Customer acquisition cost | model.admatix_warehouse.mart_campaign_performance | none recorded |
| mer | numeric | yes |  | Media efficiency ratio | model.admatix_warehouse.mart_campaign_performance | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Timestamp when the mart row was materialized. | model.admatix_warehouse.mart_campaign_performance | none recorded |

## warehouse.mart_evidence_coverage

Tenant by day evidence coverage mart measuring the share of proposed actions with complete H0 evidence and ledger visibility.

- Source lineage: source.admatix_warehouse.app.h0_packets, source.admatix_warehouse.app.policy_decisions, source.admatix_warehouse.app.proposed_actions, source.admatix_warehouse.app.tenants
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| date_key | integer | yes |  | Smart YYYYMMDD key for the action proposal date. | model.admatix_warehouse.mart_evidence_coverage | none recorded |
| metric_date | date | yes |  | Calendar date for the coverage row. | model.admatix_warehouse.mart_evidence_coverage | none recorded |
| tenant_id | uuid | yes |  | Tenant UUID. | model.admatix_warehouse.mart_evidence_coverage | none recorded |
| tenant_slug | text | yes |  | Tenant slug used in URLs and CLI output. | model.admatix_warehouse.mart_evidence_coverage | none recorded |
| tenant_name | text | yes |  | Human-readable tenant name. | model.admatix_warehouse.mart_evidence_coverage | none recorded |
| proposed_action_count | bigint | yes |  | Count of proposed actions on the date. | model.admatix_warehouse.mart_evidence_coverage | none recorded |
| complete_h0_action_count | bigint | yes |  | Count of proposed actions whose H0 packet has hypothesis | model.admatix_warehouse.mart_evidence_coverage | none recorded |
| policy_decision_count | bigint | yes |  | Count of proposed actions with a PolicyGuard decision. | model.admatix_warehouse.mart_evidence_coverage | none recorded |
| blocked_action_count | bigint | yes |  | Count of proposed actions blocked by policy. | model.admatix_warehouse.mart_evidence_coverage | none recorded |
| allowed_action_count | bigint | yes |  | Count of proposed actions allowed by policy. | model.admatix_warehouse.mart_evidence_coverage | none recorded |
| needs_approval_action_count | bigint | yes |  | Count of proposed actions requiring approval by policy. | model.admatix_warehouse.mart_evidence_coverage | none recorded |
| ledger_visible_action_count | bigint | yes |  | Count of proposed actions visible through the campaign action fact bridge. | model.admatix_warehouse.mart_evidence_coverage | none recorded |
| coverage_pct | numeric | yes |  | Complete H0 action count divided by proposed action count. | model.admatix_warehouse.mart_evidence_coverage | none recorded |
| ledger_visibility_pct | numeric | yes |  | Ledger-visible action count divided by proposed action count. | model.admatix_warehouse.mart_evidence_coverage | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Timestamp when the mart row was materialized. | model.admatix_warehouse.mart_evidence_coverage | none recorded |

## warehouse.mart_pacing

Campaign by day pacing mart comparing realized spend against daily or lifetime budget plans.

- Source lineage: model.admatix_warehouse.mart_pacing
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| date_key | integer | yes |  | Smart YYYYMMDD key for the spend date. | model.admatix_warehouse.mart_pacing | none recorded |
| metric_date | date | yes |  | Calendar date for the pacing row. | model.admatix_warehouse.mart_pacing | none recorded |
| account_key | bigint | yes |  | Account dimension surrogate key. | model.admatix_warehouse.mart_pacing | none recorded |
| tenant_id | uuid | yes |  | Tenant UUID that owns the account. | model.admatix_warehouse.mart_pacing | none recorded |
| platform | ad_platform | yes |  | Platform enum code for the account. | model.admatix_warehouse.mart_pacing | none recorded |
| account_name | text | yes |  | Human-readable account name. | model.admatix_warehouse.mart_pacing | none recorded |
| platform_key | smallint | yes |  | Platform dimension surrogate key. | model.admatix_warehouse.mart_pacing | none recorded |
| platform_name | text | yes |  | Human-readable platform name. | model.admatix_warehouse.mart_pacing | none recorded |
| campaign_key | bigint | yes |  | Campaign dimension surrogate key. | model.admatix_warehouse.mart_pacing | none recorded |
| campaign_business_key | text | yes |  | Stable conformed campaign business key. | model.admatix_warehouse.mart_pacing | none recorded |
| external_campaign_id | text | yes |  | Platform-native campaign identifier. | model.admatix_warehouse.mart_pacing | none recorded |
| campaign_name | text | yes |  | Human-readable campaign name. | model.admatix_warehouse.mart_pacing | none recorded |
| campaign_status | entity_status | yes |  | Campaign lifecycle status. | model.admatix_warehouse.mart_pacing | none recorded |
| daily_budget | numeric | yes |  | Daily campaign budget from the SCD-2 row valid on the spend date. | model.admatix_warehouse.mart_pacing | none recorded |
| lifetime_budget | numeric | yes |  | Lifetime campaign budget from the SCD-2 row valid on the spend date. | model.admatix_warehouse.mart_pacing | none recorded |
| start_date | date | yes |  | Campaign start date from the SCD-2 row. | model.admatix_warehouse.mart_pacing | none recorded |
| end_date | date | yes |  | Campaign end date from the SCD-2 row. | model.admatix_warehouse.mart_pacing | none recorded |
| spend | numeric | yes |  | Actual spend on the metric date. | model.admatix_warehouse.mart_pacing | none recorded |
| cumulative_spend | numeric | yes |  | Cumulative spend observed through the metric date. | model.admatix_warehouse.mart_pacing | none recorded |
| elapsed_reporting_days | integer | yes |  | Count of spend fact days observed for the campaign through the metric date. | model.admatix_warehouse.mart_pacing | none recorded |
| planned_spend_to_date | numeric | yes |  | Budget-implied planned spend through the metric date. | model.admatix_warehouse.mart_pacing | none recorded |
| pacing_variance | numeric | yes |  | Cumulative spend minus planned spend to date. | model.admatix_warehouse.mart_pacing | none recorded |
| pacing_ratio | numeric | yes |  | Cumulative spend divided by planned spend to date. | model.admatix_warehouse.mart_pacing | none recorded |
| days_remaining | integer | yes |  | Calendar days remaining until campaign end date when known. | model.admatix_warehouse.mart_pacing | none recorded |
| projected_total_spend | numeric | yes |  | Projected total spend at the current average daily spend rate. | model.admatix_warehouse.mart_pacing | none recorded |
| projected_overspend | numeric | yes |  | Expected overspend against lifetime or daily budget. | model.admatix_warehouse.mart_pacing | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Timestamp when the mart row was materialized. | model.admatix_warehouse.mart_pacing | none recorded |

## warehouse.mart_verification

H0 outcome verification mart with lift estimates, confidence intervals, methods, and verdicts.

- Source lineage: source.admatix_warehouse.app.h0_packets
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| date_key | integer | yes |  | Smart YYYYMMDD key for the measurement date. | model.admatix_warehouse.mart_verification | none recorded |
| measured_date | date | yes |  | Calendar date the outcome was measured. | model.admatix_warehouse.mart_verification | none recorded |
| h0_packet_id | uuid | yes |  | H0 packet UUID measured by the verifier. | model.admatix_warehouse.mart_verification | none recorded |
| tx_id | text | yes |  | Ledger transaction id joining the packet to action events. | model.admatix_warehouse.mart_verification | none recorded |
| account_key | bigint | yes |  | Account dimension surrogate key. | model.admatix_warehouse.mart_verification | none recorded |
| tenant_id | uuid | yes |  | Tenant UUID that owns the account. | model.admatix_warehouse.mart_verification | none recorded |
| platform | ad_platform | yes |  | Platform enum code for the account. | model.admatix_warehouse.mart_verification | none recorded |
| account_name | text | yes |  | Human-readable account name. | model.admatix_warehouse.mart_verification | none recorded |
| platform_key | smallint | yes |  | Platform dimension surrogate key. | model.admatix_warehouse.mart_verification | none recorded |
| platform_name | text | yes |  | Human-readable platform name. | model.admatix_warehouse.mart_verification | none recorded |
| campaign_key | bigint | yes |  | Campaign dimension surrogate key when the outcome maps to a campaign. | model.admatix_warehouse.mart_verification | none recorded |
| campaign_business_key | text | yes |  | Stable conformed campaign business key. | model.admatix_warehouse.mart_verification | none recorded |
| external_campaign_id | text | yes |  | Platform-native campaign identifier. | model.admatix_warehouse.mart_verification | none recorded |
| campaign_name | text | yes |  | Human-readable campaign name. | model.admatix_warehouse.mart_verification | none recorded |
| proposed_action_id | uuid | yes |  | Proposed action UUID associated with the H0 packet. | model.admatix_warehouse.mart_verification | none recorded |
| action_type | action_type | yes |  | Proposed action type. | model.admatix_warehouse.mart_verification | none recorded |
| policy_result | policy_result | yes |  | PolicyGuard result for the associated action. | model.admatix_warehouse.mart_verification | none recorded |
| approval_decision | approval_decision | yes |  | Human approval decision when present. | model.admatix_warehouse.mart_verification | none recorded |
| success_metric | text | yes |  | Metric measured by the outcome. | model.admatix_warehouse.mart_verification | none recorded |
| baseline_value | numeric | yes |  | Baseline metric value before the action. | model.admatix_warehouse.mart_verification | none recorded |
| observed_value | numeric | yes |  | Observed metric value after the action. | model.admatix_warehouse.mart_verification | none recorded |
| delta_pct | numeric | yes |  | Percent delta from baseline to observed. | model.admatix_warehouse.mart_verification | none recorded |
| estimated_lift | numeric | yes |  | Estimated lift reported by the verifier. | model.admatix_warehouse.mart_verification | none recorded |
| lift_ci_low | numeric | yes |  | Lower confidence interval bound for lift. | model.admatix_warehouse.mart_verification | none recorded |
| lift_ci_high | numeric | yes |  | Upper confidence interval bound for lift. | model.admatix_warehouse.mart_verification | none recorded |
| ground_truth_lift | numeric | yes |  | Simulator ground truth lift when available to the scorer. | model.admatix_warehouse.mart_verification | none recorded |
| method | text | yes |  | Verification method recorded on the packet body | model.admatix_warehouse.mart_verification | none recorded |
| causal_status | causal_status | yes |  | Causal claim strength attached to the H0 packet. | model.admatix_warehouse.mart_verification | none recorded |
| verdict | text | yes |  | Outcome verdict derived from the measurement pass flag. | model.admatix_warehouse.mart_verification | none recorded |
| passed | boolean | yes |  | True when the measured outcome met the success criterion. | model.admatix_warehouse.mart_verification | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Timestamp when the mart row was materialized. | model.admatix_warehouse.mart_verification | none recorded |

## warehouse.mart_waste

Identified wasted spend mart for campaign and creative surfaces with spend but no conversions over the evaluated window.

- Source lineage: model.admatix_warehouse.mart_waste
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| date_key | integer | yes |  | Smart YYYYMMDD key for the waste signal date. | model.admatix_warehouse.mart_waste | none recorded |
| metric_date | date | yes |  | Calendar date for the waste signal. | model.admatix_warehouse.mart_waste | none recorded |
| account_key | bigint | yes |  | Account dimension surrogate key. | model.admatix_warehouse.mart_waste | none recorded |
| tenant_id | uuid | yes |  | Tenant UUID that owns the account. | model.admatix_warehouse.mart_waste | none recorded |
| platform | ad_platform | yes |  | Platform enum code for the account. | model.admatix_warehouse.mart_waste | none recorded |
| account_name | text | yes |  | Human-readable account name. | model.admatix_warehouse.mart_waste | none recorded |
| platform_key | smallint | yes |  | Platform dimension surrogate key. | model.admatix_warehouse.mart_waste | none recorded |
| platform_name | text | yes |  | Human-readable platform name. | model.admatix_warehouse.mart_waste | none recorded |
| campaign_key | bigint | yes |  | Campaign dimension surrogate key. | model.admatix_warehouse.mart_waste | none recorded |
| campaign_business_key | text | yes |  | Stable conformed campaign business key. | model.admatix_warehouse.mart_waste | none recorded |
| external_campaign_id | text | yes |  | Platform-native campaign identifier. | model.admatix_warehouse.mart_waste | none recorded |
| campaign_name | text | yes |  | Human-readable campaign name. | model.admatix_warehouse.mart_waste | none recorded |
| creative_key | bigint | yes |  | Creative dimension surrogate key when the waste signal is creative-level. | model.admatix_warehouse.mart_waste | none recorded |
| external_creative_id | text | yes |  | Platform-native creative identifier when available. | model.admatix_warehouse.mart_waste | none recorded |
| creative_format | text | yes |  | Creative format when available. | model.admatix_warehouse.mart_waste | none recorded |
| waste_type | text | yes |  | Waste signal type. | model.admatix_warehouse.mart_waste | none recorded |
| waste_entity_id | text | yes |  | Entity identifier the waste signal applies to. | model.admatix_warehouse.mart_waste | none recorded |
| wasted_spend | numeric | yes |  | Spend considered wasted by the signal. | model.admatix_warehouse.mart_waste | none recorded |
| conversions_in_window | numeric | yes |  | Conversion count observed over the signal lookback window. | model.admatix_warehouse.mart_waste | none recorded |
| lookback_days | integer | yes |  | Number of days evaluated for the waste signal. | model.admatix_warehouse.mart_waste | none recorded |
| dead_keyword_signal_available | boolean | yes |  | False until keyword-level forward signals are available in a later phase. | model.admatix_warehouse.mart_waste | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Timestamp when the mart row was materialized. | model.admatix_warehouse.mart_waste | none recorded |

## warehouse.silver_auctions

Cleaned iPinYou auction rows; empty in Phase 2 until WP-P lands data.

- Source lineage: model.admatix_warehouse.silver_auctions
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| silver_auction_id | bigint | yes |  | Surrogate row id. | model.admatix_warehouse.silver_auctions | none recorded |
| auction_key | text | yes |  | Source auction or bid key. | model.admatix_warehouse.silver_auctions | none recorded |
| auction_ts_raw | text | yes |  | Raw auction timestamp. | model.admatix_warehouse.silver_auctions | none recorded |
| creative_key | text | yes |  | Source creative key. | model.admatix_warehouse.silver_auctions | none recorded |
| advertiser_key | text | yes |  | Source advertiser key. | model.admatix_warehouse.silver_auctions | none recorded |
| region | text | yes |  | Region code. | model.admatix_warehouse.silver_auctions | none recorded |
| city | text | yes |  | City code. | model.admatix_warehouse.silver_auctions | none recorded |
| ad_exchange | text | yes |  | Ad exchange id. | model.admatix_warehouse.silver_auctions | none recorded |
| domain | text | yes |  | Publisher domain. | model.admatix_warehouse.silver_auctions | none recorded |
| ad_slot_id | text | yes |  | Ad slot id. | model.admatix_warehouse.silver_auctions | none recorded |
| ad_slot_width | integer | yes |  | Slot width. | model.admatix_warehouse.silver_auctions | none recorded |
| ad_slot_height | integer | yes |  | Slot height. | model.admatix_warehouse.silver_auctions | none recorded |
| floor_price | numeric | yes |  | Slot floor price. | model.admatix_warehouse.silver_auctions | none recorded |
| bid_price | numeric | yes |  | Bid price. | model.admatix_warehouse.silver_auctions | none recorded |
| paid_price | numeric | yes |  | Paid clearing price. | model.admatix_warehouse.silver_auctions | none recorded |
| is_click | smallint | yes |  | Click flag. | model.admatix_warehouse.silver_auctions | none recorded |
| is_conversion | smallint | yes |  | Conversion flag. | model.admatix_warehouse.silver_auctions | none recorded |
| _source | text | yes |  | Logical source. | model.admatix_warehouse.silver_auctions | none recorded |
| _batch_id | text | yes |  | Ingest batch id. | model.admatix_warehouse.silver_auctions | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Materialisation timestamp. | model.admatix_warehouse.silver_auctions | none recorded |

## warehouse.silver_campaign_daily

Cleaned daily campaign performance conformed to the warehouse contract.

- Source lineage: model.admatix_warehouse.silver_campaign_daily
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| silver_campaign_daily_id | bigint | yes |  | Surrogate row id. | model.admatix_warehouse.silver_campaign_daily | none recorded |
| metric_date | date | yes |  | Metric date. | model.admatix_warehouse.silver_campaign_daily | none recorded |
| platform | ad_platform | yes |  | Source platform enum. | model.admatix_warehouse.silver_campaign_daily | none recorded |
| account_key | text | yes |  | Conformed account business key. | model.admatix_warehouse.silver_campaign_daily | none recorded |
| campaign_key | text | yes |  | Conformed campaign business key. | model.admatix_warehouse.silver_campaign_daily | none recorded |
| spend | numeric | yes |  | Daily spend. | model.admatix_warehouse.silver_campaign_daily | none recorded |
| impressions | bigint | yes |  | Daily impressions. | model.admatix_warehouse.silver_campaign_daily | none recorded |
| clicks | bigint | yes |  | Daily clicks. | model.admatix_warehouse.silver_campaign_daily | none recorded |
| conversions | numeric | yes |  | Daily platform conversions. | model.admatix_warehouse.silver_campaign_daily | none recorded |
| platform_revenue | numeric | yes |  | Directional platform-attributed revenue. | model.admatix_warehouse.silver_campaign_daily | none recorded |
| currency | character | yes |  | ISO-4217 currency. | model.admatix_warehouse.silver_campaign_daily | none recorded |
| _source | text | yes |  | Logical source. | model.admatix_warehouse.silver_campaign_daily | none recorded |
| _batch_id | text | yes |  | Ingest batch id. | model.admatix_warehouse.silver_campaign_daily | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Materialisation timestamp. | model.admatix_warehouse.silver_campaign_daily | none recorded |

## warehouse.silver_conversions

Cleaned individual conversion events from first-party sources.

- Source lineage: model.admatix_warehouse.silver_conversions
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| silver_conversion_id | bigint | yes |  | Surrogate row id. | model.admatix_warehouse.silver_conversions | none recorded |
| conversion_key | text | yes |  | Conformed conversion business key. | model.admatix_warehouse.silver_conversions | none recorded |
| account_key | text | yes |  | Conformed account business key. | model.admatix_warehouse.silver_conversions | none recorded |
| campaign_key | text | yes |  | Optional campaign business key. | model.admatix_warehouse.silver_conversions | none recorded |
| creative_key | text | yes |  | Optional creative business key. | model.admatix_warehouse.silver_conversions | none recorded |
| conversion_ts | timestamp with time zone | yes |  | UTC conversion timestamp. | model.admatix_warehouse.silver_conversions | none recorded |
| customer_key | text | yes |  | Hashed customer key. | model.admatix_warehouse.silver_conversions | none recorded |
| revenue | numeric | yes |  | Conversion revenue. | model.admatix_warehouse.silver_conversions | none recorded |
| is_first_party | boolean | yes |  | True for truth-source conversions. | model.admatix_warehouse.silver_conversions | none recorded |
| attribution_model | text | yes |  | Attribution model name. | model.admatix_warehouse.silver_conversions | none recorded |
| _source | text | yes |  | Logical source. | model.admatix_warehouse.silver_conversions | none recorded |
| _batch_id | text | yes |  | Ingest batch id. | model.admatix_warehouse.silver_conversions | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Materialisation timestamp. | model.admatix_warehouse.silver_conversions | none recorded |

## warehouse.silver_creative_daily

Cleaned daily creative performance conformed to the warehouse contract.

- Source lineage: model.admatix_warehouse.silver_creative_daily
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| silver_creative_daily_id | bigint | yes |  | Surrogate row id. | model.admatix_warehouse.silver_creative_daily | none recorded |
| metric_date | date | yes |  | Metric date. | model.admatix_warehouse.silver_creative_daily | none recorded |
| platform | ad_platform | yes |  | Source platform enum. | model.admatix_warehouse.silver_creative_daily | none recorded |
| account_key | text | yes |  | Conformed account business key. | model.admatix_warehouse.silver_creative_daily | none recorded |
| campaign_key | text | yes |  | Conformed campaign business key. | model.admatix_warehouse.silver_creative_daily | none recorded |
| creative_key | text | yes |  | Conformed creative business key. | model.admatix_warehouse.silver_creative_daily | none recorded |
| spend | numeric | yes |  | Daily spend. | model.admatix_warehouse.silver_creative_daily | none recorded |
| impressions | bigint | yes |  | Daily impressions. | model.admatix_warehouse.silver_creative_daily | none recorded |
| clicks | bigint | yes |  | Daily clicks. | model.admatix_warehouse.silver_creative_daily | none recorded |
| conversions | numeric | yes |  | Daily platform conversions. | model.admatix_warehouse.silver_creative_daily | none recorded |
| frequency | numeric | yes |  | Average creative frequency. | model.admatix_warehouse.silver_creative_daily | none recorded |
| _source | text | yes |  | Logical source. | model.admatix_warehouse.silver_creative_daily | none recorded |
| _batch_id | text | yes |  | Ingest batch id. | model.admatix_warehouse.silver_creative_daily | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Materialisation timestamp. | model.admatix_warehouse.silver_creative_daily | none recorded |

## warehouse.silver_first_party_daily

Cleaned first-party daily revenue and order totals.

- Source lineage: model.admatix_warehouse.silver_first_party_daily
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| silver_first_party_daily_id | bigint | yes |  | Surrogate row id. | model.admatix_warehouse.silver_first_party_daily | none recorded |
| metric_date | date | yes |  | Revenue date. | model.admatix_warehouse.silver_first_party_daily | none recorded |
| account_key | text | yes |  | Conformed account business key. | model.admatix_warehouse.silver_first_party_daily | none recorded |
| revenue | numeric | yes |  | First-party revenue. | model.admatix_warehouse.silver_first_party_daily | none recorded |
| orders | bigint | yes |  | Order count. | model.admatix_warehouse.silver_first_party_daily | none recorded |
| gross_margin | numeric | yes |  | Gross margin dollars. | model.admatix_warehouse.silver_first_party_daily | none recorded |
| new_customers | bigint | yes |  | New customer count. | model.admatix_warehouse.silver_first_party_daily | none recorded |
| currency | character | yes |  | ISO-4217 currency. | model.admatix_warehouse.silver_first_party_daily | none recorded |
| _source | text | yes |  | Logical source. | model.admatix_warehouse.silver_first_party_daily | none recorded |
| _batch_id | text | yes |  | Ingest batch id. | model.admatix_warehouse.silver_first_party_daily | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Materialisation timestamp. | model.admatix_warehouse.silver_first_party_daily | none recorded |

## warehouse.silver_treatment_assignment

Unified treatment assignment rows from public datasets and simulator events.

- Source lineage: model.admatix_warehouse.silver_treatment_assignment
- dbt tests: none recorded

| Column | Type | Nullable | Default | Description | Lineage | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| silver_treatment_assignment_id | bigint | yes |  | Surrogate row id. | model.admatix_warehouse.silver_treatment_assignment | none recorded |
| experiment_key | text | yes |  | Experiment or scenario key. | model.admatix_warehouse.silver_treatment_assignment | none recorded |
| unit_key | text | yes |  | Randomised unit key. | model.admatix_warehouse.silver_treatment_assignment | none recorded |
| account_key | text | yes |  | Optional account business key. | model.admatix_warehouse.silver_treatment_assignment | none recorded |
| campaign_key | text | yes |  | Optional campaign business key. | model.admatix_warehouse.silver_treatment_assignment | none recorded |
| treatment_arm | text | yes |  | Named assignment arm. | model.admatix_warehouse.silver_treatment_assignment | none recorded |
| is_treated | boolean | yes |  | True when assigned to treatment. | model.admatix_warehouse.silver_treatment_assignment | none recorded |
| assigned_at | timestamp with time zone | yes |  | Assignment timestamp. | model.admatix_warehouse.silver_treatment_assignment | none recorded |
| assignment_source | text | yes |  | Assignment source type. | model.admatix_warehouse.silver_treatment_assignment | none recorded |
| _source | text | yes |  | Logical source. | model.admatix_warehouse.silver_treatment_assignment | none recorded |
| _batch_id | text | yes |  | Ingest batch id. | model.admatix_warehouse.silver_treatment_assignment | none recorded |
| _loaded_at | timestamp with time zone | yes |  | Materialisation timestamp. | model.admatix_warehouse.silver_treatment_assignment | none recorded |
