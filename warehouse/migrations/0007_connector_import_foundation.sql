BEGIN;

-- ============================================================================
-- AdMatix Data Layer -- Part 8: connector import foundation
-- Read-only import manifests, connector jobs/cursors, and data-quality results.
-- ============================================================================

-- This migration complements 0005_live_data_readiness.sql. 0005 records syncs
-- and raw landings; this migration adds the planning/provenance layer needed
-- for CSV/manual exports and future read-only OAuth/API connectors.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'connector_source_kind'
  ) THEN
    CREATE TYPE app.connector_source_kind AS ENUM (
      'csv_upload', 'manual_export', 'api_pull', 'oauth_readonly',
      'platform_mcp', 'fixture'
    );
  END IF;
END;
$$;
COMMENT ON TYPE app.connector_source_kind IS
  'How a source batch entered AdMatix: CSV upload, manual platform export, read-only API pull, OAuth read-only connector, platform MCP, or fixture.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'connector_job_status'
  ) THEN
    CREATE TYPE app.connector_job_status AS ENUM (
      'active', 'paused', 'disabled'
    );
  END IF;
END;
$$;
COMMENT ON TYPE app.connector_job_status IS
  'Scheduling state for a read-only connector job.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'connector_import_object_type'
  ) THEN
    CREATE TYPE app.connector_import_object_type AS ENUM (
      'platform_report',
      'entity_snapshot',
      'conversion_event',
      'account',
      'campaign',
      'ad_set',
      'ad',
      'creative',
      'order',
      'payment',
      'unknown'
    );
  END IF;
END;
$$;
COMMENT ON TYPE app.connector_import_object_type IS
  'Object type represented by a connector import manifest.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'app'
       AND t.typname = 'data_quality_status'
  ) THEN
    CREATE TYPE app.data_quality_status AS ENUM (
      'pass', 'warn', 'fail'
    );
  END IF;
END;
$$;
COMMENT ON TYPE app.data_quality_status IS
  'Result of a data-quality check. Failed checks block promotion to proof.';

-- ----------------------------------------------------------------------------
-- Table: app.connector_jobs -- scheduled read-only connector work.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.connector_jobs (
  connector_job_id uuid                         NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid                         NOT NULL,
  connection_id    uuid,
  ad_account_id    uuid,
  platform         app.ad_platform              NOT NULL,
  sync_type        app.connector_sync_type      NOT NULL,
  status           app.connector_job_status     NOT NULL DEFAULT 'paused',
  job_key          text                         NOT NULL,
  schedule         text,
  api_version      text,
  field_mapping_version text                    NOT NULL DEFAULT 'manual-v1',
  params           jsonb                        NOT NULL DEFAULT '{}'::jsonb,
  last_run_at      timestamptz,
  next_run_at      timestamptz,
  created_at       timestamptz                  NOT NULL DEFAULT now(),
  updated_at       timestamptz                  NOT NULL DEFAULT now(),

  CONSTRAINT pk_connector_jobs PRIMARY KEY (connector_job_id),
  CONSTRAINT fk_connector_jobs_tenant FOREIGN KEY (tenant_id)
    REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_connector_jobs_connection FOREIGN KEY (connection_id)
    REFERENCES app.connections (connection_id) ON DELETE SET NULL,
  CONSTRAINT fk_connector_jobs_account FOREIGN KEY (ad_account_id)
    REFERENCES app.ad_accounts (ad_account_id) ON DELETE SET NULL,
  CONSTRAINT uq_connector_jobs_key UNIQUE (tenant_id, job_key)
);

COMMENT ON TABLE app.connector_jobs IS
  'Read-only connector schedules and configuration. Jobs describe what may be pulled; connector_syncs records each run.';
