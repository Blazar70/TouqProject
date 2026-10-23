-- Checks for migration 0069 (invoices outlive pets). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0069_invoices_outlive_pets_check.sql
begin;

insert into auth.users (id, email, aud, role) values
  ('f6900000-0000-0000-0000-000000000001', 'io1@check.local', 'authenticated', 'authenticated');
insert into clinics (id, name) values ('f6900000-0000-0000-0000-00000000000a', 'Invoice outlive check');
insert into profiles (id, role, clinic_id, full_name, clinic_role) values
  ('f6900000-0000-0000-0000-000000000001', 'vet', 'f6900000-0000-0000-0000-00000000000a', 'I Manager', 'manager');
insert into pets (id, clinic_id, name, species, owner_name) values
  ('f6900000-0000-0000-0000-0000000000a1', 'f6900000-0000-0000-0000-00000000000a', 'Rex', 'dog', 'Owner');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'f6900000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$
declare
  v_inv uuid;
begin
  v_inv := public.create_invoice('f6900000-0000-0000-0000-0000000000a1', null, null, null,
    '[{"description": "Exam", "unit_price": 100, "quantity": 1}]', null, '[{"method": "cash", "amount": 40}]');
  perform set_config('check.inv', v_inv::text, true);
  assert (select pet_name from invoices where id = v_inv) = 'Rex', 'invoice must keep the pet name';
  assert (select pet_number from invoices where id = v_inv) is not null, 'invoice must keep the pet number';
end $$;
reset role;

-- The nightly pet purge (runs as the database owner).
update pets set deleted_at = now() - interval '8 days' where id = 'f6900000-0000-0000-0000-0000000000a1';
delete from pets where deleted_at is not null and deleted_at < now() - interval '7 days';

do $$
declare
  v_inv uuid := current_setting('check.inv')::uuid;
begin
  assert exists (select 1 from invoices where id = v_inv and pet_id is null and pet_name = 'Rex'), 'invoice must survive the pet purge, pet link cleared';
  assert (select count(*) from invoice_payments where invoice_id = v_inv) = 1, 'its payment must survive too';
  assert exists (select 1 from public.report_unpaid() where id = v_inv and pet_name = 'Rex' and remaining = 60),
    'unpaid report must still list the bill with the saved pet name';
end $$;

rollback;
select '0069 invoices outlive pets: all checks passed' as result;
