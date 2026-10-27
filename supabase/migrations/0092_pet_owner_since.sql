-- Touq / طوق — nightly 10-27 S16 (user 10-27: leave the previous owner's waivers and invoices out of
-- an owner's PDPL export). pets.owner_since = when the pet joined its current owner file; the export
-- keeps only waivers and invoices from then on. A merge joins two files of the same person, so it keeps
-- owner_since; moving a pet to another owner (pet file or owner page) resets it.
-- Existing pets start at created_at: earlier transfers were never recorded.

alter table pets add column owner_since timestamptz not null default now();
update pets set owner_since = created_at;

create function public.pets_owner_since()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.owner_file_id is distinct from old.owner_file_id and coalesce(current_setting('touq.owner_merge', true), '') <> 'on' then
    new.owner_since := now();
  else
    new.owner_since := old.owner_since; -- not editable by hand: it decides what an export shows
  end if;
  return new;
end;
$$;

create trigger pets_owner_since
before update on pets
for each row execute function public.pets_owner_since();

-- 0088's merge, plus the flag around its pet move.
create or replace function public.merge_owner_files(p_keep uuid, p_remove uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_clinic uuid := public.current_user_clinic_id();
  v_keep owner_files;
  v_remove owner_files;
  v_moved numeric := 0;
begin
  if v_clinic is null then
    raise exception 'Only clinic staff can merge owners' using errcode = '42501';
  end if;
  -- Lock both in id order so two merges can't deadlock.
  perform 1 from owner_files where id in (p_keep, p_remove) and clinic_id = v_clinic order by id for update;
  select * into v_keep from owner_files where id = p_keep and clinic_id = v_clinic;
  select * into v_remove from owner_files where id = p_remove and clinic_id = v_clinic;
  if v_keep.id is null or v_remove.id is null or p_keep = p_remove then
    raise exception 'Pick two different owners of this clinic' using errcode = 'P0001';
  end if;

  update owner_files set
    phone = coalesce(nullif(btrim(phone), ''), v_remove.phone),
    email = coalesce(nullif(btrim(email), ''), v_remove.email),
    notes = nullif(concat_ws(E'\n', nullif(btrim(notes), ''), nullif(btrim(v_remove.notes), '')), '')
  where id = p_keep;
  -- 0088: the balance lives in owner_balances.
  select coalesce((select balance from owner_balances where owner_file_id = p_remove), 0) into v_moved;
  insert into owner_balances (owner_file_id, clinic_id, balance) values (p_keep, v_clinic, v_moved)
    on conflict (owner_file_id) do update set balance = owner_balances.balance + excluded.balance;
  perform set_config('touq.owner_merge', 'on', true);
  update pets set owner_file_id = p_keep where owner_file_id = p_remove;
  perform set_config('touq.owner_merge', '', true);
  update owner_balance_entries set owner_file_id = p_keep where owner_file_id = p_remove;
  delete from owner_files where id = p_remove;

  insert into admin_audit_log (actor_id, actor_name, action, target_type, target_label, clinic_id)
  select auth.uid(), coalesce(p.full_name, 'Unknown'), 'owners_merged', 'owner',
         v_remove.name || ' → ' || v_keep.name || ' · ' || v_moved, v_clinic
  from (select 1) one left join profiles p on p.id = auth.uid();
end;
$$;
