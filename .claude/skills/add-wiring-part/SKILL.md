---
name: add-wiring-part
description: Add or change a part of the Sandbox's wiring bench in the Bringup game (a device a student attaches to free pins, or a part of the homework board with its fault switches). Use when asked for a new sensor, actuator or board part on the bench, a new fault, or a new connection check.
---

# Add a wiring-bench part

Read `docs/WIRING.md` first ("The model and its limits", "Add a part", "Connection checks"). The bench has fixed connections and one rule per part. It has no circuit solver: do not add one for a part.

1. **Decide what it is.** A device for the bin (the student attaches it) or a part of the board (it has a place in `src/sim/world/boards/hw-board.json`). A board part that is missing from the data needs `tools/gen-board.mjs` changed and the file regenerated from the course's board files: regenerating must give the same bytes twice.
2. **One file.** `src/sim/wiring/parts/<id>.ts`, picked up by itself. Copy the nearest existing part. Give it `terminals` with the right role (the role decides its connection checks), `options` (a fault switch has `fault: true`; the first choice is the default), `inputs` for what the student moves, `apply` for what it does to the simulation, `status` for its state in a few words and why it is not working, and `check` for connection mistakes of its own. A board part also has `onBoard` and `draw`.
3. **Rules.** No DOM, no wall clock, no `Math.random`. The header says what the part models, what it does not, and where the numbers come from (data sheet section, handout). A mistake a beginner makes gets a message that says what happened and what to choose instead. State is never shown by colour alone: `draw` gives a shape or a word for lit, pressed, moved and not soldered.
4. **Never** add a file that attaches several devices at once, a finished homework or lab circuit, or a program. The guard tests in `tests/wiring_bench.test.ts` fail on it.
5. **Test.** Add cases to `tests/wiring_bench.test.ts`: the part works when wired right, each fault gives its symptom and message, each wrong connection gives its check. Add a step to `tests/e2e/wiring.e2e.ts` if it has a new kind of control.
6. **Look and verify.** Open the Sandbox on the homework red board, attach or select the part, run a program, and read screenshots in light and dark, at 390 px and in the large view. Then the `verify` skill, including `npm run a11y -- --only screens`.
7. **Document.** One line in `docs/WIRING.md` (the parts list and, for a new check, "Connection checks").
