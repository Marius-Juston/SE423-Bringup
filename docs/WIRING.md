# The wiring bench

The Sandbox's homework board has a **Wiring bench** panel. It shows the board as you solder it in the homeworks, lets you switch a fault on for any part to see its symptom, and lets you attach devices of your own to free pins. It is for troubleshooting and for planning a project. Nothing on it is checked.

It has two layers:

1. **The board and its parts.** The board is drawn from data compiled from the course's board file. Every part the homeworks add is where it really is: the LaunchPad, 16 LEDs behind three inverter chips, four push buttons, the buzzer and its jumper, the joystick, the photoresistor, two servo connectors with the battery pack, the IMU with its four jumpers. Each has fault switches.
2. **Devices on free pins.** You add a device from a bin and choose, terminal by terminal, which pin or supply it goes to. The bench says what cannot work and what to choose instead, and makes a wiring table and a drawing of what you attached.

The bench starts fully built, with no fault and nothing attached. It ships no ready-made project and no program: `tests/wiring_bench.test.ts` holds it to that.

## Files

```
tools/gen-board.mjs                 compiles the board file into the data file (run by hand)
src/sim/world/boards/hw-board.json  the compiled board (about 86 kB, 22 kB compressed)
src/sim/wiring/
  types.ts        the part format and the bench's state
  board.ts        the data file with types; the LaunchPad's header pins and what each can do
  bench.ts        the state, the connection checks, saving, the bench in words, the wiring table
  nets.ts         who is connected to what: part to pins, pin to parts, the sentence and the pin table
  schematic.ts    the drawing of what was attached (SVG text)
  active.ts       the switch between the Sandbox and the simulator
  parts/          one file per part, picked up automatically
src/sim/plugins/bench_wiring.ts     the bench while a program runs
src/ui/wiring/                      the panel: store.ts, BoardPicture.tsx, WiringBench.tsx
tests/wiring_bench.test.ts          rules, faults, checks, saving, the guard
tests/e2e/wiring.e2e.ts             the panel with the keyboard and with the mouse
```

## The model and its limits

The model is simple on purpose. Every connection is fixed: a terminal goes to one pin or one supply. Every part follows a rule of its own, written in its file. Examples:

- An LED is lit while its anode side is high and its cathode side is low, it is on the board, it is the right way round and its inverter chip is there. On a square wave it is "dimmed" by the fraction of time it is on.
- The photoresistor's junction is `3.3 V * R / (R_photo + R)`.
- A servo's horn goes to the angle of the pulse width, if pulses come at 40 to 60 Hz and it has 4.8 V to 6 V.
- A button joins its pin to ground while you hold it. Released, it connects nothing.

What that leaves out:

