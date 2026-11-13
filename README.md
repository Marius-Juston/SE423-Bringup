# Bringup

A practice game for **SE 423: Introduction to Mechatronics** (University of
Illinois). Students work through short levels that start at bits and hex and
build up to the robot: background puzzles (wiring, timing diagrams, register
bits) followed by real course-style C that runs on a simulated TMS320F28379D.

Private course material. It runs offline; progress is saved on the student's
own computer.

## Playing

- **Map**: chapters unlock in order; every chapter has the same rhythm
  (briefing, puzzles, complete the code, write the code, debug, checkpoint).
  Settings has an "unlock every chapter" switch for practising one topic.
- **Code levels**: write C in the editor. **Run** starts a live board: hold
  the on-screen push buttons, type into the serial terminal, watch LEDs, pin
  traces, variables and the registers your code wrote. **Run tests** plays a
  fixed scenario and lists each check with what was observed.
- **Hints**: up to three per level, from a nudge to nearly the answer. The
  reference solution opens after the level is passed or the last hint is used.
- **Handbook**: every register of the chip with its fields, the pin tables
  of the course boards, and the formulas.
- **Sandbox**: a free board with nothing checked.

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
  periph/         behavioural models: GPIO, CPU timers, PIE, SCI
  lib/            course library: TI helper sources (run as C) + natives
  world/          parts on the course boards (LEDs, buttons)
  board.ts        memory, time, events, CPU interrupt logic
  runner.ts       scripted run + checks (used by "Run tests" and CI)
  live.ts         interactive run (used by "Run")
src/levels/       level data, one file per chapter
src/ui/           React interface
src-tauri/        desktop shell (Tauri 2)
tools/            generators for the register map, TI sources, TRM index
tests/            simulator tests, the course starter project, level checks
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

## Adding a level

Add an entry to a chapter file in `src/levels/chapters/` (or a new
`chNN_name.ts` exporting a `Chapter`; files are picked up automatically).
The format is in `src/levels/types.ts`. `npm run check-levels` then verifies
that the reference solution passes every check with no diagnostics, the
starter compiles but does not pass, and every TRM citation exists.

## Regenerating generated files

These need a local copy of the course repository (`SE423Spring26/`), which
holds C2000Ware and the Technical Reference Manual. Neither is committed
here.

```bash
node tools/gen-registers.mjs <.../C2000Ware_4_01_00_00/device_support/f2837xd/headers>
node tools/gen-ti-source.mjs <.../C2000Ware_4_01_00_00/device_support/f2837xd>
node tools/trm-index.mjs <.../tms320f28379D_TechRefi.pdf>     # needs pdftotext
```

## Roadmap

| Milestone | Chapters |
|---|---|
| M1 (this release) | 0 Bits, 1 Registers, 2 Digital outputs, 3 Digital inputs, 4 CPU timers, 5 Interrupts, 6 Serial |
| M2 | 7 DAC, 8 ADC, 9 PWM, 10 Motors and actuators, 11 Encoders |
| M3 | 12 SPI, 13 SPI devices, 14 I2C and CAN, 15 DMA and filters |
| M4 | 16 Feedback control, 17 Sensors and state machines, 18 Localization |
| M5 | 19 Vision and planning, 20 Threads |

See `THIRD_PARTY.md` for the Texas Instruments licence notice.
