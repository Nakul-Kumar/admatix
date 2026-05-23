{{ config(materialized='table') }}

with ranked as (
  select
    metric_date,
    platform::app.ad_platform as platform,
    external_account_id as account_key,
    campaign_external_id as campaign_key,
    creative_external_id as creative_key,
    greatest(spend, 0)::numeric(18,4) as spend,
    greatest(impressions, 0)::bigint as impressions,
    greatest(clicks, 0)::bigint as clicks,
    least(greatest(conversions, 0), greatest(clicks, 0))::numeric(18,4) as conversions,
    frequency::numeric(12,4) as frequency,
    _source,
    _batch_id,
    _loaded_at,
    row_number() over (
      partition by metric_date, platform, external_account_id, campaign_external_id, creative_external_id
      order by _loaded_at desc, _row_hash
    ) as rn
  from {{ ref('bronze_creative_metrics_fixture') }}
)
select
  row_number() over (order by metric_date, platform, account_key, campaign_key, creative_key) as silver_creative_daily_id,
  metric_date,
  platform,
  account_key,
  campaign_key,
  creative_key,
  spend,
  impressions,
  clicks,
  conversions,
  frequency,
  _source,
  _batch_id,
  now()::timestamptz as _loaded_at
from ranked
where rn = 1

