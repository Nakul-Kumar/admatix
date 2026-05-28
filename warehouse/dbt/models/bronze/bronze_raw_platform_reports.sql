{{ config(materialized='view') }}

select
  raw_report_id as bronze_id,
  platform,
  coalesce(
    dimensions ->> 'external_account_id',
    raw_payload ->> 'account_id',
    raw_payload ->> 'external_account_id'
  ) as external_account_id,
  coalesce(
    external_entity_id,
    dimensions ->> 'campaign_id',
    raw_payload ->> 'campaign_id'
  ) as campaign_external_id,
  report_date::date as metric_date,
  coalesce((metrics ->> 'spend')::double precision, 0) as spend,
  coalesce((metrics ->> 'impressions')::bigint, 0) as impressions,
  coalesce((metrics ->> 'clicks')::bigint, 0) as clicks,
  coalesce((metrics ->> 'conversions')::double precision, 0) as conversions,
  coalesce((metrics ->> 'platform_revenue')::double precision, 0) as platform_revenue,
  upper(coalesce(metrics ->> 'currency', raw_payload ->> 'currency', 'USD'))::char(3) as currency,
  raw_payload as raw,
  _loaded_at,
  _source,
  _batch_id,
  raw_hash::char(64) as _row_hash,
  connector_sync_id,
  connector_import_manifest_id
from {{ source('warehouse', 'raw_platform_reports') }}
where grain = 'campaign'
