# v2 walkthrough: every use case, step by step

For the owner's own pass before v2 closes (handoff §2 item 4b): go through every form as each role and check
that it is readable, easy to use and follows good usability (HCI) practice. Tick boxes in VS Code's
Markdown preview or by typing `x` between the brackets. Write problems straight under the step as `> note`.

Site: https://touqproject.ahmadhfatani.workers.dev (staging). Logins are in the handoff (§7 and the demo
clinic). Button names below are the English ones; check the Arabic screen says the same thing.

## On every form, check

- [ ] Can I tell what this screen is for within 3 seconds? Is the main button obvious?
- [ ] Labels are plain words; required fields are marked; nothing is cut off.
- [ ] Wrong input gives a clear message next to the field, in my language, and keeps what I typed.
- [ ] After saving I can see that it worked (a message, or the change on screen).
- [ ] Buttons are big enough to tap on a tablet; nothing important is hidden off-screen on a phone.
- [ ] Arabic: text right-to-left, numbers and phones still read correctly, icons point the right way.
- [ ] Dark mode: everything still readable.
- [ ] Destructive actions (delete, cancel, void) ask first, and say what will happen.

Roles: **M** manager (whole clinic) · **BM** branch manager · **R** receptionist · **D** doctor · **N** nurse · **A** Touq admin.
"Refused" lines: check that role does NOT get the button, or gets a clear "not allowed" message.

---

## 1. Getting in

### 1.1 Log in — all roles
- [ ] Open the site → type username (staff) or email (manager/admin) and password → **Log in**
- [ ] If asked "Which branch are you at?", pick a branch
- [ ] Wrong password → clear message, password field easy to retry
### 1.2 Forgot password — M, A (email logins)
- [ ] Login → **Forgot password?** → email → **Send reset link** → read the message
- [ ] Staff with a username: the hint says to ask the manager (no email is sent)
### 1.3 Switch branch / language / theme / log out — all
- [ ] Change branch from the clinic badge · switch EN/AR · switch light/dark · **Log out**
### 1.4 Install Touq on this device — all
- [ ] Settings → top section "Install Touq on this device" → follow the steps (iPad) or **Install Touq** (Chrome/Edge)

## 2. Pets and owners

### 2.1 Register a new pet with a new owner — R, M, D, N
- [ ] Pets → **+ Register a pet** → name, species (or Other… → type it), breed, date of birth
- [ ] Owner name, owner phone (+966…), owner email → **Register pet** → the new pet's file opens
### 2.2 Register a pet for an existing owner — R, M
- [ ] Same as 2.1, but pick the owner when the phone/name matches → the pet joins that owner
### 2.3 Find a pet — all clinic roles
- [ ] Pets → search by name, Pet ID, owner name or phone → open the pet file
### 2.4 Edit a pet's details / photo — R, M, D, N
- [ ] Pet file → **Edit** → change fields → **Save changes** · **Add photo**
### 2.5 Trusted contacts — all clinic roles
- [ ] Pet file → **Add contact** → name + phone → save · remove one
### 2.6 Delete and restore a pet — M (delete in edit mode)
- [ ] Pet file → **Edit** → **Delete pet** → confirm → Pets → **Deleted pets** → **Restore**
- [ ] **Delete permanently** (only after reading the warning)
### 2.7 Owners: view, edit, merge duplicates, move a pet — R, M
- [ ] Owners → search → open owner → edit contact details
- [ ] Merge two duplicate owners · move a pet to another owner
- [ ] Refused: D, N cannot merge or move
### 2.8 Owner balance (prepaid credit) — R, M
- [ ] Owner → **Add balance** (top-up) → amount + method → save → print the deposit receipt (DEP-…)
- [ ] Owner → adjust balance (correction with a reason) — M only
- [ ] Refused: D, N do not see the balance
### 2.9 Owner data export and delete (PDPL) — M
- [ ] Owner → export the owner's data (file downloads)
- [ ] Owner → delete owner data → type the phone/name to confirm → "Export first" offered
- [ ] Refused: R, D, N

