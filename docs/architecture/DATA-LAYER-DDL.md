# AdMatix — Data Layer DDL

Production-ready PostgreSQL 17 DDL for the AdMatix data layer. Target platform is
Supabase (managed Postgres 17). Every schema, table, and column carries a
`COMMENT`. The file is intended to be applied top-to-bottom.

This document is split into ordered SQL parts. Apply them in numeric order. Each
part assumes the previous parts have already run.

- **Part 0** — Extensions, roles, helper functions
- **Part 1** — `ledger` schema (tamper-evident, append-only)
- **Part 2** — `app` schema (operational / mutable)
- **Part 3** — `warehouse` schema, bronze + silver
- **Part 4** — `warehouse` schema, gold dimensions
- **Part 5** — `warehouse` schema, gold facts
- **Part 6** — `sim` and `bench` schemas
- **Part 7** — Running it + dbt notes

---

## Part 0 — Extensions, Roles, Helper Functions

```sql
-- ============================================================================
-- AdMatix Data Layer -- Part 0: Extensions, roles, helpers
-- PostgreSQL 17 / Supabase
-- ============================================================================

-- pgcrypto gives us digest() for SHA-256 hashing inside the ledger triggers.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- citext is used for case-insensitive natural keys (emails, account handles).
CREATE EXTENSION IF NOT EXISTS citext;

-- ----------------------------------------------------------------------------
-- Application roles. The ledger schema is granted INSERT/SELECT only;
-- UPDATE/DELETE are revoked. These roles are distinct from the Supabase-managed
-- roles (anon, authenticated, service_role). The build agent should map the
-- service connection to admatix_app.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admatix_app') THEN
    CREATE ROLE admatix_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admatix_readonly') THEN
    CREATE ROLE admatix_readonly NOLOGIN;
  END IF;
END
$$;

COMMENT ON ROLE admatix_app IS
  'Primary AdMatix application role. Holds INSERT/SELECT on ledger (never UPDATE/DELETE), full DML on app/warehouse/sim/bench. Supabase service connection should inherit this role.';
COMMENT ON ROLE admatix_readonly IS
  'Read-only role for analytics, dbt source freshness, and the verification dashboard.';

-- ----------------------------------------------------------------------------
-- Helper: canonical SHA-256 of a jsonb payload. jsonb '::text' emits keys in a
-- deterministic sorted order, so equal logical payloads always hash identically.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admatix_sha256_jsonb(p_payload jsonb)
RETURNS char(64)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(digest(convert_to((p_payload || '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex')::char(64);
$$;

COMMENT ON FUNCTION public.admatix_sha256_jsonb(jsonb) IS
  'Deterministic SHA-256 (hex, 64 chars) of a jsonb payload. Used to compute payload_hash and body_hash so equal logical payloads always hash identically.';

-- ----------------------------------------------------------------------------
-- Helper: SHA-256 of an arbitrary text string. Used to chain ledger entries.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admatix_sha256_text(p_text text)
RETURNS char(64)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(digest(convert_to(coalesce(p_text, ''), 'UTF8'), 'sha256'), 'hex')::char(64);
$$;

COMMENT ON FUNCTION public.admatix_sha256_text(text) IS
  'Deterministic SHA-256 (hex, 64 chars) of a text string. Used to compute ledger entry_hash from the concatenated chain material.';

-- ----------------------------------------------------------------------------
-- Helper: generic updated_at touch trigger used by mutable tables.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admatix_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.admatix_touch_updated_at() IS
  'BEFORE UPDATE trigger function: sets updated_at to now() on every row mutation.';
```

---

## Part 1 — `ledger` Schema (Tamper-Evident, Append-Only)

The `ledger` schema is the trust spine of AdMatix. Rows are immutable: once
written they cannot be updated or deleted by the application role. Each row is
hash-chained to its predecessor, and ranges of rows are periodically anchored
into a Merkle root for external timestamping.

```sql
-- ============================================================================
-- AdMatix Data Layer -- Part 1: ledger schema
-- Tamper-evident, append-only event log + Merkle anchoring.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS ledger;

COMMENT ON SCHEMA ledger IS
  'Tamper-evident, append-only audit ledger. Every governance-relevant event (proposal, gate decision, approval, execution diff, measurement, reflection, flag) is hash-chained here. UPDATE and DELETE are revoked and blocked by trigger. Merkle anchors provide external verifiability.';

-- ----------------------------------------------------------------------------
-- Enum: ledger.event_type -- the kind of governance event recorded.
-- ----------------------------------------------------------------------------
CREATE TYPE ledger.event_type AS ENUM (
  'proposal',        -- an H0 packet / proposed action was created
  'gate_decision',   -- a policy gate allowed/blocked/escalated an action
  'approval',        -- a human approval or rejection receipt
  'execution_diff',  -- a dry-run before/after preview was produced
  'measurement',     -- an outcome measurement was recorded
  'reflection',      -- a reflect-step learning was recorded
  'flag'             -- a manual or automated integrity/anomaly flag
);

COMMENT ON TYPE ledger.event_type IS
  'Classifies a ledger.action_events row: proposal | gate_decision | approval | execution_diff | measurement | reflection | flag.';

-- ----------------------------------------------------------------------------
-- Enum: ledger.workflow_step -- which phase of plan/activate/measure/reflect.
-- ----------------------------------------------------------------------------
CREATE TYPE ledger.workflow_step AS ENUM (
  'plan',      -- planning / proposal generation
  'activate',  -- dry-run activation and gating
  'measure',   -- outcome measurement
  'reflect'    -- post-hoc reflection / learning
);

COMMENT ON TYPE ledger.workflow_step IS
  'The plan/activate/measure/reflect phase an event belongs to. Mirrors WorkflowStep in @admatix/schemas.';

-- ----------------------------------------------------------------------------
-- Table: ledger.action_events
-- Grain: exactly one row per governance event. Append-only, hash-chained.
-- ----------------------------------------------------------------------------
CREATE TABLE ledger.action_events (
  event_id        text                 NOT NULL,
  seq             bigserial            NOT NULL,
  tx_id           text                 NOT NULL,
  workflow_id     text                 NOT NULL,
  trace_id        text                 NOT NULL,
  tenant_id       text                 NOT NULL,
  event_type      ledger.event_type    NOT NULL,
  step            ledger.workflow_step NOT NULL,
  actor_agent_id  text                 NOT NULL,
  subject_id      text,
  payload         jsonb                NOT NULL DEFAULT '{}'::jsonb,
  payload_hash    char(64)             NOT NULL,
  prev_hash       char(64)             NOT NULL,
  entry_hash      char(64)             NOT NULL,
  signature       text,
  created_at      timestamptz          NOT NULL DEFAULT now(),

  CONSTRAINT pk_action_events            PRIMARY KEY (event_id),
  CONSTRAINT uq_action_events_seq        UNIQUE (seq),
  CONSTRAINT uq_action_events_entry_hash UNIQUE (entry_hash),
  CONSTRAINT ck_action_events_payload_hash_hex
    CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_action_events_prev_hash_hex
    CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_action_events_entry_hash_hex
    CHECK (entry_hash ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE ledger.action_events IS
  'Append-only hash-chained event ledger. One row per governance event. seq gives monotonic chain order; entry_hash chains each row to its predecessor via prev_hash. UPDATE/DELETE are revoked and trigger-blocked.';

COMMENT ON COLUMN ledger.action_events.event_id IS
  'Primary key. ULID rendered as text (26-char Crockford base32), generated by the application. Sortable by creation time.';
COMMENT ON COLUMN ledger.action_events.seq IS
  'Monotonic chain order (bigserial). Defines the canonical hash-chain sequence; ordering is strictly increasing.';
COMMENT ON COLUMN ledger.action_events.tx_id IS
  'AdMatix transaction id tying together task, cost, route, trace and handoff records. Never null; preserved end-to-end.';
COMMENT ON COLUMN ledger.action_events.workflow_id IS
  'Identifier of the plan/activate/measure/reflect workflow instance this event belongs to.';
COMMENT ON COLUMN ledger.action_events.trace_id IS
  'Distributed trace id (Langfuse/OpenTelemetry) for cross-system correlation.';
COMMENT ON COLUMN ledger.action_events.tenant_id IS
  'Owning tenant. Denormalised into the ledger so a tenant slice of the chain can be exported and verified independently.';
COMMENT ON COLUMN ledger.action_events.event_type IS
  'Kind of event: proposal | gate_decision | approval | execution_diff | measurement | reflection | flag.';
COMMENT ON COLUMN ledger.action_events.step IS
  'Workflow phase: plan | activate | measure | reflect.';
COMMENT ON COLUMN ledger.action_events.actor_agent_id IS
  'Identifier of the agent or human actor that produced the event (e.g. "policy-guard", "user:uuid").';
COMMENT ON COLUMN ledger.action_events.subject_id IS
  'Identifier of the entity the event is about (h0_packet id, proposed_action id, etc.). Nullable for system-level events.';
COMMENT ON COLUMN ledger.action_events.payload IS
  'Full event payload as jsonb. Immutable. The canonical, hashable record of what happened.';
COMMENT ON COLUMN ledger.action_events.payload_hash IS
  'SHA-256 (hex, 64 chars) of the canonicalised payload. Computed by trigger via admatix_sha256_jsonb(payload).';
COMMENT ON COLUMN ledger.action_events.prev_hash IS
  'entry_hash of the immediately preceding row in seq order. The genesis row uses 64 zero characters. Set by trigger.';
COMMENT ON COLUMN ledger.action_events.entry_hash IS
  'SHA-256 of the chain material (prev_hash || event_id || tx_id || event_type || step || payload_hash || created_at). Set by trigger.';
COMMENT ON COLUMN ledger.action_events.signature IS
  'Optional detached cryptographic signature over entry_hash (e.g. Ed25519, base64). Null when signing is not configured.';
COMMENT ON COLUMN ledger.action_events.created_at IS
  'UTC timestamp the event was written. Part of the chain material; immutable.';

-- Indexes: every common filter column gets an index.
CREATE INDEX idx_action_events_tx_id        ON ledger.action_events (tx_id);
CREATE INDEX idx_action_events_workflow_id  ON ledger.action_events (workflow_id);
CREATE INDEX idx_action_events_trace_id     ON ledger.action_events (trace_id);
CREATE INDEX idx_action_events_tenant_id    ON ledger.action_events (tenant_id);
CREATE INDEX idx_action_events_event_type   ON ledger.action_events (event_type);
CREATE INDEX idx_action_events_step         ON ledger.action_events (step);
CREATE INDEX idx_action_events_subject_id   ON ledger.action_events (subject_id);
CREATE INDEX idx_action_events_actor        ON ledger.action_events (actor_agent_id);
CREATE INDEX idx_action_events_created_at   ON ledger.action_events (created_at);
CREATE INDEX idx_action_events_tenant_seq   ON ledger.action_events (tenant_id, seq);
CREATE INDEX idx_action_events_payload_gin  ON ledger.action_events USING gin (payload jsonb_path_ops);

COMMENT ON INDEX ledger.idx_action_events_tenant_seq IS
  'Composite index supporting per-tenant chain export and verification in seq order.';
COMMENT ON INDEX ledger.idx_action_events_payload_gin IS
  'GIN index on the jsonb payload for containment queries (@>) used by the verification dashboard.';

-- ----------------------------------------------------------------------------
-- Table: ledger.merkle_anchors
-- Periodic anchoring of a contiguous range of action_events into a Merkle root.
-- ----------------------------------------------------------------------------
CREATE TABLE ledger.merkle_anchors (
  anchor_id        bigint        GENERATED ALWAYS AS IDENTITY,
  from_seq         bigint        NOT NULL,
  to_seq           bigint        NOT NULL,
  merkle_root      char(64)      NOT NULL,
  event_count      integer       NOT NULL,
  anchored_at      timestamptz   NOT NULL DEFAULT now(),
  external_anchor  text,

  CONSTRAINT pk_merkle_anchors          PRIMARY KEY (anchor_id),
  CONSTRAINT uq_merkle_anchors_range    UNIQUE (from_seq, to_seq),
  CONSTRAINT ck_merkle_anchors_range    CHECK (to_seq >= from_seq),
  CONSTRAINT ck_merkle_anchors_count    CHECK (event_count = to_seq - from_seq + 1),
  CONSTRAINT ck_merkle_anchors_root_hex CHECK (merkle_root ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE ledger.merkle_anchors IS
  'Periodic Merkle anchoring of contiguous action_events ranges. Each row commits a verifiable digest of [from_seq, to_seq]. external_anchor optionally records an off-system commitment (blockchain tx, RFC-3161 timestamp) for independent verification.';

COMMENT ON COLUMN ledger.merkle_anchors.anchor_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN ledger.merkle_anchors.from_seq IS
  'Inclusive lower bound: the smallest action_events.seq covered by this anchor.';
COMMENT ON COLUMN ledger.merkle_anchors.to_seq IS
  'Inclusive upper bound: the largest action_events.seq covered by this anchor.';
COMMENT ON COLUMN ledger.merkle_anchors.merkle_root IS
  'SHA-256 (hex, 64 chars) Merkle root computed over the entry_hash values of all events in [from_seq, to_seq].';
COMMENT ON COLUMN ledger.merkle_anchors.event_count IS
  'Number of events covered. Constrained to equal to_seq - from_seq + 1.';
COMMENT ON COLUMN ledger.merkle_anchors.anchored_at IS 'UTC timestamp the anchor was computed and recorded.';
COMMENT ON COLUMN ledger.merkle_anchors.external_anchor IS
  'Optional external commitment reference (blockchain tx hash, RFC-3161 token, OpenTimestamps proof URL). Null until externally anchored.';

CREATE INDEX idx_merkle_anchors_anchored_at ON ledger.merkle_anchors (anchored_at);
CREATE INDEX idx_merkle_anchors_to_seq      ON ledger.merkle_anchors (to_seq);

-- ----------------------------------------------------------------------------
-- Trigger function: hash-chain on INSERT.
-- Computes payload_hash, pulls prev_hash from the prior row (by seq), derives
-- entry_hash. Any client-supplied values for these columns are overwritten.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger.action_events_hash_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_hash char(64);
  v_genesis   char(64) := repeat('0', 64);
BEGIN
  -- Compute the payload hash from the canonicalised payload.
  NEW.payload_hash := public.admatix_sha256_jsonb(NEW.payload);

  -- Pull prev_hash from the most recent row by seq. NEW.seq is already assigned
  -- because the bigserial DEFAULT is evaluated before BEFORE-INSERT triggers.
  SELECT ae.entry_hash
    INTO v_prev_hash
    FROM ledger.action_events ae
   WHERE ae.seq < NEW.seq
   ORDER BY ae.seq DESC
   LIMIT 1;

  NEW.prev_hash := COALESCE(v_prev_hash, v_genesis);

  -- Derive entry_hash from the immutable chain material.
  NEW.entry_hash := public.admatix_sha256_text(
       NEW.prev_hash
    || '|' || NEW.event_id
    || '|' || NEW.tx_id
    || '|' || NEW.event_type::text
    || '|' || NEW.step::text
    || '|' || NEW.payload_hash
    || '|' || to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION ledger.action_events_hash_chain() IS
  'BEFORE INSERT trigger on ledger.action_events. Computes payload_hash, sets prev_hash from the previous row by seq (genesis = 64 zeros), and derives entry_hash over the immutable chain material. Client-supplied hash columns are overwritten.';

CREATE TRIGGER trg_action_events_hash_chain
  BEFORE INSERT ON ledger.action_events
  FOR EACH ROW
  EXECUTE FUNCTION ledger.action_events_hash_chain();

COMMENT ON TRIGGER trg_action_events_hash_chain ON ledger.action_events IS
  'Maintains the tamper-evident hash chain on every INSERT.';

-- ----------------------------------------------------------------------------
-- Trigger function: block UPDATE and DELETE on the ledger. Defence in depth
-- alongside the REVOKE statements below.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'ledger.% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation',
          HINT = 'Ledger rows are immutable. Append a corrective event instead.';
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION ledger.reject_mutation() IS
  'Trigger function that unconditionally raises on UPDATE/DELETE/TRUNCATE. Enforces ledger immutability even if table privileges are misconfigured.';

CREATE TRIGGER trg_action_events_no_update
  BEFORE UPDATE ON ledger.action_events
  FOR EACH ROW EXECUTE FUNCTION ledger.reject_mutation();

CREATE TRIGGER trg_action_events_no_delete
  BEFORE DELETE ON ledger.action_events
  FOR EACH ROW EXECUTE FUNCTION ledger.reject_mutation();

CREATE TRIGGER trg_action_events_no_truncate
  BEFORE TRUNCATE ON ledger.action_events
  FOR EACH STATEMENT EXECUTE FUNCTION ledger.reject_mutation();

CREATE TRIGGER trg_merkle_anchors_no_update
  BEFORE UPDATE ON ledger.merkle_anchors
  FOR EACH ROW EXECUTE FUNCTION ledger.reject_mutation();

CREATE TRIGGER trg_merkle_anchors_no_delete
  BEFORE DELETE ON ledger.merkle_anchors
  FOR EACH ROW EXECUTE FUNCTION ledger.reject_mutation();

COMMENT ON TRIGGER trg_action_events_no_update ON ledger.action_events IS
  'Blocks all UPDATE statements: ledger rows are immutable.';
COMMENT ON TRIGGER trg_action_events_no_delete ON ledger.action_events IS
  'Blocks all DELETE statements: ledger rows are immutable.';

-- ----------------------------------------------------------------------------
-- Privileges: grant append + read only. Revoke UPDATE/DELETE/TRUNCATE.
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA ledger TO admatix_app, admatix_readonly;

GRANT SELECT, INSERT ON ledger.action_events  TO admatix_app;
GRANT SELECT, INSERT ON ledger.merkle_anchors TO admatix_app;
GRANT SELECT          ON ledger.action_events  TO admatix_readonly;
GRANT SELECT          ON ledger.merkle_anchors TO admatix_readonly;

-- The bigserial / identity sequences must be usable by the app role for INSERT.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ledger TO admatix_app;

-- Explicitly revoke the mutating privileges. The UPDATE/DELETE triggers above
-- are belt-and-braces in case a future GRANT accidentally re-adds these.
REVOKE UPDATE, DELETE, TRUNCATE ON ledger.action_events  FROM admatix_app, admatix_readonly, PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON ledger.merkle_anchors FROM admatix_app, admatix_readonly, PUBLIC;
```


---

## Part 2 — `app` Schema (Operational / Mutable)

The `app` schema holds the live, mutable operational state: tenants, users,
connected ad accounts, the credential vault, H0 packets, proposed actions,
policy decisions, and the trust system. These tables are freely updatable;
durable audit history lives in the `ledger` schema.

