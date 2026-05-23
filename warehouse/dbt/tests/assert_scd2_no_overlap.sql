with ranges as (
  select 'campaign' as dim_name, campaign_business_key as business_key, valid_from, coalesce(valid_to, 'infinity'::timestamptz) as valid_to
  from {{ ref('dim_campaign_snapshot') }}
  union all
  select 'ad_set', ad_set_business_key, valid_from, coalesce(valid_to, 'infinity'::timestamptz)
  from {{ ref('dim_ad_set_snapshot') }}
  union all
  select 'creative', creative_business_key, valid_from, coalesce(valid_to, 'infinity'::timestamptz)
  from {{ ref('dim_creative_snapshot') }}
)
select a.dim_name, a.business_key, a.valid_from, a.valid_to
from ranges a
join ranges b
  on a.dim_name = b.dim_name
 and a.business_key = b.business_key
 and a.valid_from < b.valid_to
 and b.valid_from < a.valid_to
 and a.valid_from <> b.valid_from

