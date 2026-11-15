---
name: perf-check
description: Measure the Bringup game's speed and size before and after a change (blocking time during Run tests, frames in a live run, first-load size, simulator rate) and compare with the recorded numbers. Use after changes to the simulator's hot paths, the code level view, bench views, the build configuration or dependencies, and when asked whether something got slower.
---

# Check performance

Measure a production build before and after, back to back on a quiet machine, medians of at least three runs, also with 4x CPU throttling (CDP `Emulation.setCPUThrottlingRate`). Build each into its own folder and serve it with `vite preview` on a free port (`ss -ltn` first). Report both numbers; do not report a gain you did not measure.

| What | How | Recorded (November 2026, 32-core desktop) |
|---|---|---|
| Simulator rate | `npm run bench` (`tests/sim.bench.ts`) | compare with the previous run on the same machine |
| Run tests, heaviest level (`cap-x-trap`) | longest task from a PerformanceObserver `longtask` trace, and click to `.bench .result` | none over 50 ms at 1x; about 85 ms at 4x; about 2.1 s at 1x |
| Live run, `cap-x-trap`, 30 s | frames per second and renders per second per component (unminified build, React DevTools hook) | 60 fps at 1x, 30 fps at 4x; only the bench panels render |
| First load of the map | transferred bytes, FCP, module evaluation | 2.47 MB script (0.73 MB gzip) in 3 files; FCP 128 ms at 1x, 320 ms at 4x |
| Fonts | emitted font files | 5 files, 86 kB, none inlined in the CSS |
| Memory | JS heap after 40 levels opened and left | flat, about 21 MB |

Rules that keep these numbers:
- Nothing in `src/sim` builds a string or looks a register up by name per event: resolve names once (see `src/sim/plugins/epwm.ts`, `src/sim/periph/pie.ts`).
- The page runs a level's tests in slices (`runProgramSteps`, `src/ui/code/testrun.ts`); `tests/runner_slices.test.ts` holds the sliced and the single run equal.
- While a program runs only the bench panels re-render (`src/ui/code/BenchPanels.tsx`). Nothing is memoised on `board`: it is changed in place. Lists that grow are keyed by place, not by entry.
- Screens, the code level and figures load on demand through `src/ui/screens.tsx` and `src/ui/figures/index.tsx`. An import of one of them from the map or `App.tsx` puts it back in the first script: check the chunk list after a build.
- A new font subset or a character outside the shipped ranges fails `tests/fonts.test.ts`.

If a number got worse, find the cause with a CPU profile (`node --cpu-prof` on a script that calls `runProgram`, or a Performance trace in the browser) before changing anything.
