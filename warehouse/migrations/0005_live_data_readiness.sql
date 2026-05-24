BEGIN;

-- ============================================================================
-- AdMatix Data Layer -- Part 7: live-data readiness
-- Shadow-mode ingestion, experiment pre-registration, and proof bundles.
-- ============================================================================

-- The live pipeline must not turn raw "latest" platform data into public proof.
-- These tables record connector syncs, lossless raw landings, pre-registered
-- experiment designs, and immutable proof bundles promoted after H0/policy/
-- measurement checks pass.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'connector_sync_type'
  ) THEN
    CREATE TYPE app.connector_sync_type AS ENUM (
      'account_discovery',
      'entity_snapshot',
      'performance_report',
      'conversion_import',
      'experiment_import'
    );
  END IF;
END;
$$;
COMMENT ON TYPE app.connector_sync_type IS
  'Kind of connector sync: account discovery, entity snapshot, performance report, conversion import, or experiment import.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'connector_sync_status'
  ) THEN
    CREATE TYPE app.connector_sync_status AS ENUM (
      'running', 'succeeded', 'partial', 'failed', 'cancelled'
    );
  END IF;
END;
$$;
COMMENT ON TYPE app.connector_sync_status IS
  'Terminal or in-flight state of a connector sync.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'experiment_design_type'
  ) THEN
    CREATE TYPE app.experiment_design_type AS ENUM (
      'user_holdout',
      'geo_holdout',
      'switchback',
      'platform_lift',
      'synthetic_control',
      'none'
    );
  END IF;
END;
$$;
COMMENT ON TYPE app.experiment_design_type IS
  'Measurement design pre-registered for an H0 packet or live pilot.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'proof_origin_kind'
  ) THEN
    CREATE TYPE app.proof_origin_kind AS ENUM (
      'live', 'artifact', 'demo', 'fixture', 'unavailable'
    );
  END IF;
END;
$$;
COMMENT ON TYPE app.proof_origin_kind IS
  'Dashboard/proof data origin kind. Mirrors proof-dashboard DataOriginKind.';

