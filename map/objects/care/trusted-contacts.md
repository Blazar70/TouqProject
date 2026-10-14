---
type: object
cluster: care
universe: live
status: verified   # 2026-10-14 @ 583fe57
entity: supabase/migrations/0012_trusted_contacts_and_vaccinations.sql
---

# Trusted contacts (table `pet_trusted_contacts`)

People other than the owner who may bring a pet in. Per pet.

## Why this shape

This took over the per-pet contact role that `caregivers` had before 0010.

## Shape

- `pet_id` (cascade), `name`, `phone`
- Only the `pet_trusted_contacts_all_vet` policy (clinic scope via pets). No owner policy and no admin policy.

## Connected to

- **owned-by:** pets

## If you change this

- **Hits:** `src/components/TrustedContactsPanel.tsx`, `admin-manage-clinic` purge.
- **Does not hit:** staff, appointments.

## See

- Source: `src/lib/database.types.ts:533`
