-- Checks for migration 0068 (credit note roles). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0068_credit_note_roles_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.

begin;

insert into auth.users (id, email, aud, role) values
  ('f6800000-0000-0000-0000-000000000001', 'cn1@check.local', 'authenticated', 'authenticated'),
  ('f6800000-0000-0000-0000-000000000002', 'cn2@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f6800000-0000-0000-0000-00000000000a', 'Credit role check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f6800000-0000-0000-0000-000000000001', 'vet', 'f6800000-0000-0000-0000-00000000000a', 'C Reception', 'receptionist'),
  ('f6800000-0000-0000-0000-000000000002', 'vet', 'f6800000-0000-0000-0000-00000000000a', 'C Nurse', 'nurse');
insert into staff_branches (profile_id, branch_id)
  select p, b.id from branches b, unnest(array['f6800000-0000-0000-0000-000000000001', 'f6800000-0000-0000-0000-000000000002']::uuid[]) p
  where b.clinic_id = 'f6800000-0000-0000-0000-00000000000a';
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f6800000-0000-0000-0000-0000000000a1', 'f6800000-0000-0000-0000-00000000000a', 'Rex', 'dog', 'Owner');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f6800000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare
  v_inv uuid;
begin
  v_inv := public.create_invoice('f6800000-0000-0000-0000-0000000000a1', null, null, null,
    '[{"description": "Exam", "unit_price": 1000, "quantity": 1}]', null, '[{"method": "cash", "amount": 1000}]');
  perform set_config('check.inv', v_inv::text, true);
  -- Receptionist: any amount (here 60%) is allowed.
  perform public.create_credit_note(v_inv, null, 600, 'Goodwill', 'cash');
  assert (select count(*) from credit_notes where invoice_id = v_inv) = 1, 'receptionist credit note must be saved';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'f6800000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform public.create_credit_note(current_setting('check.inv')::uuid, null, 100, 'Try', 'cash');
    assert false, 'nurse credit note must be refused';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

reset role;
rollback;
select '0068 credit note roles: all checks passed' as result;
