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
- `refs`: `{ course: "L5" | "Lab 3" | "HW2" }` and/or `{ trm: "15.4" }`.
  A `trm` value must be a key of `src/levels/trm-index.json` (section
  numbers of the Technical Reference Manual, SPRUHM8I).
- Text uses a small Markdown subset: paragraphs, `**bold**`, `` `code` ``,
  `- ` lists, `1. ` lists, `## ` headings, and ```` ```c ```` blocks.

## Code levels
- `kit`: "robot" (LED1-5 on GPIO22/94/95/97/111 lit when high, PB1-4 on
  GPIO157-160, LaunchPad BLUE GPIO31 / RED GPIO34 lit when LOW, plus
  knobs and meters added by plugins), "redboard" (homework board: 16 LEDs,
  PB1-4 on GPIO4-7) or "launchpad".
- `starter` must compile and must NOT pass. `solution` must pass every
  check and every `bonus` objective with zero diagnostics.
- `checks` and `bonus` use the `Check` kinds in `src/sim/runner.ts`:
  `led`, `pin`, `blink`, `steady`, `opposite`, `duty`, `latency`, `uart`,
  `serial`, `serial-period`, `lcd`, `reg`, `var`, `signal`, `isr`,
  `isr-time`, `max-steps`, `max-lines`, `no-dat-write`, `no-diagnostic`,
  `source`. Give each a `label` a student understands, and a `hint` when a
  failure has a typical cause.
- `stimuli`: `{ at, press | release: "PB1" }`, `{ at, type: "text" }`
  (typed into SCIA at 115200 baud), `{ at, set: "<input name>", value }`
  (signal bus). Times are in ms. Leave at least 1 ms between a stimulus
  and a check that samples its effect.
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
checks and bonus objectives, every starter compiles but fails, citations
exist) and `npx tsc --noEmit`.
