# Interactive visuals

Two kinds, both picked up automatically from their folders. Neither needs a
shared file to be edited.

## Figures (in a level's brief)

A figure is an interactive explainer embedded in a brief with a line of its
own: `{{figure:timer-sawtooth}}`. It is one file,
`src/ui/figures/<id>.tsx`, named exactly like its id, exporting

```tsx
function TimerSawtooth() { ... }
export const figure = {
  id: "timer-sawtooth",
  title: "CPU timer countdown",
  description: "Set the period register and the prescaler, step the clock and watch the counter count down to zero, raise its flag and start again.",
  Component: TimerSawtooth,
};
```

`title` and `description` are what the Handbook shows on the figure's card.
The title is what a student would call the figure ("RC charging curve",
"Ohm's law"), not the file name. The description is one plain sentence:
what you can do with it and what it shows, without the terms the figure
itself teaches.

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
- **One idea also means few controls.** Two or three rows are visible. The
  rest goes behind one disclosure, closed by default:
  `<details className="fig-more"><summary>More controls: ...</summary>`.
  A control a brief tells the student to use must be visible, or the brief
  must say "open More controls".
- **Opens in the state of its first level.** The embed syntax has no
  options, so a figure opens the same way everywhere: choose the state the
  first level that embeds it needs, and say in later briefs what to set.
- **Small.** It sits in a column about 300 to 600 px wide next to the
  activity, and about 380 px in the reading pane of a code level: draw SVG
  with a `viewBox` about 400 wide so it scales, and use `.fig-label` /
  `.fig-value` for its text.
- **Legible when narrow.** No label in a drawing may render under 9 px.
  `Figure` (`index.tsx`) gives every drawing its scale as `--fig-k` and
  the standard label classes grow to stay at 9 px, by up to 18 % at 380 px.
  So leave room: a label that just fits its box at 700 px runs out of it
  at 380 px. Text with a class of its own uses
  `font-size: max(8.5px, calc(9px / var(--fig-k, 1)))`. A sentence does not
  belong in the drawing: put it in the status line or the caption.
- **Correct.** Numbers, register names, bit values and formulas come from
  the Technical Reference Manual (text extracted for grep at the path given
  in your task) and the course code. Cite the TRM section in a comment at
  the top. A figure that teaches something wrong is worse than none.

### Order of the parts

Every figure is laid out in the same order, so a student knows where to
look:

1. the picture (and a read-out that belongs to it, such as a formula or
   three numbers);
2. the sentence that reacts (`.fig-why` or `.fig-step`, `role="status"`);
3. the controls (`.fig-controls`), then "More controls";
4. code or a table that follows from the settings, if any;
5. the caption.

The only exception: controls that are part of the picture, such as bits,
memory cells or gates you click (`bit-explorer`, `mask-ops`, `math-grid`,
`math-centroid`, `memory-map`, `schematic-symbols`, `interrupt-path`).
Anything that can be dragged in a drawing also has a slider or buttons
with a visible label, and the caption says so.

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
the default width, at `--width 480` and at `--width 412` (a 380 px figure)
for figures, light and `--dark`. Code lines may scroll inside their own
box; nothing else may be wider than the figure.
