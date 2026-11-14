# Adding a peripheral or a world model (simulator plugins)

A plugin is one file in `src/sim/plugins/` that exports `plugin: SimPlugin`
(`src/sim/plugin.ts`). It is loaded automatically. `src/sim/plugins/dac.ts`
is the small reference example; `src/sim/periph/cputimer.ts`, `gpio.ts`,
`sci.ts` and `pie.ts` show larger models (those four are built into the
board; new work goes in plugins).

## What a plugin can do

```ts
export const plugin: SimPlugin = {
  name: "adc",
  prelude: `/* C source added to the course library */`,
  install(b) { /* per Board: hooks, natives, world models */ },
  parts: { robot: [ /* knobs, meters, LEDs, buttons added to a kit */ ] },
};
```

### Registers
Every register of the chip already exists with its TI name, real address and
fields (`src/sim/device/registers.json`, from the TI headers).

- `b.dev.reg("EPwm1Regs.TBPRD").hook` is a `RegHook` (`src/sim/memory.ts`):
  - `read(stored)`: value a CPU read returns (default: stored value).
  - `write(value, stored)`: value to store (use for write-1-to-clear bits,
    bits that always read 0).
  - `after(value, before)`: react to a CPU write (start a conversion,
    recompute a period).
  - `live = true`: the value changes with time on its own (a running
    counter). Required for any register whose read depends on `b.now`.
  - `protect = true`: EALLOW-protected (ADC, DAC, DMA, GPIO control, PIE
    vectors, clocks are already marked in `src/sim/device/device.ts`; add
    others the TRM register tables mark as EALLOW).
- `b.dev.get(name, field?)` / `b.dev.set(name, value, field?)`: the
  peripheral's own access (no hooks, no protection).
- `[...b.dev.regs.keys()]` lists names; check field names in the TI header
  or with the game's Handbook search.

### Time and events
- `b.now`: time in ns. SYSCLK is 200 MHz (`src/sim/consts.ts` has
  `SYSCLK_NS`, `LSPCLK_HZ` = 50 MHz, `EPWMCLK_HZ` = 100 MHz).
- `b.at(timeNs, (t) => { ... })` schedules an event and returns a handle;
  `b.cancel(handle)`. Model periodic hardware by rescheduling from the
  event. Never model a counter by ticking it every clock: compute its value
  from `b.now` when read (see `cputimer.ts`).
- The simulator skips ahead when the program's loop changes nothing. It
  decides this from memory contents and `b.mem.writes`. Register and memory
  changes made with `b.dev.set` / `b.mem.poke` are tracked automatically;
  if your model changes state that is NOT in memory (a queue, a mode flag)
  call `b.mem.writes++`.

### Interrupts
- Through the PIE: `b.pie.raise(group, channel)` (TRM Table 3-2; the vector
  name is `b.pie.vectorName(group, channel)`).
- Trigger lines between peripherals: `b.fireTrigger("EPWM4SOCA", t)` and
  `b.onTrigger("EPWM4SOCA", (t) => ...)`. Names in use: `TINT0`..`TINT2`
  (CPU timers), `EPWM<n>SOCA` / `EPWM<n>SOCB` (n = 1..12), `ADC<A-D>INT<1-4>`.

### Pins
- A peripheral output on a pin: `b.gpio.drivePeripheral(pin, 0 | 1 | null, t)`
  (it reaches the pin only while the pin's mux selects a peripheral;
  `b.gpio.mux(pin)` gives the mux position 0..15, check it against the
  position the course code uses for that signal).
- Reading a pin: `b.gpio.level[pin]` (0, 1, or -1 floating);
  `b.gpio.listeners.push((pin, level, t) => ...)` for edges;
  `b.gpio.trace.get(pin)` is the full history.
- An external device driving a pin: `b.gpio.drive(pin, 0 | 1 | null, t)`.

### The world: signal bus, knobs and meters
- Inputs by name: `b.input("ADCINA4")` (set by a knob, a test stimulus
  `{ at, set: "ADCINA4", value: 1.5 }`, or another plugin via
  `b.setInput(name, v)`); `b.onInput(name, fn)` to react.
- Outputs by name: `b.publish("DACA", volts)` (history kept; the `signal`
  check in `src/sim/runner.ts` reads it, meters display it).
- Kit parts (`src/sim/world/kits.ts`): `knob` (slider feeding an input),
  `meter` (read-out of an output), `led`, `button`. Add them with `parts`.

### The robot's world: rooms, terrains and mazes
`src/sim/world/terrain.ts` (pure, no Board) describes a world as an outer
boundary plus obstacles: axis-aligned boxes, round posts and thin walls.
`castRay()` and `scan()` in `plugins/lidar.ts` and the crash test in
`plugins/robot_world.ts` (exact distance from the robot's disc to every
wall and post) all use it. A level or test chooses the world with inputs:

- `LIDAR_ROOM` 0 to 4: the five rooms (empty box, corridor, wall on the
  right, box with a block, box with a doorway). Their walls and the order
  of the walls never change; `tests/robot_arena.test.ts` compares their
  ray casts bit for bit with the model before obstacles existed.
- `WORLD_KIND` (0, the default, leaves the choice to `LIDAR_ROOM`): 1 two
  rooms and a door, 2 slalom of posts, 3 U-shaped dead end, 4 narrow gap,
  5 random maze, 6 one long slanted wall (the line y = 0.5 x - 2, nothing
  else, no goal: for line fits, where a wall along an axis hides a missing
  `atan`).
- `WORLD_SEED`: the maze's seed (the same seed gives the same maze on
  every machine: the generator is `mulberry32`, never `Math.random`), or
  the layout number of the slalom and the U.
