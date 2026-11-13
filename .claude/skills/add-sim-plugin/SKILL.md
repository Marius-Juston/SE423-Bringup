---
name: add-sim-plugin
description: Add or extend a peripheral or world model in the Bringup simulator (ADC, ePWM, SPI device, sensor, robot world, a C-language feature, a diagnostic). Use when a level needs behaviour the simulator lacks, a simulator result disagrees with the reference manual, or a beginner mistake goes unreported.
---

# Extend the simulator

Read `docs/PLUGINS.md` first. The simulator is pure TypeScript under `src/sim/`; plugins in `src/sim/plugins/*.ts` export `plugin: SimPlugin` and load automatically.

1. **Read the manual section** for the peripheral (the Technical Reference Manual PDF is in the course repo under `SE423Spring26/`; `pdftotext -layout`, then grep) and the course code that uses it. Write down the register fields involved, reset values, EALLOW protection and the timing formulas. Do not work from memory.
2. **Model behaviour, not gates.** Hook the registers (`RegHook` in `src/sim/memory.ts`: `read`, `write`, `after`, `protect`, `live`), schedule events on the board (`b.at(t, fn)`), publish what the outside world sees (`b.publish(name, value, t)`) and read what it provides (`b.inputs`, `b.onInput`). Time is in nanoseconds and only advances through the board. No wall-clock time, no `Math.random` (use a seeded generator), no DOM.
3. **Header comment:** the manual sections implemented, the signal names in and out, and a plain list of what is not modelled.
4. **Diagnostics.** For each mistake a beginner will make with this peripheral (forgot the pin mux, wrote a protected register without EALLOW, read a result before it exists, a value that does not fit), call `b.warn(line, code, message)` with what happened and what to try. Library code reports the student's line.
5. **Parts on the board:** add knobs and meters through the plugin's `parts` so levels can show and drive it; they appear only when a level uses them.
6. **Tests** in `tests/<name>.test.ts`: the manual's formulas with numbers, the diagnostics, and a short C program through `runProgram`. If a figure models the same thing, test the two against each other.
7. **Do not change what existing levels observe** unless the old behaviour was wrong; then fix the levels in the same change. `npx vitest run` must stay green, including `tests/levels.test.ts`, which runs every reference solution.
8. Document new inputs, outputs and helper functions in `docs/PLUGINS.md`.
