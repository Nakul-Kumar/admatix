{{ config(materialized='table') }}

select
  1::bigint as geo_key,
  'US'::text as geo_business_key,
  'US'::char(2) as country_code,
  'United States'::text as country_name,
  null::text as region,
  null::text as region_code,
  null::text as city,
  null::text as metro_code,
  null::text as postal_code

