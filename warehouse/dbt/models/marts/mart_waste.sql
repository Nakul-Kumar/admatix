{{ config(materialized='table', tags=['mart']) }}

with campaign_daily as (
  select
    fs.date_key,
    dd.full_date as metric_date,
    fs.account_key,
    fs.campaign_key,
    fs.platform_key,
    fs.spend,
    fs.conversions,
    sum(fs.spend) over (
      partition by fs.campaign_key
      order by dd.full_date
      rows between 6 preceding and current row
    )::numeric(18,4) as rolling_7d_spend,
    sum(fs.conversions) over (
      partition by fs.campaign_key
      order by dd.full_date
      rows between 6 preceding and current row
    )::numeric(18,4) as rolling_7d_conversions
  from {{ ref('fct_spend_daily') }} fs
  join {{ ref('dim_date') }} dd on dd.date_key = fs.date_key
),
campaign_waste as (
  select
    date_key,
    metric_date,
    account_key,
    campaign_key,
    null::bigint as creative_key,
    platform_key,
    'campaign_zero_conversion_window'::text as waste_type,
    campaign_key::text as waste_entity_id,
    rolling_7d_spend as wasted_spend,
    rolling_7d_conversions as conversions_in_window,
    7::integer as lookback_days
  from campaign_daily
  where rolling_7d_spend > 0
    and rolling_7d_conversions = 0
),
creative_daily as (
  select
    to_char(sc.metric_date, 'YYYYMMDD')::integer as date_key,
    sc.metric_date,
    da.account_key,
    dc.campaign_key,
    dcr.creative_key,
    dp.platform_key,
    sum(sc.spend)::numeric(18,4) as spend,
    sum(sc.conversions)::numeric(18,4) as conversions
  from {{ ref('silver_creative_daily') }} sc
  join {{ ref('dim_account') }} da on da.external_account_id = sc.account_key
  join {{ ref('dim_campaign') }} dc on dc.external_campaign_id = sc.campaign_key and dc.is_current
  left join {{ ref('dim_creative') }} dcr on dcr.external_creative_id = sc.creative_key and dcr.is_current
  join {{ ref('dim_platform') }} dp on dp.platform_code = sc.platform
  group by sc.metric_date, da.account_key, dc.campaign_key, dcr.creative_key, dp.platform_key
),
creative_waste as (
  select
    date_key,
    metric_date,
    account_key,
    campaign_key,
    creative_key,
    platform_key,
    'creative_zero_conversion'::text as waste_type,
    creative_key::text as waste_entity_id,
    spend as wasted_spend,
    conversions as conversions_in_window,
    1::integer as lookback_days
  from creative_daily
  where spend > 0
    and conversions = 0
)
select
  w.date_key,
  w.metric_date,
  w.account_key,
  da.tenant_id,
  da.platform,
  da.account_name,
  w.platform_key,
  dp.platform_name,
  w.campaign_key,
  dc.campaign_business_key,
  dc.external_campaign_id,
  dc.campaign_name,
  w.creative_key,
  dcr.external_creative_id,
  dcr.creative_format,
  w.waste_type,
  w.waste_entity_id,
  w.wasted_spend,
  w.conversions_in_window,
  w.lookback_days,
  false::boolean as dead_keyword_signal_available,
  now()::timestamptz as _loaded_at
from (
  select * from campaign_waste
  union all
  select * from creative_waste
) w
join {{ ref('dim_account') }} da on da.account_key = w.account_key
join {{ ref('dim_platform') }} dp on dp.platform_key = w.platform_key
join {{ ref('dim_campaign') }} dc on dc.campaign_key = w.campaign_key
left join {{ ref('dim_creative') }} dcr on dcr.creative_key = w.creative_key
