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
| `j2-stay.cjs [resume\|bill]` | admit → nurse update (Arabic digits) → discharge → bill the stay | yes |
| `j3-credit.cjs` | fully credit MAIN-000017 → not on Unpaid, "Bill this visit" back (B22) | yes |
| `j4-waiver-cash-staff.cjs [cash]` | waiver signed in owner view · cash count · manager adds staff | yes |
| `j5-reminder.cjs` | WhatsApp reminder send + undo (the WhatsApp tab is closed, never sent) | yes |
| `j6-phone-book-cancel.cjs` | phone 390 px, AR: book, then cancel with a reason | yes |
| `j7-vaccine-register-void-export.cjs [rest]` | vaccine given + undo · register pet · void waiver · owner export | yes |
| `j8-meds-staffedit-ownerdelete.cjs` | medicine reminder Done/Undo/Stop · staff edit · delete test owner's data | yes |
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