```sql
-- ============================================================================
-- AdMatix Data Layer -- Part 2: app schema
-- Operational, mutable state.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS app;

COMMENT ON SCHEMA app IS
  'Operational, mutable application state: tenants, users, ad accounts, credential vault, H0 packets, proposed actions, policy decisions, approvals, measurements, and the trust system. Durable audit history is in the ledger schema.';

-- ----------------------------------------------------------------------------
-- Enums for the app schema.
-- ----------------------------------------------------------------------------
CREATE TYPE app.ad_platform AS ENUM (
  'google_ads', 'meta_ads', 'tiktok_ads', 'dv360',
  'trade_desk', 'linkedin_ads', 'amazon_ads', 'first_party'
);
COMMENT ON TYPE app.ad_platform IS
  'Ad platforms AdMatix can read from. first_party is the truth source for MER. Mirrors the Platform enum in @admatix/schemas.';

CREATE TYPE app.entity_status AS ENUM ('active', 'paused', 'removed', 'draft');
COMMENT ON TYPE app.entity_status IS
  'Lifecycle status of a connected ad entity (account/campaign/ad set/creative).';

CREATE TYPE app.connection_status AS ENUM ('pending', 'active', 'expired', 'revoked', 'error');
COMMENT ON TYPE app.connection_status IS
  'Health of a stored platform credential connection.';

CREATE TYPE app.h0_state AS ENUM (
  'draft', 'validated', 'pending_approval', 'approved', 'rejected', 'measured', 'reflected'
);
COMMENT ON TYPE app.h0_state IS
  'Lifecycle state of an H0 packet through the plan/activate/measure/reflect loop.';

CREATE TYPE app.causal_status AS ENUM (
  'directional_until_lift_test', 'experimental', 'causal'
);
COMMENT ON TYPE app.causal_status IS
  'Strength of a causal claim. Detectors default to directional_until_lift_test. Mirrors CausalStatus in @admatix/schemas.';

CREATE TYPE app.action_type AS ENUM (
  'budget_shift', 'pause_entity', 'resume_entity', 'bid_adjust',
  'add_negative_keyword', 'creative_rotate', 'no_op'
);
COMMENT ON TYPE app.action_type IS
  'The kind of change a proposed action represents. Mirrors ActionType in @admatix/schemas.';

CREATE TYPE app.risk_level AS ENUM ('low', 'medium', 'high');
COMMENT ON TYPE app.risk_level IS
  'Risk classification of a proposed action or agent run.';

CREATE TYPE app.policy_result AS ENUM ('allow', 'block', 'needs_approval');
COMMENT ON TYPE app.policy_result IS
  'The PolicyGuard verdict on a proposed action.';

CREATE TYPE app.policy_severity AS ENUM ('block', 'warn');
COMMENT ON TYPE app.policy_severity IS
  'Whether a policy rule hard-blocks an action or only warns.';

CREATE TYPE app.policy_kind AS ENUM (
  'budget_cap', 'approval_required', 'prohibited_action', 'brand_safety', 'platform_limit'
);
COMMENT ON TYPE app.policy_kind IS
  'Category of a policy rule. Mirrors PolicyRule.kind in @admatix/schemas.';

CREATE TYPE app.approval_decision AS ENUM ('approved', 'rejected');
COMMENT ON TYPE app.approval_decision IS
  'Terminal human decision recorded on an approval receipt.';

CREATE TYPE app.workflow_step AS ENUM ('plan', 'activate', 'measure', 'reflect');
COMMENT ON TYPE app.workflow_step IS
  'The plan/activate/measure/reflect phase an agent run belongs to.';

CREATE TYPE app.agent_run_status AS ENUM ('completed', 'blocked', 'error');
COMMENT ON TYPE app.agent_run_status IS
  'Terminal status of a persisted agent run.';

CREATE TYPE app.trust_subject_type AS ENUM ('agent', 'skill', 'connector');
COMMENT ON TYPE app.trust_subject_type IS
  'The kind of entity a trust score is attached to.';

CREATE TYPE app.user_role AS ENUM ('owner', 'admin', 'approver', 'analyst', 'viewer');
COMMENT ON TYPE app.user_role IS
  'Role of a user within a tenant. approver may sign approval receipts.';

-- ----------------------------------------------------------------------------
-- Table: app.tenants
-- ----------------------------------------------------------------------------
CREATE TABLE app.tenants (
  tenant_id    uuid          NOT NULL DEFAULT gen_random_uuid(),
  slug         citext        NOT NULL,
  name         text          NOT NULL,
  plan         text          NOT NULL DEFAULT 'free',
  is_active    boolean       NOT NULL DEFAULT true,
  settings     jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_tenants      PRIMARY KEY (tenant_id),
  CONSTRAINT uq_tenants_slug UNIQUE (slug)
);

COMMENT ON TABLE app.tenants IS
  'Top-level customer organisation. Every other app row is scoped to a tenant.';
COMMENT ON COLUMN app.tenants.tenant_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN app.tenants.slug IS 'Case-insensitive unique short identifier used in URLs and CLI.';
COMMENT ON COLUMN app.tenants.name IS 'Human-readable tenant / company name.';
COMMENT ON COLUMN app.tenants.plan IS 'Subscription plan key (free, team, enterprise, ...).';
COMMENT ON COLUMN app.tenants.is_active IS 'False soft-disables the tenant without deleting data.';
COMMENT ON COLUMN app.tenants.settings IS 'Tenant-level configuration as jsonb (feature flags, defaults).';
COMMENT ON COLUMN app.tenants.created_at IS 'UTC creation timestamp.';
COMMENT ON COLUMN app.tenants.updated_at IS 'UTC timestamp of the last mutation (maintained by trigger).';

CREATE INDEX idx_tenants_is_active ON app.tenants (is_active);
CREATE TRIGGER trg_tenants_touch BEFORE UPDATE ON app.tenants
  FOR EACH ROW EXECUTE FUNCTION public.admatix_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Table: app.users
-- ----------------------------------------------------------------------------
CREATE TABLE app.users (
  user_id        uuid          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid          NOT NULL,
  email          citext        NOT NULL,
  display_name   text,
  role           app.user_role NOT NULL DEFAULT 'viewer',
  auth_subject   text,
  is_active      boolean       NOT NULL DEFAULT true,
  last_seen_at   timestamptz,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_users              PRIMARY KEY (user_id),
  CONSTRAINT fk_users_tenant       FOREIGN KEY (tenant_id)
                                   REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT uq_users_tenant_email UNIQUE (tenant_id, email)
);

COMMENT ON TABLE app.users IS
  'A person with access to a tenant. approver-role users can sign approval receipts.';
COMMENT ON COLUMN app.users.user_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN app.users.tenant_id IS 'Owning tenant (FK app.tenants).';
COMMENT ON COLUMN app.users.email IS 'Case-insensitive email; unique within a tenant.';
COMMENT ON COLUMN app.users.display_name IS 'Optional human-readable name.';
COMMENT ON COLUMN app.users.role IS 'Tenant-scoped role: owner | admin | approver | analyst | viewer.';
COMMENT ON COLUMN app.users.auth_subject IS 'External auth provider subject id (Supabase auth.users.id), nullable for service accounts.';
COMMENT ON COLUMN app.users.is_active IS 'False soft-disables the user.';
COMMENT ON COLUMN app.users.last_seen_at IS 'UTC timestamp of last activity, for session/audit reporting.';
COMMENT ON COLUMN app.users.created_at IS 'UTC creation timestamp.';
COMMENT ON COLUMN app.users.updated_at IS 'UTC timestamp of the last mutation (maintained by trigger).';

CREATE INDEX idx_users_tenant_id ON app.users (tenant_id);
CREATE INDEX idx_users_role      ON app.users (role);
CREATE INDEX idx_users_is_active ON app.users (is_active);
CREATE TRIGGER trg_users_touch BEFORE UPDATE ON app.users
  FOR EACH ROW EXECUTE FUNCTION public.admatix_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Table: app.ad_accounts
-- ----------------------------------------------------------------------------
CREATE TABLE app.ad_accounts (
  ad_account_id        uuid              NOT NULL DEFAULT gen_random_uuid(),
  tenant_id            uuid              NOT NULL,
  platform             app.ad_platform   NOT NULL,
  external_account_id  text              NOT NULL,
  name                 text              NOT NULL,
  currency             char(3)           NOT NULL DEFAULT 'USD',
  timezone             text              NOT NULL DEFAULT 'UTC',
  status               app.entity_status NOT NULL DEFAULT 'active',
  raw                  jsonb             NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz       NOT NULL DEFAULT now(),
  updated_at           timestamptz       NOT NULL DEFAULT now(),

  CONSTRAINT pk_ad_accounts          PRIMARY KEY (ad_account_id),
  CONSTRAINT fk_ad_accounts_tenant   FOREIGN KEY (tenant_id)
                                     REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT uq_ad_accounts_external UNIQUE (tenant_id, platform, external_account_id)
);

COMMENT ON TABLE app.ad_accounts IS
  'A connected ad account on a specific platform. external_account_id is the platform-native id.';
COMMENT ON COLUMN app.ad_accounts.ad_account_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN app.ad_accounts.tenant_id IS 'Owning tenant (FK app.tenants).';
COMMENT ON COLUMN app.ad_accounts.platform IS 'Ad platform this account belongs to.';
COMMENT ON COLUMN app.ad_accounts.external_account_id IS 'Platform-native account id (e.g. Google Ads customer id).';
COMMENT ON COLUMN app.ad_accounts.name IS 'Human-readable account name.';
COMMENT ON COLUMN app.ad_accounts.currency IS 'ISO-4217 currency code of the account.';
COMMENT ON COLUMN app.ad_accounts.timezone IS 'IANA timezone of the account, used to align daily metrics.';
COMMENT ON COLUMN app.ad_accounts.status IS 'Lifecycle status of the account.';
COMMENT ON COLUMN app.ad_accounts.raw IS 'Lossless capture of unknown platform fields as jsonb.';
COMMENT ON COLUMN app.ad_accounts.created_at IS 'UTC creation timestamp.';
COMMENT ON COLUMN app.ad_accounts.updated_at IS 'UTC timestamp of the last mutation (maintained by trigger).';

CREATE INDEX idx_ad_accounts_tenant_id ON app.ad_accounts (tenant_id);
CREATE INDEX idx_ad_accounts_platform  ON app.ad_accounts (platform);
CREATE INDEX idx_ad_accounts_status    ON app.ad_accounts (status);
CREATE TRIGGER trg_ad_accounts_touch BEFORE UPDATE ON app.ad_accounts
  FOR EACH ROW EXECUTE FUNCTION public.admatix_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Table: app.connections -- the credential vault.
-- Tokens are stored encrypted at rest (token_ciphertext); plaintext never lands.
-- ----------------------------------------------------------------------------
CREATE TABLE app.connections (
  connection_id     uuid                  NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid                  NOT NULL,
  ad_account_id     uuid,
  platform          app.ad_platform       NOT NULL,
  status            app.connection_status NOT NULL DEFAULT 'pending',
  token_ciphertext  bytea                 NOT NULL,
  token_iv          bytea                 NOT NULL,
  token_auth_tag    bytea,
  key_id            text                  NOT NULL,
  scopes            text[]                NOT NULL DEFAULT '{}',
  expires_at        timestamptz,
  last_refreshed_at timestamptz,
  last_error        text,
  created_by        uuid,
  created_at        timestamptz           NOT NULL DEFAULT now(),
  updated_at        timestamptz           NOT NULL DEFAULT now(),

  CONSTRAINT pk_connections         PRIMARY KEY (connection_id),
  CONSTRAINT fk_connections_tenant  FOREIGN KEY (tenant_id)
                                    REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_connections_account FOREIGN KEY (ad_account_id)
                                    REFERENCES app.ad_accounts (ad_account_id) ON DELETE SET NULL,
  CONSTRAINT fk_connections_creator FOREIGN KEY (created_by)
                                    REFERENCES app.users (user_id) ON DELETE SET NULL
);

COMMENT ON TABLE app.connections IS
  'Credential vault. Stores encrypted OAuth/API tokens for platform connections. Plaintext secrets are never persisted; token_ciphertext is AES-GCM ciphertext decrypted only in memory by the connector service.';
COMMENT ON COLUMN app.connections.connection_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN app.connections.tenant_id IS 'Owning tenant (FK app.tenants).';
COMMENT ON COLUMN app.connections.ad_account_id IS 'Optional linked ad account (FK app.ad_accounts). Null for account-discovery connections.';
COMMENT ON COLUMN app.connections.platform IS 'Platform this credential authenticates against.';
COMMENT ON COLUMN app.connections.status IS 'Connection health: pending | active | expired | revoked | error.';
COMMENT ON COLUMN app.connections.token_ciphertext IS 'AES-GCM-encrypted credential blob (access + refresh token). Never plaintext.';
COMMENT ON COLUMN app.connections.token_iv IS 'Initialisation vector / nonce used to encrypt token_ciphertext.';
COMMENT ON COLUMN app.connections.token_auth_tag IS 'AES-GCM authentication tag verifying ciphertext integrity. Null only for non-AEAD ciphers.';
COMMENT ON COLUMN app.connections.key_id IS 'Identifier of the KMS/envelope key used, enabling key rotation.';
COMMENT ON COLUMN app.connections.scopes IS 'OAuth scopes granted to this credential.';
COMMENT ON COLUMN app.connections.expires_at IS 'UTC expiry of the access token; null if non-expiring.';
COMMENT ON COLUMN app.connections.last_refreshed_at IS 'UTC timestamp the token was last refreshed.';
COMMENT ON COLUMN app.connections.last_error IS 'Last connection error message, for operator diagnostics.';
COMMENT ON COLUMN app.connections.created_by IS 'User who created the connection (FK app.users).';
COMMENT ON COLUMN app.connections.created_at IS 'UTC creation timestamp.';
COMMENT ON COLUMN app.connections.updated_at IS 'UTC timestamp of the last mutation (maintained by trigger).';

CREATE INDEX idx_connections_tenant_id  ON app.connections (tenant_id);
CREATE INDEX idx_connections_account_id ON app.connections (ad_account_id);
CREATE INDEX idx_connections_platform   ON app.connections (platform);
CREATE INDEX idx_connections_status     ON app.connections (status);
CREATE INDEX idx_connections_expires_at ON app.connections (expires_at);
CREATE INDEX idx_connections_created_by ON app.connections (created_by);
CREATE TRIGGER trg_connections_touch BEFORE UPDATE ON app.connections
  FOR EACH ROW EXECUTE FUNCTION public.admatix_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Table: app.policies -- versioned policy rule sets evaluated by PolicyGuard.
-- ----------------------------------------------------------------------------
CREATE TABLE app.policies (
  policy_id       uuid          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid          NOT NULL,
  policy_version  text          NOT NULL,
  name            text          NOT NULL,
  description     text,
  is_active       boolean       NOT NULL DEFAULT true,
  rules           jsonb         NOT NULL DEFAULT '[]'::jsonb,
  rules_hash      char(64)      NOT NULL,
  effective_from  timestamptz   NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_by      uuid,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_policies          PRIMARY KEY (policy_id),
  CONSTRAINT fk_policies_tenant   FOREIGN KEY (tenant_id)
                                  REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_policies_creator  FOREIGN KEY (created_by)
                                  REFERENCES app.users (user_id) ON DELETE SET NULL,
  CONSTRAINT uq_policies_version  UNIQUE (tenant_id, policy_version)
);

COMMENT ON TABLE app.policies IS
  'Versioned policy rule sets. Each PolicyDecision pins a policy_version so gating verdicts are reproducible. rules holds the array of PolicyRule objects.';
COMMENT ON COLUMN app.policies.policy_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN app.policies.tenant_id IS 'Owning tenant (FK app.tenants).';
COMMENT ON COLUMN app.policies.policy_version IS 'Semantic version string of the rule set; unique within a tenant.';
COMMENT ON COLUMN app.policies.name IS 'Human-readable policy name.';
COMMENT ON COLUMN app.policies.description IS 'Optional description of the policy intent.';
COMMENT ON COLUMN app.policies.is_active IS 'True if this version is the one currently enforced.';
COMMENT ON COLUMN app.policies.rules IS 'jsonb array of PolicyRule objects (rule_id, kind, params, severity).';
COMMENT ON COLUMN app.policies.rules_hash IS 'SHA-256 (hex, 64 chars) of the rules array, for integrity and change detection.';
COMMENT ON COLUMN app.policies.effective_from IS 'UTC timestamp this policy version becomes effective.';
COMMENT ON COLUMN app.policies.effective_to IS 'UTC timestamp this policy version is superseded; null while current.';
COMMENT ON COLUMN app.policies.created_by IS 'User who authored the policy version (FK app.users).';
COMMENT ON COLUMN app.policies.created_at IS 'UTC creation timestamp.';
COMMENT ON COLUMN app.policies.updated_at IS 'UTC timestamp of the last mutation (maintained by trigger).';

CREATE INDEX idx_policies_tenant_id  ON app.policies (tenant_id);
CREATE INDEX idx_policies_is_active  ON app.policies (is_active);
CREATE INDEX idx_policies_version    ON app.policies (policy_version);
CREATE INDEX idx_policies_created_by ON app.policies (created_by);
CREATE TRIGGER trg_policies_touch BEFORE UPDATE ON app.policies
  FOR EACH ROW EXECUTE FUNCTION public.admatix_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Table: app.h0_packets -- the unit of trust in AdMatix.
-- ----------------------------------------------------------------------------
CREATE TABLE app.h0_packets (
  h0_packet_id      uuid              NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid              NOT NULL,
  ad_account_id     uuid,
  workflow_id       text              NOT NULL,
  tx_id             text              NOT NULL,
  trace_id          text              NOT NULL,
  state             app.h0_state      NOT NULL DEFAULT 'draft',
  causal_status     app.causal_status NOT NULL DEFAULT 'directional_until_lift_test',
  goal              text              NOT NULL,
  hypothesis        text              NOT NULL,
  null_hypothesis   text              NOT NULL,
  baseline_window   text              NOT NULL,
  success_metric    text              NOT NULL,
  body              jsonb             NOT NULL DEFAULT '{}'::jsonb,
  body_hash         char(64)          NOT NULL,
  created_by_agent  text              NOT NULL,
  created_at        timestamptz       NOT NULL DEFAULT now(),
  updated_at        timestamptz       NOT NULL DEFAULT now(),

  CONSTRAINT pk_h0_packets          PRIMARY KEY (h0_packet_id),
  CONSTRAINT fk_h0_packets_tenant   FOREIGN KEY (tenant_id)
                                    REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_h0_packets_account  FOREIGN KEY (ad_account_id)
                                    REFERENCES app.ad_accounts (ad_account_id) ON DELETE SET NULL,
  CONSTRAINT ck_h0_packets_body_hash_hex CHECK (body_hash ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE app.h0_packets IS
  'The H0 packet -- the unit of trust in AdMatix. Bundles goal, hypothesis, null hypothesis, evidence, guardrails, proposal, rollback and approval into one verifiable record. body holds the full H0Packet jsonb; body_hash is its integrity digest.';
COMMENT ON COLUMN app.h0_packets.h0_packet_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN app.h0_packets.tenant_id IS 'Owning tenant (FK app.tenants).';
COMMENT ON COLUMN app.h0_packets.ad_account_id IS 'Ad account the packet operates on (FK app.ad_accounts). Nullable for account-agnostic packets.';
COMMENT ON COLUMN app.h0_packets.workflow_id IS 'Workflow instance id linking the packet across plan/activate/measure/reflect.';
COMMENT ON COLUMN app.h0_packets.tx_id IS 'AdMatix transaction id; preserved end-to-end and joined to the ledger.';
COMMENT ON COLUMN app.h0_packets.trace_id IS 'Distributed trace id for cross-system correlation.';
COMMENT ON COLUMN app.h0_packets.state IS 'Lifecycle state: draft | validated | pending_approval | approved | rejected | measured | reflected.';
COMMENT ON COLUMN app.h0_packets.causal_status IS 'Strength of the causal claim: directional_until_lift_test | experimental | causal.';
COMMENT ON COLUMN app.h0_packets.goal IS 'Plain-language objective of the packet.';
COMMENT ON COLUMN app.h0_packets.hypothesis IS 'The hypothesis being tested (the expected effect).';
COMMENT ON COLUMN app.h0_packets.null_hypothesis IS 'The null hypothesis (no effect), required for honest measurement.';
COMMENT ON COLUMN app.h0_packets.baseline_window IS 'The baseline measurement window (e.g. "2026-04-01..2026-04-30").';
COMMENT ON COLUMN app.h0_packets.success_metric IS 'The metric that determines whether the packet succeeded.';
COMMENT ON COLUMN app.h0_packets.body IS 'Full H0Packet jsonb: evidence refs, guardrails, proposal, rollback, approval block.';
COMMENT ON COLUMN app.h0_packets.body_hash IS 'SHA-256 (hex, 64 chars) of the canonicalised body, computed by trigger via admatix_sha256_jsonb(body).';
COMMENT ON COLUMN app.h0_packets.created_by_agent IS 'Identifier of the agent that authored the packet.';
COMMENT ON COLUMN app.h0_packets.created_at IS 'UTC creation timestamp.';
COMMENT ON COLUMN app.h0_packets.updated_at IS 'UTC timestamp of the last mutation (maintained by trigger).';

CREATE INDEX idx_h0_packets_tenant_id   ON app.h0_packets (tenant_id);
CREATE INDEX idx_h0_packets_account_id  ON app.h0_packets (ad_account_id);
CREATE INDEX idx_h0_packets_workflow_id ON app.h0_packets (workflow_id);
CREATE INDEX idx_h0_packets_tx_id       ON app.h0_packets (tx_id);
CREATE INDEX idx_h0_packets_trace_id    ON app.h0_packets (trace_id);
CREATE INDEX idx_h0_packets_state       ON app.h0_packets (state);
CREATE INDEX idx_h0_packets_created_at  ON app.h0_packets (created_at);

-- Trigger: compute body_hash and maintain updated_at on h0_packets.
CREATE OR REPLACE FUNCTION app.h0_packets_biud()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.body_hash := public.admatix_sha256_jsonb(NEW.body);
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION app.h0_packets_biud() IS
  'BEFORE INSERT/UPDATE trigger on app.h0_packets: recomputes body_hash from body and touches updated_at on UPDATE.';

CREATE TRIGGER trg_h0_packets_biud
  BEFORE INSERT OR UPDATE ON app.h0_packets
  FOR EACH ROW EXECUTE FUNCTION app.h0_packets_biud();

-- ----------------------------------------------------------------------------
-- Table: app.proposed_actions -- a change the system wants to make (dry-run).
-- ----------------------------------------------------------------------------
CREATE TABLE app.proposed_actions (
  proposed_action_id uuid             NOT NULL DEFAULT gen_random_uuid(),
  h0_packet_id       uuid             NOT NULL,
  tenant_id          uuid             NOT NULL,
  action_type        app.action_type  NOT NULL,
  target_entity_id   text             NOT NULL,
  params             jsonb            NOT NULL DEFAULT '{}'::jsonb,
  risk_level         app.risk_level   NOT NULL DEFAULT 'low',
  dry_run_only       boolean          NOT NULL DEFAULT true,
  created_at         timestamptz      NOT NULL DEFAULT now(),
  updated_at         timestamptz      NOT NULL DEFAULT now(),

  CONSTRAINT pk_proposed_actions          PRIMARY KEY (proposed_action_id),
  CONSTRAINT fk_proposed_actions_packet   FOREIGN KEY (h0_packet_id)
                                          REFERENCES app.h0_packets (h0_packet_id) ON DELETE CASCADE,
  CONSTRAINT fk_proposed_actions_tenant   FOREIGN KEY (tenant_id)
                                          REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT ck_proposed_actions_dry_run  CHECK (dry_run_only = true)
);

COMMENT ON TABLE app.proposed_actions IS
  'A concrete change the system proposes against an ad entity. In the MVP every action is dry-run only (enforced by CHECK).';
COMMENT ON COLUMN app.proposed_actions.proposed_action_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN app.proposed_actions.h0_packet_id IS 'Parent H0 packet (FK app.h0_packets).';
COMMENT ON COLUMN app.proposed_actions.tenant_id IS 'Owning tenant (FK app.tenants), denormalised for filtering.';
COMMENT ON COLUMN app.proposed_actions.action_type IS 'Kind of change: budget_shift | pause_entity | resume_entity | bid_adjust | add_negative_keyword | creative_rotate | no_op.';
COMMENT ON COLUMN app.proposed_actions.target_entity_id IS 'Platform entity id the action targets (campaign/ad set/creative).';
COMMENT ON COLUMN app.proposed_actions.params IS 'Action parameters as jsonb (e.g. budget delta, bid multiplier).';
COMMENT ON COLUMN app.proposed_actions.risk_level IS 'Risk classification: low | medium | high.';
COMMENT ON COLUMN app.proposed_actions.dry_run_only IS 'Always true in the MVP; the action is a preview, never an executed mutation.';
COMMENT ON COLUMN app.proposed_actions.created_at IS 'UTC creation timestamp.';
COMMENT ON COLUMN app.proposed_actions.updated_at IS 'UTC timestamp of the last mutation (maintained by trigger).';

CREATE INDEX idx_proposed_actions_packet_id   ON app.proposed_actions (h0_packet_id);
CREATE INDEX idx_proposed_actions_tenant_id   ON app.proposed_actions (tenant_id);
CREATE INDEX idx_proposed_actions_action_type ON app.proposed_actions (action_type);
CREATE INDEX idx_proposed_actions_target      ON app.proposed_actions (target_entity_id);
CREATE INDEX idx_proposed_actions_risk_level  ON app.proposed_actions (risk_level);
CREATE TRIGGER trg_proposed_actions_touch BEFORE UPDATE ON app.proposed_actions
  FOR EACH ROW EXECUTE FUNCTION public.admatix_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Table: app.policy_decisions -- the PolicyGuard verdict on a proposed action.
-- ----------------------------------------------------------------------------
CREATE TABLE app.policy_decisions (
  policy_decision_id uuid              NOT NULL DEFAULT gen_random_uuid(),
  proposed_action_id uuid              NOT NULL,
  tenant_id          uuid              NOT NULL,
  policy_id          uuid,
  policy_version     text              NOT NULL,
  result             app.policy_result NOT NULL,
  risk_level         app.risk_level    NOT NULL,
  matched_rules      text[]            NOT NULL DEFAULT '{}',
  reasons            text[]            NOT NULL DEFAULT '{}',
  decided_at         timestamptz       NOT NULL DEFAULT now(),

  CONSTRAINT pk_policy_decisions        PRIMARY KEY (policy_decision_id),
  CONSTRAINT fk_policy_decisions_action FOREIGN KEY (proposed_action_id)
                                        REFERENCES app.proposed_actions (proposed_action_id) ON DELETE CASCADE,
  CONSTRAINT fk_policy_decisions_tenant FOREIGN KEY (tenant_id)
                                        REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_policy_decisions_policy FOREIGN KEY (policy_id)
                                        REFERENCES app.policies (policy_id) ON DELETE SET NULL
);

COMMENT ON TABLE app.policy_decisions IS
  'PolicyGuard verdict on a single proposed action. Pins the policy_version so the decision is reproducible.';
COMMENT ON COLUMN app.policy_decisions.policy_decision_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN app.policy_decisions.proposed_action_id IS 'Action evaluated (FK app.proposed_actions).';
COMMENT ON COLUMN app.policy_decisions.tenant_id IS 'Owning tenant (FK app.tenants), denormalised for filtering.';
COMMENT ON COLUMN app.policy_decisions.policy_id IS 'Policy row used for the decision (FK app.policies). Nullable if the policy was later deleted.';
COMMENT ON COLUMN app.policy_decisions.policy_version IS 'Version string of the policy applied; pinned for reproducibility.';
COMMENT ON COLUMN app.policy_decisions.result IS 'Verdict: allow | block | needs_approval.';
COMMENT ON COLUMN app.policy_decisions.risk_level IS 'Risk level assigned by the gate.';
COMMENT ON COLUMN app.policy_decisions.matched_rules IS 'Array of rule_ids that matched the action.';
COMMENT ON COLUMN app.policy_decisions.reasons IS 'Human-readable reasons explaining the verdict.';
COMMENT ON COLUMN app.policy_decisions.decided_at IS 'UTC timestamp the verdict was rendered.';

CREATE INDEX idx_policy_decisions_action_id  ON app.policy_decisions (proposed_action_id);
CREATE INDEX idx_policy_decisions_tenant_id  ON app.policy_decisions (tenant_id);
CREATE INDEX idx_policy_decisions_policy_id  ON app.policy_decisions (policy_id);
CREATE INDEX idx_policy_decisions_result     ON app.policy_decisions (result);
CREATE INDEX idx_policy_decisions_decided_at ON app.policy_decisions (decided_at);

-- ----------------------------------------------------------------------------
-- Table: app.execution_diffs -- the before/after preview from a dry-run.
-- ----------------------------------------------------------------------------
CREATE TABLE app.execution_diffs (
  execution_diff_id  uuid          NOT NULL DEFAULT gen_random_uuid(),
  proposed_action_id uuid          NOT NULL,
  tenant_id          uuid          NOT NULL,
  entity_id          text          NOT NULL,
  changes            jsonb         NOT NULL DEFAULT '[]'::jsonb,
  estimated_impact   jsonb,
  dry_run            boolean       NOT NULL DEFAULT true,
  created_at         timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_execution_diffs         PRIMARY KEY (execution_diff_id),
  CONSTRAINT fk_execution_diffs_action  FOREIGN KEY (proposed_action_id)
                                        REFERENCES app.proposed_actions (proposed_action_id) ON DELETE CASCADE,
  CONSTRAINT fk_execution_diffs_tenant  FOREIGN KEY (tenant_id)
                                        REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT ck_execution_diffs_dry_run CHECK (dry_run = true)
);

COMMENT ON TABLE app.execution_diffs IS
  'The before/after field-level preview produced by a dry-run activation. Never represents a real mutation (enforced by CHECK).';
COMMENT ON COLUMN app.execution_diffs.execution_diff_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN app.execution_diffs.proposed_action_id IS 'Action the diff previews (FK app.proposed_actions).';
COMMENT ON COLUMN app.execution_diffs.tenant_id IS 'Owning tenant (FK app.tenants), denormalised for filtering.';
COMMENT ON COLUMN app.execution_diffs.entity_id IS 'Platform entity id the diff applies to.';
COMMENT ON COLUMN app.execution_diffs.changes IS 'jsonb array of FieldDiff objects (field, before, after).';
COMMENT ON COLUMN app.execution_diffs.estimated_impact IS 'Optional jsonb map of metric -> estimated numeric impact.';
COMMENT ON COLUMN app.execution_diffs.dry_run IS 'Always true; the diff is a preview, not an applied change.';
COMMENT ON COLUMN app.execution_diffs.created_at IS 'UTC creation timestamp.';

CREATE INDEX idx_execution_diffs_action_id ON app.execution_diffs (proposed_action_id);
CREATE INDEX idx_execution_diffs_tenant_id ON app.execution_diffs (tenant_id);
CREATE INDEX idx_execution_diffs_entity_id ON app.execution_diffs (entity_id);

-- ----------------------------------------------------------------------------
-- Table: app.approval_receipts -- the human decision on an action.
-- ----------------------------------------------------------------------------
CREATE TABLE app.approval_receipts (
  approval_receipt_id uuid                  NOT NULL DEFAULT gen_random_uuid(),
  h0_packet_id        uuid                  NOT NULL,
  proposed_action_id  uuid                  NOT NULL,
  tenant_id           uuid                  NOT NULL,
  decision            app.approval_decision NOT NULL,
  decided_by_user_id  uuid,
  decided_by          text                  NOT NULL,
  role                text                  NOT NULL,
  note                text,
  decided_at          timestamptz           NOT NULL DEFAULT now(),
  created_at          timestamptz           NOT NULL DEFAULT now(),

  CONSTRAINT pk_approval_receipts         PRIMARY KEY (approval_receipt_id),
  CONSTRAINT fk_approval_receipts_packet  FOREIGN KEY (h0_packet_id)
                                          REFERENCES app.h0_packets (h0_packet_id) ON DELETE CASCADE,
  CONSTRAINT fk_approval_receipts_action  FOREIGN KEY (proposed_action_id)
                                          REFERENCES app.proposed_actions (proposed_action_id) ON DELETE CASCADE,
  CONSTRAINT fk_approval_receipts_tenant  FOREIGN KEY (tenant_id)
                                          REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_approval_receipts_user    FOREIGN KEY (decided_by_user_id)
                                          REFERENCES app.users (user_id) ON DELETE SET NULL
);

COMMENT ON TABLE app.approval_receipts IS
  'The human approval or rejection of a proposed action. One receipt per terminal human decision.';
COMMENT ON COLUMN app.approval_receipts.approval_receipt_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN app.approval_receipts.h0_packet_id IS 'H0 packet the decision pertains to (FK app.h0_packets).';
COMMENT ON COLUMN app.approval_receipts.proposed_action_id IS 'Specific action approved/rejected (FK app.proposed_actions).';
COMMENT ON COLUMN app.approval_receipts.tenant_id IS 'Owning tenant (FK app.tenants), denormalised for filtering.';
COMMENT ON COLUMN app.approval_receipts.decision IS 'Terminal decision: approved | rejected.';
COMMENT ON COLUMN app.approval_receipts.decided_by_user_id IS 'User who made the decision (FK app.users). Null if recorded outside the user table.';
COMMENT ON COLUMN app.approval_receipts.decided_by IS 'Display name or identifier of the decider, captured at decision time.';
COMMENT ON COLUMN app.approval_receipts.role IS 'Role the decider held when approving (e.g. "approver", "owner").';
COMMENT ON COLUMN app.approval_receipts.note IS 'Optional free-text rationale for the decision.';
COMMENT ON COLUMN app.approval_receipts.decided_at IS 'UTC timestamp the decision was made.';
COMMENT ON COLUMN app.approval_receipts.created_at IS 'UTC timestamp the receipt row was written.';

CREATE INDEX idx_approval_receipts_packet_id ON app.approval_receipts (h0_packet_id);
CREATE INDEX idx_approval_receipts_action_id ON app.approval_receipts (proposed_action_id);
CREATE INDEX idx_approval_receipts_tenant_id ON app.approval_receipts (tenant_id);
CREATE INDEX idx_approval_receipts_user_id   ON app.approval_receipts (decided_by_user_id);
CREATE INDEX idx_approval_receipts_decision  ON app.approval_receipts (decision);
CREATE INDEX idx_approval_receipts_decided_at ON app.approval_receipts (decided_at);

-- ----------------------------------------------------------------------------
-- Table: app.rollback_checkpoints -- a snapshot enabling restoration.
-- ----------------------------------------------------------------------------
CREATE TABLE app.rollback_checkpoints (
  rollback_checkpoint_id uuid         NOT NULL DEFAULT gen_random_uuid(),
  h0_packet_id           uuid,
  tenant_id              uuid         NOT NULL,
  entity_id              text         NOT NULL,
  method                 text         NOT NULL DEFAULT 'restore_previous_state',
  snapshot               jsonb        NOT NULL DEFAULT '{}'::jsonb,
  snapshot_hash          char(64)     NOT NULL,
  is_consumed            boolean      NOT NULL DEFAULT false,
  created_at             timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT pk_rollback_checkpoints        PRIMARY KEY (rollback_checkpoint_id),
  CONSTRAINT fk_rollback_checkpoints_packet FOREIGN KEY (h0_packet_id)
                                            REFERENCES app.h0_packets (h0_packet_id) ON DELETE SET NULL,
  CONSTRAINT fk_rollback_checkpoints_tenant FOREIGN KEY (tenant_id)
                                            REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT ck_rollback_checkpoints_hash_hex CHECK (snapshot_hash ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE app.rollback_checkpoints IS
  'A captured snapshot of an entity state before a (dry-run) change, enabling deterministic restoration. Every H0 packet must reference a checkpoint.';
COMMENT ON COLUMN app.rollback_checkpoints.rollback_checkpoint_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN app.rollback_checkpoints.h0_packet_id IS 'H0 packet that produced the checkpoint (FK app.h0_packets). Nullable if packet is deleted.';
COMMENT ON COLUMN app.rollback_checkpoints.tenant_id IS 'Owning tenant (FK app.tenants).';
COMMENT ON COLUMN app.rollback_checkpoints.entity_id IS 'Platform entity id the snapshot captures.';
COMMENT ON COLUMN app.rollback_checkpoints.method IS 'The rollback method to apply (e.g. restore_previous_budget).';
COMMENT ON COLUMN app.rollback_checkpoints.snapshot IS 'jsonb snapshot of the entity state at checkpoint time.';
COMMENT ON COLUMN app.rollback_checkpoints.snapshot_hash IS 'SHA-256 (hex, 64 chars) of the snapshot, computed by trigger.';
COMMENT ON COLUMN app.rollback_checkpoints.is_consumed IS 'True once the checkpoint has been used to roll back.';
COMMENT ON COLUMN app.rollback_checkpoints.created_at IS 'UTC creation timestamp.';

CREATE INDEX idx_rollback_checkpoints_packet_id ON app.rollback_checkpoints (h0_packet_id);
CREATE INDEX idx_rollback_checkpoints_tenant_id ON app.rollback_checkpoints (tenant_id);
CREATE INDEX idx_rollback_checkpoints_entity_id ON app.rollback_checkpoints (entity_id);
CREATE INDEX idx_rollback_checkpoints_consumed  ON app.rollback_checkpoints (is_consumed);

CREATE OR REPLACE FUNCTION app.rollback_checkpoints_bi()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.snapshot_hash := public.admatix_sha256_jsonb(NEW.snapshot);
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION app.rollback_checkpoints_bi() IS
  'BEFORE INSERT/UPDATE trigger on app.rollback_checkpoints: recomputes snapshot_hash from snapshot.';

CREATE TRIGGER trg_rollback_checkpoints_bi
  BEFORE INSERT OR UPDATE ON app.rollback_checkpoints
  FOR EACH ROW EXECUTE FUNCTION app.rollback_checkpoints_bi();

-- ----------------------------------------------------------------------------
-- Table: app.outcome_measurements -- the Measure-step result for an H0 packet.
-- ----------------------------------------------------------------------------
CREATE TABLE app.outcome_measurements (
  outcome_measurement_id uuid          NOT NULL DEFAULT gen_random_uuid(),
  h0_packet_id           uuid          NOT NULL,
  tenant_id              uuid          NOT NULL,
  success_metric         text          NOT NULL,
  baseline_value         numeric(18,6),
  observed_value         numeric(18,6),
  delta_pct              numeric(12,6),
  ci_low                 numeric(18,6),
  ci_high                numeric(18,6),
  passed                 boolean       NOT NULL,
  notes                  text[]        NOT NULL DEFAULT '{}',
  evidence               jsonb         NOT NULL DEFAULT '[]'::jsonb,
  measured_at            timestamptz   NOT NULL DEFAULT now(),
  created_at             timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_outcome_measurements        PRIMARY KEY (outcome_measurement_id),
  CONSTRAINT fk_outcome_measurements_packet FOREIGN KEY (h0_packet_id)
                                            REFERENCES app.h0_packets (h0_packet_id) ON DELETE CASCADE,
  CONSTRAINT fk_outcome_measurements_tenant FOREIGN KEY (tenant_id)
                                            REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT ck_outcome_measurements_ci     CHECK (ci_high IS NULL OR ci_low IS NULL OR ci_high >= ci_low)
);

COMMENT ON TABLE app.outcome_measurements IS
  'The Measure-step result for an H0 packet: baseline vs observed, delta, confidence interval, and a pass/fail verdict.';
COMMENT ON COLUMN app.outcome_measurements.outcome_measurement_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN app.outcome_measurements.h0_packet_id IS 'H0 packet measured (FK app.h0_packets).';
COMMENT ON COLUMN app.outcome_measurements.tenant_id IS 'Owning tenant (FK app.tenants).';
COMMENT ON COLUMN app.outcome_measurements.success_metric IS 'The metric measured, matching h0_packets.success_metric.';
COMMENT ON COLUMN app.outcome_measurements.baseline_value IS 'Metric value over the baseline window; null if unavailable.';
COMMENT ON COLUMN app.outcome_measurements.observed_value IS 'Metric value over the measurement window; null if unavailable.';
COMMENT ON COLUMN app.outcome_measurements.delta_pct IS 'Percentage change from baseline to observed; null if not computable.';
COMMENT ON COLUMN app.outcome_measurements.ci_low IS 'Lower bound of the confidence interval on the effect.';
COMMENT ON COLUMN app.outcome_measurements.ci_high IS 'Upper bound of the confidence interval on the effect.';
COMMENT ON COLUMN app.outcome_measurements.passed IS 'True if the measured outcome met the success criterion.';
COMMENT ON COLUMN app.outcome_measurements.notes IS 'Array of free-text caveats and observations.';
COMMENT ON COLUMN app.outcome_measurements.evidence IS 'jsonb array of EvidenceRef objects backing the measurement.';
COMMENT ON COLUMN app.outcome_measurements.measured_at IS 'UTC timestamp the measurement was taken.';
COMMENT ON COLUMN app.outcome_measurements.created_at IS 'UTC timestamp the row was written.';

CREATE INDEX idx_outcome_measurements_packet_id   ON app.outcome_measurements (h0_packet_id);
CREATE INDEX idx_outcome_measurements_tenant_id   ON app.outcome_measurements (tenant_id);
CREATE INDEX idx_outcome_measurements_passed      ON app.outcome_measurements (passed);
CREATE INDEX idx_outcome_measurements_measured_at ON app.outcome_measurements (measured_at);

-- ----------------------------------------------------------------------------
-- Table: app.agent_runs -- the replayable audit unit for a single agent run.
-- ----------------------------------------------------------------------------
CREATE TABLE app.agent_runs (
  agent_run_id     uuid                 NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid                 NOT NULL,
  h0_packet_id     uuid,
  agent_id         text                 NOT NULL,
  agent_version    text                 NOT NULL,
  workflow_id      text                 NOT NULL,
  tx_id            text                 NOT NULL,
  trace_id         text                 NOT NULL,
  step             app.workflow_step    NOT NULL,
  model            text                 NOT NULL DEFAULT 'none',
  policy_version   text                 NOT NULL,
  input_hash       char(64)             NOT NULL,
  output_hash      char(64)             NOT NULL,
  tools_allowed    text[]               NOT NULL DEFAULT '{}',
  tools_called     text[]               NOT NULL DEFAULT '{}',
  source_refs      text[]               NOT NULL DEFAULT '{}',
  risk_level       app.risk_level       NOT NULL DEFAULT 'low',
  status           app.agent_run_status NOT NULL,
  blocked_reason   text,
  duration_ms      integer,
  created_at       timestamptz          NOT NULL DEFAULT now(),

  CONSTRAINT pk_agent_runs        PRIMARY KEY (agent_run_id),
  CONSTRAINT fk_agent_runs_tenant FOREIGN KEY (tenant_id)
                                  REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_agent_runs_packet FOREIGN KEY (h0_packet_id)
                                  REFERENCES app.h0_packets (h0_packet_id) ON DELETE SET NULL,
  CONSTRAINT ck_agent_runs_input_hash_hex  CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_agent_runs_output_hash_hex CHECK (output_hash ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE app.agent_runs IS
  'Persisted state for a single agent run -- the replayable audit unit. Pins model, policy_version, tools and input/output hashes so a run can be deterministically replayed and verified.';
COMMENT ON COLUMN app.agent_runs.agent_run_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN app.agent_runs.tenant_id IS 'Owning tenant (FK app.tenants).';
COMMENT ON COLUMN app.agent_runs.h0_packet_id IS 'H0 packet the run contributed to (FK app.h0_packets). Nullable for non-packet runs.';
COMMENT ON COLUMN app.agent_runs.agent_id IS 'Identifier of the agent that executed.';
COMMENT ON COLUMN app.agent_runs.agent_version IS 'Version string of the agent implementation, pinned for reproducibility.';
COMMENT ON COLUMN app.agent_runs.workflow_id IS 'Workflow instance id linking runs across steps.';
COMMENT ON COLUMN app.agent_runs.tx_id IS 'AdMatix transaction id; preserved end-to-end.';
COMMENT ON COLUMN app.agent_runs.trace_id IS 'Distributed trace id for cross-system correlation.';
COMMENT ON COLUMN app.agent_runs.step IS 'Workflow phase: plan | activate | measure | reflect.';
COMMENT ON COLUMN app.agent_runs.model IS 'Model id used, or "none" for deterministic agents.';
COMMENT ON COLUMN app.agent_runs.policy_version IS 'Policy version in force during the run.';
COMMENT ON COLUMN app.agent_runs.input_hash IS 'SHA-256 (hex) of the canonicalised run input.';
COMMENT ON COLUMN app.agent_runs.output_hash IS 'SHA-256 (hex) of the canonicalised run output.';
COMMENT ON COLUMN app.agent_runs.tools_allowed IS 'Tools the agent was permitted to call.';
COMMENT ON COLUMN app.agent_runs.tools_called IS 'Tools the agent actually invoked.';
COMMENT ON COLUMN app.agent_runs.source_refs IS 'Evidence/source references the run consumed.';
COMMENT ON COLUMN app.agent_runs.risk_level IS 'Risk classification of the run.';
COMMENT ON COLUMN app.agent_runs.status IS 'Terminal status: completed | blocked | error.';
COMMENT ON COLUMN app.agent_runs.blocked_reason IS 'Reason the run was blocked; null unless status = blocked.';
COMMENT ON COLUMN app.agent_runs.duration_ms IS 'Wall-clock run duration in milliseconds.';
COMMENT ON COLUMN app.agent_runs.created_at IS 'UTC timestamp the run record was written.';

CREATE INDEX idx_agent_runs_tenant_id   ON app.agent_runs (tenant_id);
CREATE INDEX idx_agent_runs_packet_id   ON app.agent_runs (h0_packet_id);
CREATE INDEX idx_agent_runs_agent_id    ON app.agent_runs (agent_id);
CREATE INDEX idx_agent_runs_workflow_id ON app.agent_runs (workflow_id);
CREATE INDEX idx_agent_runs_tx_id       ON app.agent_runs (tx_id);
CREATE INDEX idx_agent_runs_trace_id    ON app.agent_runs (trace_id);
CREATE INDEX idx_agent_runs_step        ON app.agent_runs (step);
CREATE INDEX idx_agent_runs_status      ON app.agent_runs (status);
CREATE INDEX idx_agent_runs_created_at  ON app.agent_runs (created_at);

-- ----------------------------------------------------------------------------
-- Table: app.trust_scores -- current trust for an agent / skill / connector.
-- ----------------------------------------------------------------------------
CREATE TABLE app.trust_scores (
  trust_score_id    uuid                  NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid                  NOT NULL,
  subject_type      app.trust_subject_type NOT NULL,
  subject_id        text                  NOT NULL,
  score             numeric(5,4)          NOT NULL DEFAULT 0.5000,
  validated_count   integer               NOT NULL DEFAULT 0,
  invalidated_count integer               NOT NULL DEFAULT 0,
  updated_at        timestamptz           NOT NULL DEFAULT now(),
  created_at        timestamptz           NOT NULL DEFAULT now(),

  CONSTRAINT pk_trust_scores         PRIMARY KEY (trust_score_id),
  CONSTRAINT fk_trust_scores_tenant  FOREIGN KEY (tenant_id)
                                     REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT uq_trust_scores_subject UNIQUE (tenant_id, subject_type, subject_id),
  CONSTRAINT ck_trust_scores_score   CHECK (score >= 0 AND score <= 1),
  CONSTRAINT ck_trust_scores_counts  CHECK (validated_count >= 0 AND invalidated_count >= 0)
);

COMMENT ON TABLE app.trust_scores IS
  'Current trust score for an agent, skill, or connector. Trust rises with validated outcomes and decays with invalidated ones. One row per (tenant, subject_type, subject_id).';
COMMENT ON COLUMN app.trust_scores.trust_score_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN app.trust_scores.tenant_id IS 'Owning tenant (FK app.tenants).';
COMMENT ON COLUMN app.trust_scores.subject_type IS 'Kind of subject: agent | skill | connector.';
COMMENT ON COLUMN app.trust_scores.subject_id IS 'Identifier of the trusted subject.';
COMMENT ON COLUMN app.trust_scores.score IS 'Current trust score in [0,1]; defaults to 0.5 (neutral).';
COMMENT ON COLUMN app.trust_scores.validated_count IS 'Number of outcomes that validated the subject.';
COMMENT ON COLUMN app.trust_scores.invalidated_count IS 'Number of outcomes that invalidated the subject.';
COMMENT ON COLUMN app.trust_scores.updated_at IS 'UTC timestamp the score was last recomputed.';
COMMENT ON COLUMN app.trust_scores.created_at IS 'UTC timestamp the score row was first created.';

CREATE INDEX idx_trust_scores_tenant_id    ON app.trust_scores (tenant_id);
CREATE INDEX idx_trust_scores_subject_type ON app.trust_scores (subject_type);
CREATE INDEX idx_trust_scores_subject_id   ON app.trust_scores (subject_id);
CREATE INDEX idx_trust_scores_score        ON app.trust_scores (score);

-- ----------------------------------------------------------------------------
-- Table: app.trust_score_history -- append-style log of every score change.
-- ----------------------------------------------------------------------------
CREATE TABLE app.trust_score_history (
  trust_score_history_id bigint        GENERATED ALWAYS AS IDENTITY,
  trust_score_id         uuid          NOT NULL,
  tenant_id              uuid          NOT NULL,
  subject_type           app.trust_subject_type NOT NULL,
  subject_id             text          NOT NULL,
  previous_score         numeric(5,4),
  new_score              numeric(5,4)  NOT NULL,
  delta                  numeric(6,4)  NOT NULL,
  reason                 text          NOT NULL,
  related_h0_packet_id   uuid,
  recorded_at            timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_trust_score_history        PRIMARY KEY (trust_score_history_id),
  CONSTRAINT fk_trust_score_history_score  FOREIGN KEY (trust_score_id)
                                           REFERENCES app.trust_scores (trust_score_id) ON DELETE CASCADE,
  CONSTRAINT fk_trust_score_history_tenant FOREIGN KEY (tenant_id)
                                           REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_trust_score_history_packet FOREIGN KEY (related_h0_packet_id)
                                           REFERENCES app.h0_packets (h0_packet_id) ON DELETE SET NULL,
  CONSTRAINT ck_trust_score_history_score  CHECK (new_score >= 0 AND new_score <= 1)
);

COMMENT ON TABLE app.trust_score_history IS
  'Append-style history of every trust score change, giving an auditable trail of how trust accrued or decayed over time.';
COMMENT ON COLUMN app.trust_score_history.trust_score_history_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN app.trust_score_history.trust_score_id IS 'The trust score row that changed (FK app.trust_scores).';
COMMENT ON COLUMN app.trust_score_history.tenant_id IS 'Owning tenant (FK app.tenants), denormalised for filtering.';
COMMENT ON COLUMN app.trust_score_history.subject_type IS 'Kind of subject: agent | skill | connector (denormalised).';
COMMENT ON COLUMN app.trust_score_history.subject_id IS 'Identifier of the trusted subject (denormalised).';
COMMENT ON COLUMN app.trust_score_history.previous_score IS 'Score before this change; null for the first record.';
COMMENT ON COLUMN app.trust_score_history.new_score IS 'Score after this change.';
COMMENT ON COLUMN app.trust_score_history.delta IS 'new_score - previous_score (the signed change).';
COMMENT ON COLUMN app.trust_score_history.reason IS 'Why the score changed (e.g. "measurement_passed", "policy_violation").';
COMMENT ON COLUMN app.trust_score_history.related_h0_packet_id IS 'H0 packet that triggered the change, if any (FK app.h0_packets).';
COMMENT ON COLUMN app.trust_score_history.recorded_at IS 'UTC timestamp the change was recorded.';

CREATE INDEX idx_trust_score_history_score_id    ON app.trust_score_history (trust_score_id);
CREATE INDEX idx_trust_score_history_tenant_id   ON app.trust_score_history (tenant_id);
CREATE INDEX idx_trust_score_history_subject_id  ON app.trust_score_history (subject_id);
CREATE INDEX idx_trust_score_history_packet_id   ON app.trust_score_history (related_h0_packet_id);
CREATE INDEX idx_trust_score_history_recorded_at ON app.trust_score_history (recorded_at);

-- ----------------------------------------------------------------------------
-- Privileges for the app schema.
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA app TO admatix_app, admatix_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO admatix_app;
GRANT SELECT ON ALL TABLES IN SCHEMA app TO admatix_readonly;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO admatix_app;
```


