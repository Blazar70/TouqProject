-- Touq / طوق — phase 6, owner reminders, tap-to-send (user decisions 2026-10-25). Reception and
-- managers see a "to send" list (vaccines due, appointments tomorrow, pets ready for pickup); a tap
-- opens WhatsApp with the message written in Arabic and English. Touq can't see whether it was really
-- sent, so a tap records "sent" here; nothing is sent twice and a wrong tap can be undone.
-- item_key: pet_vaccines id + due date (a new due date is a new reminder), appointment id, stay id.

create table owner_reminders_sent (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete cascade,
  kind text not null check (kind in ('vaccine', 'appointment', 'pickup')),
  item_key text not null,
  owner_file_id uuid references owner_files (id) on delete cascade,
  sent_by uuid references profiles (id) on delete set null,
  sent_at timestamptz not null default now(),
  unique (clinic_id, kind, item_key)
);
create index owner_reminders_sent_recent on owner_reminders_sent (clinic_id, sent_at);

alter table owner_reminders_sent enable row level security;

create policy owner_reminders_sent_all_admin on owner_reminders_sent for all using (public.current_user_is_admin());
create policy owner_reminders_sent_select_staff on owner_reminders_sent for select
  using (clinic_id = (select public.current_user_clinic_id()));
create policy owner_reminders_sent_insert_desk on owner_reminders_sent for insert
  with check (
    clinic_id = (select public.current_user_clinic_id())
    and (select public.current_user_has_role(array['receptionist', 'manager']))
    and (owner_file_id is null or owner_file_id in (select id from owner_files where clinic_id = (select public.current_user_clinic_id())))
  );
-- Undo.
create policy owner_reminders_sent_delete_desk on owner_reminders_sent for delete
  using (clinic_id = (select public.current_user_clinic_id()) and (select public.current_user_has_role(array['receptionist', 'manager'])));
revoke update on owner_reminders_sent from authenticated;

create function public.fill_owner_reminder_sent()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.sent_at := now();
  new.sent_by := auth.uid();
  return new;
end;
$$;
create trigger owner_reminders_sent_fill before insert on owner_reminders_sent
  for each row execute function public.fill_owner_reminder_sent();
