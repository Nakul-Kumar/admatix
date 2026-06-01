select *
from {{ ref('mart_import_quality_status') }}
where proof_ready <> false
   or causal_status <> 'directional_until_lift_test'