---

## Part 3 — `warehouse` Schema: Bronze + Silver

The `warehouse` schema is a medallion architecture. Bronze tables are raw dataset
landing zones (lossless, minimally typed). Silver tables are cleaned and
conformed. Gold (Parts 4 and 5) is a star schema. The bronze/silver/gold
transforms are owned by dbt; the DDL below defines the physical landing and
conformed tables that dbt models materialise into and read from.

```sql
-- ============================================================================
-- AdMatix Data Layer -- Part 3: warehouse schema, bronze + silver
-- Medallion architecture. Bronze = raw landing. Silver = cleaned + conformed.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS warehouse;

COMMENT ON SCHEMA warehouse IS
  'Medallion data warehouse: bronze raw landing tables, silver cleaned/conformed tables, and a gold star schema (dimensions + facts). Bronze/silver/gold transforms are managed by dbt.';

-- ----------------------------------------------------------------------------
-- BRONZE -- raw dataset landing tables.
-- Each bronze table preserves source rows losslessly. Typed columns capture the
-- known schema; raw jsonb captures the complete original row. Every bronze table
-- carries the four ingest-metadata columns: _loaded_at, _source, _batch_id,
-- _row_hash. Natural keys are deliberately NOT enforced as PKs at bronze; the
-- surrogate identity column is the only PK so duplicate raw rows can land and be
-- deduplicated downstream by dbt.
-- ----------------------------------------------------------------------------

-- bronze.bronze_criteo_uplift -- Criteo Uplift Modeling dataset (treatment +
-- 12 anonymised features, visit/conversion labels).
CREATE TABLE warehouse.bronze_criteo_uplift (
  bronze_id    bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  f0  double precision, f1  double precision, f2  double precision,
  f3  double precision, f4  double precision, f5  double precision,
  f6  double precision, f7  double precision, f8  double precision,
  f9  double precision, f10 double precision, f11 double precision,
  treatment    smallint,
  conversion   smallint,
  visit        smallint,
  exposure     smallint,
  raw          jsonb        NOT NULL DEFAULT '{}'::jsonb,
  _loaded_at   timestamptz  NOT NULL DEFAULT now(),
  _source      text         NOT NULL,
  _batch_id    text         NOT NULL,
  _row_hash    char(64)     NOT NULL
);
COMMENT ON TABLE warehouse.bronze_criteo_uplift IS
  'Raw landing for the Criteo Uplift Modeling dataset: 12 anonymised numeric features, a randomised treatment flag, and visit/conversion/exposure labels. Used for uplift/incrementality model training and verification.';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift.bronze_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift.f0 IS 'Anonymised numeric feature 0 from the source dataset.';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift.f1 IS 'Anonymised numeric feature 1 from the source dataset.';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift.f2 IS 'Anonymised numeric feature 2 from the source dataset.';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift.f3 IS 'Anonymised numeric feature 3 from the source dataset.';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift.f4 IS 'Anonymised numeric feature 4 from the source dataset.';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift.f5 IS 'Anonymised numeric feature 5 from the source dataset.';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift.f6 IS 'Anonymised numeric feature 6 from the source dataset.';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift.f7 IS 'Anonymised numeric feature 7 from the source dataset.';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift.f8 IS 'Anonymised numeric feature 8 from the source dataset.';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift.f9 IS 'Anonymised numeric feature 9 from the source dataset.';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift.f10 IS 'Anonymised numeric feature 10 from the source dataset.';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift.f11 IS 'Anonymised numeric feature 11 from the source dataset.';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift.treatment IS 'Randomised treatment flag (1 = treated, 0 = control).';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift.conversion IS 'Conversion label (1 = converted).';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift.visit IS 'Visit label (1 = visited).';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift.exposure IS 'Exposure label (1 = ad was actually shown).';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift.raw IS 'Complete original source row as jsonb (lossless capture).';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift._loaded_at IS 'UTC timestamp the row was loaded into bronze.';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift._source IS 'Logical source identifier (e.g. "criteo_uplift_v2.1").';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift._batch_id IS 'Ingest batch identifier grouping rows loaded together.';
COMMENT ON COLUMN warehouse.bronze_criteo_uplift._row_hash IS 'SHA-256 (hex) of the source row, used for idempotent dedup.';
CREATE INDEX idx_bronze_criteo_uplift_batch ON warehouse.bronze_criteo_uplift (_batch_id);
CREATE INDEX idx_bronze_criteo_uplift_hash  ON warehouse.bronze_criteo_uplift (_row_hash);

-- bronze.bronze_hillstrom -- Hillstrom MineThatData email challenge dataset.
CREATE TABLE warehouse.bronze_hillstrom (
  bronze_id        bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recency          integer,
  history_segment  text,
  history          double precision,
  mens             smallint,
  womens           smallint,
  zip_code         text,
  newbie           smallint,
  channel          text,
  segment          text,
  visit            smallint,
  conversion       smallint,
  spend            double precision,
  raw              jsonb        NOT NULL DEFAULT '{}'::jsonb,
  _loaded_at       timestamptz  NOT NULL DEFAULT now(),
  _source          text         NOT NULL,
  _batch_id        text         NOT NULL,
  _row_hash        char(64)     NOT NULL
);
COMMENT ON TABLE warehouse.bronze_hillstrom IS
  'Raw landing for the Hillstrom MineThatData email marketing dataset: customer attributes, a 3-arm treatment (mens email / womens email / no email), and visit/conversion/spend outcomes. Used for uplift verification.';
COMMENT ON COLUMN warehouse.bronze_hillstrom.bronze_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN warehouse.bronze_hillstrom.recency IS 'Months since last purchase.';
COMMENT ON COLUMN warehouse.bronze_hillstrom.history_segment IS 'Categorical bucket of prior spend.';
COMMENT ON COLUMN warehouse.bronze_hillstrom.history IS 'Actual dollar value of prior purchases.';
COMMENT ON COLUMN warehouse.bronze_hillstrom.mens IS '1 if the customer purchased mens merchandise in the prior year.';
COMMENT ON COLUMN warehouse.bronze_hillstrom.womens IS '1 if the customer purchased womens merchandise in the prior year.';
COMMENT ON COLUMN warehouse.bronze_hillstrom.zip_code IS 'Zip-code class (urban/suburban/rural).';
COMMENT ON COLUMN warehouse.bronze_hillstrom.newbie IS '1 if the customer is new in the prior 12 months.';
COMMENT ON COLUMN warehouse.bronze_hillstrom.channel IS 'Channels the customer purchased from.';
COMMENT ON COLUMN warehouse.bronze_hillstrom.segment IS 'Treatment arm: "Mens E-Mail", "Womens E-Mail", or "No E-Mail".';
COMMENT ON COLUMN warehouse.bronze_hillstrom.visit IS '1 if the customer visited the site in the following two weeks.';
COMMENT ON COLUMN warehouse.bronze_hillstrom.conversion IS '1 if the customer purchased in the following two weeks.';
COMMENT ON COLUMN warehouse.bronze_hillstrom.spend IS 'Dollars spent in the following two weeks.';
COMMENT ON COLUMN warehouse.bronze_hillstrom.raw IS 'Complete original source row as jsonb (lossless capture).';
COMMENT ON COLUMN warehouse.bronze_hillstrom._loaded_at IS 'UTC timestamp the row was loaded into bronze.';
COMMENT ON COLUMN warehouse.bronze_hillstrom._source IS 'Logical source identifier.';
COMMENT ON COLUMN warehouse.bronze_hillstrom._batch_id IS 'Ingest batch identifier.';
COMMENT ON COLUMN warehouse.bronze_hillstrom._row_hash IS 'SHA-256 (hex) of the source row, used for idempotent dedup.';
CREATE INDEX idx_bronze_hillstrom_batch ON warehouse.bronze_hillstrom (_batch_id);
CREATE INDEX idx_bronze_hillstrom_hash  ON warehouse.bronze_hillstrom (_row_hash);

-- bronze.bronze_avazu -- Avazu CTR prediction dataset (mobile ad click logs).
CREATE TABLE warehouse.bronze_avazu (
  bronze_id        bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ad_id            text,
  click            smallint,
  hour_raw         text,
  c1               text,
  banner_pos       text,
  site_id          text,
  site_domain      text,
  site_category    text,
  app_id           text,
  app_domain       text,
  app_category     text,
  device_id        text,
  device_ip        text,
  device_model     text,
  device_type      text,
  device_conn_type text,
  raw              jsonb        NOT NULL DEFAULT '{}'::jsonb,
  _loaded_at       timestamptz  NOT NULL DEFAULT now(),
  _source          text         NOT NULL,
  _batch_id        text         NOT NULL,
  _row_hash        char(64)     NOT NULL
);
COMMENT ON TABLE warehouse.bronze_avazu IS
  'Raw landing for the Avazu mobile ad click-through-rate dataset: high-cardinality categorical impression logs with a binary click label. Used for CTR-model training and as realistic event volume for the simulator.';
COMMENT ON COLUMN warehouse.bronze_avazu.bronze_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN warehouse.bronze_avazu.ad_id IS 'Source ad/impression identifier.';
COMMENT ON COLUMN warehouse.bronze_avazu.click IS 'Click label (1 = clicked, 0 = not clicked).';
COMMENT ON COLUMN warehouse.bronze_avazu.hour_raw IS 'Raw YYMMDDHH timestamp string from the source.';
COMMENT ON COLUMN warehouse.bronze_avazu.c1 IS 'Anonymised categorical field C1.';
COMMENT ON COLUMN warehouse.bronze_avazu.banner_pos IS 'Banner position on the page.';
COMMENT ON COLUMN warehouse.bronze_avazu.site_id IS 'Anonymised site identifier.';
COMMENT ON COLUMN warehouse.bronze_avazu.site_domain IS 'Anonymised site domain.';
COMMENT ON COLUMN warehouse.bronze_avazu.site_category IS 'Anonymised site category.';
COMMENT ON COLUMN warehouse.bronze_avazu.app_id IS 'Anonymised app identifier.';
COMMENT ON COLUMN warehouse.bronze_avazu.app_domain IS 'Anonymised app domain.';
COMMENT ON COLUMN warehouse.bronze_avazu.app_category IS 'Anonymised app category.';
COMMENT ON COLUMN warehouse.bronze_avazu.device_id IS 'Anonymised device identifier.';
COMMENT ON COLUMN warehouse.bronze_avazu.device_ip IS 'Anonymised device IP.';
COMMENT ON COLUMN warehouse.bronze_avazu.device_model IS 'Anonymised device model.';
COMMENT ON COLUMN warehouse.bronze_avazu.device_type IS 'Device type code.';
COMMENT ON COLUMN warehouse.bronze_avazu.device_conn_type IS 'Device connection type code.';
COMMENT ON COLUMN warehouse.bronze_avazu.raw IS 'Complete original source row as jsonb (lossless capture).';
COMMENT ON COLUMN warehouse.bronze_avazu._loaded_at IS 'UTC timestamp the row was loaded into bronze.';
COMMENT ON COLUMN warehouse.bronze_avazu._source IS 'Logical source identifier.';
COMMENT ON COLUMN warehouse.bronze_avazu._batch_id IS 'Ingest batch identifier.';
COMMENT ON COLUMN warehouse.bronze_avazu._row_hash IS 'SHA-256 (hex) of the source row, used for idempotent dedup.';
CREATE INDEX idx_bronze_avazu_batch ON warehouse.bronze_avazu (_batch_id);
CREATE INDEX idx_bronze_avazu_hash  ON warehouse.bronze_avazu (_row_hash);

-- bronze.bronze_ipinyou -- iPinYou real-time-bidding dataset (bid/impression logs).
CREATE TABLE warehouse.bronze_ipinyou (
  bronze_id        bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bid_id           text,
  log_type         text,
  timestamp_raw    text,
  ipinyou_id       text,
  user_agent       text,
  ip               text,
  region           text,
  city             text,
  ad_exchange      text,
  domain           text,
  url              text,
  ad_slot_id       text,
  ad_slot_width    integer,
  ad_slot_height   integer,
  ad_slot_floor    double precision,
  bidding_price    double precision,
  paying_price     double precision,
  creative_id      text,
  advertiser_id    text,
  is_click         smallint,
  is_conversion    smallint,
  raw              jsonb        NOT NULL DEFAULT '{}'::jsonb,
  _loaded_at       timestamptz  NOT NULL DEFAULT now(),
  _source          text         NOT NULL,
  _batch_id        text         NOT NULL,
  _row_hash        char(64)     NOT NULL
);
COMMENT ON TABLE warehouse.bronze_ipinyou IS
  'Raw landing for the iPinYou real-time-bidding dataset: bid, impression, click and conversion logs with auction prices. Used to calibrate the auction model in the simulator and to verify bid-adjust actions.';
COMMENT ON COLUMN warehouse.bronze_ipinyou.bronze_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN warehouse.bronze_ipinyou.bid_id IS 'Source bid identifier.';
COMMENT ON COLUMN warehouse.bronze_ipinyou.log_type IS 'Log record type (bid / impression / click / conversion).';
COMMENT ON COLUMN warehouse.bronze_ipinyou.timestamp_raw IS 'Raw timestamp string from the source.';
COMMENT ON COLUMN warehouse.bronze_ipinyou.ipinyou_id IS 'Anonymised iPinYou user identifier.';
COMMENT ON COLUMN warehouse.bronze_ipinyou.user_agent IS 'Browser user-agent string.';
COMMENT ON COLUMN warehouse.bronze_ipinyou.ip IS 'Anonymised IP address.';
COMMENT ON COLUMN warehouse.bronze_ipinyou.region IS 'Region code.';
COMMENT ON COLUMN warehouse.bronze_ipinyou.city IS 'City code.';
COMMENT ON COLUMN warehouse.bronze_ipinyou.ad_exchange IS 'Ad exchange identifier.';
COMMENT ON COLUMN warehouse.bronze_ipinyou.domain IS 'Anonymised publisher domain.';
COMMENT ON COLUMN warehouse.bronze_ipinyou.url IS 'Anonymised page URL.';
COMMENT ON COLUMN warehouse.bronze_ipinyou.ad_slot_id IS 'Ad slot identifier.';
COMMENT ON COLUMN warehouse.bronze_ipinyou.ad_slot_width IS 'Ad slot width in pixels.';
COMMENT ON COLUMN warehouse.bronze_ipinyou.ad_slot_height IS 'Ad slot height in pixels.';
COMMENT ON COLUMN warehouse.bronze_ipinyou.ad_slot_floor IS 'Ad slot floor (reserve) price.';
COMMENT ON COLUMN warehouse.bronze_ipinyou.bidding_price IS 'Price the DSP bid in the auction.';
COMMENT ON COLUMN warehouse.bronze_ipinyou.paying_price IS 'Winning/clearing price actually paid.';
COMMENT ON COLUMN warehouse.bronze_ipinyou.creative_id IS 'Creative identifier shown.';
COMMENT ON COLUMN warehouse.bronze_ipinyou.advertiser_id IS 'Advertiser identifier.';
COMMENT ON COLUMN warehouse.bronze_ipinyou.is_click IS 'Click label (1 = clicked).';
COMMENT ON COLUMN warehouse.bronze_ipinyou.is_conversion IS 'Conversion label (1 = converted).';
COMMENT ON COLUMN warehouse.bronze_ipinyou.raw IS 'Complete original source row as jsonb (lossless capture).';
COMMENT ON COLUMN warehouse.bronze_ipinyou._loaded_at IS 'UTC timestamp the row was loaded into bronze.';
COMMENT ON COLUMN warehouse.bronze_ipinyou._source IS 'Logical source identifier.';
COMMENT ON COLUMN warehouse.bronze_ipinyou._batch_id IS 'Ingest batch identifier.';
COMMENT ON COLUMN warehouse.bronze_ipinyou._row_hash IS 'SHA-256 (hex) of the source row, used for idempotent dedup.';
CREATE INDEX idx_bronze_ipinyou_batch ON warehouse.bronze_ipinyou (_batch_id);
CREATE INDEX idx_bronze_ipinyou_hash  ON warehouse.bronze_ipinyou (_row_hash);

-- bronze.bronze_sim_events -- raw event stream emitted by the AdMatix simulator.
CREATE TABLE warehouse.bronze_sim_events (
  bronze_id      bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scenario_id    text,
  sim_campaign_id text,
  event_type     text,
  event_ts       timestamptz,
  user_key       text,
  treatment_arm  text,
  spend          double precision,
  revenue        double precision,
  raw            jsonb        NOT NULL DEFAULT '{}'::jsonb,
  _loaded_at     timestamptz  NOT NULL DEFAULT now(),
  _source        text         NOT NULL,
  _batch_id      text         NOT NULL,
  _row_hash      char(64)     NOT NULL
);
COMMENT ON TABLE warehouse.bronze_sim_events IS
  'Raw landing for the event stream produced by the AdMatix simulator (sim schema). Mirrors sim.events for warehouse-side analytics. The simulator is the only source where ground-truth incremental lift is known.';
COMMENT ON COLUMN warehouse.bronze_sim_events.bronze_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN warehouse.bronze_sim_events.scenario_id IS 'Simulation scenario the event belongs to.';
COMMENT ON COLUMN warehouse.bronze_sim_events.sim_campaign_id IS 'Simulated campaign the event belongs to.';
COMMENT ON COLUMN warehouse.bronze_sim_events.event_type IS 'Event type (impression / click / conversion / spend).';
COMMENT ON COLUMN warehouse.bronze_sim_events.event_ts IS 'UTC timestamp of the simulated event.';
COMMENT ON COLUMN warehouse.bronze_sim_events.user_key IS 'Synthetic user key for the simulated user.';
COMMENT ON COLUMN warehouse.bronze_sim_events.treatment_arm IS 'Treatment arm assigned to the user (treatment / control).';
COMMENT ON COLUMN warehouse.bronze_sim_events.spend IS 'Spend attributed to the event.';
COMMENT ON COLUMN warehouse.bronze_sim_events.revenue IS 'Revenue attributed to the event.';
COMMENT ON COLUMN warehouse.bronze_sim_events.raw IS 'Complete original simulator event as jsonb.';
COMMENT ON COLUMN warehouse.bronze_sim_events._loaded_at IS 'UTC timestamp the row was loaded into bronze.';
COMMENT ON COLUMN warehouse.bronze_sim_events._source IS 'Logical source identifier (simulator run id).';
COMMENT ON COLUMN warehouse.bronze_sim_events._batch_id IS 'Ingest batch identifier.';
COMMENT ON COLUMN warehouse.bronze_sim_events._row_hash IS 'SHA-256 (hex) of the source row, used for idempotent dedup.';
CREATE INDEX idx_bronze_sim_events_batch    ON warehouse.bronze_sim_events (_batch_id);
CREATE INDEX idx_bronze_sim_events_hash     ON warehouse.bronze_sim_events (_row_hash);
CREATE INDEX idx_bronze_sim_events_scenario ON warehouse.bronze_sim_events (scenario_id);
CREATE INDEX idx_bronze_sim_events_ts       ON warehouse.bronze_sim_events (event_ts);

-- bronze.bronze_platform_metrics -- raw daily metrics pulled from ad platforms.
CREATE TABLE warehouse.bronze_platform_metrics (
  bronze_id        bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform         text,
  external_account_id text,
  campaign_external_id text,
  metric_date      date,
  spend            double precision,
  impressions      bigint,
  clicks           bigint,
  conversions      double precision,
  platform_revenue double precision,
  currency         text,
  raw              jsonb        NOT NULL DEFAULT '{}'::jsonb,
  _loaded_at       timestamptz  NOT NULL DEFAULT now(),
  _source          text         NOT NULL,
  _batch_id        text         NOT NULL,
  _row_hash        char(64)     NOT NULL
);
COMMENT ON TABLE warehouse.bronze_platform_metrics IS
  'Raw landing for daily campaign performance metrics pulled from ad platform APIs/connectors. platform_revenue is platform-attributed and directional, never causal.';
COMMENT ON COLUMN warehouse.bronze_platform_metrics.bronze_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN warehouse.bronze_platform_metrics.platform IS 'Source platform identifier.';
COMMENT ON COLUMN warehouse.bronze_platform_metrics.external_account_id IS 'Platform-native account id.';
COMMENT ON COLUMN warehouse.bronze_platform_metrics.campaign_external_id IS 'Platform-native campaign id.';
COMMENT ON COLUMN warehouse.bronze_platform_metrics.metric_date IS 'The day the metrics cover (account timezone).';
COMMENT ON COLUMN warehouse.bronze_platform_metrics.spend IS 'Spend reported by the platform.';
COMMENT ON COLUMN warehouse.bronze_platform_metrics.impressions IS 'Impressions reported by the platform.';
COMMENT ON COLUMN warehouse.bronze_platform_metrics.clicks IS 'Clicks reported by the platform.';
COMMENT ON COLUMN warehouse.bronze_platform_metrics.conversions IS 'Conversions reported by the platform.';
COMMENT ON COLUMN warehouse.bronze_platform_metrics.platform_revenue IS 'Platform-attributed revenue. Directional, NOT causal.';
COMMENT ON COLUMN warehouse.bronze_platform_metrics.currency IS 'ISO-4217 currency of the monetary fields.';
COMMENT ON COLUMN warehouse.bronze_platform_metrics.raw IS 'Complete original source row as jsonb (lossless capture).';
COMMENT ON COLUMN warehouse.bronze_platform_metrics._loaded_at IS 'UTC timestamp the row was loaded into bronze.';
COMMENT ON COLUMN warehouse.bronze_platform_metrics._source IS 'Logical source identifier.';
COMMENT ON COLUMN warehouse.bronze_platform_metrics._batch_id IS 'Ingest batch identifier.';
COMMENT ON COLUMN warehouse.bronze_platform_metrics._row_hash IS 'SHA-256 (hex) of the source row, used for idempotent dedup.';
CREATE INDEX idx_bronze_platform_metrics_batch    ON warehouse.bronze_platform_metrics (_batch_id);
CREATE INDEX idx_bronze_platform_metrics_hash     ON warehouse.bronze_platform_metrics (_row_hash);
CREATE INDEX idx_bronze_platform_metrics_account  ON warehouse.bronze_platform_metrics (external_account_id);
CREATE INDEX idx_bronze_platform_metrics_date     ON warehouse.bronze_platform_metrics (metric_date);

-- bronze.bronze_first_party_orders -- raw first-party orders (the MER truth source).
CREATE TABLE warehouse.bronze_first_party_orders (
  bronze_id        bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_account_id text,
  order_external_id text,
  order_ts         timestamptz,
  customer_key     text,
  revenue          double precision,
  gross_margin     double precision,
  currency         text,
  channel          text,
  is_new_customer  smallint,
  raw              jsonb        NOT NULL DEFAULT '{}'::jsonb,
  _loaded_at       timestamptz  NOT NULL DEFAULT now(),
  _source          text         NOT NULL,
  _batch_id        text         NOT NULL,
  _row_hash        char(64)     NOT NULL
);
COMMENT ON TABLE warehouse.bronze_first_party_orders IS
  'Raw landing for first-party order data (Shopify, internal OMS, etc.). This is the truth source for MER and margin -- the only revenue AdMatix treats as real.';
COMMENT ON COLUMN warehouse.bronze_first_party_orders.bronze_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN warehouse.bronze_first_party_orders.external_account_id IS 'Account/store identifier the order belongs to.';
COMMENT ON COLUMN warehouse.bronze_first_party_orders.order_external_id IS 'Source-native order identifier.';
COMMENT ON COLUMN warehouse.bronze_first_party_orders.order_ts IS 'UTC timestamp the order was placed.';
COMMENT ON COLUMN warehouse.bronze_first_party_orders.customer_key IS 'Customer identifier (hashed where required for privacy).';
COMMENT ON COLUMN warehouse.bronze_first_party_orders.revenue IS 'Order revenue (net of refunds where the source provides it).';
COMMENT ON COLUMN warehouse.bronze_first_party_orders.gross_margin IS 'Gross margin on the order, if the source provides it.';
COMMENT ON COLUMN warehouse.bronze_first_party_orders.currency IS 'ISO-4217 currency of the monetary fields.';
COMMENT ON COLUMN warehouse.bronze_first_party_orders.channel IS 'Order channel (web / app / retail).';
COMMENT ON COLUMN warehouse.bronze_first_party_orders.is_new_customer IS '1 if the order is the customer first purchase.';
COMMENT ON COLUMN warehouse.bronze_first_party_orders.raw IS 'Complete original source row as jsonb (lossless capture).';
COMMENT ON COLUMN warehouse.bronze_first_party_orders._loaded_at IS 'UTC timestamp the row was loaded into bronze.';
COMMENT ON COLUMN warehouse.bronze_first_party_orders._source IS 'Logical source identifier.';
COMMENT ON COLUMN warehouse.bronze_first_party_orders._batch_id IS 'Ingest batch identifier.';
COMMENT ON COLUMN warehouse.bronze_first_party_orders._row_hash IS 'SHA-256 (hex) of the source row, used for idempotent dedup.';
CREATE INDEX idx_bronze_fp_orders_batch   ON warehouse.bronze_first_party_orders (_batch_id);
CREATE INDEX idx_bronze_fp_orders_hash    ON warehouse.bronze_first_party_orders (_row_hash);
CREATE INDEX idx_bronze_fp_orders_account ON warehouse.bronze_first_party_orders (external_account_id);
CREATE INDEX idx_bronze_fp_orders_ts      ON warehouse.bronze_first_party_orders (order_ts);

-- ----------------------------------------------------------------------------
-- SILVER -- cleaned, conformed, deduplicated tables.
-- Silver tables apply types, conform identifiers, and dedup on natural keys.
-- They are the inputs to the gold star schema. dbt owns the bronze->silver SQL.
-- ----------------------------------------------------------------------------

-- silver.silver_campaign_daily -- conformed daily campaign performance.
CREATE TABLE warehouse.silver_campaign_daily (
  silver_campaign_daily_id bigint    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  metric_date      date          NOT NULL,
  platform         app.ad_platform NOT NULL,
  account_key      text          NOT NULL,
  campaign_key     text          NOT NULL,
  spend            numeric(18,4) NOT NULL DEFAULT 0,
  impressions      bigint        NOT NULL DEFAULT 0,
  clicks           bigint        NOT NULL DEFAULT 0,
  conversions      numeric(18,4) NOT NULL DEFAULT 0,
  platform_revenue numeric(18,4) NOT NULL DEFAULT 0,
  currency         char(3)       NOT NULL DEFAULT 'USD',
  _source          text          NOT NULL,
  _batch_id        text          NOT NULL,
  _loaded_at       timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT uq_silver_campaign_daily UNIQUE (metric_date, platform, account_key, campaign_key)
);
COMMENT ON TABLE warehouse.silver_campaign_daily IS
  'Conformed daily campaign performance, deduplicated on (date, platform, account, campaign). Built by dbt from bronze_platform_metrics. platform_revenue remains directional.';
COMMENT ON COLUMN warehouse.silver_campaign_daily.silver_campaign_daily_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN warehouse.silver_campaign_daily.metric_date IS 'The day the metrics cover.';
COMMENT ON COLUMN warehouse.silver_campaign_daily.platform IS 'Source platform (conformed enum).';
COMMENT ON COLUMN warehouse.silver_campaign_daily.account_key IS 'Conformed business key for the ad account.';
COMMENT ON COLUMN warehouse.silver_campaign_daily.campaign_key IS 'Conformed business key for the campaign.';
COMMENT ON COLUMN warehouse.silver_campaign_daily.spend IS 'Daily spend in account currency.';
COMMENT ON COLUMN warehouse.silver_campaign_daily.impressions IS 'Daily impressions.';
COMMENT ON COLUMN warehouse.silver_campaign_daily.clicks IS 'Daily clicks.';
COMMENT ON COLUMN warehouse.silver_campaign_daily.conversions IS 'Daily platform-reported conversions.';
COMMENT ON COLUMN warehouse.silver_campaign_daily.platform_revenue IS 'Platform-attributed revenue. Directional, NOT causal.';
COMMENT ON COLUMN warehouse.silver_campaign_daily.currency IS 'ISO-4217 currency of the monetary fields.';
COMMENT ON COLUMN warehouse.silver_campaign_daily._source IS 'Logical source identifier carried from bronze.';
COMMENT ON COLUMN warehouse.silver_campaign_daily._batch_id IS 'Ingest batch identifier carried from bronze.';
COMMENT ON COLUMN warehouse.silver_campaign_daily._loaded_at IS 'UTC timestamp the silver row was materialised.';
CREATE INDEX idx_silver_campaign_daily_date     ON warehouse.silver_campaign_daily (metric_date);
CREATE INDEX idx_silver_campaign_daily_platform ON warehouse.silver_campaign_daily (platform);
CREATE INDEX idx_silver_campaign_daily_account  ON warehouse.silver_campaign_daily (account_key);
CREATE INDEX idx_silver_campaign_daily_campaign ON warehouse.silver_campaign_daily (campaign_key);

-- silver.silver_creative_daily -- conformed daily creative performance.
CREATE TABLE warehouse.silver_creative_daily (
  silver_creative_daily_id bigint   GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  metric_date    date          NOT NULL,
  platform       app.ad_platform NOT NULL,
  account_key    text          NOT NULL,
  campaign_key   text          NOT NULL,
  creative_key   text          NOT NULL,
  spend          numeric(18,4) NOT NULL DEFAULT 0,
  impressions    bigint        NOT NULL DEFAULT 0,
  clicks         bigint        NOT NULL DEFAULT 0,
  conversions    numeric(18,4) NOT NULL DEFAULT 0,
  frequency      numeric(12,4),
  _source        text          NOT NULL,
  _batch_id      text          NOT NULL,
  _loaded_at     timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT uq_silver_creative_daily UNIQUE (metric_date, platform, account_key, campaign_key, creative_key)
);
COMMENT ON TABLE warehouse.silver_creative_daily IS
  'Conformed daily creative-level performance, deduplicated on (date, platform, account, campaign, creative). Built by dbt from bronze platform exports.';
COMMENT ON COLUMN warehouse.silver_creative_daily.silver_creative_daily_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN warehouse.silver_creative_daily.metric_date IS 'The day the metrics cover.';
COMMENT ON COLUMN warehouse.silver_creative_daily.platform IS 'Source platform (conformed enum).';
COMMENT ON COLUMN warehouse.silver_creative_daily.account_key IS 'Conformed business key for the ad account.';
COMMENT ON COLUMN warehouse.silver_creative_daily.campaign_key IS 'Conformed business key for the campaign.';
COMMENT ON COLUMN warehouse.silver_creative_daily.creative_key IS 'Conformed business key for the creative.';
COMMENT ON COLUMN warehouse.silver_creative_daily.spend IS 'Daily spend in account currency.';
COMMENT ON COLUMN warehouse.silver_creative_daily.impressions IS 'Daily impressions.';
COMMENT ON COLUMN warehouse.silver_creative_daily.clicks IS 'Daily clicks.';
COMMENT ON COLUMN warehouse.silver_creative_daily.conversions IS 'Daily platform-reported conversions.';
COMMENT ON COLUMN warehouse.silver_creative_daily.frequency IS 'Average impressions per unique user, if available.';
COMMENT ON COLUMN warehouse.silver_creative_daily._source IS 'Logical source identifier carried from bronze.';
COMMENT ON COLUMN warehouse.silver_creative_daily._batch_id IS 'Ingest batch identifier carried from bronze.';
COMMENT ON COLUMN warehouse.silver_creative_daily._loaded_at IS 'UTC timestamp the silver row was materialised.';
CREATE INDEX idx_silver_creative_daily_date     ON warehouse.silver_creative_daily (metric_date);
CREATE INDEX idx_silver_creative_daily_account  ON warehouse.silver_creative_daily (account_key);
CREATE INDEX idx_silver_creative_daily_campaign ON warehouse.silver_creative_daily (campaign_key);
CREATE INDEX idx_silver_creative_daily_creative ON warehouse.silver_creative_daily (creative_key);

-- silver.silver_first_party_daily -- conformed daily first-party revenue.
CREATE TABLE warehouse.silver_first_party_daily (
  silver_first_party_daily_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  metric_date    date          NOT NULL,
  account_key    text          NOT NULL,
  revenue        numeric(18,4) NOT NULL DEFAULT 0,
  orders         bigint        NOT NULL DEFAULT 0,
  gross_margin   numeric(18,4),
  new_customers  bigint        NOT NULL DEFAULT 0,
  currency       char(3)       NOT NULL DEFAULT 'USD',
  _source        text          NOT NULL,
  _batch_id      text          NOT NULL,
  _loaded_at     timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT uq_silver_first_party_daily UNIQUE (metric_date, account_key)
);
COMMENT ON TABLE warehouse.silver_first_party_daily IS
  'Conformed daily first-party revenue aggregated from bronze_first_party_orders. The truth source for MER and margin calculations.';
COMMENT ON COLUMN warehouse.silver_first_party_daily.silver_first_party_daily_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN warehouse.silver_first_party_daily.metric_date IS 'The day the revenue covers.';
COMMENT ON COLUMN warehouse.silver_first_party_daily.account_key IS 'Conformed business key for the account/store.';
COMMENT ON COLUMN warehouse.silver_first_party_daily.revenue IS 'Total first-party revenue for the day.';
COMMENT ON COLUMN warehouse.silver_first_party_daily.orders IS 'Total orders for the day.';
COMMENT ON COLUMN warehouse.silver_first_party_daily.gross_margin IS 'Total gross margin for the day, if available.';
COMMENT ON COLUMN warehouse.silver_first_party_daily.new_customers IS 'Count of first-time customers for the day.';
COMMENT ON COLUMN warehouse.silver_first_party_daily.currency IS 'ISO-4217 currency of the monetary fields.';
COMMENT ON COLUMN warehouse.silver_first_party_daily._source IS 'Logical source identifier carried from bronze.';
COMMENT ON COLUMN warehouse.silver_first_party_daily._batch_id IS 'Ingest batch identifier carried from bronze.';
COMMENT ON COLUMN warehouse.silver_first_party_daily._loaded_at IS 'UTC timestamp the silver row was materialised.';
CREATE INDEX idx_silver_fp_daily_date    ON warehouse.silver_first_party_daily (metric_date);
CREATE INDEX idx_silver_fp_daily_account ON warehouse.silver_first_party_daily (account_key);

-- silver.silver_conversions -- conformed individual conversion events.
CREATE TABLE warehouse.silver_conversions (
  silver_conversion_id bigint    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversion_key   text          NOT NULL,
  account_key      text          NOT NULL,
  campaign_key     text,
  creative_key     text,
  conversion_ts    timestamptz   NOT NULL,
  customer_key     text,
  revenue          numeric(18,4) NOT NULL DEFAULT 0,
  is_first_party   boolean       NOT NULL DEFAULT false,
  attribution_model text,
  _source          text          NOT NULL,
  _batch_id        text          NOT NULL,
  _loaded_at       timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT uq_silver_conversions UNIQUE (conversion_key, _source)
);
COMMENT ON TABLE warehouse.silver_conversions IS
  'Conformed individual conversion events from platform and first-party sources. is_first_party distinguishes truth-source conversions from platform-attributed ones.';
COMMENT ON COLUMN warehouse.silver_conversions.silver_conversion_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN warehouse.silver_conversions.conversion_key IS 'Conformed business key for the conversion event.';
COMMENT ON COLUMN warehouse.silver_conversions.account_key IS 'Conformed business key for the account.';
COMMENT ON COLUMN warehouse.silver_conversions.campaign_key IS 'Conformed business key for the campaign, if attributed.';
COMMENT ON COLUMN warehouse.silver_conversions.creative_key IS 'Conformed business key for the creative, if attributed.';
COMMENT ON COLUMN warehouse.silver_conversions.conversion_ts IS 'UTC timestamp of the conversion.';
COMMENT ON COLUMN warehouse.silver_conversions.customer_key IS 'Customer identifier, if known.';
COMMENT ON COLUMN warehouse.silver_conversions.revenue IS 'Revenue value of the conversion.';
COMMENT ON COLUMN warehouse.silver_conversions.is_first_party IS 'True if sourced from first-party data (truth source).';
COMMENT ON COLUMN warehouse.silver_conversions.attribution_model IS 'Attribution model used by the source (e.g. last_click, data_driven).';
COMMENT ON COLUMN warehouse.silver_conversions._source IS 'Logical source identifier carried from bronze.';
COMMENT ON COLUMN warehouse.silver_conversions._batch_id IS 'Ingest batch identifier carried from bronze.';
COMMENT ON COLUMN warehouse.silver_conversions._loaded_at IS 'UTC timestamp the silver row was materialised.';
CREATE INDEX idx_silver_conversions_account  ON warehouse.silver_conversions (account_key);
CREATE INDEX idx_silver_conversions_campaign ON warehouse.silver_conversions (campaign_key);
CREATE INDEX idx_silver_conversions_ts       ON warehouse.silver_conversions (conversion_ts);
CREATE INDEX idx_silver_conversions_fp       ON warehouse.silver_conversions (is_first_party);

-- silver.silver_treatment_assignment -- conformed treatment/control assignment.
CREATE TABLE warehouse.silver_treatment_assignment (
  silver_treatment_assignment_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  experiment_key   text          NOT NULL,
  unit_key         text          NOT NULL,
  account_key      text,
  campaign_key     text,
  treatment_arm    text          NOT NULL,
  is_treated       boolean       NOT NULL,
  assigned_at      timestamptz   NOT NULL,
  assignment_source text         NOT NULL,
  _source          text          NOT NULL,
  _batch_id        text          NOT NULL,
  _loaded_at       timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT uq_silver_treatment_assignment UNIQUE (experiment_key, unit_key)
);
COMMENT ON TABLE warehouse.silver_treatment_assignment IS
  'Conformed treatment/control assignment for experiments and uplift datasets. Maps an experimental unit (user, geo, campaign) to its arm. Required to compute incremental lift honestly.';
COMMENT ON COLUMN warehouse.silver_treatment_assignment.silver_treatment_assignment_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN warehouse.silver_treatment_assignment.experiment_key IS 'Conformed business key for the experiment.';
COMMENT ON COLUMN warehouse.silver_treatment_assignment.unit_key IS 'Conformed key for the randomised unit (user/geo/campaign).';
COMMENT ON COLUMN warehouse.silver_treatment_assignment.account_key IS 'Conformed account key, if the unit maps to one.';
COMMENT ON COLUMN warehouse.silver_treatment_assignment.campaign_key IS 'Conformed campaign key, if the unit maps to one.';
COMMENT ON COLUMN warehouse.silver_treatment_assignment.treatment_arm IS 'Named arm the unit was assigned to.';
COMMENT ON COLUMN warehouse.silver_treatment_assignment.is_treated IS 'True if the arm is a treatment arm; false for control.';
COMMENT ON COLUMN warehouse.silver_treatment_assignment.assigned_at IS 'UTC timestamp the assignment was made.';
COMMENT ON COLUMN warehouse.silver_treatment_assignment.assignment_source IS 'How the assignment was produced (randomised_holdout, ghost_ads, simulator, dataset).';
COMMENT ON COLUMN warehouse.silver_treatment_assignment._source IS 'Logical source identifier carried from bronze.';
COMMENT ON COLUMN warehouse.silver_treatment_assignment._batch_id IS 'Ingest batch identifier carried from bronze.';
COMMENT ON COLUMN warehouse.silver_treatment_assignment._loaded_at IS 'UTC timestamp the silver row was materialised.';
CREATE INDEX idx_silver_treatment_assignment_exp     ON warehouse.silver_treatment_assignment (experiment_key);
CREATE INDEX idx_silver_treatment_assignment_unit    ON warehouse.silver_treatment_assignment (unit_key);
CREATE INDEX idx_silver_treatment_assignment_treated ON warehouse.silver_treatment_assignment (is_treated);
```


