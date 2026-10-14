---
type: object
cluster: care
universe: ghost
status: verified   # 2026-10-14 @ 583fe57
entity: supabase/migrations/0001_init.sql
---

# Ownership transfers

A table for handing a pet from one owner account to another. Not wired.

## Why this shape

It was created for a future owner-login phase. Owner accounts never took off (0034 note), so nothing writes to it.

## Shape

- `pet_id`, `from_owner_id`, `to_owner_id`, `status` pending/accepted/declined. `0001_init.sql:138`
- A search of `src/` finds no read or write. Only `admin-manage-clinic` deletes from it during purge.

## If you change this

- **Hits:** only the purge function.
- **Does not hit:** pets.owner_id or the owner contact fields.

Do not implement against this table without asking the owner.

## See

- Source: `src/lib/database.types.ts:440`
