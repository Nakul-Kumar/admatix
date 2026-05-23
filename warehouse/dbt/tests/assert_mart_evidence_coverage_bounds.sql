select *
from {{ ref('mart_evidence_coverage') }}
where coverage_pct < 0
   or coverage_pct > 1
   or ledger_visibility_pct < 0
   or ledger_visibility_pct > 1
   or complete_h0_action_count > proposed_action_count
   or ledger_visible_action_count > proposed_action_count
