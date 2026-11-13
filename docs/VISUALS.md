# Interactive visuals

Two kinds, both picked up automatically from their folders. Neither needs a
shared file to be edited.

## Figures (in a level's brief)

A figure is an interactive explainer embedded in a brief with a line of its
own: `{{figure:timer-sawtooth}}`. It is one file,
`src/ui/figures/<id>.tsx`, named exactly like its id, exporting

```tsx
function TimerSawtooth() { ... }
export const figure = { id: "timer-sawtooth", Component: TimerSawtooth };
```

`gpio-pin.tsx`, `adc-chain.tsx` and `spi-modes.tsx` are the models to
follow. All figures also appear in the Handbook under "Key diagrams".

What makes a good figure here:
- **One idea.** It answers one question a student actually gets wrong
  ("which edge is the data read on?", "why does the ISR run only once?").
- **Something to do.** Sliders, toggles, a step button, something to drag.
  Every control changes the picture immediately, and where it corresponds
  to code, the exact C line is shown next to it and updates with it.
- **The picture carries the meaning.** Colour is consistent everywhere:
  orange = high / 3.3 V / active, blue = low / 0 V, harvest yellow = values
  and numbers, dashed grey = undefined or inactive. Label things directly;
  no legend to decode.
- **A sentence that reacts.** A short status line (`role="status"`) says in
  plain words what the current state means and why.
- **Small.** It sits in a column about 300 to 600 px wide next to the
  activity: draw SVG with a `viewBox` about 400 wide so it scales, keep
  text at 8.5 px or larger in that coordinate system.
- **Correct.** Numbers, register names, bit values and formulas come from
  the Technical Reference Manual (text extracted for grep at the path given
  in your task) and the course code. Cite the TRM section in a comment at
  the top. A figure that teaches something wrong is worse than none.

Reuse the CSS classes in `src/ui/styles.css` (`.figure`, `.fig-box`,
`.fig-box.hot`, `.fig-wire`, `.fig-label`, `.fig-value`, `.fig-trace`,
`.fig-controls`, `.fig-opt`, `.fig-step`, `.fig-why`, `.fig-dots`). If you
need a new class, put a `<style>` element inside your component (scoped by
a unique class prefix); do not edit `styles.css`.

Accessibility: real `<button>` / `<input>` controls with labels, visible
focus (inherited), `aria-pressed` on toggles, an `aria-label` on the SVG
that states the current state in words, no information by colour alone,
nothing that animates on its own unless the student started it (and then
respect `prefers-reduced-motion`).

Embed it where the idea is first needed: add the `{{figure:<id>}}` line to
the brief and one sentence pointing at it ("Try it in the figure: ...").
Keep other text changes to what the figure makes redundant.

## Bench views (next to the running board)

A view visualises what a running program is doing: a plot, a spinning
wheel, a robot on a map, an image from the program's memory. It is one
file, `src/ui/views/<id>.tsx`, exporting `view: BenchView`
(`src/ui/views/types.ts`). `analog-plot.tsx` is the model.

- `relevant(board, kit)` decides whether the panel appears; it must be
  cheap and must return false when the program does not use the thing
  (a level about LEDs should not show a motor).
- The component gets `board` (the whole simulator: `board.outputs`
  histories, `board.inputs`, `board.gpio.trace` / `level`, `board.dev.get`,
  `board.readVar(name)`, `board.readArray(name)` for global arrays,
  `board.plugins` for plugin state), the `kit`, `nowMs`, the time `window`
  to draw, and `live`.
- Output histories (`board.outputs`) record only changes of value: publishing
  the same value again adds no entry, so count events from a counter output
  or a plugin's own log, never from the number of history entries.
- It is re-rendered every animation frame while a program runs: draw from
  current state, keep no timers of your own, and keep it light (SVG with at
  most a few hundred elements, or a `<canvas>`).
- Read-only: a view never changes the simulation.

## Checking your work

```bash
node tools/shot.mjs figure <id> out.png [--click "button text"]...
node tools/shot.mjs level <level-id> out.png [--code solution.c] [--tests | --run 1500]
npx tsc --noEmit
npx vitest run tests/levels.test.ts
```

Look at every screenshot yourself (labels overlapping, text cut off,
unreadable contrast, a wrong waveform) and iterate until it is clean at
the default width and at `--width 480` for figures.
