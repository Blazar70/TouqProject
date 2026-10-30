# Possible skills

Things looked at on 2026-10-30 and kept for later, not used in Touq yet. Each says why it waits and when it could fit.

## Libraries and skills

| Name | What it is | Checked 10-30 | Why not now | Could fit |
|---|---|---|---|---|
| [GSAP](https://github.com/greensock/GSAP) | Animation library (scroll effects, timelines) | v3.15, no dependencies. Free under Webflow's "standard no charge" licence, not open source (no use in tools that compete with Webflow) | Touq has almost no animation; adds weight on clinic tablets | A marketing / landing site (v3) |
| [Lenis](https://github.com/darkroomengineering/lenis) | Smooth scrolling | v1.3.27, MIT, no dependencies, maintained | Takes over scrolling: feels wrong on iPads and gets in the way of screen readers and keyboard users | A marketing site, if at all |
| [React Bits](https://github.com/DavidHDev/react-bits) | Copy-paste animated text, backgrounds, buttons | ~50k stars, maintained. MIT + Commons Clause: fine inside an app, can't resell the components | Several pull in heavy 3D code (three.js / ogl) or GSAP; decorative | A marketing site; pick single components, read each one first |
| [unslop](https://github.com/heydamir/unslop) | Claude skill: removes the "AI-made" look from a screen in nine passes | Clean: text guidance, no hidden instructions. Two optional scripts (headless Chrome page snapshot; localhost server + ffmpeg for a before/after video). CC BY 4.0 (credit the author) | Overlaps design-deslop, baseline-ui and touq-ui; wants grey surfaces and 400/500 weights, clashing with Touq's warm gold look | A marketing site, or a one-off audit of a single screen (its sign list and checklist) |

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
