BEGIN;

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
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'ad_platform'
  ) THEN
    CREATE TYPE app.ad_platform AS ENUM (
      'google_ads', 'meta_ads', 'tiktok_ads', 'dv360',
      'trade_desk', 'linkedin_ads', 'amazon_ads', 'first_party'
    );
  END IF;
END;
$$;
COMMENT ON TYPE app.ad_platform IS
  'Ad platforms AdMatix can read from. first_party is the truth source for MER. Mirrors the Platform enum in @admatix/schemas.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'entity_status'
  ) THEN
    CREATE TYPE app.entity_status AS ENUM ('active', 'paused', 'removed', 'draft');
  END IF;
END;
$$;
COMMENT ON TYPE app.entity_status IS
  'Lifecycle status of a connected ad entity (account/campaign/ad set/creative).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'connection_status'
  ) THEN
    CREATE TYPE app.connection_status AS ENUM ('pending', 'active', 'expired', 'revoked', 'error');
  END IF;
END;
$$;
COMMENT ON TYPE app.connection_status IS
  'Health of a stored platform credential connection.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'h0_state'
  ) THEN
    CREATE TYPE app.h0_state AS ENUM (
      'draft', 'validated', 'pending_approval', 'approved', 'rejected', 'measured', 'reflected'
    );
  END IF;
END;
$$;
COMMENT ON TYPE app.h0_state IS
  'Lifecycle state of an H0 packet through the plan/activate/measure/reflect loop.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'causal_status'
  ) THEN
    CREATE TYPE app.causal_status AS ENUM (
      'directional_until_lift_test', 'experimental', 'causal'
    );
  END IF;
END;
$$;
COMMENT ON TYPE app.causal_status IS
  'Strength of a causal claim. Detectors default to directional_until_lift_test. Mirrors CausalStatus in @admatix/schemas.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'action_type'
  ) THEN
    CREATE TYPE app.action_type AS ENUM (
      'budget_shift', 'pause_entity', 'resume_entity', 'bid_adjust',
      'add_negative_keyword', 'creative_rotate', 'no_op'
    );
  END IF;
END;
$$;
COMMENT ON TYPE app.action_type IS
  'The kind of change a proposed action represents. Mirrors ActionType in @admatix/schemas.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'risk_level'
  ) THEN
    CREATE TYPE app.risk_level AS ENUM ('low', 'medium', 'high');
  END IF;
END;
$$;
COMMENT ON TYPE app.risk_level IS
  'Risk classification of a proposed action or agent run.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'policy_result'
  ) THEN
    CREATE TYPE app.policy_result AS ENUM ('allow', 'block', 'needs_approval');
  END IF;
END;
$$;
COMMENT ON TYPE app.policy_result IS
  'The PolicyGuard verdict on a proposed action.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'policy_severity'
  ) THEN
    CREATE TYPE app.policy_severity AS ENUM ('block', 'warn');
  END IF;
END;
$$;
COMMENT ON TYPE app.policy_severity IS
  'Whether a policy rule hard-blocks an action or only warns.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'policy_kind'
  ) THEN
    CREATE TYPE app.policy_kind AS ENUM (
      'budget_cap', 'approval_required', 'prohibited_action', 'brand_safety', 'platform_limit'
    );
  END IF;
END;
$$;
COMMENT ON TYPE app.policy_kind IS
  'Category of a policy rule. Mirrors PolicyRule.kind in @admatix/schemas.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'approval_decision'
  ) THEN
    CREATE TYPE app.approval_decision AS ENUM ('approved', 'rejected');
  END IF;
END;
$$;
COMMENT ON TYPE app.approval_decision IS
  'Terminal human decision recorded on an approval receipt.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'workflow_step'
  ) THEN
    CREATE TYPE app.workflow_step AS ENUM ('plan', 'activate', 'measure', 'reflect');
  END IF;
END;
$$;
COMMENT ON TYPE app.workflow_step IS
  'The plan/activate/measure/reflect phase an agent run belongs to.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'agent_run_status'
  ) THEN
    CREATE TYPE app.agent_run_status AS ENUM ('completed', 'blocked', 'error');
  END IF;
