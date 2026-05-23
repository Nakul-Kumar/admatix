{{ config(materialized='view') }}

select
  null::bigint as bronze_id,
  null::integer as recency,
  null::text as history_segment,
  null::double precision as history,
  null::smallint as mens,
  null::smallint as womens,
  null::text as zip_code,
  null::smallint as newbie,
  null::text as channel,
  null::text as segment,
  null::smallint as visit,
  null::smallint as conversion,
  null::double precision as spend,
  '{}'::jsonb as raw,
  now()::timestamptz as _loaded_at,
  'hillstrom_pending'::text as _source,
  'phase2_empty'::text as _batch_id,
  repeat('0', 64)::char(64) as _row_hash
where false

