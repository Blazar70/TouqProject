-- Touq / طوق — backing for the expanded admin page: a manual billing status
-- per clinic (not wired to any real payment processor — just a flag admin
-- sets, foundation for "disable based on payments" later) and an audit log
-- of admin actions (who did what, to which clinic/user, when).

alter table clinics
  add column billing_status text not null default 'active'
    check (billing_status in ('active', 'trial', 'overdue', 'cancelled'));

create table admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles (id) on delete set null,
  -- Denormalized so the log entry still reads sensibly after the actor (or
  -- target) is later deleted — an audit trail that goes blank on deletion
  -- defeats its own purpose.
  actor_name text not null,
  action text not null,
  target_type text not null,
  target_label text,
  created_at timestamptz not null default now()
);

alter table admin_audit_log enable row level security;

create policy "admin_audit_log_all_admin" on admin_audit_log
  for all using (current_user_is_admin());