## 3. Appointments

### 3.1 Book from the calendar — R, M, D, N
- [ ] Appointments → tap an empty time in a doctor's column → pick pet → reason → **Save**
- [ ] Warning if the pet is already booked, a vaccine is due, or the doctor is away
### 3.2 Book from the button / from the pet file — R, M
- [ ] **New appointment** → pet, date, time (AM/PM), doctor → save
- [ ] Pet file → book appointment → the pet is already filled in
### 3.3 Confirm a request — R, M
- [ ] Open a "Requested" appointment → **Confirm** · undo with **Back to requested**
### 3.4 Check in an arrival — R (main tap), M
- [ ] Today's confirmed appointment → **Arrived** → dashboard shows "waiting N min" · **Undo** right after
### 3.5 Reschedule — R, M
- [ ] Open appointment → **Reschedule** → new date/time/doctor → **Confirm new time**
### 3.6 Cancel — R, M
- [ ] Open appointment → **Cancel appointment** → **Why is this being cancelled?** → reason + details → **Confirm cancellation**
### 3.7 Search appointments — all clinic roles
- [ ] Search box: pet name, Pet ID, staff, owner phone or date
### 3.8 Day and week view, other branches — all
- [ ] Day / Week, mini calendar, Today/Previous/Next · switch "Show" to another branch (read-only unless you work there)

## 4. The visit (session)

### 4.1 Start and work a session — D, N
- [ ] Arrived appointment → **Start session** → visit record fields (doctor: diagnosis, treatment, plan; nurse: notes/vitals)
- [ ] Add visit services (items charged) · add a photo · see earlier visits
- [ ] Refused: N cannot fill diagnosis/treatment/plan; R cannot start a session
### 4.2 Stop / finish — D (finish), D/N (stop)
- [ ] **Stop session** (pause) · **Finish session** → visit becomes Completed, record saved
### 4.3 Edit or delete a visit record later — D, N, M (rules per role)
- [ ] Pet file → Medical records → edit a record → save · delete (author/manager)
### 4.4 Print visit summary / full history — D, N, M, R
- [ ] Pet file → **Print summary** · **Print full history** → check the print preview in both languages

## 5. Vaccines

### 5.1 Clinic vaccine list — M
- [ ] Settings → vaccines → **Add vaccine** (name, repeat every N days) → edit
### 5.2 Pet vaccine schedule — D, N, M
- [ ] Pet file → vaccinations → **Add vaccine** to the pet → set next due date → save
### 5.3 Give a dose — D, N, M
- [ ] Due vaccine → **Mark given** → "next due" message · **Undo** (latest dose only)
- [ ] Refused: R cannot mark doses (read-only list)

## 6. Money

### 6.1 Bill a finished visit — R, M
- [ ] Completed visit → **Bill visit** (or Payments → **Record payment**) → items are filled from the visit
- [ ] Add/remove items, quantity, discount (with reason) → save → invoice number shown
### 6.2 Take a payment — R, M
- [ ] Invoice → **Take payment** → cash / card / balance → amount → paid time → save → status Paid / Part paid
### 6.3 Invoice without a visit (walk-in sale) — R, M
- [ ] Payments → **Record payment** → pet → **+ Add item** (price lookup) → save
### 6.4 Credit note / refund — R, M
- [ ] Invoice → issue credit note → pick lines or an amount → reason → refund method → save → print
- [ ] A fully credited visit can be billed again and is NOT on the Unpaid list
### 6.5 Print an invoice — R, M
- [ ] Invoice → print → A4 vs 80 mm (Settings → print size) · VAT number + QR when set
### 6.6 Cash count (end of day) — R, M
- [ ] Reports → cash count → **Counted cash** → save → difference shown
- [ ] Refused: earlier day — only M can correct
### 6.7 Reports — R, M (income/VAT: M only)
- [ ] Reports → Unpaid / unbilled visits · cash-up · income + VAT (manager) → export CSV
### 6.8 Price list (services) — M
- [ ] Settings → services → add/edit a service, price, VAT rate

