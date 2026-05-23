{{ config(materialized='table', tags=['mart']) }}

select
  null::uuid as run_id,
  null::text as agent_id
where false
