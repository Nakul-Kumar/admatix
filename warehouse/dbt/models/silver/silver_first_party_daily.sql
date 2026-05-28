{{ config(materialized='table') }}

select
  row_number() over (order by order_ts::date, external_account_id) as silver_first_party_daily_id,
  order_ts::date as metric_date,
  external_account_id as account_key,
  sum(greatest(revenue, 0))::numeric(18,4) as revenue,
  count(*)::bigint as orders,
  sum(greatest(coalesce(gross_margin, 0), 0))::numeric(18,4) as gross_margin,
  sum(case when is_new_customer = 1 then 1 else 0 end)::bigint as new_customers,
  max(upper(currency))::char(3) as currency,
  min(_source) as _source,
  min(_batch_id) as _batch_id,
  min(connector_sync_id) as connector_sync_id,
  min(connector_import_manifest_id) as connector_import_manifest_id,
  min(_row_hash) as _row_hash,
  now()::timestamptz as _loaded_at
from {{ ref('bronze_first_party_orders') }}
group by order_ts::date, external_account_id
