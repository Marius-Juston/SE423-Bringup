import type { Chapter } from "../types";

// Primer D: the homework board, before homework 1. A tour of what is on it
// (the LaunchPad's place, how a part reaches its pin, the inverter chips,
// which way round an LED goes, push buttons and the pull-up, jumpers), then
// four fault-finding levels on the wiring bench (docs/WIRING.md).
//
// Facts come from the compiled board data (src/sim/world/boards/
// hw-board.json), the data sheet (SPRS880P, sections 6.1 and 6.6) and the
// assembly steps of HW1 to HW4. The tour asks about parts and pins the
// figure shows; no question is a blank of a handout. The programs of the
// fault-finding levels toggle pins by hand: the ePWM set-ups that HW2 to
// HW4 grade are not used. Every program was run in the simulator.

const LEDS = String.raw`// Lights LED2, LED3, LED4 and LED5 of the homework board.
// The code is correct. It is given: chapters 1 and 2 explain every line.
void main(void)
{
    InitSysCtrl();
    InitGpio();
    // LED2 is on GPIO94, LED3 on GPIO95, LED4 on GPIO97, LED5 on GPIO111.
    GPIO_SetupPinMux(94, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(94, GPIO_OUTPUT, GPIO_PUSHPULL);
    GPIO_SetupPinMux(95, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(95, GPIO_OUTPUT, GPIO_PUSHPULL);
    GPIO_SetupPinMux(97, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(97, GPIO_OUTPUT, GPIO_PUSHPULL);
    GPIO_SetupPinMux(111, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(111, GPIO_OUTPUT, GPIO_PUSHPULL);
    // A pin made high lights its LED.
    GpioDataRegs.GPCSET.bit.GPIO94 = 1;
    GpioDataRegs.GPCSET.bit.GPIO95 = 1;
    GpioDataRegs.GPDSET.bit.GPIO97 = 1;
    GpioDataRegs.GPDSET.bit.GPIO111 = 1;
    while (1) {
    }
}
`;

const button = (pull: string) => String.raw`// LED10 is on while push button PB4 is held.
// PB4 is on GPIO7, LED10 on GPIO27.
void main(void)
{
    InitSysCtrl();
    InitGpio();
    GPIO_SetupPinMux(27, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(27, GPIO_OUTPUT, GPIO_PUSHPULL);   // LED10: an output
    GPIO_SetupPinMux(7, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(7, GPIO_INPUT, ${pull});     // PB4: an input
    while (1) {
        if (GpioDataRegs.GPADAT.bit.GPIO7 == 0) {
            GpioDataRegs.GPASET.bit.GPIO27 = 1;     // pressed (reads 0): LED10 on
        } else {
            GpioDataRegs.GPACLEAR.bit.GPIO27 = 1;   // released (reads 1): LED10 off
        }
    }
}
`;

const BUZZER = String.raw`// A 500 Hz tone on the buzzer: GPIO16 goes high for 1 ms, low for 1 ms, and so on.
// The code is correct. It is given: chapters 1 and 2 explain every line.
void main(void)
{
    InitSysCtrl();
    InitGpio();
    GPIO_SetupPinMux(16, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(16, GPIO_OUTPUT, GPIO_PUSHPULL);
    while (1) {
        GpioDataRegs.GPATOGGLE.bit.GPIO16 = 1;   // high becomes low, low becomes high
        DELAY_US(1000);                          // wait 1 ms
    }
}
`;

const SERVO = String.raw`// Turns the servo on connector RC2 to -45 degrees.
// A servo reads the length of a pulse that comes every 20 ms: 1.2 ms means -45 degrees.
// The code is correct. It is given: chapters 1 and 2 explain every line.
void main(void)
{
    InitSysCtrl();
    InitGpio();
    GPIO_SetupPinMux(15, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(15, GPIO_OUTPUT, GPIO_PUSHPULL);
    while (1) {
        GpioDataRegs.GPASET.bit.GPIO15 = 1;      // the pulse starts
        DELAY_US(1200);                          // 1.2 ms
        GpioDataRegs.GPACLEAR.bit.GPIO15 = 1;    // the pulse ends
        DELAY_US(18800);                         // the rest of the 20 ms
    }
}
`;

