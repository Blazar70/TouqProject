---
type: process
universe: staging
status: verified   # 2026-10-25 @ feature/pc-redesign
entity: supabase/migrations/0085_owner_reminders.sql
---

# Owner reminders (tap-to-send)

- Page `/reminders` (`src/pages/RemindersPage.tsx`), receptionists and managers only (nav flag `desk`, route guard `handlesMoney`). Three lists, computed in the browser on every load: appointments tomorrow (not cancelled), pets discharged in the last 2 days and not admitted again, vaccines due from 30 days ago to 7 days ahead (one message per owner).
- Send = a `wa.me` link (`whatsAppLink`) with the text from `src/lib/ownerReminders.ts`: fixed wording, Arabic then English, clinic name and phone, dates in clinic time. Test `ownerReminders.test.ts`. Phone comes from `owner_files.phone`.
- The tap records a row in `owner_reminders_sent` (kind + item_key: appointment id, stay id, or pet_vaccines id + due date). Unique per clinic/kind/key, so nothing is sent twice; Undo deletes the rows. Who/when filled by trigger. Check `supabase/tests/0085_owner_reminders_check.sql`.
- Touq never sees whether WhatsApp really sent it. Automatic sending (Unifonic/Twilio) would reuse the same lists and the same sent table.
