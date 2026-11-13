---
name: add-level
description: Add or change a level (brief, quiz, calc, register, timing, order, wiring or code) in a chapter of the Bringup game, following the content rules and verifying it. Use when asked to add, write, fix or extend levels or a chapter.
---

# Add a level

Read `docs/AUTHORING.md` first; it is the contract. This is the order of work.

1. **Place it.** Open the chapter file in `src/levels/chapters/`. Read the levels before and after the spot. List what the student has been taught by then (earlier levels of this chapter, the chapters in its `requires`, the primers). The new level may use only that, plus one new idea.
2. **Source it.** Find the fact in the course material (`../SE-423---Class-Material`: `Lectures/Slides/*.pptx`, `Labs/`, `Homeworks/`, the starter projects under `SE423Spring26/`) and in the Technical Reference Manual (`pdftotext -layout` the PDF in `SE423Spring26/`, then grep). Note the manual section and the lecture slide for `refs`. If a homework or lab asks for this exact answer, change the numbers, pins or registers.
3. **Write it** as data (types in `src/levels/types.ts`): `id` (new, permanent, chapter prefix), `title`, one-sentence `goal`, `brief` (why first, a worked example with numbers, under about 350 words, `{{figure:<id>}}` where a picture teaches), the activity, three `hints` (nudge, mechanism, nearly the answer), a `takeaway`, `refs` with `{ course: "L6-7", slide: 23 }` and `{ trm: "15.6" }`, and `tier` (`core` only if the chapter cannot be understood without it; keep core paths near ten levels).
4. **Code levels:** `starter` compiles and fails; `solution` passes every check and star with zero diagnostics; `checks` judge behaviour (`led`, `pin`, `blink`, `duty`, `signal`, `serial`, `console`, `var`, `isr`, `isr-time`, `reg`, ...; see `src/sim/runner.ts`) and each has a `hint` naming the likely cause; a check on end-state globals gets a second input (stimulus or second call). State every name a check relies on in the brief. Use `continues: "<earlier id>"` when the student should build on their own code.
5. **Attack it.** Write the two or three most likely wrong programs and one different correct one; run them with a script that imports `runProgram` from `src/sim/runner.ts` (`npx vite-node script.ts` from the repo root). Wrong ones must fail with feedback a beginner can act on; the alternative correct one must pass.
6. **Glossary.** Add each new term to a file in `src/levels/glossary/` (plain one or two sentences, `level` id).
7. **Verify.** `npm run check-levels`, `npx tsc --noEmit`, then look: `node tools/shot.mjs level <id> out.png --tests --height 1400` (and `--dark`). For a new chapter also run `E2E_FROM=<number> npx vitest run --config vitest.e2e.config.ts` after `npx vite build`.

If the simulator lacks what the level needs, extend the simulator (skill `add-sim-plugin`); do not weaken the level.
