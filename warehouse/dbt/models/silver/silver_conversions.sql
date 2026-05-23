{{ config(materialized='table') }}

select
  row_number() over (order by order_ts, external_account_id, order_external_id) as silver_conversion_id,
  order_external_id as conversion_key,
  external_account_id as account_key,
  null::text as campaign_key,
  null::text as creative_key,
  order_ts as conversion_ts,
  customer_key,
  greatest(revenue, 0)::numeric(18,4) as revenue,
  true as is_first_party,
  'first_party_order'::text as attribution_model,
  _source,
  _batch_id,
  now()::timestamptz as _loaded_at
from {{ ref('bronze_first_party_orders') }}