COMMENT ON COLUMN app.connector_jobs.connector_job_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN app.connector_jobs.tenant_id IS 'Owning tenant (FK app.tenants).';
COMMENT ON COLUMN app.connector_jobs.connection_id IS 'Credential reference used by the job, if OAuth/API backed.';
COMMENT ON COLUMN app.connector_jobs.ad_account_id IS 'Ad account targeted by the job, if known.';
COMMENT ON COLUMN app.connector_jobs.platform IS 'Source platform.';
COMMENT ON COLUMN app.connector_jobs.sync_type IS 'Sync kind this job runs.';
COMMENT ON COLUMN app.connector_jobs.status IS 'Scheduling state: active, paused, or disabled.';
COMMENT ON COLUMN app.connector_jobs.job_key IS 'Stable per-tenant job key used for idempotent scheduler registration.';
COMMENT ON COLUMN app.connector_jobs.schedule IS 'Human-readable or cron-like schedule string.';
COMMENT ON COLUMN app.connector_jobs.api_version IS 'Platform API version pinned for the job.';
COMMENT ON COLUMN app.connector_jobs.field_mapping_version IS 'Version of source-field to AdMatix-schema mapping.';
COMMENT ON COLUMN app.connector_jobs.params IS 'Read-only source parameters such as breakdowns, fields, or date repair window.';
COMMENT ON COLUMN app.connector_jobs.last_run_at IS 'UTC timestamp of the most recent connector_sync for this job.';
COMMENT ON COLUMN app.connector_jobs.next_run_at IS 'UTC timestamp when the scheduler should run the job next.';
COMMENT ON COLUMN app.connector_jobs.created_at IS 'UTC creation timestamp.';
COMMENT ON COLUMN app.connector_jobs.updated_at IS 'UTC timestamp of the last mutation.';

CREATE INDEX IF NOT EXISTS idx_connector_jobs_tenant_id ON app.connector_jobs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_connector_jobs_connection_id ON app.connector_jobs (connection_id);
CREATE INDEX IF NOT EXISTS idx_connector_jobs_account_id ON app.connector_jobs (ad_account_id);
CREATE INDEX IF NOT EXISTS idx_connector_jobs_platform ON app.connector_jobs (platform);
CREATE INDEX IF NOT EXISTS idx_connector_jobs_status ON app.connector_jobs (status);
CREATE INDEX IF NOT EXISTS idx_connector_jobs_next_run_at ON app.connector_jobs (next_run_at);
DROP TRIGGER IF EXISTS trg_connector_jobs_touch ON app.connector_jobs;
CREATE TRIGGER trg_connector_jobs_touch BEFORE UPDATE ON app.connector_jobs
  FOR EACH ROW EXECUTE FUNCTION public.admatix_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Table: app.connector_cursors -- idempotent source cursor state.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.connector_cursors (
  connector_cursor_id uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  connector_job_id    uuid        NOT NULL,
  source_key          text        NOT NULL,
  cursor              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  last_successful_connector_sync_id uuid,
  last_successful_at  timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_connector_cursors PRIMARY KEY (connector_cursor_id),
  CONSTRAINT fk_connector_cursors_tenant FOREIGN KEY (tenant_id)
    REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_connector_cursors_job FOREIGN KEY (connector_job_id)
    REFERENCES app.connector_jobs (connector_job_id) ON DELETE CASCADE,
  CONSTRAINT fk_connector_cursors_sync FOREIGN KEY (last_successful_connector_sync_id)
    REFERENCES app.connector_syncs (connector_sync_id) ON DELETE SET NULL,
  CONSTRAINT uq_connector_cursors_source UNIQUE (tenant_id, connector_job_id, source_key)
);

COMMENT ON TABLE app.connector_cursors IS
  'Opaque per-job cursor state. Cursor advances only after raw landing and quality checks pass.';
COMMENT ON COLUMN app.connector_cursors.connector_cursor_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN app.connector_cursors.tenant_id IS 'Owning tenant (FK app.tenants).';
COMMENT ON COLUMN app.connector_cursors.connector_job_id IS 'Connector job that owns the cursor.';
COMMENT ON COLUMN app.connector_cursors.source_key IS 'Source-specific cursor key, for example customer_id/report_type.';
COMMENT ON COLUMN app.connector_cursors.cursor IS 'Opaque source cursor JSON.';
COMMENT ON COLUMN app.connector_cursors.last_successful_connector_sync_id IS 'Last successful sync that advanced this cursor.';
COMMENT ON COLUMN app.connector_cursors.last_successful_at IS 'UTC timestamp when cursor last advanced.';
COMMENT ON COLUMN app.connector_cursors.created_at IS 'UTC creation timestamp.';
COMMENT ON COLUMN app.connector_cursors.updated_at IS 'UTC timestamp of the last mutation.';

