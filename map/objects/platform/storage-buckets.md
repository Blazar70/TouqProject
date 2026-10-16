---
type: object
cluster: platform
universe: live
status: verified   # 2026-10-14 @ 583fe57
entity: supabase/migrations/0043_pet_photos_private.sql
---

# Storage buckets

Two private buckets.

## Why this shape

`pet-photos` is private since 0043 so pet and medical-record photos need a login: images load through 1-hour signed URLs (`src/lib/photoUrl.ts`), and push icons through 1-day ones (`supabase/functions/_shared/push.ts`). All access is scoped to the uploader's clinic folder (`<clinic_id>/...`). `payment-documents` is admin-only.

## Shape

- `pet-photos`: insert/update/delete/select policies scoped by `(storage.foldername(name))[1] = current_user_clinic_id()`. Final form is 0020 plus select scoping in 0025 (repeated as a no-op in 0042). 0014-0019 are the trial-and-error history (`0016_test_wide_open_policy`); leftover.
- `photo_url` stores the path, not a URL, plus `?t=<n>` after a re-upload so the cache key changes (0043 converted the old public URLs).
- Pet photo path `<clinic_id>/<pet_id>.<ext>`; record photo uses a `records/` prefix (0027). Validation: 5 MB, image types only. `src/lib/imageUpload.ts:1`
- `payment-documents`: `0035_clinic_billing_payments.sql`

## If you change this

- **Hits:** PetDetail, RegisterPetPage, AppointmentsPage uploads; PetAvatar, PhotoThumbnail, PrintContext (signing); push edge functions (icons); AdminBillingPage.

## See

- Source: `scripts/create-pet-photos-bucket.mjs`
