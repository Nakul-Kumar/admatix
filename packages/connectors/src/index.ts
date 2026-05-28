/**
 * @admatix/connectors — read-only adapters over a uniform `Connector` interface.
 *
 * MVP rule: every connector is READ-ONLY. The interface defines no write methods,
 * so no caller can mutate a platform through this package. Live adapters are
 * post-MVP; today only `fixtureConnector()` (reading `data/fixtures/`) is wired up.
 */
export type { Connector } from "./connector.js";
export { fixtureConnector } from "./fixture-connector.js";
export {
  buildCsvImportManifest,
  parseCsvRows,
  ConnectorSourceKind,
  ImportManifest,
  ImportObjectType,
  ImportQualityCheck,
  ImportQualityStatus,
} from "./import-manifest.js";
export {
  ConnectorReadRequest,
  ConnectorSyncType,
  ReadOnlyConnectorCapabilities,
  assertReadOnlyCapabilities,
} from "./read-contract.js";
export type {
  BuildCsvImportManifestOptions,
  CsvParseResult,
  ConnectorSourceKind as ConnectorSourceKindT,
  ImportManifest as ImportManifestT,
  ImportObjectType as ImportObjectTypeT,
  ImportQualityCheck as ImportQualityCheckT,
  ImportQualityStatus as ImportQualityStatusT,
} from "./import-manifest.js";
export type {
  ConnectorReadRequest as ConnectorReadRequestT,
  ConnectorSyncType as ConnectorSyncTypeT,
  ReadOnlyConnectorCapabilities as ReadOnlyConnectorCapabilitiesT,
  ReadOnlyConnectorCapabilitiesInput,
  ReadOnlyConnectorWorker,
} from "./read-contract.js";
export { resolveAccountRef } from "./resolve-ref.js";
export type { AccountRef } from "./resolve-ref.js";
export { redactConnectorSecrets } from "./redact.js";
