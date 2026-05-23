{% snapshot dim_ad_set_snapshot %}
{{
  config(
    target_schema='warehouse',
    unique_key='ad_set_business_key',
    strategy='check',
    check_cols=['ad_set_name', 'status', 'bid_strategy', 'daily_budget', 'optimization_goal'],
    snapshot_meta_column_names={'dbt_valid_from': 'valid_from', 'dbt_valid_to': 'valid_to'}
  )
}}

select
  ad_set_business_key,
  campaign_business_key,
  external_ad_set_id,
  ad_set_name,
  status::app.entity_status as status,
  bid_strategy,
  daily_budget::numeric(18,4) as daily_budget,
  optimization_goal,
  true as is_current,
  repeat(md5(concat_ws('|', ad_set_name, status, bid_strategy, daily_budget, optimization_goal)), 2)::char(64) as row_hash
from {{ ref('admatix_ad_sets_seed') }}

{% endsnapshot %}

