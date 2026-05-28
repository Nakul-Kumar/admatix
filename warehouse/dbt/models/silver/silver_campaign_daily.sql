{{ config(materialized='table') }}

with ranked as (
  select
    metric_date,
    platform::app.ad_platform as platform,
    external_account_id as account_key,
    campaign_external_id as campaign_key,
    greatest(spend, 0)::numeric(18,4) as spend,
    greatest(impressions, 0)::bigint as impressions,
    greatest(clicks, 0)::bigint as clicks,
    least(greatest(conversions, 0), greatest(clicks, 0))::numeric(18,4) as conversions,
    greatest(platform_revenue, 0)::numeric(18,4) as platform_revenue,
    upper(currency)::char(3) as currency,
    _source,
    _batch_id,
    connector_sync_id,
    connector_import_manifest_id,
    _row_hash,
    _loaded_at,
    row_number() over (
      partition by metric_date, platform, external_account_id, campaign_external_id
      order by _loaded_at desc, _row_hash
    ) as rn
  from {{ ref('bronze_platform_metrics') }}
)
select
  row_number() over (order by metric_date, platform, account_key, campaign_key) as silver_campaign_daily_id,
  metric_date,
  platform,
  account_key,
  campaign_key,
  spend,
  impressions,
  clicks,
  conversions,
  platform_revenue,
  currency,
  _source,
  _batch_id,
  connector_sync_id,
  connector_import_manifest_id,
  _row_hash,
  now()::timestamptz as _loaded_at
from ranked
where rn = 1
