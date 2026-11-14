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
  5 random maze.
- `WORLD_SEED`: the maze's seed (the same seed gives the same maze on
  every machine: the generator is `mulberry32`, never `Math.random`), or
  the layout number of the slalom and the U.
- `WORLD_SIZE`: maze cells per side, 3 to 8 (2 ft cells). `WORLD_LOOPS`:
  1 takes away extra walls, so the maze has more than one way.

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

## Rules
- Cite the TRM section the model implements in a comment at the top, and
  follow the TRM where course material differs.
- Add `tests/<name>.test.ts` with small C programs asserting the TRM
  formulas (see `tests/dac.test.ts`, `tests/c.test.ts`).
- Do not edit `board.ts`, `runner.ts`, `kits.ts`, `prelude.ts` or the UI
  from a plugin task: if something is missing, report it.
