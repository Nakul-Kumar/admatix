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
  persistCsvImport,
} from "./import-persistence.js";
export type {
  PersistCsvImportOptions,
  PersistCsvImportResult,
  QueryExecutor,
} from "./import-persistence.js";
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
export {
  CredentialRef,
  createEnvCredentialResolver,
  credentialRefKind,
  parseCredentialRef,
  redactCredentialRef,
  redactCredentialValue,
} from "./credential-ref.js";
export type {
  CredentialMaterial,
  CredentialResolver,
} from "./credential-ref.js";
export {
  assertReadOnlyHttpRequest,
  createFetchTransport,
  redactHttpRequest,
} from "./http-transport.js";
export type {
  HttpRequest,
  HttpResponse,
  HttpTransport,
} from "./http-transport.js";
export {
  ConnectorCassette,
  createCassetteTransport,
  loadConnectorCassette,
} from "./cassette-transport.js";
export type { ConnectorCassette as ConnectorCassetteT } from "./cassette-transport.js";
export {
  GOOGLE_ADS_API_VERSION,
  GOOGLE_ADS_REPORTING_SCOPE,
  googleAdsReadOnlyCapabilities,
  previewGoogleAds,
} from "./google-ads-readonly.js";
export type {
  GoogleAdsPreviewOptions,
  GoogleAdsPreviewRows,
} from "./google-ads-readonly.js";
export {
  ConnectorPreviewInput,
  ConnectorPreviewResult,
  previewConnector,
} from "./preview.js";
export type {
  ConnectorPreviewInput as ConnectorPreviewInputT,
  ConnectorPreviewResult as ConnectorPreviewResultT,
} from "./preview.js";