- `WORLD_SIZE`: maze cells per side, 3 to 8 (2 ft cells). `WORLD_LOOPS`:
  1 takes away extra walls, so the maze has more than one way.

Other world inputs a level or test can set:

- `SPIC_JUMPER`, `SPIA_JUMPER` = 1: a jumper wire on the LaunchPad header
  from the module's SIMO pin to its SOMI pin (GPIO122 to GPIO123 for SPIC,
  GPIO58 to GPIO59 for SPIA). The master then receives what it sends, if
  both pins are switched to the module and TALK is 1. The robot kit has a
  knob for the SPIC one, fitted by default (`plugins/spi.ts`).
- `MOTOR_RIGHT_GAIN` (default 1): makes the right motor weaker or stronger
  than the left one (`plugins/actuators.ts`).

A terrain has its own start pose and goal, used by `robot_world.ts` where
the `ROBOT_START_*` and `ROBOT_GOAL_*` inputs are not set. Changing an
input in mid-run changes the world at that moment. `worldOf(board)` is the
world in use. Objects placed by hand (`setWorldObjects`, the arena's
playground) exist only in a live run. To add a terrain, write a function
that returns `makeWorld({...})`, give it a `KIND_` number in `terrain()`
and an entry in `TERRAINS`, and test that its start and goal are free.

### Course library functions
- Put C prototypes, typedefs, `#define`s and helper functions written in C
  in `prelude` (it is compiled with the library; errors there are reported
  as "Library error").
- Native functions: declare the prototype in `prelude`, then in `install`
  call `b.compiler.defineNative("name", (args, types, line) => number)`.
  Read a C string argument or a global with `b.mem.peek(addr, words)`;
  `b.readVar("name")` reads a global by name.
- Prefer running the real TI or course C source when it only touches
  registers (as `InitCpuTimers` / `GPIO_SetupPinMux` do).
- A course function that students write for credit is provided by the
  library and never printed in a level. Where the graded part is a formula
  (`setEPWM1A`, `setEPWM2A`: Lab 3; `setDACA`, `setDACB`: Lab 4) it is a
  native, not C source in `prelude`, so the game holds no copy of the
  answer. Mark it `b.compiler.fns.get(name)!.replaceable = true`: a
  student's own definition then takes its place, so programs saved before
  the library had the function still compile. Call `b.tick(line)` once for
  each C statement the function stands for, so a loop that calls it takes
  the time it would take with C code.

Library functions that stand in for graded work, all replaceable:

| Function | Plugin | What it does | Graded in |
| --- | --- | --- | --- |
| `setEPWM1A(u)`, `setEPWM2A(u)` | `actuators.ts` | control effort -10 to 10 to CMPA of EPWM1 or EPWM2 (0 is 50 % duty) | Lab 3 |
| `setDACA(volts)`, `setDACB(volts)` | `dac.ts` | limits to 0 V to 3 V, scales to DACVALS (3 V is 4095) | Lab 4 |
| `enableAdccInterrupt()` | `adc.ts` | PIE and IER enables of ADCC1 | Lab 4 |
| `setupSpib()` | `spi.ts` | the course's SPIB set-up: chip select GPIO66 high, GPIO63 to 65 to SPIB, 16-bit words, 1 MHz, FIFOs, receive interrupt level 16 | HW3 |
| `enableSpibInterrupt()` | `spi.ts` | PIE and IER enables of SPIB_RX | HW3 |

A level that calls one says in one sentence that the board's library
provides it and that writing it is part of that lab or homework. A PIE
channel that is such a blank is also registered with
`b.pie.libraryEnable.set("1.3", "enableAdccInterrupt();")`: the PIE's
"enable is missing" message then names the call and Table 3-2 instead of
the bit. `tests/actuators.test.ts`, `tests/spi_library.test.ts` and
`tests/lab_library.test.ts` hold these functions to their behaviour and
check that no level prints what they hide.

### Diagnostics
`b.warn(b.line, "code", "message", "warning" | "error")` shows a message on
the student's line. Use it for mistakes the real chip would hide (a
conversion triggered with the ADC powered down, a PWM output on a pin whose
mux was never set). An `error` fails the level. Messages: say what happened,
why, and what to write instead.

A peripheral whose interrupt flag must be cleared by the student's function
(ADCINTFLG, ETFLG.INT, a FIFO flag) calls
`b.pie.uncleared(group, channel, "the flag", "the statement that clears it")`
when it cannot request the interrupt because that flag is still set: the
student then reads why the function ran once and never again.
`b.isrFor(vectorName)` gives the student's function behind a vector, when
there is one. A forgotten `PIEACK`, `PIEIER` bit, `IER` bit or `EINT` is
reported by the PIE itself for every peripheral.

The system set-up is not modelled: no watchdog, no PLL, no peripheral clock
gates (`PCLKCRx`). `InitSysCtrl()` does all of that on the chip, every course
program calls it first, and the course never gates a clock by hand. A program
that writes a register before `InitSysCtrl()` gets the warning
`no-initsysctrl`, which is what the missing set-up would break. Tests of one
peripheral that run bare programs switch it off with
`Board.expectInitSysCtrl = false`.

## Rules
- Cite the TRM section the model implements in a comment at the top, and
  follow the TRM where course material differs.
- Add `tests/<name>.test.ts` with small C programs asserting the TRM
  formulas (see `tests/dac.test.ts`, `tests/c.test.ts`).
- Do not edit `board.ts`, `runner.ts`, `kits.ts`, `prelude.ts` or the UI
  from a plugin task: if something is missing, report it.