const BENCH_HOW = `
## How to look
Press **Run**. In the **Wiring bench** panel, choose a part in the list or click it in the picture. Its card says what the part is doing **now** and, if that is not what its pin asks for, why. Messages under the editor name faults the program runs into.

## How to repair
Each part's card has **Repair** lists. They start at "Leave as it is" and do not show how the board is. Choose a repair, then press **Run tests**.`;

export const chD: Chapter = {
  id: "primer-d-board",
  number: -0.5,
  label: "D",
  title: "The homework board",
  blurb: "What is on the board you solder, which pin each part is on, and how to find a fault.",
  requires: [],
  course: ["HW1", "HW2", "HW3", "HW4"],
  levels: [
    {
      id: "brd-tour",
      kind: "brief",
      title: "The board and the LaunchPad",
      goal: "Find the LaunchPad's place on the homework board and read three of its pins.",
      refs: [{ course: "HW1", note: "Exercise 2: soldering the breakout board, starting with the four headers" }],
      brief: `
In the homeworks you solder a **breakout board**: a board with places for LEDs, push buttons, a buzzer and more. It has no processor of its own. The processor sits on the red **LaunchPad**, which plugs into the middle of the board.

## Four headers, 80 pins
A **header** is a row of metal pins, or of sockets for pins. The LaunchPad has 80 pins in four double rows. The first thing you solder in homework 1 is the four matching sockets. They are named on the board: **J1 and J3** top left, **J4 and J2** top right, **J5 and J7** bottom left, **J8 and J6** bottom right. Each has ten pins.

Every pin has a number from 1 to 80 and a place, such as "pin 8, J1.8": the eighth pin of J1.

## Which way round
The LaunchPad fits both ways round, and only one is right. Pin 1 of J1 is **3V3**, the 3.3 V supply. Turned round, supply pins meet signal pins, and nothing works. Match J1 on the LaunchPad with J1 on the board before you push it in.

## What a pin is
Most pins are **GPIO** pins ("general purpose input or output"): your program makes them high (3.3 V) or low (0 V), or reads them. Some are **ADC** pins, which measure a voltage. A few are supplies: 3V3, 5V and GND (ground, 0 V).

{{figure:board-connections}}

Try it in the figure: choose a pin in the **LaunchPad pin** list, or click one of the small squares. The sentence under the picture says what the pin is and what is connected to it. Use it to answer the questions.
`,
      questions: [
        { prompt: "Choose pin 21 in the figure. What is it?", options: ["5V, a supply", "GPIO21", "GND", "An ADC pin"], answer: 0, why: "Pin 21, the first pin of J3, is the 5 V supply that comes from USB. A pin's number is its place on the LaunchPad, not a GPIO number." },
        { prompt: "On which header is pin 58?", options: ["J6", "J5", "J8", "J2"], answer: 0, why: "Pins 51 to 60 are J6, so pin 58 is J6.8. The figure says so when you choose it." },
        { prompt: "The LaunchPad is plugged in turned round. What do you expect?", options: ["Nothing works: supplies and signals meet the wrong pins", "Everything works, the headers are symmetric", "Only the LEDs are swapped left to right"], answer: 0, why: "Each socket on the board expects one particular pin. Turned round, 3V3 no longer meets 3V3. Check J1 against J1 first." },
      ],
      takeaway: "The LaunchPad's 80 pins are the only way between your program and the board. Every part on the board ends at one of them.",
    },
    {
      id: "brd-follow",
      kind: "brief",
      title: "Follow a part to its pin",
      goal: "Use the picture to find which pin a part is on, and what is on a pin.",
      refs: [{ course: "HW1", note: "The tables of LEDs and push buttons, and the breakout board they describe" }],
      brief: `
Your program never names an LED. It names a **pin**. So the first question about any part is: which pin is it on?

## Copper joins them
A part is joined to its pin by a thin line of copper on the board, called a **trace**. Traces run on the top of the board and on the bottom. The figure draws them when you point at something: solid on the top, dashed on the bottom.

## Both directions
- From a part to its pin: click a part. The sentence says, for example, "LED1: GPIO22, pin 8, J1.8 through IC1". LED1 is on the pin called GPIO22, which is pin 8 of the LaunchPad.
- From a pin to its parts: click a pin. The sentence lists what is connected, or says "Nothing connected". A pin with nothing on it is free for a part of your own.

## Through the inverter chip
"Through IC1" means the pin does not drive the LED itself. A pin can only give a little current (4 mA), so each LED hangs on an **inverter**: a small part of a chip whose output is the opposite of its input (input high, output low) and which can carry more current than a pin. Three chips, IC1 to IC3, hold six inverters each.

The LED sits between 3.3 V and the inverter's output. When your pin is **high**, the inverter's output is low, current flows through the LED, and it lights. So on this board: **pin high, LED on**. The dotted lines in the figure are the part of the path behind the inverter.

{{figure:board-connections}}

Try it in the figure, then answer.
`,
      questions: [
        { prompt: "Choose LED9. Which pin is it on?", options: ["GPIO26", "GPIO9", "GPIO27", "GPIO25"], answer: 0, why: "The figure says \"LED9: GPIO26, pin 53, J6.3 through IC2\". An LED's number says nothing about its pin: you look it up." },
        { prompt: "Choose pin 48. What is connected to it?", options: ["Nothing: it is free", "LED12", "Push button PB1", "The buzzer"], answer: 0, why: "Pin 48 is GPIO52 and nothing on the board uses it. That is how you find a pin for a part of your own." },
        { prompt: "Your program makes GPIO22 low. What does LED1 do?", options: ["It is off", "It is on", "It blinks"], answer: 0, why: "Pin low, inverter output high: both ends of the LED are at 3.3 V, no current flows, the LED is dark. Pin high lights it." },
      ],
      takeaway: "Part to pin and pin to part: the picture answers both. An LED on this board is on when its pin is high, because an inverter chip sits in between.",
    },
    {
      id: "brd-led",
      kind: "brief",
      title: "Which way round an LED goes",
      goal: "Learn why an LED has a direction and a resistor, then answer three questions.",
      refs: [{ course: "HW1", note: "Exercise 2: 18 LEDs with 18 resistors of 1 kΩ; \"make sure you know the LEDs' orientation\"" }, { course: "Primer A", note: "The LED and its resistor" }],
      brief: `
Homework 1 has you solder 18 small LEDs, each with a resistor of 1 kΩ. Two things can go wrong, and both look the same: the LED stays dark.

## An LED has a direction
An LED lets current through one way only, from its **anode** to its **cathode**. Soldered the other way round, it blocks: no current, no light, whatever the pin does. Nothing is damaged. It just never lights.

The tiny LEDs of the board have no long and short leg. A mark on the part shows the cathode side, and the board's print shows which way it must point. Look before you solder: a reversed LED is tedious to take off again.

## Why the resistor
A lit LED keeps about 2 V across itself. The rest of the 3.3 V supply, about 1.3 V, falls across the resistor. Ohm's law on the resistor gives the current:

1.3 V / 1000 Ω = 1.3 mA

That is enough to see and far below what harms the LED. Without a resistor nothing would limit the current.

{{figure:led-resistor}}

Try it in the figure: set the supply to 3.3 V and the resistor to 1 kΩ, then turn the LED round.

## How it shows in your program
The pin still goes high and low. The program is right and the board is wrong. That is the hardest kind of fault to find by reading code, so the next levels teach you to look at the board.
`,
      questions: [
        { prompt: "An LED is soldered the wrong way round. What happens when its pin goes high?", options: ["Nothing: it stays dark, and nothing is damaged", "It lights dimly", "It burns out", "The pin is damaged"], answer: 0, why: "Backwards, an LED blocks. No current flows, so there is no light and no harm." },
        { prompt: "What does the 1 kΩ resistor do?", options: ["It limits the current through the LED", "It makes the LED brighter", "It tells the board which way round the LED is"], answer: 0, why: "The LED keeps about 2 V. The resistor takes the remaining 1.3 V and sets the current: 1.3 V / 1 kΩ = 1.3 mA." },
        { prompt: "One LED of sixteen stays dark. The program lights all sixteen the same way. Where do you look first?", options: ["At that LED on the board: is it there, and the right way round?", "At the compiler's settings", "At the other fifteen LEDs"], answer: 0, why: "Fifteen LEDs prove the program's method works. What differs is on the board, at that one LED." },
      ],
      takeaway: "An LED works one way round and needs its resistor. A reversed LED and a missing LED give the same symptom: the pin changes, the LED stays dark.",
    },
    {
      id: "brd-button",
      kind: "brief",
      title: "A push button and the pull-up",
      goal: "Learn what a pin reads from a push button, pressed and released.",
      refs: [{ course: "HW1", note: "The push buttons are passive: they need the internal pull-up" }, { course: "Primer A", note: "Switches and pull-up resistors" }],
      brief: `
The board has four push buttons, PB1 to PB4. Each one sits between a pin and **ground** (0 V).

## Pressed
While you hold a button, it joins its pin to ground. The pin is at 0 V and your program reads **0**.

## Released
A released button joins nothing. The pin is then connected to nothing at all. Such a pin is **floating**: it picks up stray signals and reads 0 or 1 at random. Your program would see presses that never happened.

## The pull-up
The cure is a **pull-up**: a large resistor from the pin to 3.3 V. With nothing else connected it pulls the pin up to 3.3 V, so a released button reads **1**. When the button is pressed, ground wins, because the button is a plain piece of metal and the resistor is weak. The pin reads 0.

You do not solder this resistor. The chip has one inside for every pin, switched **off** at power-up. Your program switches it on with one word when it sets up the pin. So:

- pull-up on: released reads 1, pressed reads 0;
- pull-up off: released reads anything.

Note the direction: **pressed is 0**. The button pulls the pin down.

{{figure:board-connections}}

Try it in the figure: choose PB3 and see where its pin is. Then answer.
`,
      questions: [
        { prompt: "With the pull-up on, what does the pin read while the button is held?", options: ["0", "1", "It floats"], answer: 0, why: "The pressed button joins the pin to ground. Ground wins against the weak pull-up, so the pin is at 0 V." },
        { prompt: "A program reads PB2 and sees presses when nobody touches the button. What is the likely cause?", options: ["The pull-up of that pin is off, so the released button leaves the pin floating", "The button is soldered the wrong way round", "The LED's resistor is missing"], answer: 0, why: "A released button connects nothing. Without the pull-up the pin floats and reads at random." },
        { prompt: "Choose PB3 in the figure. Which pin is it on?", options: ["GPIO6", "GPIO3", "GPIO8", "GPIO5"], answer: 0, why: "The figure says \"PB3: GPIO6, pin 80, J8.10\". No inverter chip is in between: a button is read directly." },
      ],
      takeaway: "A button to ground needs the pin's pull-up. Then released reads 1 and pressed reads 0. The pull-up is switched on in the program, not soldered.",
    },
    {
      id: "brd-jumpers",
      kind: "brief",
      title: "Jumpers",
      goal: "Learn what a jumper is and which two places on the board have them.",
      refs: [{ course: "HW1", note: "Exercise 2: the 2x2 header that controls the input to the buzzer" }, { course: "HW3", note: "Exercises 1 and 2: the IMU's jumpers; \"don't forget to move the buzzer's jumper\"" }],
      brief: `
Not every connection on the board is fixed copper. Some are left open on purpose and closed with a **jumper**: a small plastic cap with metal inside that you push over two neighbouring pins. It joins those two pins, and you can pull it off again.

A jumper is a connection you can change your mind about. It is also a connection you can forget.

## The buzzer's jumper
The buzzer makes a sound when its pin goes high and low fast enough to hear. Its pin is GPIO16. Between GPIO16 and the buzzer sits a small header with a jumper:

- on the **GPIO16** position, the pin reaches the buzzer;
- on the **GND** position, the buzzer's input is tied to ground, and the buzzer is quiet whatever the pin does;
- with the jumper removed, the pin does not reach the buzzer either.

Homework 3 reminds you to move this jumper. A silent buzzer with a correct program is nearly always this.

## The IMU's jumpers
The **IMU** is a small sensor board that measures motion. It talks to the chip over four pins, GPIO63 to GPIO66, and each of the four goes through a jumper of its own. With one missing, that signal does not arrive and the IMU does not answer: the program reads only 1s.

{{figure:board-connections}}

Try it in the figure: choose "Buzzer jumper", then each "IMU jumper". The sentence names the pin each one carries.

## The rule
When a part does nothing and the program looks right, ask: is there a jumper between the pin and the part, and is it where it should be?
`,
      questions: [
        { prompt: "The buzzer's jumper is on the GND position. The program sends a tone on GPIO16. What do you hear?", options: ["Nothing", "The tone, but quieter", "A lower tone"], answer: 0, why: "On the GND position the buzzer's input is tied to ground. GPIO16 does not reach it." },
        { prompt: "Choose \"IMU jumper MISO\" in the figure. Which pin does it carry?", options: ["GPIO64", "GPIO63", "GPIO65", "GPIO66"], answer: 0, why: "The figure names GPIO64 for the MISO jumper. Each of the four jumpers carries one of GPIO63 to GPIO66." },
        { prompt: "What is a jumper?", options: ["A removable cap that joins two neighbouring pins", "A wire soldered to the board", "A kind of resistor"], answer: 0, why: "It joins two pins while it is on, and you can move it or take it off." },
      ],
      takeaway: "A jumper is a connection that can be missing. Before you doubt your program, check the jumpers between the pin and the part.",
    },
    {
      id: "brd-fault-led",
      kind: "code",
      mode: "debug",
      kit: "redboard",
      title: "One LED stays dark",
      goal: "Four LEDs should light. Find out why one does not, and repair the board.",
      refs: [{ course: "HW1", note: "Exercise 2: soldering the LEDs, their orientation, the inverter chips" }],
      brief: `
This program lights LED2, LED3, LED4 and LED5. The program is correct: do not change it. Something on the **board** is wrong, and the page does not say what.

On the real board you would see it at once: three LEDs on, one dark. Here you look with the wiring bench.
${BENCH_HOW}

## What to think about
One LED is dark while its pin is high. From the board tour you know the causes: the LED is not there, it is the wrong way round, or the inverter chip between pin and LED is missing. They need different repairs. A repair that does not fit the cause changes nothing.

You earn a star for repairing the board with a single change.
`,
      starter: LEDS,
      solution: LEDS,
      durationMs: 5,
      bench: { faults: { LED4: { way: "rev" } }, repair: { LED4: { way: "ok" } } },
      checks: [
        { label: "LED2 is lit", kind: "signal", name: "BENCH_LED2", equals: 1, hint: "LED2 was lit at the start. A repair has broken it: take that repair back." },
        { label: "LED3 is lit", kind: "signal", name: "BENCH_LED3", equals: 1, hint: "LED3 was lit at the start. A repair has broken it: take that repair back." },
        { label: "LED4 is lit", kind: "signal", name: "BENCH_LED4", equals: 1, hint: "LED4 is dark although its pin is high. Run the program, choose LED4 on the bench and read why." },
        { label: "LED5 is lit", kind: "signal", name: "BENCH_LED5", equals: 1, hint: "LED5 was lit at the start. A repair has broken it: take that repair back." },
      ],
      bonus: [{ label: "Repaired with one change", kind: "signal", name: "BENCH_CHANGES", max: 1, hint: "Take back your repairs, find the one cause, and change only that." }],
      hints: [
        "Press Run, then choose each of LED2 to LED5 in the bench's Part list. Three say \"on\". Read what the fourth one says.",
        "The dark LED's card says current cannot flow through it. An LED lets current through one way only. Soldering a new one the same way round would not help.",
        "LED4 is the wrong way round. On LED4's card set \"Repair: direction\" to \"Make it: Right way round\", then press Run tests.",
      ],
      takeaway: "The pin was high all along. A reversed LED blocks, so the fault was on the board, not in the code. The part's own state told you which repair fits.",
    },
    {
      id: "brd-fault-pullup",
      kind: "code",
      mode: "debug",
      kit: "redboard",
      title: "A button that presses itself",
      goal: "LED10 should be on only while PB4 is held. Find out why it flickers, and repair it.",
      refs: [{ course: "HW1", note: "The push buttons are passive and need the internal pull-up" }],
      brief: `
This program should light LED10 while you hold push button PB4, and only then. Run it: LED10 flickers although nobody touches the button.

This time the board is fine. The fault is **one word** in the program.
${BENCH_HOW}

While the program runs you can hold PB4: press the mouse on it in the picture, or use the Hold button on its card.

## What to think about
Read PB4's card while the program runs, and the message under the editor. Then look at the line that sets up PB4's pin, GPIO7. It ends in one of two words:

- \`GPIO_PUSHPULL\`: the pin's pull-up stays off;
- \`GPIO_PULLUP\`: the pin's pull-up is switched on.

You met the pull-up in "A push button and the pull-up". The rest of the code is given: chapters 2 and 3 explain it.

You earn a star for leaving the board alone.
`,
      starter: button("GPIO_PUSHPULL"),
      solution: button("GPIO_PULLUP"),
      durationMs: 12,
      stimuli: [{ at: 4, press: "PB4" }, { at: 8, release: "PB4" }],
      bench: { faults: {}, repair: {} },
      checks: [
        { label: "The released button never reads at random", kind: "no-diagnostic", code: "floating-7", hint: "GPIO7 floats while PB4 is released, so the program reads random values. Switch the pin's pull-up on in the line that sets up GPIO7." },
        { label: "LED10 is off before the press", kind: "signal", name: "BENCH_LED10", at: 3, equals: 0, hint: "LED10 is on although PB4 is released. Released must read 1: that needs the pull-up." },
        { label: "LED10 is on while PB4 is held", kind: "signal", name: "BENCH_LED10", at: 6, equals: 1, hint: "LED10 stays off while PB4 is held. Keep the button and the LED on the board, and keep the test \"== 0\" for pressed." },
        { label: "LED10 is off again after the release", kind: "signal", name: "BENCH_LED10", at: 11, equals: 0, hint: "LED10 stays on after the release. Released must read 1: that needs the pull-up." },
      ],
      bonus: [{ label: "Repaired without changing the board", kind: "signal", name: "BENCH_CHANGES", max: 0, hint: "The board was fine. Take back your repairs on the bench." }],
      hints: [
        "Press Run and choose PB4 on the bench. Its card says what the pin does while the button is released.",
        "The card says GPIO7's pull-up is off, so the released button leaves the pin floating. The pull-up is switched on in the program, where the pin is set up.",
        "In the line GPIO_SetupPinOptions(7, GPIO_INPUT, GPIO_PUSHPULL); write GPIO_PULLUP instead of GPIO_PUSHPULL. Change nothing on the bench.",
      ],
      takeaway: "The board was fine. A button to ground needs its pin's pull-up, and that is one word in the set-up of the pin. The bench told you the pin was floating.",
    },
    {
      id: "brd-fault-jumper",
      kind: "code",
      mode: "debug",
      kit: "redboard",
      title: "The buzzer is silent",
      goal: "The program sends a 500 Hz tone to the buzzer. Find out why you hear nothing, and repair the board.",
      refs: [{ course: "HW3", note: "Exercise 2: \"Don't forget to move the buzzer's jumper\"" }, { course: "HW1", note: "Exercise 2: the buzzer, its resistor and its 2x2 header" }],
      brief: `
This program makes GPIO16 go high and low 500 times a second. On a correct board the buzzer sounds at 500 Hz. Here it is silent. The program is correct: do not change it.
${BENCH_HOW}

## What to think about
The tone leaves the chip on GPIO16. Follow it: point at the buzzer in the picture and see what lies between the pin and the buzzer. Then read the buzzer's card while the program runs.

More than one repair looks plausible here. Only one lets the tone through.

You earn a star for repairing the board with a single change.
`,
      starter: BUZZER,
      solution: BUZZER,
      durationMs: 30,
      bench: { faults: { JBUZ: { pos: "gnd" } }, repair: { JBUZ: { pos: "pin" } } },
      checks: [{ label: "The buzzer sounds at about 500 Hz", kind: "signal", name: "BUZZER_HZ", min: 450, max: 550, hint: "The buzzer is silent although GPIO16 carries the tone. Run the program, choose the buzzer on the bench and read what stops the tone." }],
      bonus: [{ label: "Repaired with one change", kind: "signal", name: "BENCH_CHANGES", max: 1, hint: "Take back your repairs, find the one cause, and change only that." }],
      hints: [
        "Press Run and choose \"Buzzer\" in the bench's Part list. Its card says why it is silent.",
        "The card names the buzzer's jumper. A jumper joins two pins: the tone gets through only when the jumper joins GPIO16 to the buzzer's input. Taking the jumper off does not do that.",
        "Choose \"Buzzer jumper\" and set \"Repair: jumper\" to \"Make it: On the GPIO16 position\", then press Run tests.",
      ],
      takeaway: "The jumper sat on the GND position, which keeps the buzzer quiet. A jumper is part of the path from pin to part: check it before you doubt the program.",
    },
    {
      id: "brd-fault-servo",
      kind: "code",
      mode: "debug",
      kit: "redboard",
      title: "The servo does not move",
      goal: "The program asks the servo on RC2 for -45 degrees. Find out why it stays where it is, and repair the board.",
      refs: [{ course: "HW4", note: "Exercises 2 and 3: the battery pack for the RC servos, and the 3-pin servo connectors" }],
      brief: `
An **RC servo** is a small motor that turns its arm to an angle you ask for. You ask with a **pulse** on its signal wire, 50 times a second. A pulse is a short time during which the wire is high. Its length is the angle. This program sends pulses of 1.2 ms on GPIO15, which means -45 degrees. The program is correct: do not change it.

The servo on connector **RC2** does not move.
${BENCH_HOW}

## What to think about
A servo has three wires: signal, supply and ground. The signal comes from your pin and carries almost no current. The motor's power comes through the supply wire, and a motor needs more than a pin or the USB cable should give.

Read RC2's card while the program runs. It says whether the pulses arrive, and what else the servo is missing.

You earn a star for repairing the board with a single change.
`,
      starter: SERVO,
      solution: SERVO,
      durationMs: 100,
      bench: { faults: { BAT: { fitted: "no" } }, repair: { BAT: { fitted: "yes" } } },
      checks: [{ label: "The servo on RC2 turns to -45 degrees", kind: "signal", name: "SERVO2_DEG", min: -50, max: -40, hint: "The servo has not moved although the pulses arrive on GPIO15. Run the program, choose RC servo 2 on the bench and read what it is missing." }],
      bonus: [{ label: "Repaired with one change", kind: "signal", name: "BENCH_CHANGES", max: 1, hint: "Take back your repairs, find the one cause, and change only that." }],
      hints: [
        "Press Run and choose \"RC servo 2\" in the bench's Part list. Its card says why it is not moving.",
        "The pulses arrive, so the signal wire is fine. The card says the servo has no supply: its supply wire goes to the battery pack, not to the LaunchPad.",
        "The battery pack is not on the board. Choose \"Battery pack\" and set \"Repair: on the board\" to \"Make it: Soldered\", then press Run tests.",
      ],
      takeaway: "A signal alone moves nothing: the servo needs its supply, and on this board that is the battery pack. You have now found four faults the way you will on your own board. The Sandbox has the same bench with every fault switch, for your own programs: choose the board \"Homework red board\" there.",
    },
  ],
};
