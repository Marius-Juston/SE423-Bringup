# Bringup

A practice game for **SE 423: Introduction to Mechatronics** (University of
Illinois). Students work through short levels that start at bits and hex and
build up to the robot: background puzzles (wiring, timing diagrams, register
bits) followed by real course-style C that runs on a simulated TMS320F28379D.

Private course material. It runs offline; progress is saved on the student's
own computer.

## Playing

- **Map**: 25 chapters in six parts. **Start here** has three primers for
  students who have never programmed or wired a circuit (A: electricity and
  circuits, B: C from zero, C: C for hardware); anyone who knows C and Ohm's
  law starts at chapter 0. Then Foundations, Analog and motion, Buses and
  data, The robot, and a **Capstone** in which one program grows level by
  level, from the student's own code, until the robot drives itself to a
  goal. Every chapter has a **core path**, optional **practice** levels and
  optional **expert challenges**. Nothing is locked: a chapter only says
  which chapters to do first. Tiles carry the labs and homeworks a chapter
  supports, and the "Working on" filter highlights the chapters for one.
- **Briefings** embed interactive figures (a GPIO pin you can configure, the
  ADC chain from trigger to interrupt, SPI clock modes, an interrupt path
  whose gates you open and close, a PWM waveform you drag, and many more).
  They are all collected in the Handbook under "Key diagrams".
