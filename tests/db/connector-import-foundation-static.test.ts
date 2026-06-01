import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../../warehouse/migrations/0007_connector_import_foundation.sql", import.meta.url)),
  "utf8",
);
const promotionMigration = readFileSync(
  fileURLToPath(new URL("../../warehouse/migrations/0008_live_import_promotion.sql", import.meta.url)),
  "utf8",
);
const applyMigrations = readFileSync(
  fileURLToPath(new URL("../../scripts/db/apply-migrations.ts", import.meta.url)),
  "utf8",
);

describe("connector import foundation migration", () => {
  it("is wired into the migration runner", () => {
    expect(applyMigrations).toContain("0007_connector_import_foundation.sql");
    expect(applyMigrations).toContain("0008_live_import_promotion.sql");
  });

  it("defines the manifest, quality, cursor, job, and bronze manifest tables", () => {
    for (const table of [
      "app.connector_jobs",
      "app.connector_cursors",
      "app.connector_import_manifests",
      "app.connector_quality_checks",
      "warehouse.bronze_file_manifests",
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it("keeps manifests and quality checks append-only for the app role", () => {
    expect(migration).toContain("GRANT SELECT, INSERT ON");
    expect(migration).toContain("REVOKE UPDATE, DELETE, TRUNCATE ON");
    expect(migration).toContain("app.connector_import_manifests");
    expect(migration).toContain("app.connector_quality_checks");
    expect(migration).toContain("warehouse.bronze_file_manifests");
  });

  it("grants read-only manifest visibility for audit readers", () => {
    expect(migration).toContain("GRANT SELECT ON");
    expect(migration).toContain("TO admatix_readonly");
    expect(migration).toContain("app.connector_import_manifests");
    expect(migration).toContain("app.connector_quality_checks");
  });

  it("supports manual, read-only OAuth, and MCP-sourced batches", () => {
    expect(migration).toContain("'manual_export'");
    expect(migration).toContain("'oauth_readonly'");
    expect(migration).toContain("'platform_mcp'");
  });

  it("links raw platform and conversion rows back to import manifests", () => {
    expect(promotionMigration).toContain("warehouse.raw_platform_reports");
    expect(promotionMigration).toContain("warehouse.raw_conversion_events");
    expect(promotionMigration).toContain("connector_import_manifest_id");
    expect(promotionMigration).toContain("uq_raw_platform_reports_import_semantic");
    expect(promotionMigration).toContain("uq_raw_conversion_events_import_semantic");
  });
});
