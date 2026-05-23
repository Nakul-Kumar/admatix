BEGIN;

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
END;
$$;

DO $$
BEGIN
  EXECUTE format('GRANT admatix_app TO %I', current_user);
  EXECUTE format('GRANT admatix_readonly TO %I', current_user);
END;
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
  SELECT encode(extensions.digest(convert_to((p_payload || '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex')::char(64);
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
  SELECT encode(extensions.digest(convert_to(coalesce(p_text, ''), 'UTF8'), 'sha256'), 'hex')::char(64);
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

COMMIT;
