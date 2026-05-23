{% snapshot dim_campaign_snapshot %}
{{
  config(
    target_schema='warehouse',
    unique_key='campaign_business_key',
    strategy='check',
    check_cols=['campaign_name', 'objective', 'status', 'daily_budget', 'lifetime_budget', 'bid_strategy'],
    snapshot_meta_column_names={'dbt_valid_from': 'valid_from', 'dbt_valid_to': 'valid_to'}
  )
}}

select
  campaign_business_key,
  account_business_key,
  platform::app.ad_platform as platform,
  external_campaign_id,
  campaign_name,
  objective,
  status::app.entity_status as status,
  daily_budget::numeric(18,4) as daily_budget,
  lifetime_budget::numeric(18,4) as lifetime_budget,
  start_date::date as start_date,
  end_date::date as end_date,
  bid_strategy,
  true as is_current,
  repeat(md5(concat_ws('|', campaign_name, objective, status, daily_budget, lifetime_budget, bid_strategy)), 2)::char(64) as row_hash
from {{ ref('admatix_campaigns_seed') }}

{% endsnapshot %}

