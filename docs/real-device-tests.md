# Real-device tests (v2)

Site: https://touqproject.ahmadhfatani.workers.dev (staging). Clinic: Al Nakheel demo.
Logins: demo staff in HANDOFF.md §2 (khalid.vet = doctor, huda.nurse = nurse, amal.desk = reception, MohBaf = manager).
Never press Send inside WhatsApp: the demo phone numbers are made up.
For each step tick Pass, or write what you saw (a photo of the screen helps).

You need: an iPad (Safari), an Android phone (Chrome), a desktop/laptop (Chrome or Edge), the 80 mm thermal printer.

## 1. Install the app
- [ ] **iPad:** open the site in Safari, sign in as huda.nurse → Settings. The top section shows 2 steps (Share → Add to Home Screen). Follow them. The Touq icon is on the Home Screen, it opens with no Safari address bar, and the install section is gone from Settings.
- [ ] **Android:** open the site in Chrome, sign in as khalid.vet → Settings → press **Install Touq**. Chrome's install prompt appears; the app opens from the home screen; the section is gone from Settings.
- [ ] **Desktop Chrome or Edge:** same as Android. The app opens in its own window.

## 2. Push notifications (do on the INSTALLED app: iPad and Android)
- [ ] Settings → Notifications → switch push on → allow when the device asks. The switch stays on after closing and reopening the app.
- [ ] Pick a few appointment statuses to be alerted about → Save. From the desktop as amal.desk, check in one of today's appointments for that doctor/branch → the alert arrives on the device within a minute. Tap it → Touq opens.
- [ ] Appointment reminder: set the reminder lead to the shortest option → Save. Book an appointment (desktop, amal.desk) for this doctor just after that lead time → the reminder arrives at about the right time (jobs run every 15 min, so up to 15 min late is OK).
- [ ] Dose reminder: as the manager or a doctor, open an inpatient stay at the device user's branch, add a medicine due in ~15 min → the dose push arrives (allow up to 15 min). Then switch off "dose reminders" in Settings, add another dose → no push arrives.
- [ ] Lock the device / close the app before each test: the alert still arrives.

## 3. Camera, photo and video (iPad)
- [ ] As huda.nurse: Inpatients → an open stay → add an update → take a **photo with the camera** → save. It shows in the update and opens full size.
- [ ] Same with a short **video** (~10 s). It uploads and plays back on the iPad AND on the desktop.
- [ ] Pet file → Edit → take a pet photo with the camera → save. It shows on the pet file.

## 4. Waiver signed with a finger (iPad)
- [ ] As amal.desk: a pet file → Waivers → sign a waiver with a finger. Signing is smooth (no page scroll while drawing), Clear works, the saved waiver shows the signature.
- [ ] Do it once in Arabic and once in English. Print the signed waiver from the iPad → the print preview shows the signature.

## 5. Owner reminder opens WhatsApp (Android phone, then iPad)
- [ ] As amal.desk: Owner reminders → press Send on one → WhatsApp opens with the owner's number and the AR + EN text filled in. **Don't send.** Go back to Touq → the reminder is marked sent; Undo works.

## 6. Rotation and layout (iPad, then Android)
- [ ] Turn the device between portrait and landscape on Dashboard, Appointments (calendar), a pet file and a form pop-up. Nothing is cut off, no sideways scrolling, the open pop-up stays usable.
- [ ] Open the on-screen keyboard in a pop-up form: the field you type in stays visible.

## 7. Arabic on Safari (iPad)
- [ ] Switch the app to Arabic. Type a weight and a phone number with **Arabic digits** (٠١٢٣) → they save as normal numbers (check the pet file after saving).
- [ ] Dates and times read right-to-left correctly on Dashboard, Appointments and a print preview.

## 8. Thermal print 80 mm (desktop connected to the printer)
- [ ] As amal.desk, in Arabic: Payments → an invoice → Print 80 mm → print on paper. Text is black (not grey), Arabic letters are joined and readable, numbers and the QR code are sharp, nothing is cut off at the edges.
- [ ] Same for a deposit receipt (DEP-MAIN-000004) and in English.
- [ ] Print the same invoice on A4 (any normal printer) and check it the same way.

## When done
Send me the list with the fails (and photos). I fix them, then we do your walkthrough (`docs/walkthrough-paths.md`).
