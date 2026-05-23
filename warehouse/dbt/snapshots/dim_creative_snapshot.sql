{% snapshot dim_creative_snapshot %}
{{
  config(
    target_schema='warehouse',
    unique_key='creative_business_key',
    strategy='check',
    check_cols=['creative_format', 'headline', 'body_text', 'final_url', 'policy_status', 'status'],
    snapshot_meta_column_names={'dbt_valid_from': 'valid_from', 'dbt_valid_to': 'valid_to'}
  )
}}

select
  creative_business_key,
  campaign_business_key,
  ad_set_business_key,
  external_creative_id,
  creative_format,
  headline,
  body_text,
  final_url,
  policy_status,
  status::app.entity_status as status,
  true as is_current,
  repeat(md5(concat_ws('|', creative_format, headline, body_text, final_url, policy_status, status)), 2)::char(64) as row_hash
from {{ ref('admatix_creatives_seed') }}

{% endsnapshot %}

