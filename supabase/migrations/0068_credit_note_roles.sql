-- 0068: only receptionists and managers issue credit notes (user, 2026-10-23), any amount.
-- Doctors and nurses don't handle money. A trigger rather than editing create_credit_note,
-- so every insert path obeys it; every credit note is already in the audit log.

create function public.enforce_credit_note_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.current_user_has_role(array['receptionist', 'manager']) then
    raise exception 'Only receptionists and managers can issue credit notes' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger credit_notes_enforce_role
  before insert on credit_notes
  for each row execute function public.enforce_credit_note_role();
