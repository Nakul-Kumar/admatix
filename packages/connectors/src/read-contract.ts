import { Platform, z } from "@admatix/schemas";
import {
  ConnectorSourceKind,
  ImportObjectType,
  type ConnectorSourceKind as ConnectorSourceKindT,
  type ImportObjectType as ImportObjectTypeT,
} from "./import-manifest.js";

const FORBIDDEN_SCOPE = /write|mutate|manage|management|edit|delete|create|publish|campaign_management/i;
const FORBIDDEN_METHOD = /^(create|update|delete|remove|patch|put|post|write|set|mutate|send|execute|upload|publish|pause|resume|activate|deactivate)/i;

export const ConnectorSyncType = z.enum([
  "account_discovery",
  "entity_snapshot",
  "performance_report",
  "conversion_import",
  "experiment_import",
]);
export type ConnectorSyncType = z.infer<typeof ConnectorSyncType>;

export const ReadOnlyConnectorCapabilities = z.object({
  connector_id: z.string(),
  connector_version: z.string(),
  source_kind: ConnectorSourceKind,
  platform: Platform,
  supported_sync_types: z.array(ConnectorSyncType).min(1),
  supported_object_types: z.array(ImportObjectType).min(1),
  api_version: z.string().optional(),
  scopes: z.array(z.string()).default([]),
  methods: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});
export type ReadOnlyConnectorCapabilities = z.infer<typeof ReadOnlyConnectorCapabilities>;
export type ReadOnlyConnectorCapabilitiesInput = z.input<typeof ReadOnlyConnectorCapabilities>;

export const ConnectorReadRequest = z.object({
  request_id: z.string(),
  tenant_id: z.string(),
  platform: Platform,
  source_kind: ConnectorSourceKind,
  object_type: ImportObjectType,
  sync_type: ConnectorSyncType,
  account_id: z.string().optional(),
  window: z.string().optional(),
  dry_run_only: z.literal(true).default(true),
  params: z.record(z.unknown()).default({}),
});
export type ConnectorReadRequest = z.infer<typeof ConnectorReadRequest>;

export interface ReadOnlyConnectorWorker {
  readonly capabilities: ReadOnlyConnectorCapabilities;
  preview(request: ConnectorReadRequest): Promise<{
    row_count: number;
    source: string;
    file_name?: string;
    checksum_sha256?: string;
    object_type: ImportObjectTypeT;
    source_kind: ConnectorSourceKindT;
  }>;
}

export function assertReadOnlyCapabilities(
  capabilities: ReadOnlyConnectorCapabilitiesInput,
): ReadOnlyConnectorCapabilities {
  const parsed = ReadOnlyConnectorCapabilities.parse(capabilities);
  const forbiddenScopes = parsed.scopes.filter((scope) => FORBIDDEN_SCOPE.test(scope));
  if (forbiddenScopes.length > 0) {
    throw new Error(
      `connector ${parsed.connector_id} declares write-like scope(s): ${forbiddenScopes.join(", ")}`,
    );
  }
  const forbiddenMethods = parsed.methods.filter((method) => FORBIDDEN_METHOD.test(method));
  if (forbiddenMethods.length > 0) {
    throw new Error(
      `connector ${parsed.connector_id} declares write-like method(s): ${forbiddenMethods.join(", ")}`,
    );
  }
  return parsed;
}