---

## Part 4 — `warehouse` Schema: Gold Dimensions (Star Schema)

The gold layer is a Kimball star schema. Dimensions use surrogate integer keys.
`dim_campaign`, `dim_ad_set`, and `dim_creative` are Slowly-Changing-Dimension
Type 2: each business-key version is a separate row with `valid_from`,
`valid_to`, and `is_current`. Facts join on the surrogate dimension keys.

```sql
-- ============================================================================
-- AdMatix Data Layer -- Part 4: warehouse schema, gold dimensions
-- Kimball star schema. Surrogate keys. SCD2 for campaign / ad set / creative.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Dimension: warehouse.dim_date -- conformed calendar dimension.
-- ----------------------------------------------------------------------------
CREATE TABLE warehouse.dim_date (
  date_key       integer       NOT NULL,
  full_date      date          NOT NULL,
  day_of_week    smallint      NOT NULL,
  day_name       text          NOT NULL,
  day_of_month   smallint      NOT NULL,
  day_of_year    smallint      NOT NULL,
  week_of_year   smallint      NOT NULL,
  iso_week       smallint      NOT NULL,
  month_number   smallint      NOT NULL,
  month_name     text          NOT NULL,
  quarter        smallint      NOT NULL,
  year           smallint      NOT NULL,
  is_weekend     boolean       NOT NULL,
  is_month_start boolean       NOT NULL,
  is_month_end   boolean       NOT NULL,

  CONSTRAINT pk_dim_date       PRIMARY KEY (date_key),
  CONSTRAINT uq_dim_date_full  UNIQUE (full_date),
  CONSTRAINT ck_dim_date_key   CHECK (date_key = year * 10000 + month_number * 100 + day_of_month)
);
COMMENT ON TABLE warehouse.dim_date IS
  'Conformed calendar dimension. date_key is the smart integer key YYYYMMDD. Pre-populated for the full reporting range by a dbt seed.';
COMMENT ON COLUMN warehouse.dim_date.date_key IS 'Smart integer surrogate key in YYYYMMDD form (e.g. 20260523).';
COMMENT ON COLUMN warehouse.dim_date.full_date IS 'The calendar date.';
COMMENT ON COLUMN warehouse.dim_date.day_of_week IS 'ISO day of week (1 = Monday .. 7 = Sunday).';
COMMENT ON COLUMN warehouse.dim_date.day_name IS 'Full weekday name.';
COMMENT ON COLUMN warehouse.dim_date.day_of_month IS 'Day number within the month (1-31).';
COMMENT ON COLUMN warehouse.dim_date.day_of_year IS 'Day number within the year (1-366).';
COMMENT ON COLUMN warehouse.dim_date.week_of_year IS 'Week number within the year.';
COMMENT ON COLUMN warehouse.dim_date.iso_week IS 'ISO-8601 week number.';
COMMENT ON COLUMN warehouse.dim_date.month_number IS 'Month number (1-12).';
COMMENT ON COLUMN warehouse.dim_date.month_name IS 'Full month name.';
COMMENT ON COLUMN warehouse.dim_date.quarter IS 'Calendar quarter (1-4).';
COMMENT ON COLUMN warehouse.dim_date.year IS 'Calendar year.';
COMMENT ON COLUMN warehouse.dim_date.is_weekend IS 'True for Saturday and Sunday.';
COMMENT ON COLUMN warehouse.dim_date.is_month_start IS 'True if the date is the first day of its month.';
COMMENT ON COLUMN warehouse.dim_date.is_month_end IS 'True if the date is the last day of its month.';
CREATE INDEX idx_dim_date_year_month ON warehouse.dim_date (year, month_number);

-- ----------------------------------------------------------------------------
-- Dimension: warehouse.dim_account -- the ad account dimension (SCD1).
-- ----------------------------------------------------------------------------
CREATE TABLE warehouse.dim_account (
  account_key         bigint        GENERATED ALWAYS AS IDENTITY,
  account_business_key text         NOT NULL,
  tenant_id           uuid          NOT NULL,
  platform            app.ad_platform NOT NULL,
  external_account_id text          NOT NULL,
  account_name        text          NOT NULL,
  currency            char(3)       NOT NULL DEFAULT 'USD',
  timezone            text          NOT NULL DEFAULT 'UTC',
  is_active           boolean       NOT NULL DEFAULT true,
  updated_at          timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_dim_account            PRIMARY KEY (account_key),
  CONSTRAINT uq_dim_account_business   UNIQUE (account_business_key)
);
COMMENT ON TABLE warehouse.dim_account IS
  'Ad account dimension (SCD Type 1: attributes are overwritten in place). One row per account business key.';
COMMENT ON COLUMN warehouse.dim_account.account_key IS 'Surrogate primary key (identity). Facts join on this.';
COMMENT ON COLUMN warehouse.dim_account.account_business_key IS 'Stable conformed business key for the account.';
COMMENT ON COLUMN warehouse.dim_account.tenant_id IS 'Owning tenant id (mirrors app.tenants).';
COMMENT ON COLUMN warehouse.dim_account.platform IS 'Ad platform the account belongs to.';
COMMENT ON COLUMN warehouse.dim_account.external_account_id IS 'Platform-native account id.';
COMMENT ON COLUMN warehouse.dim_account.account_name IS 'Human-readable account name.';
COMMENT ON COLUMN warehouse.dim_account.currency IS 'ISO-4217 account currency.';
COMMENT ON COLUMN warehouse.dim_account.timezone IS 'IANA account timezone.';
COMMENT ON COLUMN warehouse.dim_account.is_active IS 'True if the account is currently active.';
COMMENT ON COLUMN warehouse.dim_account.updated_at IS 'UTC timestamp the dimension row was last refreshed.';
CREATE INDEX idx_dim_account_tenant   ON warehouse.dim_account (tenant_id);
CREATE INDEX idx_dim_account_platform ON warehouse.dim_account (platform);

-- ----------------------------------------------------------------------------
-- Dimension: warehouse.dim_campaign -- SCD Type 2.
-- ----------------------------------------------------------------------------
CREATE TABLE warehouse.dim_campaign (
  campaign_key          bigint        GENERATED ALWAYS AS IDENTITY,
  campaign_business_key text          NOT NULL,
  account_key           bigint        NOT NULL,
  platform              app.ad_platform NOT NULL,
  external_campaign_id  text          NOT NULL,
  campaign_name         text          NOT NULL,
  objective             text,
  status                app.entity_status NOT NULL DEFAULT 'active',
  daily_budget          numeric(18,4),
  lifetime_budget       numeric(18,4),
  start_date            date,
  end_date              date,
  valid_from            timestamptz   NOT NULL DEFAULT now(),
  valid_to              timestamptz   NOT NULL DEFAULT 'infinity',
  is_current            boolean       NOT NULL DEFAULT true,
  row_hash              char(64)      NOT NULL,

  CONSTRAINT pk_dim_campaign        PRIMARY KEY (campaign_key),
  CONSTRAINT fk_dim_campaign_account FOREIGN KEY (account_key)
                                     REFERENCES warehouse.dim_account (account_key),
  CONSTRAINT ck_dim_campaign_valid  CHECK (valid_to > valid_from)
);
COMMENT ON TABLE warehouse.dim_campaign IS
  'Campaign dimension, SCD Type 2. Each tracked-attribute change opens a new row; the prior row gets valid_to set and is_current = false. Exactly one row per business key has is_current = true.';
COMMENT ON COLUMN warehouse.dim_campaign.campaign_key IS 'Surrogate primary key (identity). Facts join on this specific version.';
COMMENT ON COLUMN warehouse.dim_campaign.campaign_business_key IS 'Stable conformed business key shared by all versions of the campaign.';
COMMENT ON COLUMN warehouse.dim_campaign.account_key IS 'Surrogate FK to warehouse.dim_account.';
COMMENT ON COLUMN warehouse.dim_campaign.platform IS 'Ad platform the campaign belongs to.';
COMMENT ON COLUMN warehouse.dim_campaign.external_campaign_id IS 'Platform-native campaign id.';
COMMENT ON COLUMN warehouse.dim_campaign.campaign_name IS 'Campaign name as of this version.';
COMMENT ON COLUMN warehouse.dim_campaign.objective IS 'Campaign objective as of this version.';
COMMENT ON COLUMN warehouse.dim_campaign.status IS 'Lifecycle status as of this version.';
COMMENT ON COLUMN warehouse.dim_campaign.daily_budget IS 'Daily budget as of this version.';
COMMENT ON COLUMN warehouse.dim_campaign.lifetime_budget IS 'Lifetime budget as of this version.';
COMMENT ON COLUMN warehouse.dim_campaign.start_date IS 'Campaign start date.';
COMMENT ON COLUMN warehouse.dim_campaign.end_date IS 'Campaign end date.';
COMMENT ON COLUMN warehouse.dim_campaign.valid_from IS 'SCD2: UTC timestamp this version became effective.';
COMMENT ON COLUMN warehouse.dim_campaign.valid_to IS 'SCD2: UTC timestamp this version was superseded; "infinity" while current.';
COMMENT ON COLUMN warehouse.dim_campaign.is_current IS 'SCD2: true for the active version of the business key.';
COMMENT ON COLUMN warehouse.dim_campaign.row_hash IS 'SHA-256 (hex) of the tracked attributes; dbt uses it to detect changes that warrant a new version.';
CREATE UNIQUE INDEX uq_dim_campaign_current
  ON warehouse.dim_campaign (campaign_business_key)
  WHERE is_current;
COMMENT ON INDEX warehouse.uq_dim_campaign_current IS
  'Partial unique index guaranteeing exactly one current row per campaign business key.';
CREATE INDEX idx_dim_campaign_business ON warehouse.dim_campaign (campaign_business_key);
CREATE INDEX idx_dim_campaign_account  ON warehouse.dim_campaign (account_key);
CREATE INDEX idx_dim_campaign_current  ON warehouse.dim_campaign (is_current);
CREATE INDEX idx_dim_campaign_validity ON warehouse.dim_campaign (valid_from, valid_to);

-- ----------------------------------------------------------------------------
-- Dimension: warehouse.dim_ad_set -- SCD Type 2.
-- ----------------------------------------------------------------------------
CREATE TABLE warehouse.dim_ad_set (
  ad_set_key          bigint        GENERATED ALWAYS AS IDENTITY,
  ad_set_business_key text          NOT NULL,
  campaign_key        bigint        NOT NULL,
  external_ad_set_id  text          NOT NULL,
  ad_set_name         text          NOT NULL,
  status              app.entity_status NOT NULL DEFAULT 'active',
  bid_strategy        text,
  daily_budget        numeric(18,4),
  optimization_goal   text,
  valid_from          timestamptz   NOT NULL DEFAULT now(),
  valid_to            timestamptz   NOT NULL DEFAULT 'infinity',
  is_current          boolean       NOT NULL DEFAULT true,
  row_hash            char(64)      NOT NULL,

  CONSTRAINT pk_dim_ad_set          PRIMARY KEY (ad_set_key),
  CONSTRAINT fk_dim_ad_set_campaign FOREIGN KEY (campaign_key)
                                    REFERENCES warehouse.dim_campaign (campaign_key),
  CONSTRAINT ck_dim_ad_set_valid    CHECK (valid_to > valid_from)
);
COMMENT ON TABLE warehouse.dim_ad_set IS
  'Ad set / ad group dimension, SCD Type 2. Each tracked-attribute change opens a new row. Exactly one current row per business key.';
COMMENT ON COLUMN warehouse.dim_ad_set.ad_set_key IS 'Surrogate primary key (identity). Facts join on this version.';
COMMENT ON COLUMN warehouse.dim_ad_set.ad_set_business_key IS 'Stable conformed business key shared by all versions.';
COMMENT ON COLUMN warehouse.dim_ad_set.campaign_key IS 'Surrogate FK to the campaign version (warehouse.dim_campaign).';
COMMENT ON COLUMN warehouse.dim_ad_set.external_ad_set_id IS 'Platform-native ad set / ad group id.';
COMMENT ON COLUMN warehouse.dim_ad_set.ad_set_name IS 'Ad set name as of this version.';
COMMENT ON COLUMN warehouse.dim_ad_set.status IS 'Lifecycle status as of this version.';
COMMENT ON COLUMN warehouse.dim_ad_set.bid_strategy IS 'Bid strategy as of this version (e.g. lowest_cost, target_cpa).';
COMMENT ON COLUMN warehouse.dim_ad_set.daily_budget IS 'Daily budget as of this version.';
COMMENT ON COLUMN warehouse.dim_ad_set.optimization_goal IS 'Optimisation goal as of this version.';
COMMENT ON COLUMN warehouse.dim_ad_set.valid_from IS 'SCD2: UTC timestamp this version became effective.';
COMMENT ON COLUMN warehouse.dim_ad_set.valid_to IS 'SCD2: UTC timestamp this version was superseded; "infinity" while current.';
COMMENT ON COLUMN warehouse.dim_ad_set.is_current IS 'SCD2: true for the active version of the business key.';
COMMENT ON COLUMN warehouse.dim_ad_set.row_hash IS 'SHA-256 (hex) of the tracked attributes; drives SCD2 change detection.';
CREATE UNIQUE INDEX uq_dim_ad_set_current
  ON warehouse.dim_ad_set (ad_set_business_key)
  WHERE is_current;
COMMENT ON INDEX warehouse.uq_dim_ad_set_current IS
  'Partial unique index guaranteeing exactly one current row per ad set business key.';
CREATE INDEX idx_dim_ad_set_business ON warehouse.dim_ad_set (ad_set_business_key);
CREATE INDEX idx_dim_ad_set_campaign ON warehouse.dim_ad_set (campaign_key);
CREATE INDEX idx_dim_ad_set_current  ON warehouse.dim_ad_set (is_current);
CREATE INDEX idx_dim_ad_set_validity ON warehouse.dim_ad_set (valid_from, valid_to);

-- ----------------------------------------------------------------------------
-- Dimension: warehouse.dim_creative -- SCD Type 2.
-- ----------------------------------------------------------------------------
CREATE TABLE warehouse.dim_creative (
  creative_key          bigint        GENERATED ALWAYS AS IDENTITY,
  creative_business_key text          NOT NULL,
  campaign_key          bigint        NOT NULL,
  ad_set_key            bigint,
  external_creative_id  text          NOT NULL,
  creative_format       text          NOT NULL,
  headline              text,
  body_text             text,
  final_url             text,
  policy_status         text,
  status                app.entity_status NOT NULL DEFAULT 'active',
  valid_from            timestamptz   NOT NULL DEFAULT now(),
  valid_to              timestamptz   NOT NULL DEFAULT 'infinity',
  is_current            boolean       NOT NULL DEFAULT true,
  row_hash              char(64)      NOT NULL,

  CONSTRAINT pk_dim_creative          PRIMARY KEY (creative_key),
  CONSTRAINT fk_dim_creative_campaign FOREIGN KEY (campaign_key)
                                      REFERENCES warehouse.dim_campaign (campaign_key),
  CONSTRAINT fk_dim_creative_ad_set   FOREIGN KEY (ad_set_key)
                                      REFERENCES warehouse.dim_ad_set (ad_set_key),
  CONSTRAINT ck_dim_creative_valid    CHECK (valid_to > valid_from)
);
COMMENT ON TABLE warehouse.dim_creative IS
  'Creative dimension, SCD Type 2. Each tracked-attribute change (headline, body, URL, policy status) opens a new row. Exactly one current row per business key.';
COMMENT ON COLUMN warehouse.dim_creative.creative_key IS 'Surrogate primary key (identity). Facts join on this version.';
COMMENT ON COLUMN warehouse.dim_creative.creative_business_key IS 'Stable conformed business key shared by all versions.';
COMMENT ON COLUMN warehouse.dim_creative.campaign_key IS 'Surrogate FK to the campaign version (warehouse.dim_campaign).';
COMMENT ON COLUMN warehouse.dim_creative.ad_set_key IS 'Surrogate FK to the ad set version (warehouse.dim_ad_set); nullable.';
COMMENT ON COLUMN warehouse.dim_creative.external_creative_id IS 'Platform-native creative id.';
COMMENT ON COLUMN warehouse.dim_creative.creative_format IS 'Creative format (image, video, carousel, text, ...).';
COMMENT ON COLUMN warehouse.dim_creative.headline IS 'Headline text as of this version.';
COMMENT ON COLUMN warehouse.dim_creative.body_text IS 'Body copy as of this version.';
COMMENT ON COLUMN warehouse.dim_creative.final_url IS 'Landing page URL as of this version.';
COMMENT ON COLUMN warehouse.dim_creative.policy_status IS 'Platform policy review status as of this version.';
COMMENT ON COLUMN warehouse.dim_creative.status IS 'Lifecycle status as of this version.';
COMMENT ON COLUMN warehouse.dim_creative.valid_from IS 'SCD2: UTC timestamp this version became effective.';
COMMENT ON COLUMN warehouse.dim_creative.valid_to IS 'SCD2: UTC timestamp this version was superseded; "infinity" while current.';
COMMENT ON COLUMN warehouse.dim_creative.is_current IS 'SCD2: true for the active version of the business key.';
COMMENT ON COLUMN warehouse.dim_creative.row_hash IS 'SHA-256 (hex) of the tracked attributes; drives SCD2 change detection.';
CREATE UNIQUE INDEX uq_dim_creative_current
  ON warehouse.dim_creative (creative_business_key)
  WHERE is_current;
COMMENT ON INDEX warehouse.uq_dim_creative_current IS
  'Partial unique index guaranteeing exactly one current row per creative business key.';
CREATE INDEX idx_dim_creative_business ON warehouse.dim_creative (creative_business_key);
CREATE INDEX idx_dim_creative_campaign ON warehouse.dim_creative (campaign_key);
CREATE INDEX idx_dim_creative_ad_set   ON warehouse.dim_creative (ad_set_key);
CREATE INDEX idx_dim_creative_current  ON warehouse.dim_creative (is_current);
CREATE INDEX idx_dim_creative_validity ON warehouse.dim_creative (valid_from, valid_to);

-- ----------------------------------------------------------------------------
-- Dimension: warehouse.dim_geo -- conformed geography dimension (SCD1).
-- ----------------------------------------------------------------------------
CREATE TABLE warehouse.dim_geo (
  geo_key       bigint        GENERATED ALWAYS AS IDENTITY,
  geo_business_key text       NOT NULL,
  country_code  char(2)       NOT NULL,
  country_name  text          NOT NULL,
  region        text,
  region_code   text,
  city          text,
  metro_code    text,
  postal_code   text,

  CONSTRAINT pk_dim_geo          PRIMARY KEY (geo_key),
  CONSTRAINT uq_dim_geo_business UNIQUE (geo_business_key)
);
COMMENT ON TABLE warehouse.dim_geo IS
  'Conformed geography dimension (SCD Type 1) at country / region / city / postal granularity.';
COMMENT ON COLUMN warehouse.dim_geo.geo_key IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN warehouse.dim_geo.geo_business_key IS 'Conformed business key composed of the geo attributes.';
COMMENT ON COLUMN warehouse.dim_geo.country_code IS 'ISO-3166-1 alpha-2 country code.';
COMMENT ON COLUMN warehouse.dim_geo.country_name IS 'Country name.';
COMMENT ON COLUMN warehouse.dim_geo.region IS 'State / province / region name.';
COMMENT ON COLUMN warehouse.dim_geo.region_code IS 'State / province / region code.';
COMMENT ON COLUMN warehouse.dim_geo.city IS 'City name.';
COMMENT ON COLUMN warehouse.dim_geo.metro_code IS 'Metro / DMA code where applicable.';
COMMENT ON COLUMN warehouse.dim_geo.postal_code IS 'Postal / ZIP code where applicable.';
CREATE INDEX idx_dim_geo_country ON warehouse.dim_geo (country_code);
CREATE INDEX idx_dim_geo_region  ON warehouse.dim_geo (region_code);

-- ----------------------------------------------------------------------------
-- Dimension: warehouse.dim_audience -- targeting audience dimension (SCD1).
-- ----------------------------------------------------------------------------
CREATE TABLE warehouse.dim_audience (
  audience_key       bigint     GENERATED ALWAYS AS IDENTITY,
  audience_business_key text    NOT NULL,
  audience_name      text       NOT NULL,
  audience_type      text       NOT NULL,
  platform           app.ad_platform,
  size_estimate      bigint,
  description        text,

  CONSTRAINT pk_dim_audience          PRIMARY KEY (audience_key),
  CONSTRAINT uq_dim_audience_business UNIQUE (audience_business_key)
);
COMMENT ON TABLE warehouse.dim_audience IS
  'Targeting audience dimension (SCD Type 1): saved audiences, custom audiences, lookalikes, interest segments.';
COMMENT ON COLUMN warehouse.dim_audience.audience_key IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN warehouse.dim_audience.audience_business_key IS 'Conformed business key for the audience.';
COMMENT ON COLUMN warehouse.dim_audience.audience_name IS 'Human-readable audience name.';
COMMENT ON COLUMN warehouse.dim_audience.audience_type IS 'Audience type (custom, lookalike, interest, remarketing, ...).';
COMMENT ON COLUMN warehouse.dim_audience.platform IS 'Platform the audience is defined on, if platform-specific.';
COMMENT ON COLUMN warehouse.dim_audience.size_estimate IS 'Estimated audience size where the platform reports it.';
COMMENT ON COLUMN warehouse.dim_audience.description IS 'Optional description of the audience definition.';
CREATE INDEX idx_dim_audience_type     ON warehouse.dim_audience (audience_type);
CREATE INDEX idx_dim_audience_platform ON warehouse.dim_audience (platform);

-- ----------------------------------------------------------------------------
-- Dimension: warehouse.dim_platform -- the ad platform dimension (SCD1).
-- ----------------------------------------------------------------------------
CREATE TABLE warehouse.dim_platform (
  platform_key   smallint      GENERATED ALWAYS AS IDENTITY,
  platform_code  app.ad_platform NOT NULL,
  platform_name  text          NOT NULL,
  platform_family text         NOT NULL,
  is_truth_source boolean      NOT NULL DEFAULT false,

  CONSTRAINT pk_dim_platform        PRIMARY KEY (platform_key),
  CONSTRAINT uq_dim_platform_code   UNIQUE (platform_code)
);
COMMENT ON TABLE warehouse.dim_platform IS
  'Ad platform dimension (SCD Type 1). Small, mostly static lookup. is_truth_source flags first_party as the MER truth source.';
COMMENT ON COLUMN warehouse.dim_platform.platform_key IS 'Surrogate primary key (identity, smallint).';
COMMENT ON COLUMN warehouse.dim_platform.platform_code IS 'Platform enum code (unique).';
COMMENT ON COLUMN warehouse.dim_platform.platform_name IS 'Human-readable platform name.';
COMMENT ON COLUMN warehouse.dim_platform.platform_family IS 'Platform family (search, social, programmatic, retail_media, first_party).';
COMMENT ON COLUMN warehouse.dim_platform.is_truth_source IS 'True for first_party; the only revenue treated as causal truth.';

-- ----------------------------------------------------------------------------
-- Dimension: warehouse.dim_device -- the device dimension (SCD1).
-- ----------------------------------------------------------------------------
CREATE TABLE warehouse.dim_device (
  device_key      smallint      GENERATED ALWAYS AS IDENTITY,
  device_business_key text      NOT NULL,
  device_type     text          NOT NULL,
  device_category text,
  operating_system text,

  CONSTRAINT pk_dim_device          PRIMARY KEY (device_key),
  CONSTRAINT uq_dim_device_business UNIQUE (device_business_key)
);
COMMENT ON TABLE warehouse.dim_device IS
  'Device dimension (SCD Type 1): device type, category, and operating system used to slice impression/click facts.';
COMMENT ON COLUMN warehouse.dim_device.device_key IS 'Surrogate primary key (identity, smallint).';
COMMENT ON COLUMN warehouse.dim_device.device_business_key IS 'Conformed business key for the device combination.';
COMMENT ON COLUMN warehouse.dim_device.device_type IS 'Device type (mobile, desktop, tablet, connected_tv, ...).';
COMMENT ON COLUMN warehouse.dim_device.device_category IS 'Coarser device category where the source provides it.';
COMMENT ON COLUMN warehouse.dim_device.operating_system IS 'Operating system family (iOS, Android, Windows, ...).';
CREATE INDEX idx_dim_device_type ON warehouse.dim_device (device_type);
```


