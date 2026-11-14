# Writing levels

Levels are data in `src/levels/chapters/chNN_name.ts` (one `Chapter` export
per file, picked up automatically). The format is `src/levels/types.ts`;
`ch02_outputs.ts`, `ch05_interrupts.ts` and `ch06_serial.ts` are good
models for tone, length and structure.

## Chapter shape
Every chapter follows the same rhythm so students know what to expect:

1. `brief`: the idea in one or two screens, with 3 questions.
2. One or more hands-on puzzles without code: `wiring`, `timing`, `order`,
   `calc`, `register`, `quiz`.
3. `code` mode `complete`: fill in a few lines of course-style code.
4. `code` mode `write`: write the function(s) from an empty body.
5. `code` mode `debug`: fix a bug taken from a pitfall the labs, homeworks
   or lectures call out.
6. `code` mode `checkpoint`: a small integrated task that also uses earlier
   chapters.

Then, after the core levels: 1 to 2 `tier: "practice"` levels (same skill,
new case) and 2 or more `tier: "expert"` levels: hard, multi-step, little
hand-holding, requiring real understanding of the hardware or the
algorithm (do it from raw registers, meet a timing budget, handle the
awkward case). Core levels (no `tier`) are what unlocks the next chapter:
keep them gentle and complete. Aim for 6 to 9 core levels.

## Every level has
- `id` (unique, short, prefixed by the chapter), `title`, `goal` (one
  sentence), `brief`, `refs`, up to 3 `hints` (a nudge, then where to look,
  then nearly the answer), and a `takeaway` when there is a real lesson.
- `refs`: where the level's material is taught, see "References" below.
  At least one per level.
