import { describe, expect, it } from "vitest";
import {
  ConnectorReadRequest,
  assertReadOnlyCapabilities,
} from "./read-contract.js";

describe("read-only connector contract", () => {
  it("accepts OAuth and MCP read-only connector capabilities", () => {
    const google = assertReadOnlyCapabilities({
      connector_id: "google_ads_reporting",
      connector_version: "0.1.0",
      source_kind: "oauth_readonly",
      platform: "google_ads",
      supported_sync_types: ["performance_report", "entity_snapshot"],
      supported_object_types: ["platform_report", "entity_snapshot"],
      api_version: "v20",
      scopes: ["https://www.googleapis.com/auth/adwords.readonly"],
      methods: ["discoverAccounts", "syncFacts", "syncDimensions"],
    });
    expect(google.platform).toBe("google_ads");

    const mcp = assertReadOnlyCapabilities({
      connector_id: "platform_mcp_reader",
      connector_version: "0.1.0",
      source_kind: "platform_mcp",
      platform: "meta_ads",
      supported_sync_types: ["performance_report"],
      supported_object_types: ["platform_report"],
      methods: ["previewReport"],
    });
    expect(mcp.source_kind).toBe("platform_mcp");
  });

  it("rejects write-like scopes and methods", () => {
    expect(() =>
      assertReadOnlyCapabilities({
        connector_id: "unsafe_meta",
        connector_version: "0.1.0",
        source_kind: "oauth_readonly",
        platform: "meta_ads",
        supported_sync_types: ["performance_report"],
        supported_object_types: ["platform_report"],
        scopes: ["ads_management"],
        methods: ["syncFacts"],
      }),
    ).toThrow(/write-like scope/);

    expect(() =>
      assertReadOnlyCapabilities({
        connector_id: "unsafe_google",
        connector_version: "0.1.0",
        source_kind: "api_pull",
        platform: "google_ads",
        supported_sync_types: ["performance_report"],
        supported_object_types: ["platform_report"],
        scopes: ["readonly"],
        methods: ["pauseCampaign"],
      }),
    ).toThrow(/write-like method/);
  });

  it("forces connector read requests to remain dry-run only", () => {
    expect(() =>
      ConnectorReadRequest.parse({
        request_id: "req_1",
        tenant_id: "tenant_demo",
        platform: "google_ads",
        source_kind: "oauth_readonly",
        object_type: "platform_report",
        sync_type: "performance_report",
        dry_run_only: false,
      }),
    ).toThrow();
  });
});
