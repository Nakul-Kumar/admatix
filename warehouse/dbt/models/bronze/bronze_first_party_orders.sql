{{ config(materialized='view') }}

select
  row_number() over (order by order_ts, external_account_id, order_external_id) as bronze_id,
  external_account_id,
  order_external_id,
  order_ts::timestamptz as order_ts,
  customer_key,
  revenue::double precision as revenue,
  gross_margin::double precision as gross_margin,
  currency,
  channel,
  is_new_customer::smallint as is_new_customer,
  to_jsonb(admatix_first_party_orders_seed.*) as raw,
  now()::timestamptz as _loaded_at,
  _source,
  _batch_id,
  _row_hash::char(64) as _row_hash
from {{ ref('admatix_first_party_orders_seed') }} as admatix_first_party_orders_seed

