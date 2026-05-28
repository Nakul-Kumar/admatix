{{ config(materialized='view') }}

select
  raw_conversion_event_id as bronze_id,
  coalesce(
    raw_payload ->> 'external_account_id',
    raw_payload ->> 'account_id',
    raw_payload ->> 'store_id',
    'first_party'
  ) as external_account_id,
  coalesce(order_external_id, event_id, raw_conversion_event_id::text) as order_external_id,
  event_ts as order_ts,
  privacy_safe_user_key as customer_key,
  coalesce(revenue, 0)::double precision as revenue,
  coalesce(gross_margin, 0)::double precision as gross_margin,
  upper(currency)::char(3) as currency,
  coalesce(attribution ->> 'channel', platform::text) as channel,
  case
    when lower(coalesce(raw_payload ->> 'is_new_customer', 'false')) in ('1', 'true', 'yes') then 1
    else 0
  end::smallint as is_new_customer,
  raw_payload as raw,
  _loaded_at,
  _source,
  _batch_id,
  raw_hash::char(64) as _row_hash,
  connector_sync_id,
  connector_import_manifest_id
from {{ source('warehouse', 'raw_conversion_events') }}
