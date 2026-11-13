---
name: add-figure
description: Build or change an interactive figure (embedded in level briefs and listed in the Handbook) or a bench view (shown beside a running program) in the Bringup game. Use when asked for a diagram, visualisation, playground, or to fix how one looks or behaves.
---

# Add a figure or a bench view

Read `docs/VISUALS.md` first; it is the contract. Reference examples: `src/ui/figures/gpio-pin.tsx` (small, one idea), `pwm-playground.tsx` with its pure model `pwm-model.ts` (large, tested), `src/ui/views/robot-arena.tsx` (bench view).

1. **One idea.** Write the sentence the student should be able to say after using it. Anything that does not serve that sentence goes behind a "More controls" disclosure or out.
2. **Truth first.** If it shows chip behaviour, put the behaviour in a pure module (no React) and test it against the manual's tables and against the simulator (`runProgram`), as `tests/pwm_model.test.ts` does. Where they disagree the manual wins and the simulator gets fixed.
3. **Build** `src/ui/figures/<id>.tsx` exporting `figure = { id, title, description, Component }` (auto-registered). Order: picture, a sentence that reacts to the current state in plain words, controls, caption. Controls are real buttons and inputs with labels and show the C line they stand for. The SVG has an `aria-label` describing the state. Colours only from the CSS tokens (`var(--hi)` high or active, `var(--lo)` low, `var(--value)` numbers, `var(--text)`, `var(--dim)`, ...), except where colour is the content.
4. **Robust.** No NaN, Infinity or division by zero at any slider end. Nothing animates on its own. Dragging always has a keyboard or numeric equivalent. Text stays at least about 9 px when the figure is 380 px wide.
5. **Bench views** live in `src/ui/views/<id>.tsx` exporting `view: BenchView` with a cheap `relevant(board)`. They re-render every frame of a live run: no heavy work, no timers, bounded histories.
6. **Look.** `node tools/shot.mjs figure <id> out.png`, again with `--dark`, `--width 480`, `--width 380`, and `--click "..."` for each state; exercise slider extremes with a small Playwright script. Read every image. Check the console is clean.
7. **Use it.** Embed with `{{figure:<id>}}` in the level that introduces the idea, never in a level whose answer it prints. Then `npx tsc --noEmit` and `npm run check-levels`.
