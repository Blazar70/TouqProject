# Sweep scripts (staging only)

Browser checks used for the v2 sweep (10-28). They drive the **staging site** with Chrome and never touch live.
Most journeys SAVE data on the demo clinic "Al Nakheel"; that data is wiped in the reset after v2.

## Setup

1. `playwright-core` comes with the playwright-cli tool (not a project dependency). Point to it in `.env.sweep.local`.
2. Create `.env.sweep.local` in the project root (git-ignored by `*.local`; the repo is public, never commit passwords):

   ```
   SWEEP_PLAYWRIGHT=<path to playwright-core>
   SWEEP_DEMO_STAFF_PASSWORD=...
   SWEEP_COFOUNDER_PASSWORD=...
   SWEEP_ADMIN_PASSWORD=...
   SWEEP_EAST_MGR_PASSWORD=...
   SWEEP_TEST_NURSE_PASSWORD=...
   ```

   Values: the staging logins in the handoff. `spsql.cjs` reads `DATABASE_URL` from `.env.staging.local` and refuses any URL that is not staging.
3. Screenshots and downloads go to `scripts/sweep/out/` (git-ignored).

## Scripts

| Script | What it checks | Saves data? |
|---|---|---|
| `pages.cjs <user> <passKey> <ar\|en> <light\|dark> <w> <h> <label> [admin]` | every route: console errors, sideways scroll, wrong-language text, tap targets < 24 px, unlabeled fields | no |
| `forms.cjs <user> <passKey> <w> <h> <label>` | opens each pop-up/form: labels, focus moves in, Escape closes | no |
| `j1-visit.cjs` → `j1b-bill-visit.cjs <appointmentId>` | book → confirm → arrived → doctor session → finish → add service → bill → paid | yes |
| `j22-nightly-1104.cjs` | 11-04 fixes: photos checked at pick time, failed profile screen, staff list groups, billing delete + PDF + Arabic search, free times, register from booking, age, Arabic purge confirm | yes (throwaway clinic purged; a pet + a cancelled visit stay) |
| `j2-stay.cjs [resume\|bill]` | admit → nurse update (Arabic digits) → discharge → bill the stay | yes |
| `j3-credit.cjs` | fully credit MAIN-000017 → not on Unpaid, "Bill this visit" back (B22) | yes |
| `j4-waiver-cash-staff.cjs [cash]` | waiver signed in owner view · cash count · manager adds staff | yes |
| `j5-reminder.cjs` | WhatsApp reminder send + undo (the WhatsApp tab is closed, never sent) | yes |
| `j6-phone-book-cancel.cjs` | phone 390 px, AR: book, then cancel with a reason | yes |
| `j7-vaccine-register-void-export.cjs [rest]` | vaccine given + undo · register pet · void waiver · owner export | yes |
| `j8-meds-staffedit-ownerdelete.cjs` | medicine reminder Done/Undo/Stop · staff edit · delete test owner's data | yes |
| `j9-batch-1029.cjs [late]` | 10-29 batch: doctor template → reception books → doctor applies template (diagnosis + medicine), finishes → record shows prescription + weight chart → template deleted · receptionist sees neither · idle warning/Stay/lock (fake clock) + reopened browser starts locked · admin CSV import into Clinic A (bad file refused, good imported). `late` = only the last three parts | yes |
| `j10-nightly-1029.cjs` | nightly 10-29 fixes: unsaved visit survives 15 idle min, saved + locked at 60 (fake clock), no push_subscriptions DELETE · record values `pre-line` · weight range · Windows-1256 CSV preview reads Arabic, second import skips (Clinic A) | yes |
| `j11-batch-1030.cjs` | 10-30 batch: admin tax status (phase 2 disabled, phase 1 needs a VAT number) → Al Nakheel Not VAT-registered → manager sees it read-only, no VAT columns → book + arrive → doctor Repeat last prescription + quick-pick buttons, finishes → reception bills: no VAT, plain Invoice print, no QR → back to phase 1: old invoice stays plain, a phase-1 invoice keeps VAT + QR → Print prescription → idle lock: wrong password refused, right one opens the same page. Ends with Al Nakheel on phase 1. `SWEEP_SITE=http://localhost:5175` to run against a local build | yes |
| `j12-nightly-1030.cjs` | 10-30 nightly fixes: Pets + Owners search on the server (Arabic without hamza, local phone) → booking and payment pickers find a pet by search → book + arrive → visit record saves by itself ("Saved …"), bad temperature says why → microchip saved, shown, searched, printed; weight change in kg → admin import with a microchip; re-run lists the rows left out (CSV download). `SWEEP_SITE=http://localhost:5175` to run against a local build | yes |
| `j13-ui-tips-1030.cjs` | 10-30 UI tips: Search button shows its Ctrl K hint → Ctrl+K lists pages, finds a pet typed in Arabic, opens it by keyboard, Escape closes → Pets list shows at once on return (last-seen) → tabular digits, balanced headings, clearer paw background. Changes no data. `SWEEP_SITE=http://localhost:5175` to run against a local build | no |
| `j14-nightly-1031.cjs` | 10-31 nightly fixes: pet picker Enter before the results (scanner) picks only a single match, never a stale one → Searching… / No pets match + Register new pet (name or phone filled in) / Couldn't search (blocked request, after the client's ~7 s of retries) → words in any order → duplicate microchip warns → reprint keeps the VAT number it was issued with (clinic number changed by SQL, then put back) → visit autosave retries when the connection returns (offline context) → phone top-bar search → lock screen "Last used at". `SWEEP_SITE=http://localhost:5175` to run against a local build | yes |
| `j15-untested-1101.cjs [stepPrefix ...]` | 11-01 untested list: nurse applies a template + adds a photo in the doctor's session, doctor finishes with a prescription → summary print EN + Arabic dates, report print in Arabic → nurse Stop then Cancel → arrived visit moved to another day is Confirmed → time-off preview counts it (not saved) → other-branch record has no Edit → calendar order: branch manager has none, whole-clinic manager reorders and back → pet purge removes inpatient photos → waiver text edit, nurse collects a waiver linked to today's visit → reminder carries the clinic phone → two tabs lock/unlock together → pasted +966 phone → Arabic device starts in Arabic → week-view tap-to-book from Tokyo → quick search AR dark phone → today's money on dashboard = Payments = database → doctor dashboard screenshot. Multi-branch users get the branch picker after every load: `pick()` and in-app `go()` handle it | yes |
| `j16-admin-1101.cjs` | admin: throwaway clinic → trash → "Deleted clinics (n)" counts it → purge with the reply changed in the browser to report files left → warning shown above the trash pop-up, clinic leaves the list. Confirms must name the test clinic | yes |
| `j17-purge-1101.cjs` | admin function on staging, by API: purging a live (untrashed) throwaway clinic is refused (409, B33) → 120 expired trashed test pets go in batches through `purge_expired` (cron secret read from Vault, B34) → the trashed clinic purges. Uses the anon key from `.env.staging.local` | yes (cleans up) |
| `j18-reminders-1101.cjs` | Reminders (H52): one Send (WhatsApp tab closed) → "x of y done" goes up, the next one is highlighted + focused → Undo | no (undone) |
| `j19-booking-photo-lock-1101.cjs` | H49 free-time chips for Khalid tomorrow, one tap fills hour/minute/AM-PM, booked times not offered (nothing saved) → H50 a 4000×3000 test JPEG on "Sweep Kitten" is stored shrunk → lock screen: wrong password says only "Wrong password" | yes (Sweep Kitten's photo) |
| `j20-csp-1102.cjs` | security headers: all six sent, also on a deep link → every screen as manager (AR) and admin, invoice/report/summary/prescription/waiver prints, visit + signature + inpatient images, fonts: nothing blocked by the Content-Security-Policy. Local run needs `wrangler dev` (`vite preview` ignores `public/_headers`) | no |
| `j21-signup-off-1102.cjs` | by API: a public sign-up is refused → admin creates a throwaway clinic + manager → manager adds staff → both log in → clinic purged, accounts gone | no (cleans up) |
| `axe.cjs <user> <passKey> <ar\|en> <light\|dark> <w> <h> <label> [admin]` | axe-core WCAG 2.1 A/AA rules on the main screens (axe loaded from cdnjs, pinned; no dependency), violations grouped by rule with contrast ratios. Exit 1 when anything is found. Run before each staging release; VoiceOver in Arabic on the iPad stays a manual check | no |
| `print.cjs <invoiceId>` | A4 + 80 mm print content | no |
| `admin-billing.cjs` | admin payment create → paid → delete (self-cleaning) | no net change |
| `removed-staff-login.cjs` | remove "Sweep Test Nurse" (row-scoped) → login refused | yes |

**Whole matrix** (6 roles in `matrix.txt` × EN/AR × light/dark × tablet/phone = 48 runs, six at a time, ~10 min), then list only the problems:

```sh
while read user key role; do for lang in ar en; do for theme in light dark; do for s in "820 1180 tablet" "390 844 phone"; do set -- $s; a=""; [ "$role" = A ] && a=admin
  echo "node scripts/sweep/pages.cjs $user $key $lang $theme $1 $2 $role-$lang-$theme-$3 $a > scripts/sweep/out/matrix-$role-$lang-$theme-$3.txt 2>&1"
done; done; done; done < scripts/sweep/matrix.txt | xargs -P 6 -I{} sh -c '{}'
cat scripts/sweep/out/matrix-*.txt | grep "^!!" | sort | uniq -c | sort -rn
```

`forms.cjs` takes `[en|ar]` and `[admin]` after the label; button names come from `translations.ts` via `i18n.cjs`.
Known false alarms: hidden file pickers (23×20, 1×1), checkboxes inside labels, English names in test data flagged as "wrong language".

`passKey` is a key of `PASS` in `config.cjs` (`demoStaff`, `cofounder`, `admin`, `eastMgr`, `sweepNurse`), so no password is typed on the command line.
Example: `node scripts/sweep/pages.cjs khalid.vet demoStaff ar dark 820 1180 D-ar-dark-tablet`

## Rules learned the hard way

- **Destructive clicks:** scope to the exact row (`li` filtered by the name) and check the confirm text names the target before accepting. An unscoped "Remove" removed the wrong person on 10-28.
- The branch picker reappears after navigating for multi-branch staff: answer it after every `goto`.
- Arabic text passed as a Windows command-line argument to psql gets mangled: look records up by id or an English field.
- Pet, invoice and appointment ids point at the demo clinic: after the post-v2 reset, update them (or look them up by name).
