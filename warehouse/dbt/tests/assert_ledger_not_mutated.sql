select 'ledger_protection_missing' as failure_reason
where not exists (
  select 1
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'ledger'
    and c.relname = 'action_events'
    and t.tgname in ('trg_action_events_no_update', 'trg_action_events_no_delete', 'trg_action_events_no_truncate')
    and not t.tgisinternal
  group by c.oid
  having count(*) = 3
)
