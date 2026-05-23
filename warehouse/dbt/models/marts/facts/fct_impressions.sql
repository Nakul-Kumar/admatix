{{ config(materialized='incremental', unique_key='impression_id') }}

with base as (
  select
    to_char(s.metric_date, 'YYYYMMDD')::integer as date_key,
    a.account_key,
    c.campaign_key,
    null::bigint as ad_set_key,
    null::bigint as creative_key,
    p.platform_key,
    1::bigint as geo_key,
    1::bigint as audience_key,
    1::smallint as device_key,
    s.metric_date::timestamptz as impression_ts,
    s.impressions,
    case when s.impressions > 0 then (s.spend / s.impressions)::numeric(18,6) else 0::numeric(18,6) end as cost,
    s._source
  from {{ ref('silver_campaign_daily') }} s
  join {{ ref('dim_account') }} a on a.account_business_key = s.account_key
  join {{ ref('dim_campaign') }} c on c.campaign_business_key = s.campaign_key and c.is_current
  join {{ ref('dim_platform') }} p on p.platform_code = s.platform
)
select
  row_number() over (order by date_key, campaign_key) as impression_id,
  date_key,
  account_key,
  campaign_key,
  ad_set_key,
  creative_key,
  platform_key,
  geo_key,
  audience_key,
  device_key,
  impression_ts,
  impressions,
  cost,
  _source,
  now()::timestamptz as _loaded_at
from base
where impressions > 0
{% if is_incremental() %}
  and not exists (
    select 1 from {{ this }} existing
    where existing.date_key = base.date_key
      and existing.campaign_key = base.campaign_key
      and existing.impression_ts = base.impression_ts
  )
{% endif %}

