select *
from {{ ref('mart_pacing') }}
where coalesce(spend, 0) < 0
   or coalesce(cumulative_spend, 0) < 0
   or coalesce(projected_overspend, 0) < 0
   or coalesce(elapsed_reporting_days, 0) < 0
