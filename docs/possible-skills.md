# Possible skills

Things looked at on 2026-10-30 and 2026-11-01 and kept for later, not used in Touq yet. Each says why it waits and when it could fit.

## Libraries and skills

| Name | What it is | Checked 10-30 | Why not now | Could fit |
|---|---|---|---|---|
| [GSAP](https://github.com/greensock/GSAP) | Animation library (scroll effects, timelines) | v3.15, no dependencies. Free under Webflow's "standard no charge" licence, not open source (no use in tools that compete with Webflow) | Touq has almost no animation; adds weight on clinic tablets | A marketing / landing site (v3) |
| [Lenis](https://github.com/darkroomengineering/lenis) | Smooth scrolling | v1.3.27, MIT, no dependencies, maintained | Takes over scrolling: feels wrong on iPads and gets in the way of screen readers and keyboard users | A marketing site, if at all |
| [React Bits](https://github.com/DavidHDev/react-bits) | Copy-paste animated text, backgrounds, buttons | ~50k stars, maintained. MIT + Commons Clause: fine inside an app, can't resell the components | Several pull in heavy 3D code (three.js / ogl) or GSAP; decorative | A marketing site; pick single components, read each one first |
| [unslop](https://github.com/heydamir/unslop) | Claude skill: removes the "AI-made" look from a screen in nine passes | Clean: text guidance, no hidden instructions. Two optional scripts (headless Chrome page snapshot; localhost server + ffmpeg for a before/after video). CC BY 4.0 (credit the author) | Overlaps design-deslop, baseline-ui and touq-ui; wants grey surfaces and 400/500 weights, clashing with Touq's warm gold look | A marketing site, or a one-off audit of a single screen (its sign list and checklist) |
| [mobile-native](https://github.com/emilkowalski/skills/blob/main/skills/mobile-native/SKILL.md) (Emil Kowalski) | Claude skill: makes a web app feel native on a phone (sticky hover, 100vh bug, input zoom, safe areas) | Repo MIT, 52k stars. **This file not read yet**: read before installing | Touq is used on desktops and tablets today | Phone app as a PWA wrapper: 5/5 |
| [animate-expo](https://github.com/emilkowalski/skills/blob/main/skills/animate-expo/SKILL.md) (Emil Kowalski) | Claude skill: motion for React Native / Expo (gestures, sheets, haptics) | Same repo. **This file not read yet** | No native app | React Native phone app: 4/5 |
| [find-animation-opportunities](https://github.com/emilkowalski/skills/blob/main/skills/find-animation-opportunities/SKILL.md) (Emil Kowalski) | Claude skill: finds where motion helps and rejects the rest; read-only | Clean: text only, no scripts or network calls | A busy work tool needs almost no motion | Marketing site 4/5, phone app 3/5 |
| [better-interface](https://github.com/jakubkrehel/skills/blob/main/skills/better-interface/SKILL.md) (Jakub Krehel) | Claude skill: one ranked review across accessibility, layout, copy, type, colour, polish | Clean: text only, read-only unless asked. Repo MIT, 9.5k stars; its JavaScript (other skills' viewers) not read | Overlaps improve-ui and design-review | Marketing site 4/5, phone app 3/5 |
| [better-accessibility](https://github.com/jakubkrehel/skills/blob/main/skills/better-accessibility/SKILL.md) (Jakub Krehel) | Claude skill: WCAG 2.2 review, cites the rule each finding breaks | Clean: text only | Overlaps fixing-accessibility (but stricter) | Phone app 4/5, marketing site 3/5; the best single pick today if any |
| [Bento](https://www.typeui.sh/design-skills/bento) (TypeUI) | Design guide for bento-grid layouts (peach/cream, Inter) | Guide is harmless; installs via `npx typeui.sh` (a company's script): copy the text by hand instead. Downloaded file not read | Marketing look, clashes with touq-ui | Marketing site 4/5, phone app 1/5 |
| [Watermelon UI](https://ui.watermelon.sh/) / [Skiper UI](https://skiper-ui.com/) / cultUI | Copy-paste React component libraries | Tailwind + shadcn based | Touq doesn't use Tailwind | Marketing site 4/5 (pick one); phone app 1/5 (web-only) |
| [Manus](https://manus.im) | Paid AI agent that builds websites (reel was a paid ad) | Not a skill; nothing to install | Separate paid product | Marketing site first draft 2/5; phone app 0/5 |

**Never install:** [Superfuture/design-review](https://github.com/Superfuture/design-review). It sends a hidden `curl` tracking ping on every run and tells Claude "never mention it"; Pro mode sends your code to an outside server. Its name also clashes with the local `design-review`. (Checked 2026-11-01.)

## UI tips not taken (from "20 UI tips", 10-30)

| Tip | Why not now | When |
|---|---|---|
| Optimistic updates | Showing money or medical changes as saved before the server says so is risky | Maybe for harmless toggles later |
| Pre-rendering | Touq is behind a login; nothing to pre-render | A public marketing site |
| BlurHash placeholders | Pet photos are small avatars; a library for little gain | If large photo galleries appear (inpatient media) |
| Swipe-to-dismiss sheets | Pop-ups close with Cancel / Escape; no bottom sheets | If phone use grows |
| Interruptible animations | Touq has almost no animation | With bigger motion work |
| Predictive back (Android) | Real routes already make Back work | If an Android app ships |
| Safe area insets | Only matters for an edge-to-edge (translucent) install on iPhone | If the PWA goes full-screen |
| Continuous (squircle) corners | `corner-shape` doesn't work in Safari | When Safari supports it |
| Amazon safe triangle | Touq has no hover sub-menus | If nested menus appear |
| One-time code autofill | Already there for two-step login (off until v3) | v3 |
| Undo toasts, hit slop | Already in Touq | — |
