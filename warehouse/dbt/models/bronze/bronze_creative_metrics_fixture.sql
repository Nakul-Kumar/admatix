{{ config(materialized='view') }}

select
  row_number() over (order by metric_date, platform, external_account_id, campaign_external_id, creative_external_id) as bronze_id,
  platform,
  external_account_id,
  campaign_external_id,
  creative_external_id,
  metric_date::date as metric_date,
  spend::double precision as spend,
  impressions::bigint as impressions,
  clicks::bigint as clicks,
  conversions::double precision as conversions,
  frequency::double precision as frequency,
  to_jsonb(admatix_creative_metrics_seed.*) as raw,
  now()::timestamptz as _loaded_at,
  _source,
  _batch_id,
  _row_hash::char(64) as _row_hash
from {{ ref('admatix_creative_metrics_seed') }} as admatix_creative_metrics_seed

