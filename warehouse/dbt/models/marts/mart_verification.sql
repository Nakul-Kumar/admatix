{{ config(materialized='table', tags=['mart']) }}

select
  null::integer as date_key,
  null::uuid as h0_packet_id
where false
