{{ config(materialized='view') }}

select
  null::bigint as bronze_id,
  null::text as scenario_id,
  null::text as sim_campaign_id,
  null::text as event_type,
  null::timestamptz as event_ts,
  null::text as user_key,
  null::text as treatment_arm,
  null::double precision as spend,
  null::double precision as revenue,
  '{}'::jsonb as raw,
  now()::timestamptz as _loaded_at,
  'simulator_pending'::text as _source,
  'phase2_empty'::text as _batch_id,
  repeat('0', 64)::char(64) as _row_hash
where false