---

## Part 5 — `warehouse` Schema: Gold Facts (Star Schema)

Fact tables hold the measurements. They carry surrogate foreign keys to the
dimensions and additive numeric measures. `fct_impressions`, `fct_clicks`, and
`fct_conversions` are event-grain; `fct_spend_daily` and `fct_outcome` are
periodic snapshots; `fct_campaign_action` is an accumulating-snapshot bridge to
the governance layer.

```sql
-- ============================================================================
-- AdMatix Data Layer -- Part 5: warehouse schema, gold facts
-- Star-schema fact tables. Surrogate FKs to dimensions. Additive measures.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Fact: warehouse.fct_impressions -- event-grain impression fact.
-- ----------------------------------------------------------------------------
CREATE TABLE warehouse.fct_impressions (
  impression_id   bigint        GENERATED ALWAYS AS IDENTITY,
  date_key        integer       NOT NULL,
  account_key     bigint        NOT NULL,
  campaign_key    bigint        NOT NULL,
  ad_set_key      bigint,
  creative_key    bigint,
  platform_key    smallint      NOT NULL,
  geo_key         bigint,
  audience_key    bigint,
  device_key      smallint,
  impression_ts   timestamptz   NOT NULL,
  impressions     bigint        NOT NULL DEFAULT 1,
  cost            numeric(18,6) NOT NULL DEFAULT 0,
  _source         text          NOT NULL,
  _loaded_at      timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_fct_impressions          PRIMARY KEY (impression_id),
  CONSTRAINT fk_fct_impressions_date     FOREIGN KEY (date_key)     REFERENCES warehouse.dim_date (date_key),
  CONSTRAINT fk_fct_impressions_account  FOREIGN KEY (account_key)  REFERENCES warehouse.dim_account (account_key),
  CONSTRAINT fk_fct_impressions_campaign FOREIGN KEY (campaign_key) REFERENCES warehouse.dim_campaign (campaign_key),
  CONSTRAINT fk_fct_impressions_ad_set   FOREIGN KEY (ad_set_key)   REFERENCES warehouse.dim_ad_set (ad_set_key),
  CONSTRAINT fk_fct_impressions_creative FOREIGN KEY (creative_key) REFERENCES warehouse.dim_creative (creative_key),
  CONSTRAINT fk_fct_impressions_platform FOREIGN KEY (platform_key) REFERENCES warehouse.dim_platform (platform_key),
  CONSTRAINT fk_fct_impressions_geo      FOREIGN KEY (geo_key)      REFERENCES warehouse.dim_geo (geo_key),
  CONSTRAINT fk_fct_impressions_audience FOREIGN KEY (audience_key) REFERENCES warehouse.dim_audience (audience_key),
  CONSTRAINT fk_fct_impressions_device   FOREIGN KEY (device_key)   REFERENCES warehouse.dim_device (device_key)
);
COMMENT ON TABLE warehouse.fct_impressions IS
  'Event-grain impression fact: one row per impression (or impression micro-batch). Measures are additive.';
COMMENT ON COLUMN warehouse.fct_impressions.impression_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN warehouse.fct_impressions.date_key IS 'FK to warehouse.dim_date (impression day).';
COMMENT ON COLUMN warehouse.fct_impressions.account_key IS 'FK to warehouse.dim_account.';
COMMENT ON COLUMN warehouse.fct_impressions.campaign_key IS 'FK to warehouse.dim_campaign (the version effective at impression time).';
COMMENT ON COLUMN warehouse.fct_impressions.ad_set_key IS 'FK to warehouse.dim_ad_set; nullable.';
COMMENT ON COLUMN warehouse.fct_impressions.creative_key IS 'FK to warehouse.dim_creative; nullable.';
COMMENT ON COLUMN warehouse.fct_impressions.platform_key IS 'FK to warehouse.dim_platform.';
COMMENT ON COLUMN warehouse.fct_impressions.geo_key IS 'FK to warehouse.dim_geo; nullable.';
COMMENT ON COLUMN warehouse.fct_impressions.audience_key IS 'FK to warehouse.dim_audience; nullable.';
COMMENT ON COLUMN warehouse.fct_impressions.device_key IS 'FK to warehouse.dim_device; nullable.';
COMMENT ON COLUMN warehouse.fct_impressions.impression_ts IS 'UTC timestamp of the impression.';
COMMENT ON COLUMN warehouse.fct_impressions.impressions IS 'Additive impression count (1 per row, or batch size).';
COMMENT ON COLUMN warehouse.fct_impressions.cost IS 'Additive media cost attributed to the impression(s).';
COMMENT ON COLUMN warehouse.fct_impressions._source IS 'Logical source identifier.';
COMMENT ON COLUMN warehouse.fct_impressions._loaded_at IS 'UTC timestamp the fact row was materialised.';
CREATE INDEX idx_fct_impressions_date     ON warehouse.fct_impressions (date_key);
CREATE INDEX idx_fct_impressions_account  ON warehouse.fct_impressions (account_key);
CREATE INDEX idx_fct_impressions_campaign ON warehouse.fct_impressions (campaign_key);
CREATE INDEX idx_fct_impressions_ad_set   ON warehouse.fct_impressions (ad_set_key);
CREATE INDEX idx_fct_impressions_creative ON warehouse.fct_impressions (creative_key);
CREATE INDEX idx_fct_impressions_platform ON warehouse.fct_impressions (platform_key);
CREATE INDEX idx_fct_impressions_geo      ON warehouse.fct_impressions (geo_key);
CREATE INDEX idx_fct_impressions_audience ON warehouse.fct_impressions (audience_key);
CREATE INDEX idx_fct_impressions_device   ON warehouse.fct_impressions (device_key);
CREATE INDEX idx_fct_impressions_ts       ON warehouse.fct_impressions (impression_ts);

-- ----------------------------------------------------------------------------
-- Fact: warehouse.fct_clicks -- event-grain click fact.
-- ----------------------------------------------------------------------------
CREATE TABLE warehouse.fct_clicks (
  click_id        bigint        GENERATED ALWAYS AS IDENTITY,
  date_key        integer       NOT NULL,
  account_key     bigint        NOT NULL,
  campaign_key    bigint        NOT NULL,
  ad_set_key      bigint,
  creative_key    bigint,
  platform_key    smallint      NOT NULL,
  geo_key         bigint,
  audience_key    bigint,
  device_key      smallint,
  click_ts        timestamptz   NOT NULL,
  clicks          bigint        NOT NULL DEFAULT 1,
  cost            numeric(18,6) NOT NULL DEFAULT 0,
  _source         text          NOT NULL,
  _loaded_at      timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_fct_clicks          PRIMARY KEY (click_id),
  CONSTRAINT fk_fct_clicks_date     FOREIGN KEY (date_key)     REFERENCES warehouse.dim_date (date_key),
  CONSTRAINT fk_fct_clicks_account  FOREIGN KEY (account_key)  REFERENCES warehouse.dim_account (account_key),
  CONSTRAINT fk_fct_clicks_campaign FOREIGN KEY (campaign_key) REFERENCES warehouse.dim_campaign (campaign_key),
  CONSTRAINT fk_fct_clicks_ad_set   FOREIGN KEY (ad_set_key)   REFERENCES warehouse.dim_ad_set (ad_set_key),
  CONSTRAINT fk_fct_clicks_creative FOREIGN KEY (creative_key) REFERENCES warehouse.dim_creative (creative_key),
  CONSTRAINT fk_fct_clicks_platform FOREIGN KEY (platform_key) REFERENCES warehouse.dim_platform (platform_key),
  CONSTRAINT fk_fct_clicks_geo      FOREIGN KEY (geo_key)      REFERENCES warehouse.dim_geo (geo_key),
  CONSTRAINT fk_fct_clicks_audience FOREIGN KEY (audience_key) REFERENCES warehouse.dim_audience (audience_key),
  CONSTRAINT fk_fct_clicks_device   FOREIGN KEY (device_key)   REFERENCES warehouse.dim_device (device_key)
);
COMMENT ON TABLE warehouse.fct_clicks IS
  'Event-grain click fact: one row per click (or click micro-batch). Measures are additive.';
COMMENT ON COLUMN warehouse.fct_clicks.click_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN warehouse.fct_clicks.date_key IS 'FK to warehouse.dim_date (click day).';
COMMENT ON COLUMN warehouse.fct_clicks.account_key IS 'FK to warehouse.dim_account.';
COMMENT ON COLUMN warehouse.fct_clicks.campaign_key IS 'FK to warehouse.dim_campaign (version effective at click time).';
COMMENT ON COLUMN warehouse.fct_clicks.ad_set_key IS 'FK to warehouse.dim_ad_set; nullable.';
COMMENT ON COLUMN warehouse.fct_clicks.creative_key IS 'FK to warehouse.dim_creative; nullable.';
COMMENT ON COLUMN warehouse.fct_clicks.platform_key IS 'FK to warehouse.dim_platform.';
COMMENT ON COLUMN warehouse.fct_clicks.geo_key IS 'FK to warehouse.dim_geo; nullable.';
COMMENT ON COLUMN warehouse.fct_clicks.audience_key IS 'FK to warehouse.dim_audience; nullable.';
COMMENT ON COLUMN warehouse.fct_clicks.device_key IS 'FK to warehouse.dim_device; nullable.';
COMMENT ON COLUMN warehouse.fct_clicks.click_ts IS 'UTC timestamp of the click.';
COMMENT ON COLUMN warehouse.fct_clicks.clicks IS 'Additive click count (1 per row, or batch size).';
COMMENT ON COLUMN warehouse.fct_clicks.cost IS 'Additive media cost attributed to the click(s).';
COMMENT ON COLUMN warehouse.fct_clicks._source IS 'Logical source identifier.';
COMMENT ON COLUMN warehouse.fct_clicks._loaded_at IS 'UTC timestamp the fact row was materialised.';
CREATE INDEX idx_fct_clicks_date     ON warehouse.fct_clicks (date_key);
CREATE INDEX idx_fct_clicks_account  ON warehouse.fct_clicks (account_key);
CREATE INDEX idx_fct_clicks_campaign ON warehouse.fct_clicks (campaign_key);
CREATE INDEX idx_fct_clicks_ad_set   ON warehouse.fct_clicks (ad_set_key);
CREATE INDEX idx_fct_clicks_creative ON warehouse.fct_clicks (creative_key);
CREATE INDEX idx_fct_clicks_platform ON warehouse.fct_clicks (platform_key);
CREATE INDEX idx_fct_clicks_geo      ON warehouse.fct_clicks (geo_key);
CREATE INDEX idx_fct_clicks_audience ON warehouse.fct_clicks (audience_key);
CREATE INDEX idx_fct_clicks_device   ON warehouse.fct_clicks (device_key);
CREATE INDEX idx_fct_clicks_ts       ON warehouse.fct_clicks (click_ts);

-- ----------------------------------------------------------------------------
-- Fact: warehouse.fct_conversions -- event-grain conversion fact.
-- ----------------------------------------------------------------------------
CREATE TABLE warehouse.fct_conversions (
  conversion_id    bigint        GENERATED ALWAYS AS IDENTITY,
  date_key         integer       NOT NULL,
  account_key      bigint        NOT NULL,
  campaign_key     bigint,
  ad_set_key       bigint,
  creative_key     bigint,
  platform_key     smallint      NOT NULL,
  geo_key          bigint,
  audience_key     bigint,
  device_key       smallint,
  conversion_ts    timestamptz   NOT NULL,
  conversions      numeric(18,4) NOT NULL DEFAULT 1,
  revenue          numeric(18,4) NOT NULL DEFAULT 0,
  is_first_party   boolean       NOT NULL DEFAULT false,
  attribution_model text,
  _source          text          NOT NULL,
  _loaded_at       timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_fct_conversions          PRIMARY KEY (conversion_id),
  CONSTRAINT fk_fct_conversions_date     FOREIGN KEY (date_key)     REFERENCES warehouse.dim_date (date_key),
  CONSTRAINT fk_fct_conversions_account  FOREIGN KEY (account_key)  REFERENCES warehouse.dim_account (account_key),
  CONSTRAINT fk_fct_conversions_campaign FOREIGN KEY (campaign_key) REFERENCES warehouse.dim_campaign (campaign_key),
  CONSTRAINT fk_fct_conversions_ad_set   FOREIGN KEY (ad_set_key)   REFERENCES warehouse.dim_ad_set (ad_set_key),
  CONSTRAINT fk_fct_conversions_creative FOREIGN KEY (creative_key) REFERENCES warehouse.dim_creative (creative_key),
  CONSTRAINT fk_fct_conversions_platform FOREIGN KEY (platform_key) REFERENCES warehouse.dim_platform (platform_key),
  CONSTRAINT fk_fct_conversions_geo      FOREIGN KEY (geo_key)      REFERENCES warehouse.dim_geo (geo_key),
  CONSTRAINT fk_fct_conversions_audience FOREIGN KEY (audience_key) REFERENCES warehouse.dim_audience (audience_key),
  CONSTRAINT fk_fct_conversions_device   FOREIGN KEY (device_key)   REFERENCES warehouse.dim_device (device_key)
);
COMMENT ON TABLE warehouse.fct_conversions IS
  'Event-grain conversion fact: one row per conversion. is_first_party marks truth-source conversions versus platform-attributed ones.';
COMMENT ON COLUMN warehouse.fct_conversions.conversion_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN warehouse.fct_conversions.date_key IS 'FK to warehouse.dim_date (conversion day).';
COMMENT ON COLUMN warehouse.fct_conversions.account_key IS 'FK to warehouse.dim_account.';
COMMENT ON COLUMN warehouse.fct_conversions.campaign_key IS 'FK to warehouse.dim_campaign; nullable when unattributed.';
COMMENT ON COLUMN warehouse.fct_conversions.ad_set_key IS 'FK to warehouse.dim_ad_set; nullable.';
COMMENT ON COLUMN warehouse.fct_conversions.creative_key IS 'FK to warehouse.dim_creative; nullable.';
COMMENT ON COLUMN warehouse.fct_conversions.platform_key IS 'FK to warehouse.dim_platform.';
COMMENT ON COLUMN warehouse.fct_conversions.geo_key IS 'FK to warehouse.dim_geo; nullable.';
COMMENT ON COLUMN warehouse.fct_conversions.audience_key IS 'FK to warehouse.dim_audience; nullable.';
COMMENT ON COLUMN warehouse.fct_conversions.device_key IS 'FK to warehouse.dim_device; nullable.';
COMMENT ON COLUMN warehouse.fct_conversions.conversion_ts IS 'UTC timestamp of the conversion.';
COMMENT ON COLUMN warehouse.fct_conversions.conversions IS 'Additive conversion count (supports fractional/credited conversions).';
COMMENT ON COLUMN warehouse.fct_conversions.revenue IS 'Additive revenue value of the conversion.';
COMMENT ON COLUMN warehouse.fct_conversions.is_first_party IS 'True if sourced from first-party data (causal truth source).';
COMMENT ON COLUMN warehouse.fct_conversions.attribution_model IS 'Attribution model used by the source.';
COMMENT ON COLUMN warehouse.fct_conversions._source IS 'Logical source identifier.';
COMMENT ON COLUMN warehouse.fct_conversions._loaded_at IS 'UTC timestamp the fact row was materialised.';
CREATE INDEX idx_fct_conversions_date     ON warehouse.fct_conversions (date_key);
CREATE INDEX idx_fct_conversions_account  ON warehouse.fct_conversions (account_key);
CREATE INDEX idx_fct_conversions_campaign ON warehouse.fct_conversions (campaign_key);
CREATE INDEX idx_fct_conversions_ad_set   ON warehouse.fct_conversions (ad_set_key);
CREATE INDEX idx_fct_conversions_creative ON warehouse.fct_conversions (creative_key);
CREATE INDEX idx_fct_conversions_platform ON warehouse.fct_conversions (platform_key);
CREATE INDEX idx_fct_conversions_geo      ON warehouse.fct_conversions (geo_key);
CREATE INDEX idx_fct_conversions_audience ON warehouse.fct_conversions (audience_key);
CREATE INDEX idx_fct_conversions_device   ON warehouse.fct_conversions (device_key);
CREATE INDEX idx_fct_conversions_ts       ON warehouse.fct_conversions (conversion_ts);
CREATE INDEX idx_fct_conversions_fp       ON warehouse.fct_conversions (is_first_party);

-- ----------------------------------------------------------------------------
-- Fact: warehouse.fct_spend_daily -- periodic-snapshot daily spend fact.
-- ----------------------------------------------------------------------------
CREATE TABLE warehouse.fct_spend_daily (
  spend_daily_id   bigint        GENERATED ALWAYS AS IDENTITY,
  date_key         integer       NOT NULL,
  account_key      bigint        NOT NULL,
  campaign_key     bigint        NOT NULL,
  ad_set_key       bigint,
  platform_key     smallint      NOT NULL,
  spend            numeric(18,4) NOT NULL DEFAULT 0,
  impressions      bigint        NOT NULL DEFAULT 0,
  clicks           bigint        NOT NULL DEFAULT 0,
  conversions      numeric(18,4) NOT NULL DEFAULT 0,
  platform_revenue numeric(18,4) NOT NULL DEFAULT 0,
  currency         char(3)       NOT NULL DEFAULT 'USD',
  _source          text          NOT NULL,
  _loaded_at       timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_fct_spend_daily          PRIMARY KEY (spend_daily_id),
  CONSTRAINT fk_fct_spend_daily_date     FOREIGN KEY (date_key)     REFERENCES warehouse.dim_date (date_key),
  CONSTRAINT fk_fct_spend_daily_account  FOREIGN KEY (account_key)  REFERENCES warehouse.dim_account (account_key),
  CONSTRAINT fk_fct_spend_daily_campaign FOREIGN KEY (campaign_key) REFERENCES warehouse.dim_campaign (campaign_key),
  CONSTRAINT fk_fct_spend_daily_ad_set   FOREIGN KEY (ad_set_key)   REFERENCES warehouse.dim_ad_set (ad_set_key),
  CONSTRAINT fk_fct_spend_daily_platform FOREIGN KEY (platform_key) REFERENCES warehouse.dim_platform (platform_key),
  CONSTRAINT uq_fct_spend_daily_grain    UNIQUE (date_key, campaign_key, ad_set_key)
);
COMMENT ON TABLE warehouse.fct_spend_daily IS
  'Periodic-snapshot daily spend fact at campaign / ad set grain. The primary fact for budget pacing and efficiency reporting. platform_revenue is directional.';
COMMENT ON COLUMN warehouse.fct_spend_daily.spend_daily_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN warehouse.fct_spend_daily.date_key IS 'FK to warehouse.dim_date (the spend day).';
COMMENT ON COLUMN warehouse.fct_spend_daily.account_key IS 'FK to warehouse.dim_account.';
COMMENT ON COLUMN warehouse.fct_spend_daily.campaign_key IS 'FK to warehouse.dim_campaign.';
COMMENT ON COLUMN warehouse.fct_spend_daily.ad_set_key IS 'FK to warehouse.dim_ad_set; nullable for campaign-level rows.';
COMMENT ON COLUMN warehouse.fct_spend_daily.platform_key IS 'FK to warehouse.dim_platform.';
COMMENT ON COLUMN warehouse.fct_spend_daily.spend IS 'Additive daily spend in account currency.';
COMMENT ON COLUMN warehouse.fct_spend_daily.impressions IS 'Additive daily impressions.';
COMMENT ON COLUMN warehouse.fct_spend_daily.clicks IS 'Additive daily clicks.';
COMMENT ON COLUMN warehouse.fct_spend_daily.conversions IS 'Additive daily platform-reported conversions.';
COMMENT ON COLUMN warehouse.fct_spend_daily.platform_revenue IS 'Additive platform-attributed revenue. Directional, NOT causal.';
COMMENT ON COLUMN warehouse.fct_spend_daily.currency IS 'ISO-4217 currency of the monetary measures.';
COMMENT ON COLUMN warehouse.fct_spend_daily._source IS 'Logical source identifier.';
COMMENT ON COLUMN warehouse.fct_spend_daily._loaded_at IS 'UTC timestamp the fact row was materialised.';
CREATE INDEX idx_fct_spend_daily_date     ON warehouse.fct_spend_daily (date_key);
CREATE INDEX idx_fct_spend_daily_account  ON warehouse.fct_spend_daily (account_key);
CREATE INDEX idx_fct_spend_daily_campaign ON warehouse.fct_spend_daily (campaign_key);
CREATE INDEX idx_fct_spend_daily_ad_set   ON warehouse.fct_spend_daily (ad_set_key);
CREATE INDEX idx_fct_spend_daily_platform ON warehouse.fct_spend_daily (platform_key);

-- ----------------------------------------------------------------------------
-- Fact: warehouse.fct_campaign_action -- accumulating-snapshot bridge linking
-- the governance layer (H0 packets) to the warehouse star schema.
-- ----------------------------------------------------------------------------
CREATE TABLE warehouse.fct_campaign_action (
  campaign_action_id bigint       GENERATED ALWAYS AS IDENTITY,
  proposed_date_key  integer      NOT NULL,
  decided_date_key   integer,
  measured_date_key  integer,
  account_key        bigint       NOT NULL,
  campaign_key       bigint       NOT NULL,
  platform_key       smallint     NOT NULL,
  h0_packet_id       uuid         NOT NULL,
  proposed_action_id uuid         NOT NULL,
  tx_id              text         NOT NULL,
  action_type        app.action_type NOT NULL,
  risk_level         app.risk_level  NOT NULL,
  policy_result      app.policy_result,
  approval_decision  app.approval_decision,
  estimated_impact   numeric(18,4),
  realized_impact    numeric(18,4),
  was_measured       boolean      NOT NULL DEFAULT false,
  _source            text         NOT NULL,
  _loaded_at         timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT pk_fct_campaign_action           PRIMARY KEY (campaign_action_id),
  CONSTRAINT fk_fct_campaign_action_pdate     FOREIGN KEY (proposed_date_key) REFERENCES warehouse.dim_date (date_key),
  CONSTRAINT fk_fct_campaign_action_ddate     FOREIGN KEY (decided_date_key)  REFERENCES warehouse.dim_date (date_key),
  CONSTRAINT fk_fct_campaign_action_mdate     FOREIGN KEY (measured_date_key) REFERENCES warehouse.dim_date (date_key),
  CONSTRAINT fk_fct_campaign_action_account   FOREIGN KEY (account_key)  REFERENCES warehouse.dim_account (account_key),
  CONSTRAINT fk_fct_campaign_action_campaign  FOREIGN KEY (campaign_key) REFERENCES warehouse.dim_campaign (campaign_key),
  CONSTRAINT fk_fct_campaign_action_platform  FOREIGN KEY (platform_key) REFERENCES warehouse.dim_platform (platform_key)
);
COMMENT ON TABLE warehouse.fct_campaign_action IS
  'Accumulating-snapshot fact bridging the governance layer to the warehouse. One row per proposed action, with milestone date keys (proposed/decided/measured) and estimated vs realized impact for verification reporting.';
COMMENT ON COLUMN warehouse.fct_campaign_action.campaign_action_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN warehouse.fct_campaign_action.proposed_date_key IS 'FK to warehouse.dim_date: day the action was proposed.';
COMMENT ON COLUMN warehouse.fct_campaign_action.decided_date_key IS 'FK to warehouse.dim_date: day the gate/approval decision was made; null until decided.';
COMMENT ON COLUMN warehouse.fct_campaign_action.measured_date_key IS 'FK to warehouse.dim_date: day the outcome was measured; null until measured.';
COMMENT ON COLUMN warehouse.fct_campaign_action.account_key IS 'FK to warehouse.dim_account.';
COMMENT ON COLUMN warehouse.fct_campaign_action.campaign_key IS 'FK to warehouse.dim_campaign.';
COMMENT ON COLUMN warehouse.fct_campaign_action.platform_key IS 'FK to warehouse.dim_platform.';
COMMENT ON COLUMN warehouse.fct_campaign_action.h0_packet_id IS 'The originating H0 packet (mirrors app.h0_packets.h0_packet_id).';
COMMENT ON COLUMN warehouse.fct_campaign_action.proposed_action_id IS 'The proposed action (mirrors app.proposed_actions.proposed_action_id).';
COMMENT ON COLUMN warehouse.fct_campaign_action.tx_id IS 'AdMatix transaction id; joins to the ledger.';
COMMENT ON COLUMN warehouse.fct_campaign_action.action_type IS 'Kind of action proposed.';
COMMENT ON COLUMN warehouse.fct_campaign_action.risk_level IS 'Risk level assigned to the action.';
COMMENT ON COLUMN warehouse.fct_campaign_action.policy_result IS 'PolicyGuard verdict; null until gated.';
COMMENT ON COLUMN warehouse.fct_campaign_action.approval_decision IS 'Human decision; null until decided or not required.';
COMMENT ON COLUMN warehouse.fct_campaign_action.estimated_impact IS 'Pre-action estimated impact on the success metric.';
COMMENT ON COLUMN warehouse.fct_campaign_action.realized_impact IS 'Measured realised impact; null until measured.';
COMMENT ON COLUMN warehouse.fct_campaign_action.was_measured IS 'True once an outcome measurement has been recorded.';
COMMENT ON COLUMN warehouse.fct_campaign_action._source IS 'Logical source identifier.';
COMMENT ON COLUMN warehouse.fct_campaign_action._loaded_at IS 'UTC timestamp the fact row was materialised.';
CREATE INDEX idx_fct_campaign_action_pdate    ON warehouse.fct_campaign_action (proposed_date_key);
CREATE INDEX idx_fct_campaign_action_account  ON warehouse.fct_campaign_action (account_key);
CREATE INDEX idx_fct_campaign_action_campaign ON warehouse.fct_campaign_action (campaign_key);
CREATE INDEX idx_fct_campaign_action_platform ON warehouse.fct_campaign_action (platform_key);
CREATE INDEX idx_fct_campaign_action_packet   ON warehouse.fct_campaign_action (h0_packet_id);
CREATE INDEX idx_fct_campaign_action_action   ON warehouse.fct_campaign_action (proposed_action_id);
CREATE INDEX idx_fct_campaign_action_tx_id    ON warehouse.fct_campaign_action (tx_id);
CREATE INDEX idx_fct_campaign_action_measured ON warehouse.fct_campaign_action (was_measured);

-- ----------------------------------------------------------------------------
-- Fact: warehouse.fct_outcome -- periodic-snapshot fact for measured outcomes,
-- including estimated incremental lift and (where known) ground truth.
-- ----------------------------------------------------------------------------
CREATE TABLE warehouse.fct_outcome (
  outcome_id          bigint        GENERATED ALWAYS AS IDENTITY,
  date_key            integer       NOT NULL,
  account_key         bigint        NOT NULL,
  campaign_key        bigint,
  platform_key        smallint      NOT NULL,
  h0_packet_id        uuid,
  tx_id               text,
  success_metric      text          NOT NULL,
  baseline_value      numeric(18,6),
  observed_value      numeric(18,6),
  delta_pct           numeric(12,6),
  estimated_lift      numeric(18,6),
  lift_ci_low         numeric(18,6),
  lift_ci_high        numeric(18,6),
  ground_truth_lift   numeric(18,6),
  causal_status       app.causal_status NOT NULL DEFAULT 'directional_until_lift_test',
  passed              boolean,
  _source             text          NOT NULL,
  _loaded_at          timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_fct_outcome          PRIMARY KEY (outcome_id),
  CONSTRAINT fk_fct_outcome_date     FOREIGN KEY (date_key)     REFERENCES warehouse.dim_date (date_key),
  CONSTRAINT fk_fct_outcome_account  FOREIGN KEY (account_key)  REFERENCES warehouse.dim_account (account_key),
  CONSTRAINT fk_fct_outcome_campaign FOREIGN KEY (campaign_key) REFERENCES warehouse.dim_campaign (campaign_key),
  CONSTRAINT fk_fct_outcome_platform FOREIGN KEY (platform_key) REFERENCES warehouse.dim_platform (platform_key),
  CONSTRAINT ck_fct_outcome_lift_ci  CHECK (lift_ci_high IS NULL OR lift_ci_low IS NULL OR lift_ci_high >= lift_ci_low)
);
COMMENT ON TABLE warehouse.fct_outcome IS
  'Periodic-snapshot outcome fact. Records measured outcomes and estimated incremental lift with confidence bounds. ground_truth_lift is populated only for simulator-sourced rows where the true effect is known, enabling verification accuracy metrics.';
COMMENT ON COLUMN warehouse.fct_outcome.outcome_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN warehouse.fct_outcome.date_key IS 'FK to warehouse.dim_date (measurement day).';
COMMENT ON COLUMN warehouse.fct_outcome.account_key IS 'FK to warehouse.dim_account.';
COMMENT ON COLUMN warehouse.fct_outcome.campaign_key IS 'FK to warehouse.dim_campaign; nullable for account-level outcomes.';
COMMENT ON COLUMN warehouse.fct_outcome.platform_key IS 'FK to warehouse.dim_platform.';
COMMENT ON COLUMN warehouse.fct_outcome.h0_packet_id IS 'Originating H0 packet, if the outcome measures a packet; nullable.';
COMMENT ON COLUMN warehouse.fct_outcome.tx_id IS 'AdMatix transaction id; joins to the ledger.';
COMMENT ON COLUMN warehouse.fct_outcome.success_metric IS 'The metric measured.';
COMMENT ON COLUMN warehouse.fct_outcome.baseline_value IS 'Metric value over the baseline window.';
COMMENT ON COLUMN warehouse.fct_outcome.observed_value IS 'Metric value over the measurement window.';
COMMENT ON COLUMN warehouse.fct_outcome.delta_pct IS 'Percentage change from baseline to observed.';
COMMENT ON COLUMN warehouse.fct_outcome.estimated_lift IS 'Estimated incremental lift attributable to the action.';
COMMENT ON COLUMN warehouse.fct_outcome.lift_ci_low IS 'Lower bound of the confidence interval on estimated lift.';
COMMENT ON COLUMN warehouse.fct_outcome.lift_ci_high IS 'Upper bound of the confidence interval on estimated lift.';
COMMENT ON COLUMN warehouse.fct_outcome.ground_truth_lift IS 'True incremental lift; populated only for simulator rows (sim.true_effects). Null for real-world rows where truth is unknowable.';
COMMENT ON COLUMN warehouse.fct_outcome.causal_status IS 'Strength of the causal claim for this outcome.';
COMMENT ON COLUMN warehouse.fct_outcome.passed IS 'True if the outcome met the success criterion; null until evaluated.';
COMMENT ON COLUMN warehouse.fct_outcome._source IS 'Logical source identifier.';
COMMENT ON COLUMN warehouse.fct_outcome._loaded_at IS 'UTC timestamp the fact row was materialised.';
CREATE INDEX idx_fct_outcome_date     ON warehouse.fct_outcome (date_key);
CREATE INDEX idx_fct_outcome_account  ON warehouse.fct_outcome (account_key);
CREATE INDEX idx_fct_outcome_campaign ON warehouse.fct_outcome (campaign_key);
CREATE INDEX idx_fct_outcome_platform ON warehouse.fct_outcome (platform_key);
CREATE INDEX idx_fct_outcome_packet   ON warehouse.fct_outcome (h0_packet_id);
CREATE INDEX idx_fct_outcome_tx_id    ON warehouse.fct_outcome (tx_id);
CREATE INDEX idx_fct_outcome_causal   ON warehouse.fct_outcome (causal_status);

-- ----------------------------------------------------------------------------
-- Privileges for the warehouse schema.
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA warehouse TO admatix_app, admatix_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA warehouse TO admatix_app;
GRANT SELECT ON ALL TABLES IN SCHEMA warehouse TO admatix_readonly;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA warehouse TO admatix_app;
```


