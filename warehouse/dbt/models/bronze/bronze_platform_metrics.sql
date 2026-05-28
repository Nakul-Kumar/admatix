{{ config(materialized='view') }}

with fixture_rows as (
  select
    row_number() over (order by metric_date, platform, external_account_id, campaign_external_id) as bronze_id,
    platform,
    external_account_id,
    campaign_external_id,
    metric_date::date as metric_date,
    spend::double precision as spend,
    impressions::bigint as impressions,
    clicks::bigint as clicks,
    conversions::double precision as conversions,
    platform_revenue::double precision as platform_revenue,
    currency,
    to_jsonb(admatix_platform_metrics_seed.*) as raw,
    now()::timestamptz as _loaded_at,
    _source,
    _batch_id,
    _row_hash::char(64) as _row_hash,
    null::uuid as connector_sync_id,
    null::uuid as connector_import_manifest_id
  from {{ ref('admatix_platform_metrics_seed') }} as admatix_platform_metrics_seed
),
live_rows as (
  select
    bronze_id,
    platform,
    external_account_id,
    campaign_external_id,
    metric_date,
    spend,
    impressions,
    clicks,
    conversions,
    platform_revenue,
    currency,
    raw,
    _loaded_at,
    _source,
    _batch_id,
    _row_hash,
    connector_sync_id,
    connector_import_manifest_id
  from {{ ref('bronze_raw_platform_reports') }}
)
select * from fixture_rows
union all
select * from live_rows
