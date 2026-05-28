{{ config(materialized='table', tags=['mart']) }}

with manifest_checks as (
  select
    cim.connector_import_manifest_id,
    cim.tenant_id,
    cim.manifest_key,
    cim.source,
    cim.source_kind,
    cim.platform,
    cim.object_type,
    cim.external_account_id,
    cim.row_count,
    cim.checksum_sha256,
    cim.imported_at,
    count(cqc.connector_quality_check_id)::bigint as check_count,
    count(*) filter (where cqc.status = 'fail')::bigint as failed_check_count,
    count(*) filter (where cqc.status = 'warn')::bigint as warning_check_count,
    max(cqc.created_at) as last_check_at
  from {{ source('app', 'connector_import_manifests') }} cim
  left join {{ source('app', 'connector_quality_checks') }} cqc
    on cqc.connector_import_manifest_id = cim.connector_import_manifest_id
  group by
    cim.connector_import_manifest_id,
    cim.tenant_id,
    cim.manifest_key,
    cim.source,
    cim.source_kind,
    cim.platform,
    cim.object_type,
    cim.external_account_id,
    cim.row_count,
    cim.checksum_sha256,
    cim.imported_at
)
select
  connector_import_manifest_id,
  tenant_id,
  manifest_key,
  source,
  source_kind,
  platform,
  object_type,
  external_account_id,
  row_count,
  checksum_sha256,
  imported_at,
  check_count,
  failed_check_count,
  warning_check_count,
  case
    when failed_check_count > 0 then 'fail'
    when warning_check_count > 0 then 'warn'
    else 'pass'
  end as quality_status,
  last_check_at,
  'directional_until_lift_test'::text as causal_status,
  false as proof_ready,
  now()::timestamptz as _loaded_at
from manifest_checks
