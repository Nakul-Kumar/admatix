select *
from {{ ref('mart_agent_safety') }}
where (benchmark_score is not null and (benchmark_score < 0 or benchmark_score > 1))
   or (evidence_coverage is not null and (evidence_coverage < 0 or evidence_coverage > 1))
   or (rollback_coverage is not null and (rollback_coverage < 0 or rollback_coverage > 1))
   or (policy_block_rate is not null and (policy_block_rate < 0 or policy_block_rate > 1))
