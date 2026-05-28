BEGIN;

-- AdMatix Data Layer -- Part 9: live import promotion
-- Adds lineage from connector import manifests into lossless raw warehouse rows.
-- This keeps CSV/manual exports queryable without promoting them to proof.

ALTER TABLE warehouse.raw_platform_reports
  ADD COLUMN IF NOT EXISTS connector_import_manifest_id uuid;

ALTER TABLE warehouse.raw_conversion_events
  ADD COLUMN IF NOT EXISTS connector_import_manifest_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_raw_platform_reports_import_manifest'
      AND conrelid = 'warehouse.raw_platform_reports'::regclass
  ) THEN
    ALTER TABLE warehouse.raw_platform_reports
      ADD CONSTRAINT fk_raw_platform_reports_import_manifest
      FOREIGN KEY (connector_import_manifest_id)
      REFERENCES app.connector_import_manifests (connector_import_manifest_id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_raw_conversion_events_import_manifest'
      AND conrelid = 'warehouse.raw_conversion_events'::regclass
  ) THEN
    ALTER TABLE warehouse.raw_conversion_events
      ADD CONSTRAINT fk_raw_conversion_events_import_manifest
      FOREIGN KEY (connector_import_manifest_id)
      REFERENCES app.connector_import_manifests (connector_import_manifest_id)
      ON DELETE SET NULL;
  END IF;
END
$$;

COMMENT ON COLUMN warehouse.raw_platform_reports.connector_import_manifest_id IS
  'Import manifest that landed this raw platform report row, if CSV/manual/API import backed.';
COMMENT ON COLUMN warehouse.raw_conversion_events.connector_import_manifest_id IS
  'Import manifest that landed this raw first-party conversion row, if CSV/manual/API import backed.';

CREATE INDEX IF NOT EXISTS idx_raw_platform_reports_import_manifest_id
  ON warehouse.raw_platform_reports (connector_import_manifest_id);
CREATE INDEX IF NOT EXISTS idx_raw_conversion_events_import_manifest_id
  ON warehouse.raw_conversion_events (connector_import_manifest_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_platform_reports_import_semantic
  ON warehouse.raw_platform_reports (
    connector_import_manifest_id,
    report_date,
    grain,
    coalesce(external_entity_id, ''),
    raw_hash
  )
  WHERE connector_import_manifest_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_conversion_events_import_semantic
  ON warehouse.raw_conversion_events (
    connector_import_manifest_id,
    event_date,
    event_name,
    coalesce(event_id, ''),
    coalesce(order_external_id, ''),
    raw_hash
  )
  WHERE connector_import_manifest_id IS NOT NULL;

GRANT SELECT, INSERT ON
  warehouse.raw_platform_reports,
  warehouse.raw_conversion_events
TO admatix_app;

REVOKE UPDATE, DELETE, TRUNCATE ON
  warehouse.raw_platform_reports,
  warehouse.raw_conversion_events
FROM admatix_app;

COMMIT;