## 7. Inpatients (hospital stays)

### 7.1 Admit — D, M (nurses can't admit or discharge, migration 0081)
- [ ] Pet file → **Admit** → reason → save → appears on Inpatients
- [ ] Refused: N, R (no Admit button)
### 7.2 Add an update (vitals, note, photo, video) — D, N, M
- [ ] Pet file (inpatient section) → **Add update at {branch}** → vitals + note + photo/video → save · delete own update
### 7.3 Medication reminders — D, N
- [ ] Stay → add medicine ("Amoxicillin 50 mg every 8 h") → dose due → mark given · **Undo** · stop the reminder
### 7.4 Discharge — D, M
- [ ] Stay → discharge → outcome (must choose, no default) → note → confirm (cannot be undone)
### 7.5 Bill the stay — R, M
- [ ] Discharged stay → Bill this stay → nights counted → add medicines by hand → save → stay shows Billed
### 7.6 Past stays — all clinic roles
- [ ] Pet file → past stays → open one's updates

## 8. Waivers (consent forms)

### 8.1 Templates — M
- [ ] Settings → waivers → add starter templates / new template (EN + AR) → edit → archive → restore
### 8.2 Owner signs on the tablet — R, M, D, N
- [ ] Pet file → waivers → new → pick template (+ link today's visit or stay) → owner view (full screen, owner's language) → finger signature → save → back to staff
### 8.3 Print / void — print: all · void: M
- [ ] Open a signed waiver → print · **void** with a reason (final)

## 9. Owner reminders (WhatsApp tap-to-send)

### 9.1 Send reminders — R, M
- [ ] Reminders → vaccine due / pickup → **send** → WhatsApp opens with AR + EN text → sent mark → undo · Skip
- [ ] Refused: D, N (no Reminders menu)

## 10. Dashboard

### 10.1 Front desk morning — R
- [ ] Dashboard → "To confirm today", Next up banner, today list, check-ins, waiting times
### 10.2 Doctor — D
- [ ] "My patients" vs "Whole branch" → open the next patient
### 10.3 Manager — M
- [ ] Totals today, vaccinations due, cancellations this month, recent medical records

## 11. Staff and clinic settings

### 11.1 Add staff — M, BM (own branches only)
- [ ] Staff → add → name, username, password, role, branches, phone, title, takes appointments → save
### 11.2 Edit staff — M, BM
- [ ] Change name / role / branches / reset password / disable · reorder calendar columns
- [ ] Refused: BM on someone who also works at another branch (clear message)
### 11.3 Time off — M (and the doctor's own view)
- [ ] Staff → doctor → add time off (from/to, reason) → shows "Away" on the calendar
### 11.4 Clinic info, VAT number, branches — M (VAT: whole-clinic M)
- [ ] Settings → clinic name, phone → save · VAT number · branches (name EN/AR, invoice code, phone)
### 11.5 Hospital night service, print size, notifications — M / all
- [ ] Settings → hospital night service (M) · print size per device · turn on notifications + reminder time + statuses

## 12. Manager page — M

- [ ] Manager → income today/month, unpaid, cash differences, visits per doctor, activity log

## 13. Touq admin — A

### 13.1 Clinics
- [ ] Clinics → create a clinic (name, manager login) → open → edit → disable → trash → "Deleted clinics (n)" → restore / purge
### 13.2 Clinic staff from admin
- [ ] Open clinic → staff → change login, role, branches → disable · main branch
### 13.3 Billing
- [ ] Billing → record a clinic payment, status (paid/overdue), due date, document upload
### 13.4 Activity and dashboard
- [ ] Activity log filters · Admin dashboard figures and weekly chart
