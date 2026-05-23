{{ config(materialized='table') }}

select
  row_number() over (order by s.creative_business_key, s.valid_from) as creative_key,
  s.creative_business_key,
  c.campaign_key,
  a.ad_set_key,
  s.external_creative_id,
  s.creative_format,
  s.headline,
  s.body_text,
  s.final_url,
  s.policy_status,
  s.status,
  s.valid_from,
  coalesce(s.valid_to, 'infinity'::timestamptz) as valid_to,
  s.valid_to is null as is_current,
  s.row_hash
from {{ ref('dim_creative_snapshot') }} s
join {{ ref('dim_campaign') }} c
  on c.campaign_business_key = s.campaign_business_key
 and c.is_current
left join {{ ref('dim_ad_set') }} a
  on a.ad_set_business_key = s.ad_set_business_key
 and a.is_current

