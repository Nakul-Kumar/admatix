{{ config(materialized='table', tags=['mart']) }}

with daily as (
  select
    fs.date_key,
    dd.full_date as metric_date,
    fs.account_key,
    fs.campaign_key,
    fs.platform_key,
    dc.daily_budget,
    dc.lifetime_budget,
    dc.start_date,
    dc.end_date,
    fs.spend,
    sum(fs.spend) over (
      partition by fs.campaign_key
      order by dd.full_date
      rows between unbounded preceding and current row
    )::numeric(18,4) as cumulative_spend,
    count(*) over (
      partition by fs.campaign_key
      order by dd.full_date
      rows between unbounded preceding and current row
    )::integer as elapsed_reporting_days
  from {{ ref('fct_spend_daily') }} fs
  join {{ ref('dim_date') }} dd on dd.date_key = fs.date_key
  join {{ ref('dim_campaign') }} dc
    on dc.campaign_key = fs.campaign_key
   and dd.full_date >= dc.valid_from::date
   and dd.full_date < dc.valid_to::date
)
select
  d.date_key,
  d.metric_date,
  d.account_key,
  da.tenant_id,
  da.platform,
  da.account_name,
  d.platform_key,
  dp.platform_name,
  d.campaign_key,
  dc.campaign_business_key,
  dc.external_campaign_id,
  dc.campaign_name,
  dc.status as campaign_status,
  d.daily_budget,
  d.lifetime_budget,
  d.start_date,
  d.end_date,
  d.spend,
  d.cumulative_spend,
  d.elapsed_reporting_days,
  case
    when d.daily_budget is not null then (d.daily_budget * d.elapsed_reporting_days)::numeric(18,4)
    when d.lifetime_budget is not null and d.start_date is not null and d.end_date is not null
      then (d.lifetime_budget * d.elapsed_reporting_days / greatest((d.end_date - d.start_date + 1), 1))::numeric(18,4)
  end as planned_spend_to_date,
  case
    when d.daily_budget is not null then (d.cumulative_spend - (d.daily_budget * d.elapsed_reporting_days))::numeric(18,4)
    when d.lifetime_budget is not null and d.start_date is not null and d.end_date is not null
      then (d.cumulative_spend - (d.lifetime_budget * d.elapsed_reporting_days / greatest((d.end_date - d.start_date + 1), 1)))::numeric(18,4)
  end as pacing_variance,
  case
    when d.daily_budget is not null and d.daily_budget > 0
      then (d.cumulative_spend / (d.daily_budget * d.elapsed_reporting_days))::numeric(18,6)
    when d.lifetime_budget is not null and d.start_date is not null and d.end_date is not null and d.lifetime_budget > 0
      then (d.cumulative_spend / (d.lifetime_budget * d.elapsed_reporting_days / greatest((d.end_date - d.start_date + 1), 1)))::numeric(18,6)
  end as pacing_ratio,
  case
    when d.end_date is not null then greatest((d.end_date - d.metric_date), 0)
  end as days_remaining,
  case
    when d.end_date is not null and d.elapsed_reporting_days > 0
      then (d.cumulative_spend / d.elapsed_reporting_days * greatest((d.end_date - d.start_date + 1), 1))::numeric(18,4)
  end as projected_total_spend,
  case
    when d.lifetime_budget is not null and d.end_date is not null and d.elapsed_reporting_days > 0
      then greatest((d.cumulative_spend / d.elapsed_reporting_days * greatest((d.end_date - d.start_date + 1), 1)) - d.lifetime_budget, 0)::numeric(18,4)
    when d.daily_budget is not null
      then greatest(d.spend - d.daily_budget, 0)::numeric(18,4)
  end as projected_overspend,
  now()::timestamptz as _loaded_at
from daily d
join {{ ref('dim_account') }} da on da.account_key = d.account_key
join {{ ref('dim_platform') }} dp on dp.platform_key = d.platform_key
join {{ ref('dim_campaign') }} dc on dc.campaign_key = d.campaign_key