- Text uses a small Markdown subset: paragraphs, `**bold**`, `` `code` ``,
  `- ` lists, `1. ` lists, `## ` headings, and ```` ```c ```` blocks.

## References
Every level links to the place in the course that teaches it. A student who
is stuck clicks the chip under the brief (or the "Where this is taught" line
that appears with the first hint) and lands on that slide, lab or homework.

```ts
refs: [
  { course: "L5", slide: [21, 22] },          // lecture 5, slides 21 and 22
  { course: "L17", slide: 24, note: "why an RGB threshold fails in shadow" },
  { course: "Lab 3" }, { course: "HW2" },     // handout PDFs
  { trm: "11.5" },                            // Technical Reference Manual
]
```

- `course` is a lecture deck (`L1` to `L5`, `L6-7`, `L8-9`, `L10` to `L19`,
  `L20-21`, `L22-23`, `L24-25`; `L6` or `L21` resolve to their deck),
  `Lab 1` to `Lab 7`, `HW1` to `HW6`, `LabVIEW1` to `LabVIEW4`, `Project`,
  `Syllabus`, or `Primer A`/`B`/`C` (this game's own primers, no link).
  `src/levels/course-links.ts` turns each into a URL and a label.
- `slide` is the slide number inside that deck, counted from 1. It is the
  section `#s<N>` of the published page
  `.../Lectures/Slides/<deck>.html` (and page N of the deck's PDF). Give
  one slide, or two or three in reading order; the first is where the link
  opens. Choose the slide that teaches what the level practises: read its
  text, not only its title, and prefer a content slide to a section divider.
- `note` is a few words for the tooltip, for a slide with a generic title
  ("Camera Vision (16/33)") or a loose fit. Say so honestly.
- Do not force a slide. A level on material the lectures do not cover (the
  primers, CAN, a pitfall only a lab meets) cites the lab, the homework or
  the manual instead. Order: lectures, then labs and homeworks, then `trm`.
- A `trm` value must be a key of `src/levels/trm-index.json` (section
  numbers of the Technical Reference Manual, SPRUHM8I).
- Slide titles come from `src/levels/slides-index.json`. Regenerate it when
  the instructor changes a deck, from a checkout of the course repo:
  `uv run tools/gen-slides-index.py [path to SE-423---Class-Material]`
  (add `--check` to compare the titles with the published pages, and
  `--full notes.json` for titles plus the start of each slide's text).
- **Slide numbers move** when a slide is added or removed in a deck. The
  test catches a number beyond the end of its deck and a `course` that does
  not resolve. It cannot catch a number that now points at a neighbouring
  slide: after regenerating, look at `git diff src/levels/slides-index.json`
  and re-check the levels that cite a deck whose titles shifted.

## Interactive figures
A brief can embed a figure by putting a directive on a line of its own:
`{{figure:gpio-pin}}` (one pin: mux, direction, latch, pull-up, outside
circuit), `{{figure:adc-chain}}` (trigger to SOC to converter to result to
interrupt, step by step), `{{figure:spi-modes}}` (clock polarity and phase).
The list is `src/levels/figures.ts`; components are in `src/ui/figures/`.
Write the text to match the figure and point at it, not to replace it.

## Code levels
- `kit`: "robot" (LED1-5 on GPIO22/94/95/97/111 lit when high, PB1-4 on
  GPIO157-160, LaunchPad BLUE GPIO31 / RED GPIO34 lit when LOW, plus
  knobs and meters added by plugins), "redboard" (homework board: 16 LEDs,
  PB1-4 on GPIO4-7) or "launchpad".
- `starter` must compile and must NOT pass. `solution` must pass every
  check and every `bonus` objective with zero diagnostics.
- `checks` and `bonus` use the `Check` kinds in `src/sim/runner.ts`:
  `led`, `pin`, `blink`, `period`, `steady`, `opposite`, `duty`, `latency`,
  `uart`, `serial`, `serial-period`, `console`, `lcd`, `reg`, `latch`,
  `var`, `signal`, `isr`, `isr-time`, `max-steps`, `max-lines`,
  `no-dat-write`, `no-diagnostic`, `source`. Give each a `label` a student
  understands, and a `hint` when a failure has a typical cause.
  - `blink` assumes equal on and off times. For a PWM-like waveform pair
    `duty` (the share of the time it is on) with `period` (`periodMs`, from
    one switch-on to the next; every period in the window must fit), or a
    wrong period with the right duty passes.
  - `latch` (`port: "A"`, `equals`) reads the output latch of a whole port.
    It sees a 1 written to the bit of a pin that is an input, which no LED
    or pin check can.
  - `var` reads one element of a global array with `name: "found[0]"`.
  - A window (`from`, `to`) must lie inside the run and have a length. A
    check with an empty window fails and says so.
- `stimuli`: `{ at, press | release: "PB1" }`, `{ at, type: "text" }`
  (typed into SCIA at 115200 baud), `{ at, set: "<input name>", value }`
  (signal bus). Times are in ms. Leave at least 1 ms between a stimulus
  and a check that samples its effect.
- Inputs that disturb the world, for the case a correct program must
  handle and a shortcut does not (each model's header has the details):
  - `CAN_ERROR_FRAMES` = N: N damaged frames on the CAN-B bus. 100 take the
    receive error counter past 96, which raises a status interrupt
    (`plugins/can.ts`).
  - `TB_SLIP_LEFT` / `TB_SLIP_RIGHT` = 0 to 1: that wheel of the test bench
    turns without moving the robot, so the encoders and the gyro disagree
    (`plugins/plant.ts`).
  - `WORLD_KIND` = 6: one slanted wall, for line fits (`world/terrain.ts`).
- Measurements taken on the pins, to use with a `signal` check:
  `I2C_SCL_MIN_LOW_US` and `I2C_SCL_MIN_HIGH_US`, the shortest SCL low and
  high time of any I2C master, the module or a bit-banged one
  (`plugins/i2c.ts`).
- Make results observable: LEDs, pins, serial text, global variables
  (`var` checks, `watch` list), registers, or signal-bus outputs.
- The C dialect is the course's: TI bit-field register names
  (`EPwm1Regs.TBCTL.bit.CLKDIV = 0;`), `int` is 16 bits, `long`/`float`
  32 bits, `%d` vs `%ld`. Supported: functions, pointers, arrays, structs,
  enums, switch, static locals, `#define` (with arguments), float math
  (`sin`, `cos`, `sqrt`, `atan2`, `fabs`...), `printf`, `serial_printf`
  (after `init_serialSCIA`), `DELAY_US`. Not supported: `goto`, 64-bit
  integers, `malloc`.
- Lines at most 100 characters. Plain ASCII in code (no curly quotes, long
  dashes or ellipsis characters). In TypeScript template strings write C
  escapes as `\\r\\n`.
- Keep each test under about 2 s of wall time. A loop that changes nothing
  is skipped instantly, interrupt-driven code is cheap, `DELAY_US` jumps
  time; a polling loop that writes something on every pass is simulated
  statement by statement (about 1 to 3 million statements per second).

## Building on earlier work
A code level may set `continues: "<earlier level id>"`. It then opens with
the student's own saved code from that level, so a chapter can grow one
program step by step (the capstone does this). Write the brief so it works
either way: say exactly what to add and where, not "fill in the TODO".

## Writing for a complete beginner
Assume the student has never programmed and never held a wire. They start
with the primer chapters A (electricity), B (C from zero) and C (C for
hardware). After those, every later chapter may rely only on what an
earlier level taught. So:
- A word is explained the first time it appears, in one plain sentence, in
  the place it appears. Add it to a glossary file as well: any file
  `src/levels/glossary/<name>.ts` exporting `glossary: GlossaryEntry[]`
  (type in `src/levels/types.ts`) is picked up by the Handbook.
- A C construct, a symbol or a piece of maths is shown with a tiny worked
  example before the student has to use it.
- One new idea per level. If a level needs two, split it.
- Say why before how: what goes wrong on the robot without this.
- Code the student did not write is either explained line by line once, or
  marked clearly as "given, explained in chapter N".
- `printf` output goes to a console; check it with the `console` check
  kind (`includes`, `equals` or `matches`).

## Accuracy
- Facts must agree with the Technical Reference Manual. Where a slide or
  handout differs, follow the TRM and say so in one line.
- Use the course's real pin numbers, register settings and helper function
  names (labs, homeworks and the starter projects in the course repo).
- Do not repeat known errors in the course material (see the report in the
  course repo's CLAUDE.md "Known Content Issues", and: SYSCLK period is
  5 ns, push buttons are read from GPEDAT/GPFDAT, `init_serialSCIA` is the
  real function name).

## Style
Second person, short plain sentences, student friendly. Define a term the
first time it appears. No filler, no jokes that need context, no long
dashes. A brief says what the thing is, why it matters on the robot, and
exactly what to do.

## Verify
`npx vitest run tests/levels.test.ts` (every reference solution passes all
checks and bonus objectives, every starter compiles but fails, every
reference resolves and every cited slide exists) and `npx tsc --noEmit`.
