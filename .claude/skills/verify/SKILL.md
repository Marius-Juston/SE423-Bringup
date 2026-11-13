---
name: verify
description: Verify a change to the Bringup game before calling it done: type check, unit and level tests, the browser playthrough, and screenshots in both themes. Use after any change to levels, the simulator, figures or the interface, and before committing or releasing.
---

# Verify a change

Do the steps that apply, in this order, and report each result as it is.

1. `npx tsc --noEmit`
2. `npx vitest run` (all of it; about a minute). A failing reference solution in `tests/levels.test.ts` means a simulator or content change broke a level: fix the cause.
3. Browser playthrough, which solves levels through the real interface in headless Chromium: `npx vite build`, then `E2E_FROM=<first chapter you touched> npx vitest run --config vitest.e2e.config.ts`, or `npm run e2e` for everything (minutes). Primer chapters are numbers -3 to -1.
4. Look at it. `node tools/shot.mjs level <id> out.png --tests` (add `--dark`, `--width 1024`, `--width 480`), `node tools/shot.mjs figure <id> out.png`, `node tools/shot.mjs map out.png`, `node tools/shot.mjs handbook out.png --section "Key diagrams"`. Read the images: overlaps, clipped labels, unreadable contrast, anything a first-time student would not understand.
5. Interface changes: keyboard only (Tab, arrows, Enter, Escape out of the editor then Tab), and an axe run on the changed screens in both themes (`npm install --no-save @axe-core/playwright`): no serious or critical violations.
6. Desktop app, when the shell or the build changed: `npm run tauri build -- --bundles deb` and start it.

Say what you ran and what you did not. "Tests pass" without the browser playthrough is not "verified" for a UI or content change.
