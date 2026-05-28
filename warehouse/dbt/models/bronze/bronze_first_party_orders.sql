{{ config(materialized='view') }}

with fixture_rows as (
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
    _row_hash::char(64) as _row_hash,
    null::uuid as connector_sync_id,
    null::uuid as connector_import_manifest_id
  from {{ ref('admatix_first_party_orders_seed') }} as admatix_first_party_orders_seed
),
live_rows as (
  select
    bronze_id,
    external_account_id,
    order_external_id,
    order_ts,
    customer_key,
    revenue,
    gross_margin,
    currency,
    channel,
    is_new_customer,
    raw,
    _loaded_at,
    _source,
    _batch_id,
    _row_hash,
    connector_sync_id,
    connector_import_manifest_id
  from {{ ref('bronze_raw_conversion_events') }}
)
select * from fixture_rows
union all
select * from live_rows