---

## Part 6 — `sim` and `bench` Schemas

The `sim` schema holds the AdMatix simulator: scenarios, synthetic campaigns,
the hidden ground-truth incremental lift, and the emitted event stream. The
`bench` schema holds the verification benchmark: tasks, runs, results, and
ground-truth answers. Together they let AdMatix measure whether its causal
claims are actually correct against a known truth.

```sql
-- ============================================================================
-- AdMatix Data Layer -- Part 6: sim and bench schemas
-- Simulator (known ground truth) + verification benchmark.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS sim;
COMMENT ON SCHEMA sim IS
  'The AdMatix simulator. Generates synthetic ad campaigns with a known, hidden ground-truth incremental lift, so verification accuracy can be measured against truth. The only data source where causal effects are known exactly.';

CREATE SCHEMA IF NOT EXISTS bench;
COMMENT ON SCHEMA bench IS
  'The AdMatix verification benchmark. Defines tasks (including unsafe ones the system must block), records benchmark runs with pinned inputs, stores per-task results, and holds the ground-truth answers used to score runs.';

-- ----------------------------------------------------------------------------
-- Enums for sim and bench.
-- ----------------------------------------------------------------------------
CREATE TYPE sim.event_type AS ENUM ('impression', 'click', 'conversion', 'spend');
COMMENT ON TYPE sim.event_type IS
  'Type of a simulated event emitted into sim.events.';

CREATE TYPE sim.treatment_arm AS ENUM ('treatment', 'control', 'holdout');
COMMENT ON TYPE sim.treatment_arm IS
  'The experimental arm a simulated unit is assigned to.';

CREATE TYPE bench.task_kind AS ENUM ('audit', 'safety', 'evidence', 'state_diff', 'policy');
COMMENT ON TYPE bench.task_kind IS
  'Category of a benchmark task. Mirrors BenchmarkTask.kind in @admatix/schemas.';

-- ----------------------------------------------------------------------------
-- Table: sim.scenarios -- a configured simulation scenario.
-- ----------------------------------------------------------------------------
CREATE TABLE sim.scenarios (
  scenario_id     uuid          NOT NULL DEFAULT gen_random_uuid(),
  scenario_key    text          NOT NULL,
  name            text          NOT NULL,
  description     text,
  random_seed     bigint        NOT NULL,
  horizon_days    integer       NOT NULL DEFAULT 30,
  config          jsonb         NOT NULL DEFAULT '{}'::jsonb,
  config_hash     char(64)      NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_sim_scenarios        PRIMARY KEY (scenario_id),
  CONSTRAINT uq_sim_scenarios_key    UNIQUE (scenario_key),
  CONSTRAINT ck_sim_scenarios_horizon CHECK (horizon_days > 0),
  CONSTRAINT ck_sim_scenarios_hash_hex CHECK (config_hash ~ '^[0-9a-f]{64}$')
);
COMMENT ON TABLE sim.scenarios IS
  'A configured simulation scenario. random_seed and config_hash make every scenario fully reproducible.';
COMMENT ON COLUMN sim.scenarios.scenario_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN sim.scenarios.scenario_key IS 'Stable human-readable scenario identifier.';
COMMENT ON COLUMN sim.scenarios.name IS 'Human-readable scenario name.';
COMMENT ON COLUMN sim.scenarios.description IS 'Description of what the scenario exercises.';
COMMENT ON COLUMN sim.scenarios.random_seed IS 'RNG seed; fixing it makes the scenario deterministic and reproducible.';
COMMENT ON COLUMN sim.scenarios.horizon_days IS 'Number of simulated days the scenario runs.';
COMMENT ON COLUMN sim.scenarios.config IS 'Full scenario configuration as jsonb (market params, noise, agent behaviours).';
COMMENT ON COLUMN sim.scenarios.config_hash IS 'SHA-256 (hex) of the config, for integrity and reproducibility checks.';
COMMENT ON COLUMN sim.scenarios.created_at IS 'UTC creation timestamp.';
CREATE INDEX idx_sim_scenarios_key ON sim.scenarios (scenario_key);

-- ----------------------------------------------------------------------------
-- Table: sim.campaigns -- a synthetic campaign within a scenario.
-- ----------------------------------------------------------------------------
CREATE TABLE sim.campaigns (
  sim_campaign_id   uuid          NOT NULL DEFAULT gen_random_uuid(),
  scenario_id       uuid          NOT NULL,
  sim_campaign_key  text          NOT NULL,
  name              text          NOT NULL,
  channel           text          NOT NULL,
  daily_budget      numeric(18,4) NOT NULL DEFAULT 0,
  base_ctr          numeric(10,8) NOT NULL DEFAULT 0,
  base_cvr          numeric(10,8) NOT NULL DEFAULT 0,
  base_aov          numeric(18,4) NOT NULL DEFAULT 0,
  params            jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_sim_campaigns          PRIMARY KEY (sim_campaign_id),
  CONSTRAINT fk_sim_campaigns_scenario FOREIGN KEY (scenario_id)
                                       REFERENCES sim.scenarios (scenario_id) ON DELETE CASCADE,
  CONSTRAINT uq_sim_campaigns_key      UNIQUE (scenario_id, sim_campaign_key)
);
COMMENT ON TABLE sim.campaigns IS
  'A synthetic campaign within a simulation scenario. Carries the base-rate parameters (CTR, CVR, AOV) the simulator draws events from.';
COMMENT ON COLUMN sim.campaigns.sim_campaign_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN sim.campaigns.scenario_id IS 'Parent scenario (FK sim.scenarios).';
COMMENT ON COLUMN sim.campaigns.sim_campaign_key IS 'Human-readable campaign key, unique within a scenario.';
COMMENT ON COLUMN sim.campaigns.name IS 'Human-readable campaign name.';
COMMENT ON COLUMN sim.campaigns.channel IS 'Simulated channel (search, social, display, ...).';
COMMENT ON COLUMN sim.campaigns.daily_budget IS 'Simulated daily budget.';
COMMENT ON COLUMN sim.campaigns.base_ctr IS 'Baseline click-through rate the simulator draws from.';
COMMENT ON COLUMN sim.campaigns.base_cvr IS 'Baseline conversion rate the simulator draws from.';
COMMENT ON COLUMN sim.campaigns.base_aov IS 'Baseline average order value the simulator draws from.';
COMMENT ON COLUMN sim.campaigns.params IS 'Additional campaign-specific simulation parameters as jsonb.';
COMMENT ON COLUMN sim.campaigns.created_at IS 'UTC creation timestamp.';
CREATE INDEX idx_sim_campaigns_scenario ON sim.campaigns (scenario_id);
CREATE INDEX idx_sim_campaigns_key      ON sim.campaigns (sim_campaign_key);

-- ----------------------------------------------------------------------------
-- Table: sim.true_effects -- the hidden ground-truth incremental lift.
-- This is the answer key. The verifier must never read it; the scorer does.
-- ----------------------------------------------------------------------------
CREATE TABLE sim.true_effects (
  true_effect_id    uuid          NOT NULL DEFAULT gen_random_uuid(),
  scenario_id       uuid          NOT NULL,
  sim_campaign_id   uuid          NOT NULL,
  intervention_key  text          NOT NULL,
  metric            text          NOT NULL,
  true_incremental_lift numeric(18,8) NOT NULL,
  true_lift_pct     numeric(12,8),
  true_baseline     numeric(18,8),
  effect_start_day  integer       NOT NULL DEFAULT 0,
  effect_end_day    integer,
  noise_sd          numeric(18,8) NOT NULL DEFAULT 0,
  notes             text,
  created_at        timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_sim_true_effects          PRIMARY KEY (true_effect_id),
  CONSTRAINT fk_sim_true_effects_scenario FOREIGN KEY (scenario_id)
                                          REFERENCES sim.scenarios (scenario_id) ON DELETE CASCADE,
  CONSTRAINT fk_sim_true_effects_campaign FOREIGN KEY (sim_campaign_id)
                                          REFERENCES sim.campaigns (sim_campaign_id) ON DELETE CASCADE,
  CONSTRAINT uq_sim_true_effects          UNIQUE (sim_campaign_id, intervention_key, metric)
);
COMMENT ON TABLE sim.true_effects IS
  'The hidden ground-truth incremental lift for each simulated intervention -- the answer key. The verification pipeline must NOT read this table; only the scorer reads it to grade the verifier estimate against truth.';
COMMENT ON COLUMN sim.true_effects.true_effect_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN sim.true_effects.scenario_id IS 'Parent scenario (FK sim.scenarios).';
COMMENT ON COLUMN sim.true_effects.sim_campaign_id IS 'Simulated campaign the effect applies to (FK sim.campaigns).';
COMMENT ON COLUMN sim.true_effects.intervention_key IS 'Identifier of the intervention whose true effect this row records (e.g. "budget_+20pct").';
COMMENT ON COLUMN sim.true_effects.metric IS 'The metric the effect is expressed on (conversions, revenue, ...).';
COMMENT ON COLUMN sim.true_effects.true_incremental_lift IS 'The true incremental lift in absolute metric units. The ground truth.';
COMMENT ON COLUMN sim.true_effects.true_lift_pct IS 'The true incremental lift as a percentage of baseline.';
COMMENT ON COLUMN sim.true_effects.true_baseline IS 'The true counterfactual baseline (metric value with no intervention).';
COMMENT ON COLUMN sim.true_effects.effect_start_day IS 'Simulated day the effect begins.';
COMMENT ON COLUMN sim.true_effects.effect_end_day IS 'Simulated day the effect ends; null if it persists to the horizon.';
COMMENT ON COLUMN sim.true_effects.noise_sd IS 'Standard deviation of the noise the simulator adds around the true effect.';
COMMENT ON COLUMN sim.true_effects.notes IS 'Optional notes on how the effect was configured.';
COMMENT ON COLUMN sim.true_effects.created_at IS 'UTC creation timestamp.';
CREATE INDEX idx_sim_true_effects_scenario ON sim.true_effects (scenario_id);
CREATE INDEX idx_sim_true_effects_campaign ON sim.true_effects (sim_campaign_id);
CREATE INDEX idx_sim_true_effects_metric   ON sim.true_effects (metric);

-- ----------------------------------------------------------------------------
-- Table: sim.events -- the event stream emitted by the simulator.
-- ----------------------------------------------------------------------------
CREATE TABLE sim.events (
  sim_event_id    bigint          GENERATED ALWAYS AS IDENTITY,
  scenario_id     uuid            NOT NULL,
  sim_campaign_id uuid            NOT NULL,
  true_effect_id  uuid,
  event_type      sim.event_type  NOT NULL,
  treatment_arm   sim.treatment_arm NOT NULL,
  sim_day         integer         NOT NULL,
  event_ts        timestamptz     NOT NULL,
  user_key        text            NOT NULL,
  quantity        numeric(18,6)   NOT NULL DEFAULT 1,
  spend           numeric(18,6)   NOT NULL DEFAULT 0,
  revenue         numeric(18,6)   NOT NULL DEFAULT 0,
  attributes      jsonb           NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT pk_sim_events           PRIMARY KEY (sim_event_id),
  CONSTRAINT fk_sim_events_scenario  FOREIGN KEY (scenario_id)
                                     REFERENCES sim.scenarios (scenario_id) ON DELETE CASCADE,
  CONSTRAINT fk_sim_events_campaign  FOREIGN KEY (sim_campaign_id)
                                     REFERENCES sim.campaigns (sim_campaign_id) ON DELETE CASCADE,
  CONSTRAINT fk_sim_events_effect    FOREIGN KEY (true_effect_id)
                                     REFERENCES sim.true_effects (true_effect_id) ON DELETE SET NULL
);
COMMENT ON TABLE sim.events IS
  'The event stream produced by the simulator: impressions, clicks, conversions and spend, each tagged with the treatment arm. This is the observable data the verifier consumes; the true effect behind it lives in sim.true_effects.';
COMMENT ON COLUMN sim.events.sim_event_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN sim.events.scenario_id IS 'Parent scenario (FK sim.scenarios).';
COMMENT ON COLUMN sim.events.sim_campaign_id IS 'Simulated campaign the event belongs to (FK sim.campaigns).';
COMMENT ON COLUMN sim.events.true_effect_id IS 'The true effect that generated this event, if any (FK sim.true_effects). Used only by the scorer.';
COMMENT ON COLUMN sim.events.event_type IS 'Event type: impression | click | conversion | spend.';
COMMENT ON COLUMN sim.events.treatment_arm IS 'Experimental arm of the user: treatment | control | holdout.';
COMMENT ON COLUMN sim.events.sim_day IS 'Simulated day index within the scenario horizon.';
COMMENT ON COLUMN sim.events.event_ts IS 'UTC timestamp of the simulated event.';
COMMENT ON COLUMN sim.events.user_key IS 'Synthetic user identifier.';
COMMENT ON COLUMN sim.events.quantity IS 'Event quantity (1 per discrete event; supports fractional credit).';
COMMENT ON COLUMN sim.events.spend IS 'Spend attributed to the event.';
COMMENT ON COLUMN sim.events.revenue IS 'Revenue attributed to the event.';
COMMENT ON COLUMN sim.events.attributes IS 'Additional simulated event attributes as jsonb.';
COMMENT ON COLUMN sim.events.created_at IS 'UTC timestamp the event row was written.';
CREATE INDEX idx_sim_events_scenario  ON sim.events (scenario_id);
CREATE INDEX idx_sim_events_campaign  ON sim.events (sim_campaign_id);
CREATE INDEX idx_sim_events_effect    ON sim.events (true_effect_id);
CREATE INDEX idx_sim_events_type      ON sim.events (event_type);
CREATE INDEX idx_sim_events_arm       ON sim.events (treatment_arm);
CREATE INDEX idx_sim_events_day       ON sim.events (sim_day);
CREATE INDEX idx_sim_events_ts        ON sim.events (event_ts);
CREATE INDEX idx_sim_events_user      ON sim.events (user_key);

-- ----------------------------------------------------------------------------
-- Table: bench.tasks -- a single benchmark task.
-- ----------------------------------------------------------------------------
CREATE TABLE bench.tasks (
  task_id        uuid           NOT NULL DEFAULT gen_random_uuid(),
  task_key       text           NOT NULL,
  suite          text           NOT NULL,
  kind           bench.task_kind NOT NULL,
  description    text           NOT NULL,
  fixture        text           NOT NULL,
  expected       jsonb          NOT NULL DEFAULT '{}'::jsonb,
  is_unsafe      boolean        NOT NULL DEFAULT false,
  created_at     timestamptz    NOT NULL DEFAULT now(),
  updated_at     timestamptz    NOT NULL DEFAULT now(),

  CONSTRAINT pk_bench_tasks      PRIMARY KEY (task_id),
  CONSTRAINT uq_bench_tasks_key  UNIQUE (suite, task_key)
);
COMMENT ON TABLE bench.tasks IS
  'A single benchmark task. Unsafe tasks (is_unsafe = true) MUST be blocked by the system to count as passed.';
COMMENT ON COLUMN bench.tasks.task_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN bench.tasks.task_key IS 'Stable human-readable task identifier, unique within a suite.';
COMMENT ON COLUMN bench.tasks.suite IS 'Benchmark suite the task belongs to.';
COMMENT ON COLUMN bench.tasks.kind IS 'Task category: audit | safety | evidence | state_diff | policy.';
COMMENT ON COLUMN bench.tasks.description IS 'Human-readable description of what the task tests.';
COMMENT ON COLUMN bench.tasks.fixture IS 'Identifier of the fixture/dataset the task runs against.';
COMMENT ON COLUMN bench.tasks.expected IS 'Expected outcome as jsonb, used to score a run.';
COMMENT ON COLUMN bench.tasks.is_unsafe IS 'True if the task represents an unsafe request the system must block.';
COMMENT ON COLUMN bench.tasks.created_at IS 'UTC creation timestamp.';
COMMENT ON COLUMN bench.tasks.updated_at IS 'UTC timestamp of the last mutation (maintained by trigger).';
CREATE INDEX idx_bench_tasks_suite  ON bench.tasks (suite);
CREATE INDEX idx_bench_tasks_kind   ON bench.tasks (kind);
CREATE INDEX idx_bench_tasks_unsafe ON bench.tasks (is_unsafe);
CREATE TRIGGER trg_bench_tasks_touch BEFORE UPDATE ON bench.tasks
  FOR EACH ROW EXECUTE FUNCTION public.admatix_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Table: bench.runs -- one execution of a benchmark suite with pinned inputs.
-- ----------------------------------------------------------------------------
CREATE TABLE bench.runs (
  run_id           uuid          NOT NULL DEFAULT gen_random_uuid(),
  suite            text          NOT NULL,
  fixture_version  text          NOT NULL,
  code_version     text          NOT NULL,
  policy_version   text          NOT NULL,
  model            text          NOT NULL,
  summary          jsonb         NOT NULL DEFAULT '{}'::jsonb,
  pass_count       integer       NOT NULL DEFAULT 0,
  fail_count       integer       NOT NULL DEFAULT 0,
  started_at       timestamptz   NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  created_at       timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_bench_runs       PRIMARY KEY (run_id),
  CONSTRAINT ck_bench_runs_counts CHECK (pass_count >= 0 AND fail_count >= 0)
);
COMMENT ON TABLE bench.runs IS
  'One execution of a benchmark suite. Pins fixture, code, policy and model versions so results are reproducible and comparable across runs.';
COMMENT ON COLUMN bench.runs.run_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN bench.runs.suite IS 'Benchmark suite executed.';
COMMENT ON COLUMN bench.runs.fixture_version IS 'Pinned fixture/dataset version.';
COMMENT ON COLUMN bench.runs.code_version IS 'Pinned AdMatix code version (git sha or tag).';
COMMENT ON COLUMN bench.runs.policy_version IS 'Pinned policy version in force during the run.';
COMMENT ON COLUMN bench.runs.model IS 'Pinned model id used during the run.';
COMMENT ON COLUMN bench.runs.summary IS 'jsonb map of aggregate metric -> value for the run.';
COMMENT ON COLUMN bench.runs.pass_count IS 'Number of tasks that passed.';
COMMENT ON COLUMN bench.runs.fail_count IS 'Number of tasks that failed.';
COMMENT ON COLUMN bench.runs.started_at IS 'UTC timestamp the run began.';
COMMENT ON COLUMN bench.runs.finished_at IS 'UTC timestamp the run completed; null while in progress.';
COMMENT ON COLUMN bench.runs.created_at IS 'UTC timestamp the run row was written.';
CREATE INDEX idx_bench_runs_suite      ON bench.runs (suite);
CREATE INDEX idx_bench_runs_model      ON bench.runs (model);
CREATE INDEX idx_bench_runs_started_at ON bench.runs (started_at);

-- ----------------------------------------------------------------------------
-- Table: bench.results -- the per-task result within a run.
-- ----------------------------------------------------------------------------
CREATE TABLE bench.results (
  result_id              uuid          NOT NULL DEFAULT gen_random_uuid(),
  run_id                 uuid          NOT NULL,
  task_id                uuid          NOT NULL,
  passed                 boolean       NOT NULL,
  score                  numeric(5,4)  NOT NULL DEFAULT 0,
  unsafe_write_attempted boolean       NOT NULL DEFAULT false,
  budget_cap_violation   boolean       NOT NULL DEFAULT false,
  hallucinated_id        boolean       NOT NULL DEFAULT false,
  evidence_coverage      numeric(5,4)  NOT NULL DEFAULT 0,
  rollback_coverage      numeric(5,4)  NOT NULL DEFAULT 0,
  notes                  text[]        NOT NULL DEFAULT '{}',
  output                 jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_at             timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_bench_results        PRIMARY KEY (result_id),
  CONSTRAINT fk_bench_results_run    FOREIGN KEY (run_id)
                                     REFERENCES bench.runs (run_id) ON DELETE CASCADE,
  CONSTRAINT fk_bench_results_task   FOREIGN KEY (task_id)
                                     REFERENCES bench.tasks (task_id) ON DELETE CASCADE,
  CONSTRAINT uq_bench_results        UNIQUE (run_id, task_id),
  CONSTRAINT ck_bench_results_score  CHECK (score >= 0 AND score <= 1),
  CONSTRAINT ck_bench_results_evidence_cov CHECK (evidence_coverage >= 0 AND evidence_coverage <= 1),
  CONSTRAINT ck_bench_results_rollback_cov CHECK (rollback_coverage >= 0 AND rollback_coverage <= 1)
);
COMMENT ON TABLE bench.results IS
  'The result of one task within one benchmark run. Captures the pass/fail verdict, score, and the safety counters that gate AdMatix release decisions.';
COMMENT ON COLUMN bench.results.result_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN bench.results.run_id IS 'The run this result belongs to (FK bench.runs).';
COMMENT ON COLUMN bench.results.task_id IS 'The task this result scores (FK bench.tasks).';
COMMENT ON COLUMN bench.results.passed IS 'True if the task passed.';
COMMENT ON COLUMN bench.results.score IS 'Continuous score in [0,1] for the task.';
COMMENT ON COLUMN bench.results.unsafe_write_attempted IS 'True if the system attempted an unsafe write (an automatic fail).';
COMMENT ON COLUMN bench.results.budget_cap_violation IS 'True if a budget cap was violated.';
COMMENT ON COLUMN bench.results.hallucinated_id IS 'True if the system referenced a non-existent entity id.';
COMMENT ON COLUMN bench.results.evidence_coverage IS 'Fraction of claims backed by valid evidence refs, in [0,1].';
COMMENT ON COLUMN bench.results.rollback_coverage IS 'Fraction of actions carrying a valid rollback, in [0,1].';
COMMENT ON COLUMN bench.results.notes IS 'Array of free-text notes on the result.';
COMMENT ON COLUMN bench.results.output IS 'Full system output for the task as jsonb, for inspection and replay.';
COMMENT ON COLUMN bench.results.created_at IS 'UTC timestamp the result was written.';
CREATE INDEX idx_bench_results_run_id  ON bench.results (run_id);
CREATE INDEX idx_bench_results_task_id ON bench.results (task_id);
CREATE INDEX idx_bench_results_passed  ON bench.results (passed);

-- ----------------------------------------------------------------------------
-- Table: bench.ground_truth -- the canonical answer key for benchmark tasks.
-- ----------------------------------------------------------------------------
CREATE TABLE bench.ground_truth (
  ground_truth_id   uuid          NOT NULL DEFAULT gen_random_uuid(),
  task_id           uuid          NOT NULL,
  scenario_id       uuid,
  true_effect_id    uuid,
  answer_key        jsonb         NOT NULL DEFAULT '{}'::jsonb,
  expected_verdict  text          NOT NULL,
  expected_lift     numeric(18,8),
  tolerance         numeric(18,8) NOT NULL DEFAULT 0,
  rationale         text,
  created_at        timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_bench_ground_truth        PRIMARY KEY (ground_truth_id),
  CONSTRAINT fk_bench_ground_truth_task   FOREIGN KEY (task_id)
                                          REFERENCES bench.tasks (task_id) ON DELETE CASCADE,
  CONSTRAINT fk_bench_ground_truth_scenario FOREIGN KEY (scenario_id)
                                          REFERENCES sim.scenarios (scenario_id) ON DELETE SET NULL,
  CONSTRAINT fk_bench_ground_truth_effect FOREIGN KEY (true_effect_id)
                                          REFERENCES sim.true_effects (true_effect_id) ON DELETE SET NULL,
  CONSTRAINT uq_bench_ground_truth_task   UNIQUE (task_id)
);
COMMENT ON TABLE bench.ground_truth IS
  'The canonical answer key for a benchmark task. For simulator-backed tasks it links to sim.true_effects so the scorer can compare an estimate against the known truth within tolerance.';
COMMENT ON COLUMN bench.ground_truth.ground_truth_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN bench.ground_truth.task_id IS 'The task this answer key belongs to (FK bench.tasks).';
COMMENT ON COLUMN bench.ground_truth.scenario_id IS 'Simulator scenario backing the task, if any (FK sim.scenarios).';
COMMENT ON COLUMN bench.ground_truth.true_effect_id IS 'The specific true effect this task is graded against (FK sim.true_effects).';
COMMENT ON COLUMN bench.ground_truth.answer_key IS 'Full expected answer as jsonb.';
COMMENT ON COLUMN bench.ground_truth.expected_verdict IS 'The expected high-level verdict (e.g. "block", "allow", "flag_waste").';
COMMENT ON COLUMN bench.ground_truth.expected_lift IS 'The expected incremental lift value, where the task scores a numeric estimate.';
COMMENT ON COLUMN bench.ground_truth.tolerance IS 'Allowed absolute deviation of an estimate from expected_lift to still pass.';
COMMENT ON COLUMN bench.ground_truth.rationale IS 'Explanation of why this is the correct answer.';
COMMENT ON COLUMN bench.ground_truth.created_at IS 'UTC creation timestamp.';
CREATE INDEX idx_bench_ground_truth_task     ON bench.ground_truth (task_id);
CREATE INDEX idx_bench_ground_truth_scenario ON bench.ground_truth (scenario_id);
CREATE INDEX idx_bench_ground_truth_effect   ON bench.ground_truth (true_effect_id);

-- ----------------------------------------------------------------------------
-- Privileges for the sim and bench schemas.
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA sim, bench TO admatix_app, admatix_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sim   TO admatix_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA bench TO admatix_app;
GRANT SELECT ON ALL TABLES IN SCHEMA sim   TO admatix_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA bench TO admatix_readonly;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA sim   TO admatix_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA bench TO admatix_app;

-- NOTE on sim.true_effects: it is the answer key. The verification pipeline
-- role must not read it. In production, run the verifier under a dedicated
-- role and add:
--   REVOKE SELECT ON sim.true_effects FROM admatix_verifier;
-- so the verifier physically cannot see ground truth. Only the scorer role
-- retains SELECT on sim.true_effects and bench.ground_truth.
```

