-- Touq / طوق — Web Push notifications for clinic staff/vets
-- Two per-user preferences on profiles (reminder lead time, which
-- appointment statuses to notify on), a table of push subscriptions
-- (one browser/device registration per row), and a dedup log so the
-- reminder cron doesn't re-notify the same profile for the same
-- appointment on every tick.

alter table profiles
  add column push_reminder_lead_minutes integer,
  add column push_notify_statuses text[] not null default '{}';

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

grant select, insert, update, delete on push_subscriptions to authenticated, service_role;

create policy "push_subscriptions_own" on push_subscriptions
  for all using (profile_id = auth.uid());

create table appointment_reminders_sent (
  appointment_id uuid not null references appointments (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (appointment_id, profile_id)
);

alter table appointment_reminders_sent enable row level security;

grant select, insert on appointment_reminders_sent to service_role;
-- No policies for authenticated/anon — only the Edge Function (using the
-- service-role key, which bypasses RLS) reads or writes this table.
