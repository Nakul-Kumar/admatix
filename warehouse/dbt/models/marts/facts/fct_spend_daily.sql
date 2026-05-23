{{ config(materialized='incremental', unique_key='spend_daily_id') }}

with base as (
  select
    to_char(s.metric_date, 'YYYYMMDD')::integer as date_key,
    a.account_key,
    c.campaign_key,
    null::bigint as ad_set_key,
    p.platform_key,
    s.spend,
    s.impressions,
    s.clicks,
    s.conversions,
    s.platform_revenue,
    s.currency,
    s._source
  from {{ ref('silver_campaign_daily') }} s
  join {{ ref('dim_account') }} a on a.account_business_key = s.account_key
  join {{ ref('dim_campaign') }} c on c.campaign_business_key = s.campaign_key and c.is_current
  join {{ ref('dim_platform') }} p on p.platform_code = s.platform
)
select
  row_number() over (order by date_key, campaign_key) as spend_daily_id,
  date_key,
  account_key,
  campaign_key,
  ad_set_key,
  platform_key,
  spend,
  impressions,
  clicks,
  conversions,
  platform_revenue,
  currency,
  _source,
  now()::timestamptz as _loaded_at
from base
{% if is_incremental() %}
where not exists (
  select 1 from {{ this }} existing
  where existing.date_key = base.date_key
    and existing.campaign_key = base.campaign_key
    and coalesce(existing.ad_set_key, -1) = coalesce(base.ad_set_key, -1)
)
{% endif %}

