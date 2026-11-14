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
- An input that changes all the time (a tone on an ADC pin):
  `b.sources.set("ADCINB4", (t) => volts)`. The function is asked only when
  the input is read and nothing has set it, so it costs no events.
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

- The MPU-9250 (`plugins/spi_devices.ts`, whose header lists the document
  section behind each behaviour): `IMU_AX_G`, `IMU_AY_G`, `IMU_AZ_G`,
  `IMU_GX_DPS`, `IMU_GY_DPS`, `IMU_GZ_DPS`, `IMU_TEMP_C` are what the chip
  feels (knobs and stimuli). While `ROBOT_WORLD` is 1 the robot's motion is
  added for every program: gyro Z is its turn rate, accel X its forward
  acceleration, accel Y its speed times turn rate. `IMU_REAL` = 1 makes it a
  real part: a fixed offset per axis and seeded noise on every sample (the
  Sandbox sets this on the robot board; levels opt in). `IMU_BIAS_GX_DPS`,
  `.._GY_`, `.._GZ_`, `IMU_BIAS_AX_G`, `.._AY_`, `.._AZ_` replace an axis's
  offset. `IMU_PU_SLEEP` = 1 gives a part that powers up asleep. Outputs:
  `IMU_RATE_HZ`, `IMU_GYRO_BW_HZ`, `IMU_ACCEL_BW_HZ` (from the configuration
  registers) and `MPU_WRITE_FRAMES` (transfers that wrote a register).
  `b.plugins.get("spi_devices")` is a `SpiDevicesState`; its `imu` holds
  what the chip feels and its last sample, for a bench view.

- The robot's range sensors and analog gyro (`plugins/robot_sensors.ts`,
  whose header gives the data sheet section and every assumption about
  mounting and wiring). While `ROBOT_WORLD` is 1 the room drives them:
  the two CAN distance sensors (sensor 1 looks ahead, sensor 2 to the
  right; 27 degree cone; 1.3 m in short mode, 2.9 m medium, 4 m long;
  ranging status 2 and 0 mm with nothing in range), the two Sharp
  GP2Y0A41SK0F sensors on `DAN_ADC1` (left) and `DAN_ADC2` (rear) with the
  data sheet's voltage curve, and the LPR510 gyro on `ADCINC2` to
  `ADCINC5` (1.23 V at rest, 2.5 mV per deg/s on C5, 10 mV on C4, each held at the
  ends of its range).
  A stimulus or knob on `CAN_DIST1_MM`, `CAN_DIST2_MM`, `DAN_ADC1`,
  `DAN_ADC2` or an `ADCINC` input wins from the moment it is set; with
  the world off nothing changes. `LPR510_REAL` = 1 gives the gyro a
  zero-rate error and noise (`LPR510_ZERO_Z_DPS` chooses the error).
  Outputs: `CAN_DIST1_MM`, `CAN_DIST2_MM`, `DAN_ADC1`, `DAN_ADC2` (what
  the sensor reports), `LPR510_Z_DPS`, `CAN_SENSOR<n>_MODE`.
  `b.plugins.get("robot-sensors")` is a `RobotSensors`; `beamsAt()` gives
  the arena the beams to draw.

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

### What the course starter projects need
The starter projects' main files must compile and run unchanged
(`tests/labstarter.test.ts`, `tests/starters_basic.test.ts`). Their other
files are not copied: a plugin provides what the main file names.

- `course_leds.ts`: `displayLEDletter(n)` and `setLEDLetter(array)` for the
  red board's 3 x 5 LED display (HWstarter, XINTstarter).
- `course_ladar.ts`: the types and variables of the LADAR starter
  (`datapts`, `pose`, `ladar_data`, `LADARpingpong`, `G_command` ...), the
  priority masks `MINTn` and `MG12_n`, and the filling of `ladar_data` from
  the LIDAR's replies while the library's own `RXCINT_recv_ready` is in use.
  The Raspberry Pi link is inert: its variables exist and never change.
- `course_fft.ts`: `RFFT_F32_STRUCT`, `RFFT_f32`, `RFFT_f32_mag`,
  `RFFT_f32_phase` and `RFFT_f32_sincostable` of TI's FPU DSP library
  (fftDMAstarter), and the robot board's microphone on ADCINB4: a tone of
  `MIC_TONE_HZ` (a knob, 1000 at the start; 0 is silence) and `MIC_AMPL_V`
  volts around 1.5 V.
- `course_final.ts`: what the final project starter adds: SE423Lib.h
  (`InitSE423DefaultGPIO`, `init_eQEPs`, `readEncLeft` ..., `init_EPWM1and2`,
  the RC servo functions, `init_ADCsAndDACs`, `readbuttons`, `PostSWI1` to
  `3`, `PIcontrol`), `xy_control`, MatrixMath.h and `UpdateOptitrackStates`.
  Formulas and algorithms are native, register set-up is C; all of them are
  replaceable. OptiTrack, the camera, LabVIEW and the Linux commands are
  inert.
  `tests/starters_project.test.ts` runs both starters.
- A library function may take and return a small struct by value
  (`UpdateOptitrackStates` does); a student's file is still told to use
  pointers.
- A library variable that levels define themselves is marked weak in
  `install`: `b.compiler.globals.get(name)!.weak = true`. A student's
  definition then takes the name; the library keeps its own copy.

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