- It is **not a circuit solver**. No currents are computed, one part does not load another, and two parts on one pin are reported, not computed.
- A GPIO pin has a level (0, 1 or floating), never a voltage. Voltages exist only on ADC pins.
- No loose wires between arbitrary points, no resistors or capacitors of your own between parts, no RC filters.
- With an IMU fault the chip is off the SPI bus and every word read is all 1s. On the real board a missing MOSI or SCLK jumper alone can also give zeros.
- Each part file lists what that part does not model (bounce, loudness, the horn's speed).

The numbers come from the data sheet (TMS320F2837xD, SPRS880P): section 6.1, inputs up to 4.6 V and 20 mA per output pin at most; section 6.6, outputs rated at 4 mA, the pull-up about 150 uA. The ADC converts 0 V to 3.0 V on the LaunchPad (TRM chapter 11).

### While a program runs

`src/sim/plugins/bench_wiring.ts` exists only on a homework board made while the Sandbox shows the bench (`benchLink.state` in `active.ts`). Levels, tests and the other boards never get it. On such a board it:

- puts levels on pins for buttons, switches and digital sensors through `gpio.drive`, so the GPIO model's own messages apply (a floating input, a short against an output);
- takes a press of the board panel's PB1 to PB4 as a press of the bench's button, so a button that is not soldered does nothing;
- sets the ADC inputs of the signal bus for analog parts, the same names the board panel's sliders use. An ADC pin whose part is missing floats: a conversion gets a small wandering voltage and a message;
- measures frequency, duty and pulse width on each pin a part hangs on;
- takes the MPU-9250 off the SPI bus (`MPU_ABSENT`) while it is not plugged in or one of its jumpers is off;
- answers the board panel's LEDs (`ledLit`), so an LED that is not soldered is dark there too;
- holds back the servo angles and the buzzer tone of `plugins/actuators.ts` on GPIO14, GPIO15 and GPIO16 while the bench's part there cannot act.

Messages go to the program's diagnostics with a code that starts with `bench-`. A connection mistake is reported once at the start of the run. A fault's symptom is reported on the line that drives the part.

One difference from the board panel alone: at rest the joystick's axes are at 1.65 V (half of 3.3 V) and the photoresistor follows its Light slider, where the board panel's sliders start at 1.5 V.

## Seeing what is connected

The picture shows connections with the board's real copper, compiled into the data file.

- Point at a part, a pad or a LaunchPad pin (mouse), click or tap it, or move to it with the arrow keys. Everything joined to it lights up: the traces (solid on the top layer, dashed on the bottom), every pad of the net and the LaunchPad pin, with a label such as "GPIO22, pin 8, J1.8". Behind an inverter chip or a resistor the far side is drawn too, dotted.
- It works both ways. A part shows its pin ("LED1: GPIO22, pin 8, J1.8 through IC1"). A pin shows its parts ("Pin 8, J1.8: GPIO22. Connected: LED1 (through IC1)"), or "Nothing connected. Free for a device of yours."
- A click, a tap or a key keeps the highlight; Escape clears it. Hovering alone keeps nothing.
- "Show all connections" draws every route in use. Each kind has its own line: digital output solid, digital input dashed, PWM dash-dot, analog dotted, SPI heavy dashes, supply long thin dashes, ground thin dots. The legend under the picture shows them.
- With the keyboard the parts are one group and the LaunchPad's pins another. The arrow keys move inside each (the pins as a grid), and the sentence under the picture, a polite live region, says what you are on. Space holds a push button.
- "Pins and what is on them" is the same as a table of the 80 pins: number and header, name, the ePWM outputs it can carry, what is connected. It can be filtered by text, limited to free pins and sorted.
- Every part is named in the picture where there is room for an 11 px name that covers nothing else. Where there is not (the small column view), rows of like parts share a name ("LED1 to LED16") and the single names appear as you zoom in or open the large view.
- State is never colour alone: a lit LED is filled and has rays, a pressed button is filled inside a second ring, the joystick's knob moves, a servo's horn turns and its name gives the angle. The legend lists these.

`src/sim/wiring/nets.ts` holds the lookups (part to nets, net to parts, the 80 pins, the sentence), so the picture, the sentence and the table always agree.

Ground is a filled area on the board, not traces: it is shown by its pads.

Not every connection is copper. The battery pack's two leads, the wire from its row to the servo supply rows, the joints beside the servo connectors and the photoresistor's wire to its ADC pin are soldered by hand. The board data lists them with the part that brings them (`links`), and the picture draws them as their own kind of line (dash-dot, a dot at each end, "Soldered lead or wire" in the legend). They exist while that part is on the board: take the battery pack off and its leads go. Which rows of the pad field the leads use is read off the photos of HW1 and HW4 by eye. What has neither copper nor a link (a part's supply and ground, a module in its socket, a plug-in jumper) is named in the part's sentence. `tests/wiring_bench.test.ts` fails when a terminal of a part resolves to none of these.

The LaunchPad's 80 pins are named whenever a row is tall enough for 11 px text (the large view at 1440 px, or zoomed in). Each name has a place of its own beside its pin, on a small plate, so it is never dropped for lack of room and reads over pads and traces. A silkscreen word under a plate is left out while the names show.

## In a level

Primer D leads into the bench: a tour of the board with the figure `board-connections` (the same picture, nothing running), then four fault-finding levels. A code level with a `bench` field (`docs/AUTHORING.md`) shows this panel above its tests in a mode of its own:

- the board starts with the level's faults, kept in a store of its own (`lessonStore` in `src/ui/wiring/store.ts`) that is never saved;
- with no program running everything is drawn and described as if nothing were wrong;
- the fault switches become Repair lists that start at "Leave as it is";
- attaching devices, the wiring table and the fault count are left out.

The simulator publishes what the checks read: `BENCH_<part id>` for each LED and `BENCH_CHANGES`, the number of options the student changed.

## Connection checks

`checkBench(state)` in `bench.ts` checks every attached device. Each message says what happens and what to choose.

| Code | What is wrong |
| --- | --- |
| `open-*` | a terminal is not connected |
| `ground-*`, `power-*` | a ground that is not on GND; a supply on GND or on a pin |
| `no-battery` | powered from the battery pack, and the pack is not on the board |
| `no-adc-*` | a voltage output on a pin without an ADC channel |
| `adc-digital-*` | a digital signal on an ADC pin |
| `over-*` | 5 V or 6 V can reach a 3.3 V pin |
| `adc-range-*` | an ADC input can rise above 3.0 V (it then reads 4095) |
| `no-pwm-*` | a servo or buzzer on a pin without an ePWM output (the message lists the pins that have one) |
| `clash-*`, `shared-*` | two parts drive one pin; a pin is shared with an on-board part or another device |
| `servo-usb`, `servo-3v3`, `load-usb` | a servo or a transistor's load powered from USB |
| `led-current`, `led-no-resistor` | more than 4 mA through a pin; no resistor |

Program-side causes are part of each part's live state: a pin left as an input, a pull-up that is off, a mux that gives the pin to a peripheral.

## The board data and its generator

```sh
node tools/gen-board.mjs <path to SE423_F28379D.brd>
```

The board file is in the course starter checkout, which is not in this repository. The generator is run by hand, like `tools/gen-registers.mjs`. Running it twice gives the same bytes.

It writes a description, not a copy of the design:

- the board's size and revision;
- `nets`: a name per net (`GND`, `3V3`, `5V`, `VIN`, `GPIO22`, `ADCINA4`, a row of the pad field, or a number);
- `holes` and `groups`: every header pin and pad, its position and its net;
- `parts`: the parts the bench simulates, each with its box on the board, the chip pins it reaches, traced through the nets (an LED to its inverter to its pin), and the nets it is on;
- `traces`: the copper of the nets a part or a LaunchPad pin is on, top and bottom layer, joined into lines and rounded to 0.05 mm (381 lines);
- `texts`: the silkscreen words;
- `decor`: boxes of parts that are only drawn (motor drivers, relay, jacks);
- `launchpad`: its outline and its 80 header pins.

It leaves out the copper of the circuits the bench does not simulate, the ground plane, the schematic sheets, the part libraries, and the silkscreen names of sub-circuits the homeworks never use.

Three things in it do not come from the board file and are assumptions:

- The LED resistors have no value in the file. The assembly handout has 1 k soldered there.
- The photoresistor has no footprint. It is drawn on the first rows of the pad field and connected to ADCINA4 with a 2.2 k resistor, as homework 2 describes the circuit.
- The servo connectors' supply is the battery pack, as homework 4 says. The board's silkscreen offers "PWR/+5V" there.

## Add a part

Drop a file in `src/sim/wiring/parts/`. It exports `part: PartDef` and is picked up automatically. `potentiometer.ts` is the small example; `servo.ts` shows a part that reads pulses; `led.ts` shows one that is both on the board and in the bin.

```ts
export const part: PartDef = {
  kind: "potentiometer",              // permanent: saved benches name it
  name: "Potentiometer",
  description: "A knob that puts a voltage between 0 V and its supply on an ADC pin.",
  addable: true,                       // offered in the device bin
  terminals: [
    { id: "w", name: "wiper (middle leg)", role: "analog" },
    { id: "vcc", name: "top leg", role: "power" },
    { id: "gnd", name: "bottom leg", role: "ground" },
  ],
  inputs: [{ id: "pos", label: "Knob", kind: "range", min: 0, max: 100, step: 1, initial: 50, unit: "%" }],
  apply(i, r) { /* what it does to the simulation */ },
  status(i, b) { /* what it reports: a few words, a level, why it is not working */ },
};
```

- **`terminals`**: each has a role, which decides the connection checks it gets. `in`: the chip drives it. `pwm`: as `in`, and it wants pulses. `out`: the part drives a level into the chip. `contact`: a passive contact. `analog`: a voltage for an ADC pin. `power`, `ground`.
- **`options`**: settings with named choices. The first choice is the default. Mark a fault switch with `fault: true`. Every board part gets "On the board: Soldered / Not soldered" by itself.
- **`inputs`**: what the student moves while the program runs: `range`, `toggle`, or `hold` (a button to hold; never saved).
- **`apply(i, r)`**: called at the start and whenever the bench changes. Declare what the part does: `r.drive(i, target, 0 | 1 | null)`, `r.analog(i, target, volts | (tNs) => volts | null)`, `r.later(tNs, fn)` for an event.
- **`edge(i, r, target, level, tNs)`**: a pin one of its terminals is on changed. `r.pin(target).wave` has the measured frequency, duty and pulse width. Use `r.warn(i, code, message)` for a symptom the program should be told about.
- **`status(i, b)`**: pure. `b.pin(target)` gives the pin's mode, mux, level and pull-up; `b.rail(target)` a supply's volts; `b.high(target)` the fraction of time a target is high; `b.mem(i)` values the part keeps during a run.
- **`check(i, b)`**: connection checks beyond the general ones.
- **`works(i, b)`**: false while the part cannot act at all.
- **`onBoard(p)`** and **`draw(i, status, box)`**: only for a part of the board itself. `onBoard` gives its connections from the board data; `draw` returns shapes in board millimetres with a tone (`part`, `metal`, `lit`, `dark`, `gone`, `bad`), which the interface maps to colour tokens. A part on the board also needs an entry in `tools/gen-board.mjs`.

Rules, as for simulator plugins (`docs/PLUGINS.md`): no DOM, no wall clock, no `Math.random`; state in the header what the part models, what it does not, and where the numbers come from; a mistake a beginner makes gets a message that says what happened and what to try. Add a test to `tests/wiring_bench.test.ts`.

Never add a file that attaches several devices at once, a finished homework or lab circuit, or a program. The guard test fails on it.

## The interface

- The picture scrolls and zooms inside its own box. Words in it are drawn only where they are at least 9 px tall; a part's name is in the Part list and on the card.
- Everything works without a mouse. The Part list chooses a part; its card has its connections, its live state, its fault switches, its sliders and its hold button. Attaching is done with lists. "The bench in words" lists every part, where it goes and what it is doing: it is the text form of the picture.
- A fault, a selected part and a problem's severity are never shown by colour alone: a word, a dashed outline or a cross says it too.
- The panel has the "Fill the column" and "Large view" buttons of every bench panel.
- The bench is saved on this computer under `bringup-bench-v1`. Stored or imported text that is damaged gives the default bench; what is understood is kept (`parseBench`). Undo and Redo cover the session.
- "Save bench file" and "Load bench file" exchange the bench as JSON. The wiring table exports as CSV and the drawing as SVG.

The accessibility suite visits the bench in the Sandbox's homework board states (`tools/a11y/screens.mjs`, `wiringBenchStates`).
