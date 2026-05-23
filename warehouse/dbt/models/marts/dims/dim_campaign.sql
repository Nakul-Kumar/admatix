{{ config(materialized='table') }}

select
  row_number() over (order by s.campaign_business_key, s.valid_from) as campaign_key,
  s.campaign_business_key,
  a.account_key,
  s.platform,
  s.external_campaign_id,
  s.campaign_name,
  s.objective,
  s.status,
  s.daily_budget,
  s.lifetime_budget,
  s.start_date,
  s.end_date,
  s.valid_from,
  coalesce(s.valid_to, 'infinity'::timestamptz) as valid_to,
  s.valid_to is null as is_current,
  s.row_hash
from {{ ref('dim_campaign_snapshot') }} s
join {{ ref('dim_account') }} a
  on a.account_business_key = s.account_business_key