---

## Part 7 — Running It + dbt Notes

### Applying the DDL

The parts above are designed to be concatenated into a single migration file
(for example `db/migrations/0001_admatix_data_layer.sql`) and applied with
`psql` against the Supabase Postgres 17 connection string:

```bash
# SUPABASE_DB_URL is the direct (non-pooled) connection string from the
# Supabase dashboard: postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f db/migrations/0001_admatix_data_layer.sql
```

Notes for the automated build agent:

- Apply parts strictly in order (0 to 6). Part 0 must run first because the
  `ledger` and `app` triggers depend on `public.admatix_sha256_*` and
  `pgcrypto`.
- `-v ON_ERROR_STOP=1` makes `psql` abort on the first error so a partial
  migration is never silently accepted.
- Run against the **direct** connection (port 5432), not the transaction
  pooler (port 6543); DDL and `CREATE ROLE` need a real session.
- The script is idempotent at the schema level (`CREATE SCHEMA IF NOT EXISTS`,
  `CREATE EXTENSION IF NOT EXISTS`, role-existence guards) but `CREATE TABLE`
  and `CREATE TYPE` are not. For re-runnable migrations, wrap each part in its
  own versioned migration file rather than re-applying this one.
- After applying, verify the ledger immutability guarantee:

  ```sql
  -- Should raise: "ledger.action_events is append-only: UPDATE is not permitted"
  UPDATE ledger.action_events SET payload = '{}'::jsonb WHERE seq = 1;
  ```

