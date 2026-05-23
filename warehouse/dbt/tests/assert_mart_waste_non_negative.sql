select *
from {{ ref('mart_waste') }}
where wasted_spend < 0
   or conversions_in_window < 0
   or lookback_days <= 0
