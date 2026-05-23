with currents as (
  select 'campaign' as dim_name, campaign_business_key as business_key
  from {{ ref('dim_campaign_snapshot') }}
  where valid_to is null
  union all
  select 'ad_set', ad_set_business_key
  from {{ ref('dim_ad_set_snapshot') }}
  where valid_to is null
  union all
  select 'creative', creative_business_key
  from {{ ref('dim_creative_snapshot') }}
  where valid_to is null
)
select dim_name, business_key, count(*) as current_rows
from currents
group by dim_name, business_key
having count(*) > 1