- Supabase Row Level Security: this DDL does not enable RLS. If the API exposes
  these tables through PostgREST/Supabase client SDKs, enable RLS per table and
  add tenant-scoped policies. Service-role access through `admatix_app` bypasses
  RLS and is the intended path for the backend.

### dbt ownership of bronze / silver / gold

The physical tables in the `warehouse` schema are defined here so foreign keys,
indexes, and comments are committed and reviewable, but the **transforms** that
populate them are owned by dbt:

- **Bronze** tables are load targets. An ingestion job (or dbt `seed` /
  external loader) lands raw rows; dbt treats bronze tables as `sources` in
  `sources.yml` and runs freshness checks (`_loaded_at`) against them.
- **Silver** models are dbt incremental models that read bronze sources, apply
  typing and conforming, and deduplicate on the documented natural keys
  (`unique_key` in the model config matches the `uq_silver_*` constraints).
- **Gold** dimensions and facts are dbt models:
  - SCD2 dimensions (`dim_campaign`, `dim_ad_set`, `dim_creative`) are built
    with dbt snapshots (`dbt snapshot`) using the `check` strategy keyed on the
    `row_hash` column, or with `dbt_utils` SCD macros. The `valid_from`,
    `valid_to`, `is_current`, and surrogate-key columns in this DDL match the
    snapshot output contract.
  - Facts are incremental models keyed on their surrogate identity / unique
    constraints, joining silver to the dimensions on business keys to resolve
    surrogate foreign keys.
- Keep the `dbt` model contracts (`schema.yml` `data_type` and `constraints`)
  aligned with this DDL. Where dbt manages a table directly, set
  `materialized: incremental` and `on_schema_change: append_new_columns` so the
  committed DDL and the dbt-managed shape do not drift.
- The `ledger`, `app`, `sim`, and `bench` schemas are **not** dbt-managed. They
  are written by the AdMatix application and the simulator/benchmark harness.
  dbt may declare them as read-only `sources` for analytics models (e.g. to
  build `fct_campaign_action` and `fct_outcome` in gold from `app` and `sim`).

### Suggested repository layout

```
db/
  migrations/
    0001_admatix_data_layer.sql      # parts 0-6 concatenated
  README.md                          # this document
warehouse/                            # dbt project
  models/
    silver/                          # bronze -> silver incremental models
    gold/
      dims/                          # dim_* models + snapshots
      facts/                         # fct_* incremental models
  snapshots/                         # SCD2 snapshots for campaign/ad_set/creative
  seeds/
    dim_date.csv                     # calendar seed
    dim_platform.csv                 # platform lookup seed
  sources.yml                        # bronze tables + app/sim/bench as sources
```
