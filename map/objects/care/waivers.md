---
type: object
cluster: care
universe: staging
status: verified   # 2026-10-25 @ feature/pc-redesign
entity: supabase/migrations/0084_waivers.sql
---

# Waivers

- Tables `waiver_templates` (clinic, title + text in English and Arabic, `suggest_on_admit`, `active`; managers write, archived never deleted) and `pet_waivers` (pet, branch signed at, template, language, frozen `title`/`body`, `signer_name`, `signature` = PNG data URL, optional `appointment_id`/`stay_id`, signed/collected, voided at/by/reason). Migration `0084_waivers.sql`, check `supabase/tests/0084_waivers_check.sql`.
- Trigger `fill_pet_waiver` copies the text from the template in the chosen language and sets who/when; the visit or stay must be the same pet's. Any staff role signs, at a branch they work at (`enforce_branch_write`). The only edit is a manager's void (with reason), once.
- UI: `src/components/WaiversPanel.tsx` on the pet file (collect, view, print, void; suggests the `suggest_on_admit` template while the pet has an open stay with no waiver), `SignaturePad.tsx`, templates in Settings (`WaiverTemplatesSettings.tsx`, starter texts in `src/lib/waivers.ts`), print `printWaiver` in `src/lib/PrintContext.tsx` (prints in the waiver's language; "save as PDF" from the print dialog).
- Owner view (H18): the sign pop-up's "Owner view (full screen)" hides the staff selects, shows the text large, lets the owner pick English/العربية, and labels follow that language (`tl()` reads `translations[lang]`); "Back to staff view" returns.
- Pet or clinic deletion cascades the waivers; no Storage files.
