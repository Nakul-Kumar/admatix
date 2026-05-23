{{ config(materialized='table', tags=['mart']) }}

with spend as (
  select
    fs.date_key,
    fs.account_key,
    fs.campaign_key,
    fs.platform_key,
    sum(fs.spend)::numeric(18,4) as spend,
    sum(fs.impressions)::bigint as impressions,
    sum(fs.clicks)::bigint as clicks,
    sum(fs.conversions)::numeric(18,4) as platform_conversions,
    sum(fs.platform_revenue)::numeric(18,4) as platform_revenue,
    max(fs.currency)::char(3) as currency
  from {{ ref('fct_spend_daily') }} fs
  group by fs.date_key, fs.account_key, fs.campaign_key, fs.platform_key
),
first_party as (
  select
    to_char(sf.metric_date, 'YYYYMMDD')::integer as date_key,
    da.account_key,
    sum(sf.revenue)::numeric(18,4) as first_party_revenue,
    sum(sf.orders)::bigint as orders,
    sum(sf.gross_margin)::numeric(18,4) as gross_margin,
    sum(sf.new_customers)::bigint as new_customers
  from {{ ref('silver_first_party_daily') }} sf
  join {{ ref('dim_account') }} da
    on da.external_account_id = sf.account_key
  group by to_char(sf.metric_date, 'YYYYMMDD')::integer, da.account_key
)
select
  s.date_key,
  dd.full_date as metric_date,
  s.account_key,
  da.tenant_id,
  da.platform,
  da.external_account_id,
  da.account_name,
  s.platform_key,
  dp.platform_name,
  dp.platform_family,
  s.campaign_key,
  dc.campaign_business_key,
  dc.external_campaign_id,
  dc.campaign_name,
  dc.objective,
  dc.status as campaign_status,
  s.currency,
  s.spend,
  s.impressions,
  s.clicks,
  s.platform_conversions,
  coalesce(fp.orders, 0)::bigint as first_party_orders,
  s.platform_revenue,
  coalesce(fp.first_party_revenue, 0)::numeric(18,4) as first_party_revenue,
  coalesce(fp.gross_margin, 0)::numeric(18,4) as gross_margin,
  coalesce(fp.new_customers, 0)::bigint as new_customers,
  case when s.impressions > 0 then (s.clicks::numeric / s.impressions)::numeric(18,6) end as ctr,
  case when s.clicks > 0 then (s.platform_conversions / s.clicks)::numeric(18,6) end as cvr,
  case when s.spend > 0 then (s.platform_revenue / s.spend)::numeric(18,6) end as platform_roas,
  case when s.spend > 0 then (coalesce(fp.first_party_revenue, 0) / s.spend)::numeric(18,6) end as first_party_roas,
  case when s.platform_conversions > 0 then (s.spend / s.platform_conversions)::numeric(18,6) end as cac,
  case when coalesce(fp.first_party_revenue, 0) > 0 then (s.spend / fp.first_party_revenue)::numeric(18,6) end as mer,
  now()::timestamptz as _loaded_at
from spend s
join {{ ref('dim_date') }} dd on dd.date_key = s.date_key
join {{ ref('dim_account') }} da on da.account_key = s.account_key
join {{ ref('dim_platform') }} dp on dp.platform_key = s.platform_key
join {{ ref('dim_campaign') }} dc on dc.campaign_key = s.campaign_key
left join first_party fp
  on fp.date_key = s.date_key
 and fp.account_key = s.account_key
