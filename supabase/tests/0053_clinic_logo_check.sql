-- Checks for migration 0053 (clinic logo). RUN ON STAGING ONLY:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0053_clinic_logo_check.sql
-- One transaction, rolled back at the end. A failed assert stops with its message.

begin;

do $$ begin
  assert (select public from storage.buckets where id = 'clinic-logos'), 'clinic-logos bucket missing or not public';
end $$;

-- Fixtures: clinic X (manager, doctor, disabled manager), clinic Y (manager), an admin.
insert into auth.users (id, email, aud, role) values
  ('f5300000-0000-0000-0000-000000000001', 'lx1@check.local', 'authenticated', 'authenticated'),
  ('f5300000-0000-0000-0000-000000000002', 'lx2@check.local', 'authenticated', 'authenticated'),
  ('f5300000-0000-0000-0000-000000000003', 'lx3@check.local', 'authenticated', 'authenticated'),
  ('f5300000-0000-0000-0000-000000000004', 'ly1@check.local', 'authenticated', 'authenticated'),
  ('f5300000-0000-0000-0000-000000000005', 'la1@check.local', 'authenticated', 'authenticated');

insert into clinics (id, name) values
  ('f5300000-0000-0000-0000-00000000000a', 'Logo X'),
  ('f5300000-0000-0000-0000-00000000000b', 'Logo Y');

insert into profiles (id, role, clinic_id, full_name, clinic_role, disabled) values
  ('f5300000-0000-0000-0000-000000000001', 'vet', 'f5300000-0000-0000-0000-00000000000a', 'X manager', 'manager', false),
  ('f5300000-0000-0000-0000-000000000002', 'vet', 'f5300000-0000-0000-0000-00000000000a', 'X doctor', 'doctor', false),
  ('f5300000-0000-0000-0000-000000000003', 'vet', 'f5300000-0000-0000-0000-00000000000a', 'X off manager', 'manager', true),
  ('f5300000-0000-0000-0000-000000000004', 'vet', 'f5300000-0000-0000-0000-00000000000b', 'Y manager', 'manager', false);
insert into profiles (id, role, full_name) values
  ('f5300000-0000-0000-0000-000000000005', 'admin', 'Check admin');

set local role authenticated;

-- X manager: own folder and own row yes, Y no
select set_config('request.jwt.claims', json_build_object('sub', 'f5300000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
do $$ begin
  insert into storage.objects (bucket_id, name) values ('clinic-logos', 'f5300000-0000-0000-0000-00000000000a/logo.png');
  begin
    insert into storage.objects (bucket_id, name) values ('clinic-logos', 'f5300000-0000-0000-0000-00000000000b/logo.png');
    raise exception 'X manager wrote Y''s logo';
  exception when insufficient_privilege then null;
  end;
  update clinics set logo_url = 'f5300000-0000-0000-0000-00000000000a/logo.png' where id = 'f5300000-0000-0000-0000-00000000000a';
  assert found, 'X manager could not set own logo_url';
  assert not public.can_manage_clinic_logo('f5300000-0000-0000-0000-00000000000b'), 'X manager may manage Y';
end $$;

-- X doctor: can still update the clinic row (0021) but not the logo
select set_config('request.jwt.claims', json_build_object('sub', 'f5300000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
do $$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('clinic-logos', 'f5300000-0000-0000-0000-00000000000a/doc.png');
    raise exception 'doctor uploaded a logo';
  exception when insufficient_privilege then null;
  end;
  begin
    update clinics set logo_url = null where id = 'f5300000-0000-0000-0000-00000000000a';
    raise exception 'doctor changed logo_url';
  exception when raise_exception then
    if sqlerrm = 'doctor changed logo_url' then raise; end if;
  end;
  update clinics set phone = phone where id = 'f5300000-0000-0000-0000-00000000000a';
  assert found, 'doctor lost the other clinic-row updates';
end $$;

-- disabled manager: nothing
select set_config('request.jwt.claims', json_build_object('sub', 'f5300000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
do $$ begin
  assert not public.can_manage_clinic_logo('f5300000-0000-0000-0000-00000000000a'), 'disabled manager may manage logo';
end $$;

-- admin: any clinic
select set_config('request.jwt.claims', json_build_object('sub', 'f5300000-0000-0000-0000-000000000005', 'role', 'authenticated')::text, true);
do $$ begin
  insert into storage.objects (bucket_id, name) values ('clinic-logos', 'f5300000-0000-0000-0000-00000000000b/logo.png');
  update clinics set logo_url = 'f5300000-0000-0000-0000-00000000000b/logo.png' where id = 'f5300000-0000-0000-0000-00000000000b';
  assert found, 'admin could not set logo_url';
end $$;

-- anonymous: can read (public bucket), cannot write
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
do $$ begin
  -- 0083: listing the bucket is closed (logos load by public URL, which needs no RLS).
  assert not exists (select 1 from storage.objects where bucket_id = 'clinic-logos'), 'anon must not list logos';
  begin
    insert into storage.objects (bucket_id, name) values ('clinic-logos', 'f5300000-0000-0000-0000-00000000000a/anon.png');
    raise exception 'anon uploaded a logo';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select 'all 0053 checks passed' as result;
rollback;
