{{ config(materialized='view') }}

select
  null::bigint as bronze_id,
  null::double precision as f0, null::double precision as f1, null::double precision as f2,
  null::double precision as f3, null::double precision as f4, null::double precision as f5,
  null::double precision as f6, null::double precision as f7, null::double precision as f8,
  null::double precision as f9, null::double precision as f10, null::double precision as f11,
  null::smallint as treatment,
  null::smallint as conversion,
  null::smallint as visit,
  null::smallint as exposure,
  '{}'::jsonb as raw,
  now()::timestamptz as _loaded_at,
  'criteo_uplift_pending'::text as _source,
  'phase2_empty'::text as _batch_id,
  repeat('0', 64)::char(64) as _row_hash
where false

