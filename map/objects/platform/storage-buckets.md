---
type: object
cluster: platform
universe: live
status: verified   # 2026-10-14 @ 583fe57
entity: supabase/migrations/0020_finalize_pet_photos_policies.sql
---

# Storage buckets

Two buckets with opposite visibility.

## Why this shape

`pet-photos` is public for reads so images load by CDN URL without signed URLs; writes are scoped to the uploader's clinic folder (`<clinic_id>/...`). `payment-documents` is private and admin-only.

## Shape

- `pet-photos`: insert/update/delete/select policies scoped by `(storage.foldername(name))[1] = current_user_clinic_id()`. Final form is 0020 plus select scoping in 0025. 0014-0019 are the trial-and-error history (`0016_test_wide_open_policy`); leftover.
- Pet photo path `<clinic_id>/<pet_id>.<ext>`; record photo uses a `records/` prefix (0027). Validation: 5 MB, image types only. `src/lib/imageUpload.ts:1`
- `payment-documents`: `0035_clinic_billing_payments.sql`

## If you change this

- **Hits:** PetDetail, RegisterPetPage, AppointmentsPage uploads; AdminBillingPage.
- **Does not hit:** `photo_url` already stored (public URLs).

## See

- Source: `scripts/create-pet-photos-bucket.mjs`
