{{ config(materialized='view') }}

select
  null::bigint as bronze_id,
  null::text as bid_id,
  null::text as log_type,
  null::text as timestamp_raw,
  null::text as ipinyou_id,
  null::text as user_agent,
  null::text as ip,
  null::text as region,
  null::text as city,
  null::text as ad_exchange,
  null::text as domain,
  null::text as url,
  null::text as ad_slot_id,
  null::integer as ad_slot_width,
  null::integer as ad_slot_height,
  null::double precision as ad_slot_floor,
  null::double precision as bidding_price,
  null::double precision as paying_price,
  null::text as creative_id,
  null::text as advertiser_id,
  null::smallint as is_click,
  null::smallint as is_conversion,
  '{}'::jsonb as raw,
  now()::timestamptz as _loaded_at,
  'ipinyou_pending'::text as _source,
  'phase2_empty'::text as _batch_id,
  repeat('0', 64)::char(64) as _row_hash
where false

