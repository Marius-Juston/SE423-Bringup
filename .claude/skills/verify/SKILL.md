---
name: verify
description: Verify a change to the Bringup game before calling it done: type check, unit and level tests, the browser playthrough, the accessibility suite, and screenshots in both themes. Use after any change to levels, the simulator, figures or the interface, and before committing or releasing.
---

# Verify a change

Do the steps that apply, in this order, and report each result as it is.

1. `npx tsc --noEmit`
2. `npx vitest run` (all of it; about a minute). A failing reference solution in `tests/levels.test.ts` means a simulator or content change broke a level: fix the cause.
3. Browser playthrough, which solves levels through the real interface in headless Chromium: `npx vite build`, then `E2E_FROM=<first chapter you touched> npx vitest run --config vitest.e2e.config.ts`, or `npm run e2e` for everything (minutes). Primer chapters are numbers -3 to -1.
4. Look at it. `node tools/shot.mjs level <id> out.png --tests` (add `--dark`, `--width 1024`, `--width 480`), `node tools/shot.mjs figure <id> out.png`, `node tools/shot.mjs map out.png`, `node tools/shot.mjs handbook out.png --section "Key diagrams"`. Read the images: overlaps, clipped labels, unreadable contrast, anything a first-time student would not understand.
5. Accessibility, for any change to levels, figures or the interface: `npm run a11y -- --level <id>` or `--from <chapter>` while you work, `npm run a11y` (about 15 minutes) before you finish. It runs axe-core, reflow at 320 px, the keyboard walk, text spacing, motion, names and status messages, colour-alone and the token contrast on every screen, level and figure, in light and dark (`docs/ACCESSIBILITY.md`). It must end with "nothing new". Fix what it reports; never raise a count in `a11y-baseline.json`, and after a fix lower them with `npm run a11y -- --update-baseline`. Then try the changed screen with the keyboard yourself (Tab, arrows, Enter, Escape out of the editor then Tab): the suite does not hear what a screen reader says.
6. Desktop app, when the shell or the build changed: `npm run tauri build -- --bundles deb` and start it.

Say what you ran and what you did not. "Tests pass" without the browser playthrough and the accessibility suite is not "verified" for a UI or content change.
