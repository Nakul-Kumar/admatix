{{ config(materialized='incremental', unique_key='conversion_id') }}

with base as (
  select
    to_char(s.conversion_ts::date, 'YYYYMMDD')::integer as date_key,
    a.account_key,
    null::bigint as campaign_key,
    null::bigint as ad_set_key,
    null::bigint as creative_key,
    p.platform_key,
    1::bigint as geo_key,
    1::bigint as audience_key,
    1::smallint as device_key,
    s.conversion_ts,
    1::numeric(18,4) as conversions,
    s.revenue,
    s.is_first_party,
    s.attribution_model,
    s._source,
    s._batch_id,
    s.connector_sync_id,
    s.connector_import_manifest_id,
    s._row_hash,
    s.conversion_key
  from {{ ref('silver_conversions') }} s
  join {{ ref('dim_account') }} a on a.account_business_key = s.account_key
  join {{ ref('dim_platform') }} p on p.platform_code = 'first_party'::app.ad_platform
)
select
  row_number() over (order by conversion_ts, conversion_key) as conversion_id,
  date_key,
  account_key,
  campaign_key,
  ad_set_key,
  creative_key,
  platform_key,
  geo_key,
  audience_key,
  device_key,
  conversion_ts,
  conversions,
  revenue,
  is_first_party,
  attribution_model,
  _source,
  _batch_id,
  connector_sync_id,
  connector_import_manifest_id,
  _row_hash,
  now()::timestamptz as _loaded_at
from base
{% if is_incremental() %}
where not exists (
  select 1 from {{ this }} existing
  where existing.conversion_ts = base.conversion_ts
    and existing.account_key = base.account_key
    and existing.revenue = base.revenue
)
{% endif %}

