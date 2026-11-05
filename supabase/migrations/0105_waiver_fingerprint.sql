-- Tamper fingerprint on signed waivers (nightly research AC; user 11-05). The database stores a SHA-256 of what was
-- signed when it is signed; the app compares it on read and prints a short form on the waiver.
-- shortcut: someone with direct database access could also rewrite the fingerprint; store it outside the database if a dispute ever needs that.
alter table pet_waivers add column fingerprint text;

-- Voiding is not covered on purpose: only what was signed. collected_by is left out because deleting a staff row nulls it.
create function public.waiver_fingerprint(w pet_waivers)
returns text
language sql stable
set search_path = public
as $$
  select encode(sha256(convert_to(
    jsonb_build_array(w.pet_id, w.language, w.title, w.body, w.signer_name, w.signature, extract(epoch from w.signed_at))::text,
    'UTF8')), 'hex');
$$;

-- Computed column for the API: select=*,fingerprint_ok.
create function public.fingerprint_ok(w pet_waivers)
returns boolean
language sql stable
set search_path = public
as $$
  select w.fingerprint = public.waiver_fingerprint(w);
$$;

revoke execute on function public.waiver_fingerprint(pet_waivers), public.fingerprint_ok(pet_waivers) from public, anon;
grant execute on function public.waiver_fingerprint(pet_waivers), public.fingerprint_ok(pet_waivers) to authenticated, service_role;

create function public.pet_waivers_set_fingerprint()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.fingerprint := public.waiver_fingerprint(new);
  return new;
end;
$$;

-- Name sorts after pet_waivers_fill, which sets the text and signed_at this hashes.
create trigger pet_waivers_y_fingerprint before insert on pet_waivers
  for each row execute function public.pet_waivers_set_fingerprint();

-- Existing waivers get theirs too; the fill trigger would refuse to touch a voided one.
alter table pet_waivers disable trigger pet_waivers_fill;
update pet_waivers w set fingerprint = public.waiver_fingerprint(w);
alter table pet_waivers enable trigger pet_waivers_fill;