-- ----------------------------------------------------------------------------
-- Table: app.connector_syncs -- one read-only platform sync attempt.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.connector_syncs (
  connector_sync_id uuid                      NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid                      NOT NULL,
  connection_id     uuid,
  ad_account_id     uuid,
  platform          app.ad_platform           NOT NULL,
  sync_type         app.connector_sync_type   NOT NULL,
  status            app.connector_sync_status NOT NULL DEFAULT 'running',
  api_version       text,
  cursor_before     jsonb                     NOT NULL DEFAULT '{}'::jsonb,
  cursor_after      jsonb                     NOT NULL DEFAULT '{}'::jsonb,
  freshness_start   timestamptz,
  freshness_end     timestamptz,
  rows_landed       integer                   NOT NULL DEFAULT 0,
  rows_rejected     integer                   NOT NULL DEFAULT 0,
  checksum          char(64),
  error             text,
  metadata          jsonb                     NOT NULL DEFAULT '{}'::jsonb,
  started_at        timestamptz               NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  created_at        timestamptz               NOT NULL DEFAULT now(),

  CONSTRAINT pk_connector_syncs PRIMARY KEY (connector_sync_id),
  CONSTRAINT fk_connector_syncs_tenant FOREIGN KEY (tenant_id)
    REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_connector_syncs_connection FOREIGN KEY (connection_id)
    REFERENCES app.connections (connection_id) ON DELETE SET NULL,
  CONSTRAINT fk_connector_syncs_account FOREIGN KEY (ad_account_id)
    REFERENCES app.ad_accounts (ad_account_id) ON DELETE SET NULL,
  CONSTRAINT ck_connector_syncs_rows CHECK (rows_landed >= 0 AND rows_rejected >= 0),
  CONSTRAINT ck_connector_syncs_finished CHECK (finished_at IS NULL OR finished_at >= started_at),
  CONSTRAINT ck_connector_syncs_checksum CHECK (checksum IS NULL OR checksum ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE app.connector_syncs IS
  'One read-only connector sync attempt. This is the freshness, provenance, and row-count spine for live data ingestion.';
COMMENT ON COLUMN app.connector_syncs.connector_sync_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN app.connector_syncs.tenant_id IS 'Owning tenant (FK app.tenants).';
COMMENT ON COLUMN app.connector_syncs.connection_id IS 'Credential connection used for the sync, if any (FK app.connections).';
COMMENT ON COLUMN app.connector_syncs.ad_account_id IS 'Ad account synced, if known (FK app.ad_accounts).';
COMMENT ON COLUMN app.connector_syncs.platform IS 'Source platform.';
COMMENT ON COLUMN app.connector_syncs.sync_type IS 'Sync kind: account_discovery | entity_snapshot | performance_report | conversion_import | experiment_import.';
COMMENT ON COLUMN app.connector_syncs.status IS 'Sync status: running | succeeded | partial | failed | cancelled.';
COMMENT ON COLUMN app.connector_syncs.api_version IS 'Platform API version used for this sync.';
COMMENT ON COLUMN app.connector_syncs.cursor_before IS 'Opaque source cursor before the sync.';
COMMENT ON COLUMN app.connector_syncs.cursor_after IS 'Opaque source cursor after the sync.';
COMMENT ON COLUMN app.connector_syncs.freshness_start IS 'Earliest source timestamp/date covered.';
COMMENT ON COLUMN app.connector_syncs.freshness_end IS 'Latest source timestamp/date covered.';
COMMENT ON COLUMN app.connector_syncs.rows_landed IS 'Raw rows landed successfully.';
COMMENT ON COLUMN app.connector_syncs.rows_rejected IS 'Rows rejected by schema or data-quality checks.';
COMMENT ON COLUMN app.connector_syncs.checksum IS 'Optional SHA-256 over the landed raw batch manifest.';
COMMENT ON COLUMN app.connector_syncs.error IS 'Terminal error message, if the sync failed or partially failed.';
COMMENT ON COLUMN app.connector_syncs.metadata IS 'Source-specific sync metadata and quality diagnostics.';
COMMENT ON COLUMN app.connector_syncs.started_at IS 'UTC timestamp the sync started.';
COMMENT ON COLUMN app.connector_syncs.finished_at IS 'UTC timestamp the sync finished.';
COMMENT ON COLUMN app.connector_syncs.created_at IS 'UTC timestamp the row was written.';

CREATE INDEX IF NOT EXISTS idx_connector_syncs_tenant_id ON app.connector_syncs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_connector_syncs_connection_id ON app.connector_syncs (connection_id);
CREATE INDEX IF NOT EXISTS idx_connector_syncs_account_id ON app.connector_syncs (ad_account_id);
CREATE INDEX IF NOT EXISTS idx_connector_syncs_platform ON app.connector_syncs (platform);
CREATE INDEX IF NOT EXISTS idx_connector_syncs_type ON app.connector_syncs (sync_type);
CREATE INDEX IF NOT EXISTS idx_connector_syncs_status ON app.connector_syncs (status);
CREATE INDEX IF NOT EXISTS idx_connector_syncs_started_at ON app.connector_syncs (started_at);
CREATE INDEX IF NOT EXISTS idx_connector_syncs_freshness_end ON app.connector_syncs (freshness_end);

-- ----------------------------------------------------------------------------
-- Table: app.experiment_designs -- pre-registered measurement plans.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.experiment_designs (
  experiment_design_id uuid                       NOT NULL DEFAULT gen_random_uuid(),
  tenant_id            uuid                       NOT NULL,
  ad_account_id        uuid,
  h0_packet_id         uuid,
  design_key           text                       NOT NULL,
  design_version       integer                    NOT NULL DEFAULT 1,
  supersedes_experiment_design_id uuid,
  design_type          app.experiment_design_type NOT NULL,
  primary_metric       text                       NOT NULL,
  treatment_unit       text                       NOT NULL,
  treatment_definition text                       NOT NULL,
  control_definition   text                       NOT NULL,
  randomization_seed   bigint,
  baseline_start       timestamptz,
  baseline_end         timestamptz,
  measurement_start    timestamptz,
  measurement_end      timestamptz,
  cooldown_end         timestamptz,
  mde                  numeric(18,8),
  power                numeric(6,5),
  alpha                numeric(6,5)               NOT NULL DEFAULT 0.05,
  decision_rule        text                       NOT NULL,
  pre_period_fit       jsonb                      NOT NULL DEFAULT '{}'::jsonb,
  placebo_plan         jsonb                      NOT NULL DEFAULT '{}'::jsonb,
  assumptions          text[]                     NOT NULL DEFAULT '{}',
  status               text                       NOT NULL DEFAULT 'draft',
  body                 jsonb                      NOT NULL DEFAULT '{}'::jsonb,
  body_hash            char(64) GENERATED ALWAYS AS (public.admatix_sha256_jsonb(body)) STORED,
  pre_registered_at    timestamptz,
  created_at           timestamptz                NOT NULL DEFAULT now(),
  updated_at           timestamptz                NOT NULL DEFAULT now(),

  CONSTRAINT pk_experiment_designs PRIMARY KEY (experiment_design_id),
  CONSTRAINT fk_experiment_designs_tenant FOREIGN KEY (tenant_id)
    REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_experiment_designs_account FOREIGN KEY (ad_account_id)
    REFERENCES app.ad_accounts (ad_account_id) ON DELETE SET NULL,
  CONSTRAINT fk_experiment_designs_packet FOREIGN KEY (h0_packet_id)
    REFERENCES app.h0_packets (h0_packet_id) ON DELETE SET NULL,
  CONSTRAINT fk_experiment_designs_supersedes FOREIGN KEY (supersedes_experiment_design_id)
    REFERENCES app.experiment_designs (experiment_design_id) ON DELETE RESTRICT,
  CONSTRAINT uq_experiment_designs_key_version UNIQUE (tenant_id, design_key, design_version),
  CONSTRAINT ck_experiment_designs_version CHECK (design_version > 0),
  CONSTRAINT ck_experiment_designs_windows CHECK (
    (baseline_start IS NULL OR baseline_end IS NULL OR baseline_end >= baseline_start)
    AND (measurement_start IS NULL OR measurement_end IS NULL OR measurement_end >= measurement_start)
    AND (cooldown_end IS NULL OR measurement_end IS NULL OR cooldown_end >= measurement_end)
  ),
  CONSTRAINT ck_experiment_designs_power CHECK (power IS NULL OR (power >= 0 AND power <= 1)),
  CONSTRAINT ck_experiment_designs_alpha CHECK (alpha > 0 AND alpha < 1),
  CONSTRAINT ck_experiment_designs_mde CHECK (mde IS NULL OR mde >= 0),
  CONSTRAINT ck_experiment_designs_status CHECK (status IN ('draft', 'pre_registered', 'cancelled')),
  CONSTRAINT ck_experiment_designs_preregistered_at CHECK (
    (status = 'pre_registered' AND pre_registered_at IS NOT NULL)
    OR (status <> 'pre_registered' AND pre_registered_at IS NULL)
  )
);

COMMENT ON TABLE app.experiment_designs IS
  'Pre-registered measurement plans for live pilots and H0 packets. Stores the design, power/MDE, windows, and decision rule before evidence is interpreted.';
COMMENT ON COLUMN app.experiment_designs.experiment_design_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN app.experiment_designs.tenant_id IS 'Owning tenant (FK app.tenants).';
COMMENT ON COLUMN app.experiment_designs.ad_account_id IS 'Optional ad account covered by the design (FK app.ad_accounts).';
COMMENT ON COLUMN app.experiment_designs.h0_packet_id IS 'Optional H0 packet the design measures (FK app.h0_packets).';
COMMENT ON COLUMN app.experiment_designs.design_key IS 'Stable human-readable experiment key, versioned per tenant.';
COMMENT ON COLUMN app.experiment_designs.design_version IS 'Monotonic version for a design_key. Superseding designs insert a new version instead of editing old rows.';
COMMENT ON COLUMN app.experiment_designs.supersedes_experiment_design_id IS 'Prior experiment design this row supersedes, if any.';
COMMENT ON COLUMN app.experiment_designs.design_type IS 'Measurement design: user holdout, geo holdout, switchback, platform lift, synthetic control, or none.';
COMMENT ON COLUMN app.experiment_designs.primary_metric IS 'Primary decision metric, e.g. first_party_gross_margin or incremental_revenue.';
COMMENT ON COLUMN app.experiment_designs.treatment_unit IS 'Unit of assignment: user, geo, campaign, ad_set, keyword, audience, or time block.';
COMMENT ON COLUMN app.experiment_designs.treatment_definition IS 'Plain-English treatment condition.';
COMMENT ON COLUMN app.experiment_designs.control_definition IS 'Plain-English control condition.';
COMMENT ON COLUMN app.experiment_designs.randomization_seed IS 'Seed used to assign units when AdMatix performs randomization.';
COMMENT ON COLUMN app.experiment_designs.baseline_start IS 'Inclusive start of the pre-period baseline window.';
COMMENT ON COLUMN app.experiment_designs.baseline_end IS 'Inclusive end of the pre-period baseline window.';
COMMENT ON COLUMN app.experiment_designs.measurement_start IS 'Inclusive start of the post-period measurement window.';
COMMENT ON COLUMN app.experiment_designs.measurement_end IS 'Inclusive end of the post-period measurement window.';
COMMENT ON COLUMN app.experiment_designs.cooldown_end IS 'Optional end of the post-test cooldown/late-conversion collection window.';
COMMENT ON COLUMN app.experiment_designs.mde IS 'Minimum detectable effect for the planned design.';
COMMENT ON COLUMN app.experiment_designs.power IS 'Planned statistical power, typically 0.8 or higher.';
COMMENT ON COLUMN app.experiment_designs.alpha IS 'Type-I error rate used for the design.';
COMMENT ON COLUMN app.experiment_designs.decision_rule IS 'Pre-declared rule for success, failure, or inconclusive verdicts.';
COMMENT ON COLUMN app.experiment_designs.pre_period_fit IS 'Pre-period fit diagnostics for geo/synthetic-control designs.';
COMMENT ON COLUMN app.experiment_designs.placebo_plan IS 'Planned placebo or negative-control checks.';
COMMENT ON COLUMN app.experiment_designs.assumptions IS 'Named assumptions and known limitations for the design.';
COMMENT ON COLUMN app.experiment_designs.status IS 'Design state: draft | pre_registered | cancelled. Running/completed outcomes live in outcome/proof tables, not by mutating the pre-registered design.';
COMMENT ON COLUMN app.experiment_designs.body IS 'Full design payload as jsonb.';
COMMENT ON COLUMN app.experiment_designs.body_hash IS 'SHA-256 of the canonical design body, generated from body.';
COMMENT ON COLUMN app.experiment_designs.pre_registered_at IS 'UTC timestamp when the design became immutable for interpretation.';
COMMENT ON COLUMN app.experiment_designs.created_at IS 'UTC timestamp the row was written.';
COMMENT ON COLUMN app.experiment_designs.updated_at IS 'UTC timestamp of the last mutation (maintained by trigger).';

CREATE INDEX IF NOT EXISTS idx_experiment_designs_tenant_id ON app.experiment_designs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_experiment_designs_account_id ON app.experiment_designs (ad_account_id);
CREATE INDEX IF NOT EXISTS idx_experiment_designs_packet_id ON app.experiment_designs (h0_packet_id);
CREATE INDEX IF NOT EXISTS idx_experiment_designs_supersedes_id ON app.experiment_designs (supersedes_experiment_design_id);
CREATE INDEX IF NOT EXISTS idx_experiment_designs_type ON app.experiment_designs (design_type);
CREATE INDEX IF NOT EXISTS idx_experiment_designs_status ON app.experiment_designs (status);
CREATE INDEX IF NOT EXISTS idx_experiment_designs_metric ON app.experiment_designs (primary_metric);

CREATE OR REPLACE FUNCTION app.enforce_experiment_design_preregistration()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.pre_registered_at IS NOT NULL OR OLD.status <> 'draft' THEN
      RAISE EXCEPTION
        'app.experiment_designs % is pre-registered and cannot be deleted', OLD.experiment_design_id
        USING ERRCODE = 'restrict_violation',
              HINT = 'Insert a new experiment_designs row with the same design_key, incremented design_version, and supersedes_experiment_design_id.';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.pre_registered_at IS NOT NULL OR OLD.status <> 'draft' THEN
    RAISE EXCEPTION
      'app.experiment_designs % is pre-registered and cannot be updated', OLD.experiment_design_id
      USING ERRCODE = 'restrict_violation',
            HINT = 'Insert a new experiment_designs row with the same design_key, incremented design_version, and supersedes_experiment_design_id.';
  END IF;

  IF NEW.status = 'pre_registered' AND NEW.pre_registered_at IS NULL THEN
    RAISE EXCEPTION
      'app.experiment_designs % cannot leave draft without pre_registered_at', OLD.experiment_design_id
      USING ERRCODE = 'check_violation',
            HINT = 'Set pre_registered_at at the same time as the terminal pre-registration transition.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION app.enforce_experiment_design_preregistration() IS
  'Blocks mutation/deletion of experiment designs once they leave draft or have pre_registered_at. Draft rows may be edited; pre-registered designs require a new version row.';

DROP TRIGGER IF EXISTS trg_experiment_designs_touch ON app.experiment_designs;
CREATE TRIGGER trg_experiment_designs_touch BEFORE UPDATE ON app.experiment_designs
  FOR EACH ROW EXECUTE FUNCTION public.admatix_touch_updated_at();

DROP TRIGGER IF EXISTS trg_experiment_designs_preregistration_update ON app.experiment_designs;
CREATE TRIGGER trg_experiment_designs_preregistration_update
  BEFORE UPDATE ON app.experiment_designs
  FOR EACH ROW EXECUTE FUNCTION app.enforce_experiment_design_preregistration();

DROP TRIGGER IF EXISTS trg_experiment_designs_preregistration_delete ON app.experiment_designs;
CREATE TRIGGER trg_experiment_designs_preregistration_delete
  BEFORE DELETE ON app.experiment_designs
  FOR EACH ROW EXECUTE FUNCTION app.enforce_experiment_design_preregistration();

COMMENT ON TRIGGER trg_experiment_designs_preregistration_update ON app.experiment_designs IS
  'Blocks UPDATE once an experiment design is pre-registered.';
COMMENT ON TRIGGER trg_experiment_designs_preregistration_delete ON app.experiment_designs IS
  'Blocks DELETE once an experiment design is pre-registered.';

-- ----------------------------------------------------------------------------
-- Table: app.proof_bundles -- immutable dashboard/export proof bundles.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.proof_bundles (
  proof_bundle_id       uuid                  NOT NULL DEFAULT gen_random_uuid(),
  tenant_id             uuid                  NOT NULL,
  h0_packet_id          uuid,
  outcome_measurement_id uuid,
  origin_kind           app.proof_origin_kind NOT NULL DEFAULT 'artifact',
  bundle_key            text                  NOT NULL,
  schema_version        text                  NOT NULL DEFAULT '1.0.0',
  source_branch         text,
  source_commit         text,
  source_tables         text[]                NOT NULL DEFAULT '{}',
  source_artifacts      text[]                NOT NULL DEFAULT '{}',
  claim_limits          text[]                NOT NULL DEFAULT '{}',
  status                text                  NOT NULL,
  public_uri            text,
  evidence_as_of        timestamptz           NOT NULL,
  generated_at          timestamptz           NOT NULL DEFAULT now(),
  bundle                jsonb                 NOT NULL DEFAULT '{}'::jsonb,
  bundle_hash           char(64) GENERATED ALWAYS AS (public.admatix_sha256_jsonb(bundle)) STORED,
  created_at            timestamptz           NOT NULL DEFAULT now(),

  CONSTRAINT pk_proof_bundles PRIMARY KEY (proof_bundle_id),
  CONSTRAINT fk_proof_bundles_tenant FOREIGN KEY (tenant_id)
    REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_proof_bundles_packet FOREIGN KEY (h0_packet_id)
    REFERENCES app.h0_packets (h0_packet_id) ON DELETE SET NULL,
  CONSTRAINT fk_proof_bundles_outcome FOREIGN KEY (outcome_measurement_id)
    REFERENCES app.outcome_measurements (outcome_measurement_id) ON DELETE SET NULL,
  CONSTRAINT uq_proof_bundles_key UNIQUE (tenant_id, bundle_key),
  CONSTRAINT ck_proof_bundles_status CHECK (status IN ('PASS', 'READY', 'FAIL', 'INCONCLUSIVE'))
);

COMMENT ON TABLE app.proof_bundles IS
  'Immutable proof bundle metadata and payloads promoted to the dashboard/export layer after evidence gates pass. This prevents raw latest data from masquerading as proof.';
COMMENT ON COLUMN app.proof_bundles.proof_bundle_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN app.proof_bundles.tenant_id IS 'Owning tenant (FK app.tenants).';
COMMENT ON COLUMN app.proof_bundles.h0_packet_id IS 'Optional H0 packet represented by the bundle (FK app.h0_packets).';
COMMENT ON COLUMN app.proof_bundles.outcome_measurement_id IS 'Optional outcome measurement represented by the bundle (FK app.outcome_measurements).';
COMMENT ON COLUMN app.proof_bundles.origin_kind IS 'Dashboard data origin kind. Public proof should be artifact or live only when generated from validated evidence.';
COMMENT ON COLUMN app.proof_bundles.bundle_key IS 'Stable proof bundle key, unique per tenant.';
COMMENT ON COLUMN app.proof_bundles.schema_version IS 'Version of the proof bundle payload schema.';
COMMENT ON COLUMN app.proof_bundles.source_branch IS 'Git branch that generated this bundle, if applicable.';
COMMENT ON COLUMN app.proof_bundles.source_commit IS 'Git commit that generated this bundle, if applicable.';
COMMENT ON COLUMN app.proof_bundles.source_tables IS 'Warehouse/app/ledger table names used to build the bundle.';
COMMENT ON COLUMN app.proof_bundles.source_artifacts IS 'Artifact paths or object URIs included in the bundle.';
COMMENT ON COLUMN app.proof_bundles.claim_limits IS 'Explicit claim limits that must render with the proof.';
COMMENT ON COLUMN app.proof_bundles.status IS 'Final bundle status at insertion: PASS | READY | FAIL | INCONCLUSIVE. Draft bundles must not be inserted into this immutable table.';
COMMENT ON COLUMN app.proof_bundles.public_uri IS 'Optional public dashboard or object-storage URI for the bundle.';
COMMENT ON COLUMN app.proof_bundles.evidence_as_of IS 'Latest source-data timestamp represented by the proof.';
COMMENT ON COLUMN app.proof_bundles.generated_at IS 'UTC timestamp when the bundle was generated.';
COMMENT ON COLUMN app.proof_bundles.bundle IS 'Full dashboard/export proof payload as jsonb.';
COMMENT ON COLUMN app.proof_bundles.bundle_hash IS 'SHA-256 of the canonical bundle payload, generated from bundle.';
COMMENT ON COLUMN app.proof_bundles.created_at IS 'UTC timestamp the row was written.';

CREATE INDEX IF NOT EXISTS idx_proof_bundles_tenant_id ON app.proof_bundles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_proof_bundles_packet_id ON app.proof_bundles (h0_packet_id);
CREATE INDEX IF NOT EXISTS idx_proof_bundles_origin_kind ON app.proof_bundles (origin_kind);
CREATE INDEX IF NOT EXISTS idx_proof_bundles_status ON app.proof_bundles (status);
CREATE INDEX IF NOT EXISTS idx_proof_bundles_evidence_as_of ON app.proof_bundles (evidence_as_of);

CREATE OR REPLACE FUNCTION app.reject_proof_bundle_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'app.proof_bundles is append-only: % is not permitted for bundle %', TG_OP, OLD.proof_bundle_id
    USING ERRCODE = 'restrict_violation',
          HINT = 'Insert a new proof bundle version instead of mutating a dashboard/export artifact.';
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION app.reject_proof_bundle_mutation() IS
  'Trigger function that unconditionally raises on UPDATE/DELETE for proof bundles. Proof bundles are append-only evidence artifacts.';

DROP TRIGGER IF EXISTS trg_proof_bundles_no_update ON app.proof_bundles;
CREATE TRIGGER trg_proof_bundles_no_update
  BEFORE UPDATE ON app.proof_bundles
  FOR EACH ROW EXECUTE FUNCTION app.reject_proof_bundle_mutation();

DROP TRIGGER IF EXISTS trg_proof_bundles_no_delete ON app.proof_bundles;
CREATE TRIGGER trg_proof_bundles_no_delete
  BEFORE DELETE ON app.proof_bundles
  FOR EACH ROW EXECUTE FUNCTION app.reject_proof_bundle_mutation();

COMMENT ON TRIGGER trg_proof_bundles_no_update ON app.proof_bundles IS
  'Blocks UPDATE: public proof bundles are immutable after insert.';
COMMENT ON TRIGGER trg_proof_bundles_no_delete ON app.proof_bundles IS
  'Blocks DELETE: public proof bundles are immutable after insert.';

-- ----------------------------------------------------------------------------
-- Table: warehouse.raw_platform_reports -- lossless platform metric rows.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouse.raw_platform_reports (
  raw_report_id     bigint          GENERATED ALWAYS AS IDENTITY,
  connector_sync_id uuid            NOT NULL,
  tenant_id         uuid            NOT NULL,
  ad_account_id     uuid,
  platform          app.ad_platform NOT NULL,
  report_date       date            NOT NULL,
  grain             text            NOT NULL,
  external_entity_id text,
  dimensions        jsonb           NOT NULL DEFAULT '{}'::jsonb,
  metrics           jsonb           NOT NULL DEFAULT '{}'::jsonb,
  raw_payload       jsonb           NOT NULL DEFAULT '{}'::jsonb,
  raw_hash          char(64) GENERATED ALWAYS AS (public.admatix_sha256_jsonb(raw_payload)) STORED,
  _source           text            NOT NULL,
  _batch_id         text            NOT NULL,
  _loaded_at        timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT pk_raw_platform_reports PRIMARY KEY (raw_report_id),
  CONSTRAINT fk_raw_platform_reports_sync FOREIGN KEY (connector_sync_id)
    REFERENCES app.connector_syncs (connector_sync_id) ON DELETE CASCADE,
  CONSTRAINT fk_raw_platform_reports_tenant FOREIGN KEY (tenant_id)
    REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_raw_platform_reports_account FOREIGN KEY (ad_account_id)
    REFERENCES app.ad_accounts (ad_account_id) ON DELETE SET NULL,
  CONSTRAINT ck_raw_platform_reports_grain CHECK (grain IN (
    'account', 'campaign', 'ad_set', 'ad', 'creative', 'keyword', 'placement',
    'geo', 'device', 'audience', 'search_term'
  ))
);

COMMENT ON TABLE warehouse.raw_platform_reports IS
  'Lossless daily platform reporting rows from Google/Meta/TikTok/Amazon/etc. Used as bronze input; not public proof until promoted through H0 and proof bundle gates.';
COMMENT ON COLUMN warehouse.raw_platform_reports.raw_report_id IS 'Surrogate identity primary key.';
COMMENT ON COLUMN warehouse.raw_platform_reports.connector_sync_id IS 'Connector sync that landed the row (FK app.connector_syncs).';
COMMENT ON COLUMN warehouse.raw_platform_reports.tenant_id IS 'Owning tenant (FK app.tenants).';
COMMENT ON COLUMN warehouse.raw_platform_reports.ad_account_id IS 'Optional ad account represented by the report row (FK app.ad_accounts).';
COMMENT ON COLUMN warehouse.raw_platform_reports.platform IS 'Source platform.';
COMMENT ON COLUMN warehouse.raw_platform_reports.report_date IS 'Platform reporting date in account-local reporting semantics.';
COMMENT ON COLUMN warehouse.raw_platform_reports.grain IS 'Report grain: account, campaign, ad_set, ad, creative, keyword, placement, geo, device, audience, or search_term.';
COMMENT ON COLUMN warehouse.raw_platform_reports.external_entity_id IS 'Platform-native entity id at the declared grain.';
COMMENT ON COLUMN warehouse.raw_platform_reports.dimensions IS 'Normalized dimension keys extracted from the platform report.';
COMMENT ON COLUMN warehouse.raw_platform_reports.metrics IS 'Normalized metric keys extracted from the platform report.';
COMMENT ON COLUMN warehouse.raw_platform_reports.raw_payload IS 'Lossless original platform payload for the row.';
COMMENT ON COLUMN warehouse.raw_platform_reports.raw_hash IS 'SHA-256 of the canonical raw_payload jsonb.';
COMMENT ON COLUMN warehouse.raw_platform_reports._source IS 'Source system or connector name.';
COMMENT ON COLUMN warehouse.raw_platform_reports._batch_id IS 'Connector batch identifier.';
COMMENT ON COLUMN warehouse.raw_platform_reports._loaded_at IS 'UTC timestamp the row was loaded.';
CREATE INDEX IF NOT EXISTS idx_raw_platform_reports_sync ON warehouse.raw_platform_reports (connector_sync_id);
CREATE INDEX IF NOT EXISTS idx_raw_platform_reports_tenant_date ON warehouse.raw_platform_reports (tenant_id, report_date);
CREATE INDEX IF NOT EXISTS idx_raw_platform_reports_account_date ON warehouse.raw_platform_reports (ad_account_id, report_date);
CREATE INDEX IF NOT EXISTS idx_raw_platform_reports_platform ON warehouse.raw_platform_reports (platform);
CREATE INDEX IF NOT EXISTS idx_raw_platform_reports_entity ON warehouse.raw_platform_reports (external_entity_id);
CREATE INDEX IF NOT EXISTS idx_raw_platform_reports_hash ON warehouse.raw_platform_reports (raw_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_platform_reports_source_batch_hash
  ON warehouse.raw_platform_reports (_source, _batch_id, raw_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_platform_reports_semantic_hash
  ON warehouse.raw_platform_reports (
    tenant_id, platform, report_date, grain, coalesce(external_entity_id, ''), raw_hash
  );

-- ----------------------------------------------------------------------------
-- Table: warehouse.raw_entity_snapshots -- SCD source snapshots.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouse.raw_entity_snapshots (
  raw_entity_snapshot_id bigint          GENERATED ALWAYS AS IDENTITY,
  connector_sync_id      uuid            NOT NULL,
  tenant_id              uuid            NOT NULL,
  ad_account_id          uuid,
  platform               app.ad_platform NOT NULL,
  entity_type            text            NOT NULL,
  external_entity_id     text            NOT NULL,
  parent_external_entity_id text,
  status                 text,
  snapshot_ts            timestamptz     NOT NULL,
  effective_date         date,
  attributes             jsonb           NOT NULL DEFAULT '{}'::jsonb,
  raw_payload            jsonb           NOT NULL DEFAULT '{}'::jsonb,
  raw_hash               char(64) GENERATED ALWAYS AS (public.admatix_sha256_jsonb(raw_payload)) STORED,
  _source                text            NOT NULL,
  _batch_id              text            NOT NULL,
  _loaded_at             timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT pk_raw_entity_snapshots PRIMARY KEY (raw_entity_snapshot_id),
  CONSTRAINT fk_raw_entity_snapshots_sync FOREIGN KEY (connector_sync_id)
    REFERENCES app.connector_syncs (connector_sync_id) ON DELETE CASCADE,
  CONSTRAINT fk_raw_entity_snapshots_tenant FOREIGN KEY (tenant_id)
    REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_raw_entity_snapshots_account FOREIGN KEY (ad_account_id)
    REFERENCES app.ad_accounts (ad_account_id) ON DELETE SET NULL,
  CONSTRAINT ck_raw_entity_snapshots_type CHECK (entity_type IN (
    'account', 'campaign', 'ad_set', 'ad', 'creative', 'keyword', 'placement',
    'audience', 'budget', 'conversion_action', 'product'
  ))
);

COMMENT ON TABLE warehouse.raw_entity_snapshots IS
  'Lossless ad-platform entity snapshots used to build SCD dimensions and rollback checkpoints.';
COMMENT ON COLUMN warehouse.raw_entity_snapshots.raw_entity_snapshot_id IS 'Surrogate identity primary key.';
COMMENT ON COLUMN warehouse.raw_entity_snapshots.connector_sync_id IS 'Connector sync that landed the snapshot (FK app.connector_syncs).';
COMMENT ON COLUMN warehouse.raw_entity_snapshots.tenant_id IS 'Owning tenant (FK app.tenants).';
COMMENT ON COLUMN warehouse.raw_entity_snapshots.ad_account_id IS 'Optional ad account represented by the snapshot (FK app.ad_accounts).';
COMMENT ON COLUMN warehouse.raw_entity_snapshots.platform IS 'Source platform.';
COMMENT ON COLUMN warehouse.raw_entity_snapshots.entity_type IS 'Entity kind: account, campaign, ad_set, ad, creative, keyword, placement, audience, budget, conversion_action, or product.';
COMMENT ON COLUMN warehouse.raw_entity_snapshots.external_entity_id IS 'Platform-native entity id.';
COMMENT ON COLUMN warehouse.raw_entity_snapshots.parent_external_entity_id IS 'Platform-native parent entity id, when applicable.';
COMMENT ON COLUMN warehouse.raw_entity_snapshots.status IS 'Platform-native entity lifecycle status at snapshot time.';
COMMENT ON COLUMN warehouse.raw_entity_snapshots.snapshot_ts IS 'Source timestamp for the entity snapshot.';
COMMENT ON COLUMN warehouse.raw_entity_snapshots.effective_date IS 'Optional effective date for SCD construction.';
COMMENT ON COLUMN warehouse.raw_entity_snapshots.attributes IS 'Normalized attributes used for dimensions and diffs.';
COMMENT ON COLUMN warehouse.raw_entity_snapshots.raw_payload IS 'Lossless original platform payload for the snapshot.';
COMMENT ON COLUMN warehouse.raw_entity_snapshots.raw_hash IS 'SHA-256 of the canonical raw_payload jsonb.';
COMMENT ON COLUMN warehouse.raw_entity_snapshots._source IS 'Source system or connector name.';
COMMENT ON COLUMN warehouse.raw_entity_snapshots._batch_id IS 'Connector batch identifier.';
COMMENT ON COLUMN warehouse.raw_entity_snapshots._loaded_at IS 'UTC timestamp the row was loaded.';
CREATE INDEX IF NOT EXISTS idx_raw_entity_snapshots_sync ON warehouse.raw_entity_snapshots (connector_sync_id);
CREATE INDEX IF NOT EXISTS idx_raw_entity_snapshots_tenant_ts ON warehouse.raw_entity_snapshots (tenant_id, snapshot_ts);
CREATE INDEX IF NOT EXISTS idx_raw_entity_snapshots_account_ts ON warehouse.raw_entity_snapshots (ad_account_id, snapshot_ts);
CREATE INDEX IF NOT EXISTS idx_raw_entity_snapshots_type ON warehouse.raw_entity_snapshots (entity_type);
CREATE INDEX IF NOT EXISTS idx_raw_entity_snapshots_entity ON warehouse.raw_entity_snapshots (external_entity_id);
CREATE INDEX IF NOT EXISTS idx_raw_entity_snapshots_hash ON warehouse.raw_entity_snapshots (raw_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_entity_snapshots_source_batch_hash
  ON warehouse.raw_entity_snapshots (_source, _batch_id, raw_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_entity_snapshots_semantic_hash
  ON warehouse.raw_entity_snapshots (
    tenant_id, platform, entity_type, external_entity_id, snapshot_ts, raw_hash
  );

-- ----------------------------------------------------------------------------
-- Table: warehouse.raw_conversion_events -- first-party conversion truth rows.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouse.raw_conversion_events (
  raw_conversion_event_id bigint          GENERATED ALWAYS AS IDENTITY,
  connector_sync_id       uuid            NOT NULL,
  tenant_id               uuid            NOT NULL,
  ad_account_id           uuid,
  platform                app.ad_platform NOT NULL DEFAULT 'first_party',
  event_ts                timestamptz     NOT NULL,
  event_date              date            NOT NULL,
  event_name              text            NOT NULL,
  conversion_action       text,
  event_id                text,
  privacy_safe_user_key   text,
  order_external_id       text,
  revenue                 numeric(18,6),
  gross_margin            numeric(18,6),
  currency                char(3)         NOT NULL DEFAULT 'USD',
  attribution             jsonb           NOT NULL DEFAULT '{}'::jsonb,
  raw_payload             jsonb           NOT NULL DEFAULT '{}'::jsonb,
  raw_hash                char(64) GENERATED ALWAYS AS (public.admatix_sha256_jsonb(raw_payload)) STORED,
  _source                 text            NOT NULL,
  _batch_id               text            NOT NULL,
  _loaded_at              timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT pk_raw_conversion_events PRIMARY KEY (raw_conversion_event_id),
  CONSTRAINT fk_raw_conversion_events_sync FOREIGN KEY (connector_sync_id)
    REFERENCES app.connector_syncs (connector_sync_id) ON DELETE CASCADE,
  CONSTRAINT fk_raw_conversion_events_tenant FOREIGN KEY (tenant_id)
    REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_raw_conversion_events_account FOREIGN KEY (ad_account_id)
    REFERENCES app.ad_accounts (ad_account_id) ON DELETE SET NULL,
  CONSTRAINT ck_raw_conversion_events_revenue CHECK (revenue IS NULL OR revenue >= 0),
  CONSTRAINT ck_raw_conversion_events_margin CHECK (gross_margin IS NULL OR gross_margin >= 0)
);

COMMENT ON TABLE warehouse.raw_conversion_events IS
  'Lossless first-party conversion/order events from GA4, Shopify, Stripe, server-side pixels, CRM, or customer CSV exports. These are the preferred truth source for live pilots.';
COMMENT ON COLUMN warehouse.raw_conversion_events.raw_conversion_event_id IS 'Surrogate identity primary key.';
COMMENT ON COLUMN warehouse.raw_conversion_events.connector_sync_id IS 'Connector sync that landed the conversion event (FK app.connector_syncs).';
COMMENT ON COLUMN warehouse.raw_conversion_events.tenant_id IS 'Owning tenant (FK app.tenants).';
COMMENT ON COLUMN warehouse.raw_conversion_events.ad_account_id IS 'Optional ad account associated with the event (FK app.ad_accounts).';
COMMENT ON COLUMN warehouse.raw_conversion_events.platform IS 'Source platform; defaults to first_party.';
COMMENT ON COLUMN warehouse.raw_conversion_events.event_ts IS 'UTC event timestamp.';
COMMENT ON COLUMN warehouse.raw_conversion_events.event_date IS 'Event date used for daily facts.';
COMMENT ON COLUMN warehouse.raw_conversion_events.event_name IS 'Source event name, e.g. purchase, lead, subscription, or add_to_cart.';
COMMENT ON COLUMN warehouse.raw_conversion_events.conversion_action IS 'Normalized conversion action label.';
COMMENT ON COLUMN warehouse.raw_conversion_events.event_id IS 'Source event id used for deduplication when available.';
COMMENT ON COLUMN warehouse.raw_conversion_events.privacy_safe_user_key IS 'Pseudonymous privacy-safe user key. Never store raw PII.';
COMMENT ON COLUMN warehouse.raw_conversion_events.order_external_id IS 'External order/subscription id for reconciliation.';
COMMENT ON COLUMN warehouse.raw_conversion_events.revenue IS 'Event revenue in currency units.';
COMMENT ON COLUMN warehouse.raw_conversion_events.gross_margin IS 'Event gross margin in currency units, preferred for iROAS pilots.';
COMMENT ON COLUMN warehouse.raw_conversion_events.currency IS 'ISO-4217 currency code.';
COMMENT ON COLUMN warehouse.raw_conversion_events.attribution IS 'Attribution metadata from source systems; not causal proof by itself.';
COMMENT ON COLUMN warehouse.raw_conversion_events.raw_payload IS 'Lossless original source payload for the event.';
COMMENT ON COLUMN warehouse.raw_conversion_events.raw_hash IS 'SHA-256 of the canonical raw_payload jsonb.';
COMMENT ON COLUMN warehouse.raw_conversion_events._source IS 'Source system or connector name.';
COMMENT ON COLUMN warehouse.raw_conversion_events._batch_id IS 'Connector batch identifier.';
COMMENT ON COLUMN warehouse.raw_conversion_events._loaded_at IS 'UTC timestamp the row was loaded.';
CREATE INDEX IF NOT EXISTS idx_raw_conversion_events_sync ON warehouse.raw_conversion_events (connector_sync_id);
CREATE INDEX IF NOT EXISTS idx_raw_conversion_events_tenant_date ON warehouse.raw_conversion_events (tenant_id, event_date);
CREATE INDEX IF NOT EXISTS idx_raw_conversion_events_account_date ON warehouse.raw_conversion_events (ad_account_id, event_date);
CREATE INDEX IF NOT EXISTS idx_raw_conversion_events_event_id ON warehouse.raw_conversion_events (event_id);
CREATE INDEX IF NOT EXISTS idx_raw_conversion_events_user_key ON warehouse.raw_conversion_events (privacy_safe_user_key);
CREATE INDEX IF NOT EXISTS idx_raw_conversion_events_order ON warehouse.raw_conversion_events (order_external_id);
CREATE INDEX IF NOT EXISTS idx_raw_conversion_events_hash ON warehouse.raw_conversion_events (raw_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_conversion_events_source_batch_hash
  ON warehouse.raw_conversion_events (_source, _batch_id, raw_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_conversion_events_source_event_id
  ON warehouse.raw_conversion_events (tenant_id, platform, _source, event_id)
  WHERE event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_conversion_events_semantic_hash
  ON warehouse.raw_conversion_events (
    tenant_id,
    platform,
    event_ts,
    event_name,
    coalesce(event_id, ''),
    coalesce(order_external_id, ''),
    raw_hash
  );

-- ----------------------------------------------------------------------------
-- Privileges for live-data readiness tables.
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON app.connector_syncs, app.experiment_designs TO admatix_app;
GRANT SELECT, INSERT ON app.proof_bundles TO admatix_app;
REVOKE UPDATE, DELETE, TRUNCATE ON app.proof_bundles FROM admatix_app;
GRANT SELECT ON app.connector_syncs, app.experiment_designs, app.proof_bundles TO admatix_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  warehouse.raw_platform_reports,
  warehouse.raw_entity_snapshots,
  warehouse.raw_conversion_events
TO admatix_app;
GRANT SELECT ON
  warehouse.raw_platform_reports,
  warehouse.raw_entity_snapshots,
  warehouse.raw_conversion_events
TO admatix_readonly;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO admatix_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA warehouse TO admatix_app;

COMMIT;
