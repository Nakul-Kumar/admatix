{{ config(materialized='table') }}

select
  row_number() over (order by s.ad_set_business_key, s.valid_from) as ad_set_key,
  s.ad_set_business_key,
  c.campaign_key,
  s.external_ad_set_id,
  s.ad_set_name,
  s.status,
  s.bid_strategy,
  s.daily_budget,
  s.optimization_goal,
  s.valid_from,
  coalesce(s.valid_to, 'infinity'::timestamptz) as valid_to,
  s.valid_to is null as is_current,
  s.row_hash
from {{ ref('dim_ad_set_snapshot') }} s
join {{ ref('dim_campaign') }} c
  on c.campaign_business_key = s.campaign_business_key
 and c.is_current

