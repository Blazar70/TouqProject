-- Pet alerts and sex + neutered (nightly H66, H67; user 11-05).
-- alerts: free text in either language (allergies, "bites", chronic illness), shown in red; every clinic role may edit it.
-- sex and neutered are optional, so existing pets keep working; null = not recorded.
alter table pets
  add column alerts text check (alerts is null or (btrim(alerts) <> '' and length(alerts) <= 500)),
  add column sex text check (sex in ('male', 'female')),
  add column neutered boolean;
