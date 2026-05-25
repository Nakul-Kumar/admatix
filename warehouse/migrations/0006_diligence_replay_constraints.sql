BEGIN;

-- ============================================================================
-- AdMatix Diligence Hardening -- replay-safe approvals and dry-run diffs.
--
-- This migration is intentionally introspective. Some environments have the
-- canonical relational app tables from WP-L, while the Supabase Store path also
-- expects Store-compatible tables with `id text` + `body jsonb`. Enforce the
-- same replay-safety invariant on whichever shape exists:
--
--   * newly minted approval receipts may carry expiry + HMAC signature fields;
--   * one proposed action can have only one terminal approval receipt;
--   * one proposed action can produce only one execution diff;
--   * Store JSONB bodies cannot replay the same receipt_id or action_id.
-- ============================================================================

ALTER TABLE IF EXISTS app.approval_receipts
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS signature text;

COMMENT ON COLUMN app.approval_receipts.expires_at IS
  'UTC expiry for newly minted approval receipts. Null is allowed for legacy imported artifacts only.';
COMMENT ON COLUMN app.approval_receipts.signature IS
  'Hex HMAC signature over the canonical approval receipt payload. Null is allowed for legacy imported artifacts only.';

DO $$
BEGIN
  IF to_regclass('app.approval_receipts') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'app'
        AND table_name = 'approval_receipts'
        AND column_name = 'decided_at'
    )
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'ck_approval_receipts_expiry_after_decision'
        AND conrelid = 'app.approval_receipts'::regclass
    ) THEN
      ALTER TABLE app.approval_receipts
        ADD CONSTRAINT ck_approval_receipts_expiry_after_decision
        CHECK (expires_at IS NULL OR expires_at > decided_at)
        NOT VALID;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'ck_approval_receipts_signature_hex'
        AND conrelid = 'app.approval_receipts'::regclass
    ) THEN
      ALTER TABLE app.approval_receipts
        ADD CONSTRAINT ck_approval_receipts_signature_hex
        CHECK (signature IS NULL OR signature ~ '^[0-9a-f]{64}$')
        NOT VALID;
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('app.approval_receipts') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'app'
        AND table_name = 'approval_receipts'
        AND column_name IN ('tenant_id', 'proposed_action_id')
      GROUP BY table_schema, table_name
      HAVING count(*) = 2
    )
  THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_receipts_action_once
        ON app.approval_receipts (tenant_id, proposed_action_id)
        WHERE proposed_action_id IS NOT NULL
    $sql$;
  END IF;

  IF to_regclass('app.approval_receipts') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'app'
        AND table_name = 'approval_receipts'
        AND column_name IN ('tenant_id', 'h0_packet_id', 'proposed_action_id')
      GROUP BY table_schema, table_name
      HAVING count(*) = 3
    )
  THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_receipts_packet_action_once
        ON app.approval_receipts (tenant_id, h0_packet_id, proposed_action_id)
        WHERE h0_packet_id IS NOT NULL AND proposed_action_id IS NOT NULL
    $sql$;
  END IF;

  IF to_regclass('app.execution_diffs') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'app'
        AND table_name = 'execution_diffs'
        AND column_name IN ('tenant_id', 'proposed_action_id')
      GROUP BY table_schema, table_name
      HAVING count(*) = 2
    )
  THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS uq_execution_diffs_action_once
        ON app.execution_diffs (tenant_id, proposed_action_id)
        WHERE proposed_action_id IS NOT NULL
    $sql$;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'app'
      AND table_name = 'approval_receipts'
      AND column_name = 'body'
      AND data_type = 'jsonb'
  ) THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS uq_store_approval_receipts_receipt_id
        ON app.approval_receipts ((body->>'receipt_id'))
        WHERE body ? 'receipt_id'
    $sql$;

    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS uq_store_approval_receipts_action_id
        ON app.approval_receipts ((coalesce(body->>'action_id', body->>'proposed_action_id')))
        WHERE coalesce(body->>'action_id', body->>'proposed_action_id') IS NOT NULL
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'app'
      AND table_name = 'execution_diffs'
      AND column_name = 'body'
      AND data_type = 'jsonb'
  ) THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS uq_store_execution_diffs_action_id
        ON app.execution_diffs ((coalesce(body->>'action_id', body->>'proposed_action_id')))
        WHERE coalesce(body->>'action_id', body->>'proposed_action_id') IS NOT NULL
    $sql$;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('app.uq_approval_receipts_action_once') IS NOT NULL THEN
    COMMENT ON INDEX app.uq_approval_receipts_action_once IS
      'Replay guard: a proposed action can have only one terminal human receipt.';
  END IF;
  IF to_regclass('app.uq_execution_diffs_action_once') IS NOT NULL THEN
    COMMENT ON INDEX app.uq_execution_diffs_action_once IS
      'Replay guard: a proposed action can produce only one dry-run execution diff.';
  END IF;
END;
$$;

COMMIT;
