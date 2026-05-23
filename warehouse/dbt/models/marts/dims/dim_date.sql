{{ config(materialized='table') }}

with spine as (
  {{ dbt_utils.date_spine(
      datepart="day",
      start_date="cast('" ~ var('admatix_date_spine_start') ~ "' as date)",
      end_date="cast('" ~ var('admatix_date_spine_end') ~ "' as date)"
  ) }}
),
dates as (
  select date_day::date as full_date
  from spine
)
select
  to_char(full_date, 'YYYYMMDD')::integer as date_key,
  full_date,
  extract(isodow from full_date)::smallint as day_of_week,
  trim(to_char(full_date, 'Day')) as day_name,
  extract(day from full_date)::smallint as day_of_month,
  extract(doy from full_date)::smallint as day_of_year,
  extract(week from full_date)::smallint as week_of_year,
  extract(week from full_date)::smallint as iso_week,
  extract(month from full_date)::smallint as month_number,
  trim(to_char(full_date, 'Month')) as month_name,
  extract(quarter from full_date)::smallint as quarter,
  extract(year from full_date)::smallint as year,
  extract(isodow from full_date) in (6, 7) as is_weekend,
  full_date = date_trunc('month', full_date)::date as is_month_start,
  full_date = (date_trunc('month', full_date)::date + interval '1 month - 1 day')::date as is_month_end
from dates