- **Code levels**: write C in the editor. **Run** starts a live board: hold
  the on-screen push buttons, turn knobs, type into the serial terminal.
  **Pause**, **Step line** (F10) and **Next write** (F9) walk through the
  program. The bench shows the board, pins over time, values over time,
  views for whatever the program uses (PWM outputs, ADC slots, bus traffic,
  the robot from above, the LIDAR's room, arrays as grids), the serial
  terminal, and a register **change log**: which line wrote which register,
  the fields before and after, and the bits that changed.
- **Run tests** (Ctrl+Enter) plays a fixed scenario and lists each check
  with what was observed. Code levels also offer **stars** for tighter or
  lower-level solutions (an interrupt time budget, no helper functions,
  fewer lines).
- **Hints**: up to three per level, from a nudge to nearly the answer. The
  reference solution opens after the level is passed or the last hint is
  used. A level passed with the solution open counts as "passed with help"
  and earns no stars until it is passed again without it.
- **Glossary**: every term the levels introduce, in plain words, with a link
  to the level that teaches it (Handbook).
- **Handbook**: every register of the chip with its fields, the pin tables
  of the course boards, the formulas, and the key diagrams.
- **Sandbox**: a free board with nothing checked.
- **Settings**: light or dark theme, text size, keyboard shortcuts, progress
  export and import.

## Development

Needs Node 24+ and, for the desktop app, Rust and the Tauri prerequisites
(on Debian/Ubuntu: `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev
libayatana-appindicator3-dev libxdo-dev libssl-dev build-essential`).

```bash
npm install
npm run dev            # the game in a browser, http://localhost:5183
npm test               # simulator tests + level checks
npm run check-levels   # level checks only
npm run tauri dev      # the desktop app, live reload
npm run tauri build    # installers in src-tauri/target/release/bundle/
```

Pushing a tag `vX.Y.Z` builds Windows, macOS and Linux installers and
attaches them to a draft release (`.github/workflows/release.yml`). The
installers are not code-signed: Windows SmartScreen and macOS Gatekeeper
warn on first launch ("More info" then "Run anyway"; on macOS right-click
the app and choose Open). Releases of a private repository are not visible
to students, so post the installers where they can reach them.

## How it is built

```
src/sim/          the simulator: pure TypeScript, no DOM
  cc/             C-subset lexer, preprocessor, parser, compiler to closures
  device/         register map generated from the TI headers
  periph/         built-in models: GPIO, CPU timers, PIE, SCI
  plugins/        one file per further peripheral or world model: ADC, DAC,
                  ePWM, eQEP, SPI (+ MPU-9250, DAN28027), I2C, CAN, DMA,
                  motors/servos/buzzer, LIDAR, robot test bench, signal source
  lib/            course library: TI helper sources (run as C) + natives
  world/          parts on the course boards (LEDs, buttons, knobs, meters)
  board.ts        memory, time, events, CPU interrupt logic, signal bus
  runner.ts       scripted run + checks (used by "Run tests" and CI)
  live.ts         interactive run with pause and stepping (used by "Run")
src/levels/       level data, one file per chapter
src/ui/           React interface
  figures/        interactive figures for briefs, one file per figure
  views/          bench views shown next to a running program
src-tauri/        desktop shell (Tauri 2)
tools/            generators (register map, TI sources, TRM index), shot.mjs
tests/            simulator and plugin tests, the course starter project,
                  level checks, and e2e/ (plays every level in a browser)
docs/             AUTHORING.md (levels), PLUGINS.md (simulator), VISUALS.md
```

Things worth knowing about the simulator:

- **C as the C2000 compiler sees it.** `int` and `char` are 16 bits, `long`
  and `float` 32, `double` is `float`. `200 * 1000` wraps (with a warning),
  `%d` given a 32-bit value prints the wrong number, as on the board.
- **Real register layout.** Registers sit at their real addresses with the
  TI bit-field names, so `GpioDataRegs.GPASET.bit.GPIO31 = 1;` and pointer
  code such as TI's `GPIO_SetupPinMux` run unchanged. EALLOW protection is
  enforced, and the simulator says when a write was ignored.
- **Behaviour, not cycle accuracy.** Time advances by a nominal amount per
  statement and jumps between events when the program is idle. Each
  peripheral model cites the TRM section it implements.
- The unmodified course `LABstarter_main.c` runs and is a test fixture
  (`tests/labstarter.test.ts`, skipped when the course repo is not present).

## Adding content

- **A level**: add an entry to a chapter file in `src/levels/chapters/` (or
  a new `chNN_name.ts` exporting a `Chapter`; files are picked up
  automatically). See `docs/AUTHORING.md`. `npm run check-levels` verifies
  that the reference solution passes every check and star with no
  diagnostics, the starter compiles but does not pass, and every citation
  and figure exists.
- **A peripheral or world model**: one file in `src/sim/plugins/`. See
  `docs/PLUGINS.md`.
- **A figure or bench view**: one file in `src/ui/figures/` or
  `src/ui/views/`. See `docs/VISUALS.md`; `node tools/shot.mjs` screenshots
  a figure or a level for checking.
- `npm run e2e` builds the game and plays every level through the real
  interface in a headless browser (needs Playwright's Chromium).

## Regenerating generated files

These need a local copy of the course repository (`SE423Spring26/`), which
holds C2000Ware and the Technical Reference Manual. Neither is committed
here.

```bash
node tools/gen-registers.mjs <.../C2000Ware_4_01_00_00/device_support/f2837xd/headers>
node tools/gen-ti-source.mjs <.../C2000Ware_4_01_00_00/device_support/f2837xd>
node tools/trm-index.mjs <.../tms320f28379D_TechRefi.pdf>     # needs pdftotext
```

## Campaign

| Part | Chapters |
|---|---|
| Foundations | 0 Bits and numbers, 1 Registers, 2 Digital outputs, 3 Digital inputs, 4 CPU timers, 5 Interrupts, 6 Serial and ASCII |
| Analog and motion | 7 DAC, 8 ADC, 9 PWM, 10 Motors and actuators, 11 Encoders |
| Buses and data | 12 SPI, 13 SPI devices, 14 I2C and CAN, 15 DMA and filters |
| The robot | 16 Feedback control, 17 Sensors and state machines, 18 Where am I, 19 Seeing and planning, 20 Threads |

Known limits of the simulator are listed at the top of each model file.
The main ones: timing is nominal, not cycle-accurate; the serial port does
not draw its waveform on the TX pin; external pin interrupts (XINT) are not
modelled; chapters 16 and 18 use a self-contained robot test bench (`tb_`
functions) instead of the PWM and encoder models.

See `THIRD_PARTY.md` for the Texas Instruments licence notice.