CREATE INDEX IF NOT EXISTS idx_connector_cursors_tenant_id ON app.connector_cursors (tenant_id);
CREATE INDEX IF NOT EXISTS idx_connector_cursors_job_id ON app.connector_cursors (connector_job_id);
CREATE INDEX IF NOT EXISTS idx_connector_cursors_sync_id ON app.connector_cursors (last_successful_connector_sync_id);
DROP TRIGGER IF EXISTS trg_connector_cursors_touch ON app.connector_cursors;
CREATE TRIGGER trg_connector_cursors_touch BEFORE UPDATE ON app.connector_cursors
  FOR EACH ROW EXECUTE FUNCTION public.admatix_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Table: app.connector_import_manifests -- CSV/manual/API batch provenance.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.connector_import_manifests (
  connector_import_manifest_id uuid      NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                    uuid      NOT NULL,
  connector_sync_id            uuid,
  manifest_key                 text      NOT NULL,
  source                       text      NOT NULL,
  source_kind                  app.connector_source_kind NOT NULL,
  platform                     app.ad_platform NOT NULL,
  object_type                  app.connector_import_object_type NOT NULL,
  external_account_id          text,
  file_name                    text      NOT NULL,
  storage_uri                  text,
  row_count                    integer   NOT NULL,
  column_count                 integer   NOT NULL,
  columns                      text[]    NOT NULL DEFAULT '{}',
  checksum_sha256              char(64)  NOT NULL,
  manifest_body                jsonb     NOT NULL DEFAULT '{}'::jsonb,
  manifest_hash                char(64) GENERATED ALWAYS AS (public.admatix_sha256_jsonb(manifest_body)) STORED,
  imported_by                  text,
  imported_at                  timestamptz NOT NULL DEFAULT now(),
  created_at                   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_connector_import_manifests PRIMARY KEY (connector_import_manifest_id),
  CONSTRAINT fk_connector_import_manifests_tenant FOREIGN KEY (tenant_id)
    REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_connector_import_manifests_sync FOREIGN KEY (connector_sync_id)
    REFERENCES app.connector_syncs (connector_sync_id) ON DELETE SET NULL,
  CONSTRAINT uq_connector_import_manifests_key UNIQUE (tenant_id, manifest_key),
  CONSTRAINT ck_connector_import_manifests_rows CHECK (row_count >= 0 AND column_count >= 0),
  CONSTRAINT ck_connector_import_manifests_checksum CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE app.connector_import_manifests IS
  'Source-batch provenance for CSV/manual exports and future read-only API pulls. Stores checksums and manifest metadata, not raw secret values.';
COMMENT ON COLUMN app.connector_import_manifests.connector_import_manifest_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN app.connector_import_manifests.tenant_id IS 'Owning tenant (FK app.tenants).';
COMMENT ON COLUMN app.connector_import_manifests.connector_sync_id IS 'Optional sync attempt that produced this manifest.';
COMMENT ON COLUMN app.connector_import_manifests.manifest_key IS 'Deterministic manifest id from the connector package, e.g. import_<hash>.';
COMMENT ON COLUMN app.connector_import_manifests.source IS 'Source label, e.g. google_ads_export.';
COMMENT ON COLUMN app.connector_import_manifests.source_kind IS 'Entry path: CSV upload, manual export, API pull, OAuth read-only connector, platform MCP, or fixture.';
COMMENT ON COLUMN app.connector_import_manifests.platform IS 'Platform represented by the import.';
COMMENT ON COLUMN app.connector_import_manifests.object_type IS 'Object represented by the import batch.';
COMMENT ON COLUMN app.connector_import_manifests.external_account_id IS 'Platform-native account id/ref when available.';
COMMENT ON COLUMN app.connector_import_manifests.file_name IS 'Original filename or source object name.';
COMMENT ON COLUMN app.connector_import_manifests.storage_uri IS 'Optional immutable bronze object URI. Never a local temp path.';
COMMENT ON COLUMN app.connector_import_manifests.row_count IS 'Number of data rows parsed from the import.';
COMMENT ON COLUMN app.connector_import_manifests.column_count IS 'Number of source columns parsed from the import.';
COMMENT ON COLUMN app.connector_import_manifests.columns IS 'Source column headers as parsed.';
COMMENT ON COLUMN app.connector_import_manifests.checksum_sha256 IS 'SHA-256 of the source bytes.';
COMMENT ON COLUMN app.connector_import_manifests.manifest_body IS 'Full manifest JSON emitted by the connector package.';
COMMENT ON COLUMN app.connector_import_manifests.manifest_hash IS 'SHA-256 of manifest_body.';
COMMENT ON COLUMN app.connector_import_manifests.imported_by IS 'Actor id/email/service that created the import.';
COMMENT ON COLUMN app.connector_import_manifests.imported_at IS 'UTC timestamp supplied by the importer.';
COMMENT ON COLUMN app.connector_import_manifests.created_at IS 'UTC timestamp this row was written.';

CREATE INDEX IF NOT EXISTS idx_connector_import_manifests_tenant_id ON app.connector_import_manifests (tenant_id);
CREATE INDEX IF NOT EXISTS idx_connector_import_manifests_sync_id ON app.connector_import_manifests (connector_sync_id);
CREATE INDEX IF NOT EXISTS idx_connector_import_manifests_source ON app.connector_import_manifests (source);
CREATE INDEX IF NOT EXISTS idx_connector_import_manifests_platform ON app.connector_import_manifests (platform);
CREATE INDEX IF NOT EXISTS idx_connector_import_manifests_imported_at ON app.connector_import_manifests (imported_at);
CREATE INDEX IF NOT EXISTS idx_connector_import_manifests_checksum ON app.connector_import_manifests (checksum_sha256);

-- ----------------------------------------------------------------------------
-- Table: app.connector_quality_checks -- queryable data-quality results.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.connector_quality_checks (
  connector_quality_check_id uuid      NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                  uuid      NOT NULL,
  connector_sync_id          uuid,
  connector_import_manifest_id uuid,
  proof_bundle_id            uuid,
  check_id                   text      NOT NULL,
  status                     app.data_quality_status NOT NULL,
  severity                   text      NOT NULL DEFAULT 'info',
  message                    text      NOT NULL,
  affected_rows              integer,
  sample_refs                text[]    NOT NULL DEFAULT '{}',
  metadata                   jsonb     NOT NULL DEFAULT '{}'::jsonb,
  created_at                 timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_connector_quality_checks PRIMARY KEY (connector_quality_check_id),
  CONSTRAINT fk_connector_quality_checks_tenant FOREIGN KEY (tenant_id)
    REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_connector_quality_checks_sync FOREIGN KEY (connector_sync_id)
    REFERENCES app.connector_syncs (connector_sync_id) ON DELETE SET NULL,
  CONSTRAINT fk_connector_quality_checks_manifest FOREIGN KEY (connector_import_manifest_id)
    REFERENCES app.connector_import_manifests (connector_import_manifest_id) ON DELETE CASCADE,
  CONSTRAINT fk_connector_quality_checks_bundle FOREIGN KEY (proof_bundle_id)
    REFERENCES app.proof_bundles (proof_bundle_id) ON DELETE SET NULL,
  CONSTRAINT ck_connector_quality_checks_affected CHECK (affected_rows IS NULL OR affected_rows >= 0),
  CONSTRAINT ck_connector_quality_checks_severity CHECK (severity IN ('info', 'warning', 'error'))
);

COMMENT ON TABLE app.connector_quality_checks IS
  'Normalized data-quality results for connector syncs and import manifests. Failed checks block proof promotion.';
COMMENT ON COLUMN app.connector_quality_checks.connector_quality_check_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN app.connector_quality_checks.tenant_id IS 'Owning tenant (FK app.tenants).';
COMMENT ON COLUMN app.connector_quality_checks.connector_sync_id IS 'Sync run this check belongs to, if API backed.';
COMMENT ON COLUMN app.connector_quality_checks.connector_import_manifest_id IS 'Import manifest this check belongs to, if file/manual backed.';
COMMENT ON COLUMN app.connector_quality_checks.proof_bundle_id IS 'Proof bundle affected by this check, if already promoted.';
COMMENT ON COLUMN app.connector_quality_checks.check_id IS 'Stable check identifier, e.g. non_negative_numeric_metrics.';
COMMENT ON COLUMN app.connector_quality_checks.status IS 'Check result: pass, warn, fail.';
COMMENT ON COLUMN app.connector_quality_checks.severity IS 'Severity label: info, warning, error.';
COMMENT ON COLUMN app.connector_quality_checks.message IS 'Human-readable result message.';
COMMENT ON COLUMN app.connector_quality_checks.affected_rows IS 'Number of rows affected, if applicable.';
COMMENT ON COLUMN app.connector_quality_checks.sample_refs IS 'Optional row/object references for examples. Do not include raw PII.';
COMMENT ON COLUMN app.connector_quality_checks.metadata IS 'Structured diagnostic metadata.';
COMMENT ON COLUMN app.connector_quality_checks.created_at IS 'UTC timestamp this row was written.';

CREATE INDEX IF NOT EXISTS idx_connector_quality_checks_tenant_id ON app.connector_quality_checks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_connector_quality_checks_sync_id ON app.connector_quality_checks (connector_sync_id);
CREATE INDEX IF NOT EXISTS idx_connector_quality_checks_manifest_id ON app.connector_quality_checks (connector_import_manifest_id);
CREATE INDEX IF NOT EXISTS idx_connector_quality_checks_bundle_id ON app.connector_quality_checks (proof_bundle_id);
CREATE INDEX IF NOT EXISTS idx_connector_quality_checks_check_id ON app.connector_quality_checks (check_id);
CREATE INDEX IF NOT EXISTS idx_connector_quality_checks_status ON app.connector_quality_checks (status);

-- ----------------------------------------------------------------------------
-- Table: warehouse.bronze_file_manifests -- immutable object manifests.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouse.bronze_file_manifests (
  bronze_file_manifest_id bigint     GENERATED ALWAYS AS IDENTITY,
  tenant_id               uuid       NOT NULL,
  connector_sync_id       uuid,
  connector_import_manifest_id uuid,
  storage_uri             text       NOT NULL,
  source                  text       NOT NULL,
  source_kind             app.connector_source_kind NOT NULL,
  platform                app.ad_platform NOT NULL,
  object_type             app.connector_import_object_type NOT NULL,
  file_name               text       NOT NULL,
  content_type            text,
  compressed              boolean    NOT NULL DEFAULT false,
  row_count               integer    NOT NULL,
  byte_size               bigint,
  checksum_sha256         char(64)   NOT NULL,
  columns                 text[]     NOT NULL DEFAULT '{}',
  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_bronze_file_manifests PRIMARY KEY (bronze_file_manifest_id),
  CONSTRAINT fk_bronze_file_manifests_tenant FOREIGN KEY (tenant_id)
    REFERENCES app.tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_bronze_file_manifests_sync FOREIGN KEY (connector_sync_id)
    REFERENCES app.connector_syncs (connector_sync_id) ON DELETE SET NULL,
  CONSTRAINT fk_bronze_file_manifests_import FOREIGN KEY (connector_import_manifest_id)
    REFERENCES app.connector_import_manifests (connector_import_manifest_id) ON DELETE SET NULL,
  CONSTRAINT ck_bronze_file_manifests_rows CHECK (row_count >= 0),
  CONSTRAINT ck_bronze_file_manifests_bytes CHECK (byte_size IS NULL OR byte_size >= 0),
  CONSTRAINT ck_bronze_file_manifests_checksum CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT uq_bronze_file_manifests_storage_uri UNIQUE (tenant_id, storage_uri)
);

COMMENT ON TABLE warehouse.bronze_file_manifests IS
  'Immutable storage manifest for raw bronze files such as JSONL/Parquet/CSV objects. Raw data lives in object storage, not Git.';
COMMENT ON COLUMN warehouse.bronze_file_manifests.bronze_file_manifest_id IS 'Surrogate identity primary key.';
COMMENT ON COLUMN warehouse.bronze_file_manifests.tenant_id IS 'Owning tenant (FK app.tenants).';
COMMENT ON COLUMN warehouse.bronze_file_manifests.connector_sync_id IS 'Sync run that produced the file, if any.';
COMMENT ON COLUMN warehouse.bronze_file_manifests.connector_import_manifest_id IS 'Import manifest that describes the source file, if any.';
COMMENT ON COLUMN warehouse.bronze_file_manifests.storage_uri IS 'Immutable object-storage URI, e.g. s3:// or r2:// path.';
COMMENT ON COLUMN warehouse.bronze_file_manifests.source IS 'Source label, e.g. google_ads_export.';
COMMENT ON COLUMN warehouse.bronze_file_manifests.source_kind IS 'Entry path: CSV upload, manual export, API pull, OAuth read-only connector, platform MCP, or fixture.';
COMMENT ON COLUMN warehouse.bronze_file_manifests.platform IS 'Platform represented by the file.';
COMMENT ON COLUMN warehouse.bronze_file_manifests.object_type IS 'Object represented by the file.';
COMMENT ON COLUMN warehouse.bronze_file_manifests.file_name IS 'Original source filename.';
COMMENT ON COLUMN warehouse.bronze_file_manifests.content_type IS 'MIME/content type for the object.';
COMMENT ON COLUMN warehouse.bronze_file_manifests.compressed IS 'True if the object is compressed.';
COMMENT ON COLUMN warehouse.bronze_file_manifests.row_count IS 'Number of source rows in the file.';
COMMENT ON COLUMN warehouse.bronze_file_manifests.byte_size IS 'Byte size of the stored object.';
COMMENT ON COLUMN warehouse.bronze_file_manifests.checksum_sha256 IS 'SHA-256 of the stored object bytes.';
COMMENT ON COLUMN warehouse.bronze_file_manifests.columns IS 'Source columns if tabular.';
COMMENT ON COLUMN warehouse.bronze_file_manifests.created_at IS 'UTC timestamp this row was written.';

CREATE INDEX IF NOT EXISTS idx_bronze_file_manifests_tenant_id ON warehouse.bronze_file_manifests (tenant_id);
CREATE INDEX IF NOT EXISTS idx_bronze_file_manifests_sync_id ON warehouse.bronze_file_manifests (connector_sync_id);
CREATE INDEX IF NOT EXISTS idx_bronze_file_manifests_import_id ON warehouse.bronze_file_manifests (connector_import_manifest_id);
CREATE INDEX IF NOT EXISTS idx_bronze_file_manifests_platform ON warehouse.bronze_file_manifests (platform);
CREATE INDEX IF NOT EXISTS idx_bronze_file_manifests_checksum ON warehouse.bronze_file_manifests (checksum_sha256);

-- ----------------------------------------------------------------------------
-- Privileges.
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  app.connector_jobs,
  app.connector_cursors
TO admatix_app;
GRANT SELECT, INSERT ON
  app.connector_import_manifests,
  app.connector_quality_checks
TO admatix_app;
REVOKE UPDATE, DELETE, TRUNCATE ON
  app.connector_import_manifests,
  app.connector_quality_checks
FROM admatix_app;

GRANT SELECT, INSERT ON warehouse.bronze_file_manifests TO admatix_app;
REVOKE UPDATE, DELETE, TRUNCATE ON warehouse.bronze_file_manifests FROM admatix_app;

GRANT SELECT ON
  app.connector_jobs,
  app.connector_cursors,
  app.connector_import_manifests,
  app.connector_quality_checks,
  warehouse.bronze_file_manifests
TO admatix_readonly;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO admatix_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA warehouse TO admatix_app;

COMMIT;
