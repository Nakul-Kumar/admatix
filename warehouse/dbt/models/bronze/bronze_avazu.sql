{{ config(materialized='view') }}

select
  null::bigint as bronze_id,
  null::text as ad_id,
  null::smallint as click,
  null::text as hour_raw,
  null::text as c1,
  null::text as banner_pos,
  null::text as site_id,
  null::text as site_domain,
  null::text as site_category,
  null::text as app_id,
  null::text as app_domain,
  null::text as app_category,
  null::text as device_id,
  null::text as device_ip,
  null::text as device_model,
  null::text as device_type,
  null::text as device_conn_type,
  '{}'::jsonb as raw,
  now()::timestamptz as _loaded_at,
  'avazu_pending'::text as _source,
  'phase2_empty'::text as _batch_id,
  repeat('0', 64)::char(64) as _row_hash
where false