END;
$$;
COMMENT ON TYPE app.agent_run_status IS
  'Terminal status of a persisted agent run.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'trust_subject_type'
  ) THEN
    CREATE TYPE app.trust_subject_type AS ENUM ('agent', 'skill', 'connector');
  END IF;
END;
$$;
COMMENT ON TYPE app.trust_subject_type IS
  'The kind of entity a trust score is attached to.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'user_role'
  ) THEN
    CREATE TYPE app.user_role AS ENUM ('owner', 'admin', 'approver', 'analyst', 'viewer');
  END IF;
END;
$$;
COMMENT ON TYPE app.user_role IS
  'Role of a user within a tenant. approver may sign approval receipts.';

-- ----------------------------------------------------------------------------
-- Table: app.tenants
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.tenants (
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

CREATE INDEX IF NOT EXISTS idx_tenants_is_active ON app.tenants (is_active);
DROP TRIGGER IF EXISTS trg_tenants_touch ON app.tenants;
CREATE TRIGGER trg_tenants_touch BEFORE UPDATE ON app.tenants
  FOR EACH ROW EXECUTE FUNCTION public.admatix_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Table: app.users
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.users (
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

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON app.users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_role      ON app.users (role);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON app.users (is_active);
DROP TRIGGER IF EXISTS trg_users_touch ON app.users;
CREATE TRIGGER trg_users_touch BEFORE UPDATE ON app.users
  FOR EACH ROW EXECUTE FUNCTION public.admatix_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Table: app.ad_accounts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.ad_accounts (
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

CREATE INDEX IF NOT EXISTS idx_ad_accounts_tenant_id ON app.ad_accounts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ad_accounts_platform  ON app.ad_accounts (platform);
CREATE INDEX IF NOT EXISTS idx_ad_accounts_status    ON app.ad_accounts (status);
DROP TRIGGER IF EXISTS trg_ad_accounts_touch ON app.ad_accounts;
CREATE TRIGGER trg_ad_accounts_touch BEFORE UPDATE ON app.ad_accounts
  FOR EACH ROW EXECUTE FUNCTION public.admatix_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Table: app.connections -- the credential vault.
-- Tokens are stored encrypted at rest (token_ciphertext); plaintext never lands.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.connections (
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

CREATE INDEX IF NOT EXISTS idx_connections_tenant_id  ON app.connections (tenant_id);
CREATE INDEX IF NOT EXISTS idx_connections_account_id ON app.connections (ad_account_id);
CREATE INDEX IF NOT EXISTS idx_connections_platform   ON app.connections (platform);
CREATE INDEX IF NOT EXISTS idx_connections_status     ON app.connections (status);
CREATE INDEX IF NOT EXISTS idx_connections_expires_at ON app.connections (expires_at);
CREATE INDEX IF NOT EXISTS idx_connections_created_by ON app.connections (created_by);
DROP TRIGGER IF EXISTS trg_connections_touch ON app.connections;
CREATE TRIGGER trg_connections_touch BEFORE UPDATE ON app.connections
  FOR EACH ROW EXECUTE FUNCTION public.admatix_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Table: app.policies -- versioned policy rule sets evaluated by PolicyGuard.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.policies (
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

CREATE INDEX IF NOT EXISTS idx_policies_tenant_id  ON app.policies (tenant_id);
CREATE INDEX IF NOT EXISTS idx_policies_is_active  ON app.policies (is_active);
CREATE INDEX IF NOT EXISTS idx_policies_version    ON app.policies (policy_version);
CREATE INDEX IF NOT EXISTS idx_policies_created_by ON app.policies (created_by);
DROP TRIGGER IF EXISTS trg_policies_touch ON app.policies;
CREATE TRIGGER trg_policies_touch BEFORE UPDATE ON app.policies
  FOR EACH ROW EXECUTE FUNCTION public.admatix_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Table: app.h0_packets -- the unit of trust in AdMatix.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.h0_packets (
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

CREATE INDEX IF NOT EXISTS idx_h0_packets_tenant_id   ON app.h0_packets (tenant_id);
CREATE INDEX IF NOT EXISTS idx_h0_packets_account_id  ON app.h0_packets (ad_account_id);
CREATE INDEX IF NOT EXISTS idx_h0_packets_workflow_id ON app.h0_packets (workflow_id);
CREATE INDEX IF NOT EXISTS idx_h0_packets_tx_id       ON app.h0_packets (tx_id);
CREATE INDEX IF NOT EXISTS idx_h0_packets_trace_id    ON app.h0_packets (trace_id);
CREATE INDEX IF NOT EXISTS idx_h0_packets_state       ON app.h0_packets (state);
CREATE INDEX IF NOT EXISTS idx_h0_packets_created_at  ON app.h0_packets (created_at);

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

DROP TRIGGER IF EXISTS trg_h0_packets_biud ON app.h0_packets;
CREATE TRIGGER trg_h0_packets_biud
  BEFORE INSERT OR UPDATE ON app.h0_packets
  FOR EACH ROW EXECUTE FUNCTION app.h0_packets_biud();

-- ----------------------------------------------------------------------------
-- Table: app.proposed_actions -- a change the system wants to make (dry-run).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.proposed_actions (
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

CREATE INDEX IF NOT EXISTS idx_proposed_actions_packet_id   ON app.proposed_actions (h0_packet_id);
CREATE INDEX IF NOT EXISTS idx_proposed_actions_tenant_id   ON app.proposed_actions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_proposed_actions_action_type ON app.proposed_actions (action_type);
CREATE INDEX IF NOT EXISTS idx_proposed_actions_target      ON app.proposed_actions (target_entity_id);
CREATE INDEX IF NOT EXISTS idx_proposed_actions_risk_level  ON app.proposed_actions (risk_level);
DROP TRIGGER IF EXISTS trg_proposed_actions_touch ON app.proposed_actions;
CREATE TRIGGER trg_proposed_actions_touch BEFORE UPDATE ON app.proposed_actions
  FOR EACH ROW EXECUTE FUNCTION public.admatix_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Table: app.policy_decisions -- the PolicyGuard verdict on a proposed action.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.policy_decisions (
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

CREATE INDEX IF NOT EXISTS idx_policy_decisions_action_id  ON app.policy_decisions (proposed_action_id);
CREATE INDEX IF NOT EXISTS idx_policy_decisions_tenant_id  ON app.policy_decisions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_policy_decisions_policy_id  ON app.policy_decisions (policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_decisions_result     ON app.policy_decisions (result);
CREATE INDEX IF NOT EXISTS idx_policy_decisions_decided_at ON app.policy_decisions (decided_at);

-- ----------------------------------------------------------------------------
-- Table: app.execution_diffs -- the before/after preview from a dry-run.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.execution_diffs (
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

CREATE INDEX IF NOT EXISTS idx_execution_diffs_action_id ON app.execution_diffs (proposed_action_id);
CREATE INDEX IF NOT EXISTS idx_execution_diffs_tenant_id ON app.execution_diffs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_execution_diffs_entity_id ON app.execution_diffs (entity_id);

-- ----------------------------------------------------------------------------
-- Table: app.approval_receipts -- the human decision on an action.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.approval_receipts (
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

CREATE INDEX IF NOT EXISTS idx_approval_receipts_packet_id ON app.approval_receipts (h0_packet_id);
CREATE INDEX IF NOT EXISTS idx_approval_receipts_action_id ON app.approval_receipts (proposed_action_id);
CREATE INDEX IF NOT EXISTS idx_approval_receipts_tenant_id ON app.approval_receipts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_approval_receipts_user_id   ON app.approval_receipts (decided_by_user_id);
CREATE INDEX IF NOT EXISTS idx_approval_receipts_decision  ON app.approval_receipts (decision);
CREATE INDEX IF NOT EXISTS idx_approval_receipts_decided_at ON app.approval_receipts (decided_at);

-- ----------------------------------------------------------------------------
-- Table: app.rollback_checkpoints -- a snapshot enabling restoration.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.rollback_checkpoints (
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

CREATE INDEX IF NOT EXISTS idx_rollback_checkpoints_packet_id ON app.rollback_checkpoints (h0_packet_id);
CREATE INDEX IF NOT EXISTS idx_rollback_checkpoints_tenant_id ON app.rollback_checkpoints (tenant_id);
CREATE INDEX IF NOT EXISTS idx_rollback_checkpoints_entity_id ON app.rollback_checkpoints (entity_id);
CREATE INDEX IF NOT EXISTS idx_rollback_checkpoints_consumed  ON app.rollback_checkpoints (is_consumed);

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

DROP TRIGGER IF EXISTS trg_rollback_checkpoints_bi ON app.rollback_checkpoints;
CREATE TRIGGER trg_rollback_checkpoints_bi
  BEFORE INSERT OR UPDATE ON app.rollback_checkpoints
  FOR EACH ROW EXECUTE FUNCTION app.rollback_checkpoints_bi();

-- ----------------------------------------------------------------------------
-- Table: app.outcome_measurements -- the Measure-step result for an H0 packet.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.outcome_measurements (
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

CREATE INDEX IF NOT EXISTS idx_outcome_measurements_packet_id   ON app.outcome_measurements (h0_packet_id);
CREATE INDEX IF NOT EXISTS idx_outcome_measurements_tenant_id   ON app.outcome_measurements (tenant_id);
CREATE INDEX IF NOT EXISTS idx_outcome_measurements_passed      ON app.outcome_measurements (passed);
CREATE INDEX IF NOT EXISTS idx_outcome_measurements_measured_at ON app.outcome_measurements (measured_at);

-- ----------------------------------------------------------------------------
-- Table: app.agent_runs -- the replayable audit unit for a single agent run.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.agent_runs (
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

CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_id   ON app.agent_runs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_packet_id   ON app.agent_runs (h0_packet_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_id    ON app.agent_runs (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_workflow_id ON app.agent_runs (workflow_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_tx_id       ON app.agent_runs (tx_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_trace_id    ON app.agent_runs (trace_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_step        ON app.agent_runs (step);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status      ON app.agent_runs (status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_created_at  ON app.agent_runs (created_at);

-- ----------------------------------------------------------------------------
-- Table: app.trust_scores -- current trust for an agent / skill / connector.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.trust_scores (
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

CREATE INDEX IF NOT EXISTS idx_trust_scores_tenant_id    ON app.trust_scores (tenant_id);
CREATE INDEX IF NOT EXISTS idx_trust_scores_subject_type ON app.trust_scores (subject_type);
CREATE INDEX IF NOT EXISTS idx_trust_scores_subject_id   ON app.trust_scores (subject_id);
CREATE INDEX IF NOT EXISTS idx_trust_scores_score        ON app.trust_scores (score);

-- ----------------------------------------------------------------------------
-- Table: app.trust_score_history -- append-style log of every score change.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.trust_score_history (
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

CREATE INDEX IF NOT EXISTS idx_trust_score_history_score_id    ON app.trust_score_history (trust_score_id);
CREATE INDEX IF NOT EXISTS idx_trust_score_history_tenant_id   ON app.trust_score_history (tenant_id);
CREATE INDEX IF NOT EXISTS idx_trust_score_history_subject_id  ON app.trust_score_history (subject_id);
CREATE INDEX IF NOT EXISTS idx_trust_score_history_packet_id   ON app.trust_score_history (related_h0_packet_id);
CREATE INDEX IF NOT EXISTS idx_trust_score_history_recorded_at ON app.trust_score_history (recorded_at);

-- ----------------------------------------------------------------------------
-- Privileges for the app schema.
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA app TO admatix_app, admatix_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO admatix_app;
GRANT SELECT ON ALL TABLES IN SCHEMA app TO admatix_readonly;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO admatix_app;

COMMIT;
