select *
from {{ ref('mart_verification') }}
where lift_ci_low is not null
  and lift_ci_high is not null
  and lift_ci_high < lift_ci_low
