BEGIN;

-- ============================================================================
-- AdMatix Data Layer -- Part 3: warehouse schema stub
-- The bronze/silver/gold physical tables are owned by WP-N/WP-O dbt work.
-- WP-L creates the schema and grants so later warehouse migrations have a
-- stable namespace to target.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS warehouse;

COMMENT ON SCHEMA warehouse IS
  'Medallion data warehouse: bronze raw landing tables, silver cleaned/conformed tables, and a gold star schema (dimensions + facts). Bronze/silver/gold transforms are managed by dbt.';

GRANT USAGE ON SCHEMA warehouse TO admatix_app, admatix_readonly;

COMMIT;
