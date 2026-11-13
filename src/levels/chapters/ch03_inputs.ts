import type { Stimulus } from "../../sim/runner";
import type { Chapter } from "../types";

const INIT = `    InitSysCtrl();
    InitGpio();`;

const out = (pin: number) => `    GPIO_SetupPinMux(${pin}, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(${pin}, GPIO_OUTPUT, GPIO_PUSHPULL);`;

const inp = (pin: number) => `    GPIO_SetupPinMux(${pin}, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(${pin}, GPIO_INPUT, GPIO_PULLUP);`;

const READ_SWITCHES = `int16_t ReadSwitches(void)
{
    int16_t value = 0;

    if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) {
        value = value | 0x1;
    }
    if (GpioDataRegs.GPEDAT.bit.GPIO158 == 0) {
        value = value | 0x2;
    }
    if (GpioDataRegs.GPEDAT.bit.GPIO159 == 0) {
        value = value | 0x4;
    }
    if (GpioDataRegs.GPFDAT.bit.GPIO160 == 0) {
        value = value | 0x8;
    }
    return value;
}`;

const SETUP_BUTTONS = `${inp(157)}
${inp(158)}
${inp(159)}
${inp(160)}`;

/** A press whose contacts bounce for 0.9 ms before they settle (times in ms). */
const bouncyPress = (t: number, id: string): Stimulus[] => [
  { at: t, press: id },
  { at: t + 0.05, release: id },
  { at: t + 0.11, press: id },
  { at: t + 0.2, release: id },
  { at: t + 0.38, press: id },
  { at: t + 0.6, release: id },
  { at: t + 0.9, press: id },
];

/** A release that bounces for 0.5 ms. */
const bouncyRelease = (t: number, id: string): Stimulus[] => [
  { at: t, release: id },
  { at: t + 0.07, press: id },
  { at: t + 0.15, release: id },
  { at: t + 0.3, press: id },
  { at: t + 0.5, release: id },
];

/** A clean press and release. */
const tap = (t: number, id: string, holdMs = 1): Stimulus[] => [
  { at: t, press: id },
  { at: t + holdMs, release: id },
];

export const ch03: Chapter = {
  id: "inputs",
  number: 3,
  title: "Digital inputs",
  blurb: "Pull-ups, push buttons and GPxDAT. Read the outside world without reading noise.",
  requires: ["outputs"],
  course: ["L3", "Lab 2", "HW1"],
  levels: [
    {
      id: "in-brief",
      kind: "brief",
      title: "Reading a pin",
      goal: "Learn what a pin does as an input, why it needs a pull-up, and what a push button makes it read.",
      refs: [{ course: "L3" }, { course: "Lab 2" }, { trm: "8.2" }, { trm: "8.8" }, { trm: "8.9" }],
      brief: `
A GPIO pin is a metal contact on the chip that your program controls. It can work in two directions, and you choose which.

- As an **output** (the last chapter) the chip **pushes** a voltage onto the pin: 3.3 V or 0 V.
- As an **input** the chip pushes nothing. It only **measures** the voltage that the circuit outside puts on the pin.

The measurement gives one bit, the pin's **level**:

- near 3.3 V reads as **1** (high)
- near 0 V reads as **0** (low). The 0 V point of a circuit is called **ground**, or GND.

After reset every pin is an input.

## A pin connected to nothing
An input can only report what the outside circuit gives it. If nothing is connected, nothing sets the voltage. The pin behaves like a loose wire: its voltage drifts with every bit of electrical noise nearby. Such a pin is **floating**. It reads 0 or 1 at random, and two reads in a row can disagree.

A push button on its own has this problem. A **push button** is a switch: its two sides are connected only while it is pressed. Put one side on the pin and the other on ground:

- pressed: the pin is connected to ground. It reads 0.
- released: the pin is connected to nothing. It floats.

{{figure:gpio-pin}}

Try it in the figure: make the pin an input, switch the pull-up off, and connect nothing. Watch what \`GPxDAT\` reads. Then connect the button, and press and release it.

## The pull-up resistor
The cure is to give the pin a default level. A **resistor** is a part that lets only a small current through. A **pull-up** is a large resistor between the pin and 3.3 V.

- Nothing else acts on the pin: the resistor brings it up to 3.3 V. It reads **1**. That is the default.
- Something connects the pin to ground, such as a pressed button: a direct connection is far stronger than a large resistor, so the pin goes to 0 V and reads **0**. Nothing fights and nothing is harmed. Only a tiny current flows from 3.3 V through the resistor to ground.

So a pull-up decides the level only when nothing else does. People call that a **weak** pull.

Try it in the figure: input, pull-up on, nothing connected. Then the button, released and pressed. The pin never floats now.

## Switching the pull-up on
The chip has a pull-up built into every pin. You switch it on pin by pin. The register that controls it is \`GPxPUD\`, "pull-up **disable**", so its logic is upside down:

- bit = 1: pull-up disabled. This is the state after reset, for every pin.
- bit = 0: pull-up enabled.

The helper function sets the direction and the pull-up in one call:
\`\`\`c
GPIO_SetupPinMux(157, GPIO_MUX_CPU1, 0);            // GPIO157 is a plain GPIO
GPIO_SetupPinOptions(157, GPIO_INPUT, GPIO_PULLUP); // input, pull-up enabled
\`\`\`
\`InitGpio()\` does not enable any pull-up. Each input needs its own call.

## A push button to ground
The robot board's buttons connect the pin to **ground** when pressed. With the pull-up enabled:

- released: only the pull-up acts on the pin. It reads **1**.
- pressed: the button connects the pin to ground and wins over the pull-up. It reads **0**.

So a pressed button reads 0. That feels backwards the first time.

## Reading the level
Your program reads the measured level from the **data register** of the pin's port, \`GPxDAT\`. Each pin has one bit in it:
\`\`\`c
if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) {
    // push button 1 is pressed
}
\`\`\`
The push buttons are on GPIO157, 158, 159 and 160. The first three are in port E (\`GPEDAT\`). GPIO160 is the first pin of port F (\`GPFDAT\`).
`,
      questions: [
        {
          prompt: "A pin is set up as an input. What does the chip do with it?",
          options: [
            "It pushes 3.3 V onto the pin",
            "It pushes 0 V onto the pin",
            "It measures the voltage the outside circuit puts on the pin",
            "It disconnects the pin from the outside circuit",
          ],
          answer: 2,
          why: "An input pushes nothing. It reports the voltage it finds: near 3.3 V reads 1, near 0 V reads 0.",
        },
        {
          prompt: "GPIO157 is an input with its pull-up **disabled**. Push button 1 is released. What does `GpioDataRegs.GPEDAT.bit.GPIO157` read?",
          options: ["Always 0", "Always 1", "0 or 1 at random", "The last value the program wrote"],
          answer: 2,
          why: "A released button connects the pin to nothing, and with the pull-up off nothing else sets its voltage. The pin floats, so each read is unpredictable.",
        },
        {
          prompt: "GPIO157 is an input with its pull-up enabled. Nobody touches push button 1. What does `GpioDataRegs.GPEDAT.bit.GPIO157` read?",
          options: ["0", "1", "0 or 1 at random", "The last value written to it"],
          answer: 1,
          why: "With the button released, only the pull-up acts on the pin and holds it at 3.3 V, which reads as 1.",
        },
        {
          prompt: "After reset, which is true of the internal pull-ups?",
          options: [
            "All enabled: every `GPxPUD` bit is 0",
            "All disabled: every `GPxPUD` bit is 1",
            "All disabled: every `GPxPUD` bit is 0",
            "Enabled on inputs, disabled on outputs",
          ],
          answer: 1,
          why: "GPxPUD is a pull-up disable register and its bits are 1 after reset, so every pull-up starts disabled. You enable the ones you need.",
        },
        {
          prompt: "Which expression is true while push button 4 (GPIO160) is pressed?",
          options: [
            "`GpioDataRegs.GPEDAT.bit.GPIO160 == 0`",
            "`GpioDataRegs.GPFDAT.bit.GPIO160 == 1`",
            "`GpioDataRegs.GPFDAT.bit.GPIO160 == 0`",
            "`GpioDataRegs.GPADAT.bit.GPIO160 == 0`",
          ],
          answer: 2,
          why: "160 / 32 = 5, so GPIO160 is in port F. A pressed button connects the pin to ground, which reads 0.",
        },
      ],
      takeaway: "An input only measures. A pull-up gives it a default of 1, and a button to ground overrides that with 0: 1 when released, 0 when pressed. Read it from GPxDAT of the right port.",
    },
    {
      id: "in-wiring",
      kind: "wiring",
      title: "A level in both positions",
      goal: "Wire the pull-up and the push button so the pin never floats.",
      refs: [{ course: "L3" }, { course: "Lab 2" }, { trm: "8.8" }],
      brief: `
The pin must have a defined level, 0 or 1, when the button is released **and** when it is pressed. It must never float.

A terminal is a point where a wire can be attached.

What is already in place (grey lines):

- The **pull-up resistor** sits between the pin and the terminal labelled "Pull-up end". It is drawn as a box, the usual symbol for a resistor.
- **Button side 1** is connected to the pin.

A push button connects its two sides only while it is pressed.

Add the wires that are missing, so that the pin reads 1 while the button is released and 0 while it is pressed. This is how the robot board and the chip's internal pull-up are connected.
`,
      nodes: [
        { id: "v33", label: "3.3 V", x: 30, y: 8 },
        { id: "rtop", label: "Pull-up end", x: 30, y: 20, side: "left" },
        { id: "pin", label: "GPIO pin", x: 30, y: 46, side: "left" },
        { id: "sw1", label: "Button side 1", x: 50, y: 46, side: "bottom" },
        { id: "sw2", label: "Button side 2", x: 74, y: 46, side: "bottom" },
        { id: "gnd", label: "GND", x: 74, y: 22 },
      ],
      parts: [
        { kind: "resistor", a: "rtop", b: "pin", label: "pull-up resistor" },
        { kind: "button", a: "sw1", b: "sw2", label: "push button" },
      ],
      fixed: [
        ["rtop", "pin"],
        ["pin", "sw1"],
      ],
      wires: [
        ["v33", "rtop"],
        ["sw2", "gnd"],
      ],
      mistakes: [
        {
          wire: ["sw2", "v33"],
          why: "With the button going to 3.3 V, pressing it puts 3.3 V on the pin. A pull-up puts 3.3 V on it when released too, so the pin reads 1 in both positions and the button does nothing.",
        },
        {
          wire: ["rtop", "gnd"],
          why: "A resistor to ground is a pull-down. With a button to 3.3 V that is a valid circuit, but it is not the one the chip offers: the internal resistor only goes to 3.3 V, and the robot board's buttons go to ground.",
        },
        {
          wire: ["v33", "gnd"],
          why: "That wire connects 3.3 V straight to ground: a short circuit. Nothing limits the current.",
        },
        {
          wire: ["pin", "gnd"],
          why: "A wire from the pin to ground holds the pin at 0 all the time. The button can no longer change anything.",
        },
        {
          wire: ["pin", "v33"],
          why: "A wire from the pin to 3.3 V holds the pin at 1 with no resistor in between. Pressing a button to ground would then short 3.3 V to ground.",
        },
        {
          wire: ["sw2", "rtop"],
          why: "That puts the button across the resistor. Pressed or released, nothing ever connects the pin to ground, so it can never read 0.",
        },
        {
          wire: ["sw1", "gnd"],
          why: "Button side 1 is already connected to the pin, so this wire holds the pin at 0 all the time.",
        },
      ],
      hints: [
        "Think about each position separately. Released: what holds the pin at 1? Pressed: what takes it to 0?",
        "The resistor must reach 3.3 V to pull the pin up. The button must reach ground to pull it down when pressed.",
        "Two wires: 3.3 V to the pull-up end, and button side 2 to GND.",
      ],
      takeaway: "The resistor is what makes this safe. Pressed, only a tiny current flows from 3.3 V through the resistor to ground, and the pin sits at 0 V.",
    },
    {
      id: "in-pud",
      kind: "register",
      title: "Enable three pull-ups",
      goal: "Set GPEPUD so the pull-ups of push buttons 1 to 3 are enabled.",
      refs: [{ trm: "8.9" }, { trm: "8.8" }, { course: "Lab 2" }],
      brief: `
Each pin has a pull-up built in: a large resistor to 3.3 V that holds an input at 1 when nothing else sets its level. \`GpioCtrlRegs.GPEPUD\` switches these on and off for port E, GPIO128 to GPIO159, one bit per pin. It is a pull-up **disable** register:

- 1 = pull-up disabled (every bit after reset)
- 0 = pull-up enabled

Enable the pull-ups of **GPIO157**, **GPIO158** and **GPIO159** (push buttons 1, 2 and 3). Leave every other pin as it is.

Push button 4 is on GPIO160. That pin is in port F, so its bit is in \`GPFPUD\`, not here.
`,
      reg: "GpioCtrlRegs.GPEPUD",
      initial: 0xffffffff,
      targets: [
        { field: "GPIO157", value: 0 },
        { field: "GPIO158", value: 0 },
        { field: "GPIO159", value: 0 },
      ],
      code: "EALLOW;\nGpioCtrlRegs.GPEPUD.bit.GPIO157 = 0;\nGpioCtrlRegs.GPEPUD.bit.GPIO158 = 0;\nGpioCtrlRegs.GPEPUD.bit.GPIO159 = 0;\nEDIS;\n// GPIO_SetupPinOptions(157, GPIO_INPUT, GPIO_PULLUP); does the same for one pin",
      hints: [
        "To enable a pull-up you clear its bit. Enabled is 0.",
        "Port E starts at GPIO128, so GPIO157 is bit 29, GPIO158 is bit 30 and GPIO159 is bit 31.",
        "Clear the top three bits. The value is 0x1FFFFFFF.",
      ],
      takeaway: "GPIO_SetupPinOptions(pin, GPIO_INPUT, GPIO_PULLUP) clears exactly this bit for you. Without GPIO_PULLUP it sets the bit and the pull-up stays off.",
    },
    {
      id: "in-follow",
      kind: "code",
      mode: "complete",
      title: "Press to light",
      goal: "Make LED1 light while push button 1 is held down.",
      refs: [{ course: "Lab 2" }, { course: "L3" }, { trm: "8.3" }],
      brief: `
Push button 1 is on **GPIO157** (port E). LED1 is on **GPIO22** (port A) and is already set up as an output.

Two things are missing:

1. Make GPIO157 an input with its pull-up enabled:
\`\`\`c
GPIO_SetupPinMux(157, GPIO_MUX_CPU1, 0);
GPIO_SetupPinOptions(157, GPIO_INPUT, GPIO_PULLUP);
\`\`\`
2. In the loop, read the pin of the button again and again. Asking over and over like this is called **polling**. Turn LED1 on while the button is pressed and off while it is released.

A pressed button reads **0**.

Press **Run** and click PB1 on the board to try it.
`,
      kit: "robot",
      durationMs: 15,
      starter: `void main(void)
{
${INIT}

${out(22)}

    // TODO 1: make GPIO157 an input with its pull-up enabled

    while (1) {
        // TODO 2: if push button 1 is pressed, turn LED1 on.
        //         Otherwise turn LED1 off.
    }
}
`,
      solution: `void main(void)
{
${INIT}

${out(22)}

${inp(157)}

    while (1) {
        if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) {
            GpioDataRegs.GPASET.bit.GPIO22 = 1;
        } else {
            GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
        }
    }
}
`,
      stimuli: [
        { at: 3, press: "PB1" },
        { at: 6, release: "PB1" },
        { at: 9, press: "PB1" },
        { at: 12, release: "PB1" },
      ],
      checks: [
        { kind: "led", led: "LED1", at: 2, on: false, label: "LED1 is off before the button is pressed", hint: "A released button reads 1, but only if the pull-up is enabled." },
        { kind: "led", led: "LED1", at: 4.5, on: true, label: "LED1 is on while PB1 is pressed", hint: "Pressed reads 0. The read must be inside the while loop." },
        { kind: "led", led: "LED1", at: 7.5, on: false, label: "LED1 goes off when PB1 is released", hint: "The else branch must drive the LED low with GPACLEAR." },
        { kind: "led", led: "LED1", at: 10.5, on: true, label: "LED1 is on again on the second press" },
        { kind: "led", led: "LED1", at: 13.5, on: false, label: "LED1 is off again after the second release" },
        { kind: "reg", reg: "GpioCtrlRegs.GPEPUD", field: "GPIO157", equals: 0, label: "The pull-up of GPIO157 is enabled" },
        { kind: "no-dat-write", label: "GPxDAT is only read, never written" },
      ],
      bonus: [
        {
          kind: "latency",
          led: "LED1",
          after: 3,
          withinUs: 1,
          label: "LED1 lights within 1 microsecond of the press",
          hint: "Nothing in the loop should wait. Read the pin and write the LED, nothing else.",
        },
      ],
      inspect: ["GpioDataRegs.GPEDAT", "GpioCtrlRegs.GPEPUD"],
      hints: [
        "Copy the two set-up lines from the briefing. The button's pin is in port E, the LED's pin is in port A.",
        "The test is `if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0)`. Pressed is 0.",
        "Inside the if: `GpioDataRegs.GPASET.bit.GPIO22 = 1;`. Inside the else: `GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;`",
      ],
      takeaway: "Reading goes through GPxDAT, writing through SET and CLEAR. The loop has to keep asking: a pin read once stays read once.",
    },
    {
      id: "in-floating",
      kind: "code",
      mode: "debug",
      title: "The LED with a mind of its own",
      goal: "LED1 flickers when nobody touches the button. Find the cause and fix it.",
      refs: [{ trm: "8.8" }, { trm: "8.2" }, { course: "Lab 2" }],
      brief: `
This program should light LED1 only while push button 1 is pressed. Press **Run** and watch: the LED flickers on its own.

The loop is correct. The problem is in the set-up.

Remember what a released button does: it connects the pin to nothing. Something else has to hold the pin at 1 then, and that is the job of the pull-up. If nothing does, the pin floats and every read is a coin toss.

Look closely at the options given for GPIO157. \`GPIO_PUSHPULL\` describes how an **output** drives its pin. It has the value 0, which for an input means "no options": no pull-up.
`,
      kit: "robot",
      durationMs: 12.5,
      starter: `void main(void)
{
${INIT}

${out(22)}

    // Push button 1
    GPIO_SetupPinMux(157, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(157, GPIO_INPUT, GPIO_PUSHPULL);

    while (1) {
        if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) {
            GpioDataRegs.GPASET.bit.GPIO22 = 1;
        } else {
            GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
        }
    }
}
`,
      solution: `void main(void)
{
${INIT}

${out(22)}

    // Push button 1
    GPIO_SetupPinMux(157, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(157, GPIO_INPUT, GPIO_PULLUP);

    while (1) {
        if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) {
            GpioDataRegs.GPASET.bit.GPIO22 = 1;
        } else {
            GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
        }
    }
}
`,
      stimuli: [
        { at: 5, press: "PB1" },
        { at: 8, release: "PB1" },
      ],
      checks: [
        { kind: "steady", led: "LED1", from: 1, to: 4, on: false, label: "LED1 stays off while PB1 is released", hint: "Nothing holds GPIO157 at 1 while the button is released, so the reads are random." },
        { kind: "led", led: "LED1", at: 6.5, on: true, label: "LED1 is on while PB1 is pressed" },
        { kind: "steady", led: "LED1", from: 9.5, to: 12, on: false, label: "LED1 stays off after PB1 is released" },
        { kind: "reg", reg: "GpioCtrlRegs.GPEPUD", field: "GPIO157", equals: 0, label: "The pull-up of GPIO157 is enabled" },
      ],
      inspect: ["GpioCtrlRegs.GPEPUD", "GpioDataRegs.GPEDAT"],
      bonus: [
        {
          kind: "max-lines",
          max: 16,
          label: "A one-word fix: the program is still 16 lines of code",
          hint: "Do not add a line. One argument of one call is wrong.",
        },
      ],
      hints: [
        "The LED is fine while the button is pressed. It only misbehaves while the button is released.",
        "Open GPEPUD in the inspector: the bit of GPIO157 is still 1, so its pull-up is disabled.",
        "Change the last argument: `GPIO_SetupPinOptions(157, GPIO_INPUT, GPIO_PULLUP);`",
      ],
      takeaway: "A floating input is a nasty bug because it sometimes seems to work. Every input needs something that defines its level at all times: here, the pull-up.",
    },
    {
      id: "in-inverted",
      kind: "code",
      mode: "debug",
      title: "Backwards",
      goal: "LED2 is on until you press push button 2. Make it light only while the button is pressed.",
      refs: [{ course: "Lab 2" }, { course: "L3" }],
      brief: `
This program should light **LED2** (GPIO94) while **push button 2** (GPIO158) is pressed. It does the reverse: the LED is on all the time and goes dark when you press.

The set-up is correct this time, pull-up included. Look at the test in the loop and think about which level a pressed button puts on the pin.
`,
      kit: "robot",
      durationMs: 12,
      starter: `void main(void)
{
${INIT}

${out(94)}

${inp(158)}

    while (1) {
        // Is push button 2 pressed?
        if (GpioDataRegs.GPEDAT.bit.GPIO158 == 1) {
            GpioDataRegs.GPCSET.bit.GPIO94 = 1;
        } else {
            GpioDataRegs.GPCCLEAR.bit.GPIO94 = 1;
        }
    }
}
`,
      solution: `void main(void)
{
${INIT}

${out(94)}

${inp(158)}

    while (1) {
        // Is push button 2 pressed? Pressed connects the pin to ground: 0
        if (GpioDataRegs.GPEDAT.bit.GPIO158 == 0) {
            GpioDataRegs.GPCSET.bit.GPIO94 = 1;
        } else {
            GpioDataRegs.GPCCLEAR.bit.GPIO94 = 1;
        }
    }
}
`,
      stimuli: [
        { at: 3, press: "PB2" },
        { at: 6, release: "PB2" },
        { at: 9, press: "PB2" },
      ],
      checks: [
        { kind: "led", led: "LED2", at: 2, on: false, label: "LED2 is off before the button is pressed", hint: "A released button reads 1 because of the pull-up." },
        { kind: "led", led: "LED2", at: 4.5, on: true, label: "LED2 is on while PB2 is pressed", hint: "A pressed button reads 0." },
        { kind: "led", led: "LED2", at: 7.5, on: false, label: "LED2 goes off when PB2 is released" },
        { kind: "led", led: "LED2", at: 10.5, on: true, label: "LED2 is on again on the second press" },
        { kind: "reg", reg: "GpioCtrlRegs.GPEPUD", field: "GPIO158", equals: 0, label: "The pull-up of GPIO158 is still enabled" },
      ],
      bonus: [
        {
          kind: "max-lines",
          max: 16,
          label: "A one-character fix: the program is still 16 lines of code",
          hint: "Do not add a line. Change the value the pin is compared with.",
        },
      ],
      hints: [
        "What does the pin read while the button is released? What does the code do with that value?",
        "The button connects the pin to ground when pressed, so pressed is 0, not 1.",
        "Compare with 0: `if (GpioDataRegs.GPEDAT.bit.GPIO158 == 0)`. Swapping the SET and CLEAR lines works too.",
      ],
      takeaway: "With a pull-up and a button to ground, 0 means pressed. A signal that is active at 0 is called active low. Say it in a comment next to the test.",
    },
    {
      id: "in-readswitches",
      kind: "code",
      mode: "write",
      title: "ReadSwitches()",
      goal: "Write the Lab 2 function that packs the four push buttons into one number.",
      refs: [{ course: "Lab 2" }, { course: "HW1" }, { trm: "8.9" }],
      brief: `
Lab 2 asks for a function \`int16_t ReadSwitches(void)\` that does one job: read the buttons. It returns one number whose lowest four bits show the four push buttons:

- bit 0 (\`0x1\`): push button 1, GPIO157
- bit 1 (\`0x2\`): push button 2, GPIO158
- bit 2 (\`0x4\`): push button 3, GPIO159
- bit 3 (\`0x8\`): push button 4, GPIO160

A bit is **1 when its button is pressed**. With buttons 1 and 3 held down the function returns \`0x5\`.

The recipe from the lab: start a local variable at 0. Use four \`if\` statements. In each, if the button is pressed, OR that button's bit into the variable with \`|\`. Return the variable.

Two things to keep in mind:

- A pressed button reads 0.
- GPIO157 to 159 are in port E. GPIO160 is in port **F**.

The set-up and the main loop are written. The loop stores the result in the global \`switches\`, which you can watch next to the board.
`,
      kit: "robot",
      durationMs: 35,
      watch: ["switches"],
      starter: `int16_t switches = 0;

int16_t ReadSwitches(void)
{
    int16_t value = 0;

    // Your code here: set bit 0 to 3 of value for push buttons 1 to 4

    return value;
}

void main(void)
{
${INIT}

${inp(157)}
${inp(158)}
${inp(159)}
${inp(160)}

    while (1) {
        switches = ReadSwitches();
    }
}
`,
      solution: `int16_t switches = 0;

${READ_SWITCHES}

void main(void)
{
${INIT}

${inp(157)}
${inp(158)}
${inp(159)}
${inp(160)}

    while (1) {
        switches = ReadSwitches();
    }
}
`,
      stimuli: [
        { at: 5, press: "PB1" },
        { at: 10, press: "PB3" },
        { at: 15, press: "PB4" },
        { at: 20, release: "PB1" },
        { at: 25, press: "PB2" },
        { at: 30, release: "PB2" },
        { at: 30, release: "PB3" },
        { at: 30, release: "PB4" },
      ],
      checks: [
        { kind: "var", name: "switches", at: 3, equals: 0, label: "Nothing pressed: 0", hint: "A released button reads 1. That must leave its bit at 0." },
        { kind: "var", name: "switches", at: 7, equals: 1, label: "PB1 pressed: 0x1" },
        { kind: "var", name: "switches", at: 12, equals: 5, label: "PB1 and PB3 pressed: 0x5", hint: "Each button must OR in its own bit: 0x1, 0x2, 0x4, 0x8." },
        { kind: "var", name: "switches", at: 17, equals: 13, label: "PB1, PB3 and PB4 pressed: 0xD", hint: "Push button 4 is GPIO160, in port F: read it from GPFDAT." },
        { kind: "var", name: "switches", at: 22, equals: 12, label: "PB3 and PB4 pressed: 0xC" },
        { kind: "var", name: "switches", at: 27, equals: 14, label: "PB2, PB3 and PB4 pressed: 0xE" },
        { kind: "var", name: "switches", at: 32, equals: 0, label: "All released: 0 again", hint: "Start from 0 on every call, in a local variable." },
      ],
      hints: [
        "One if per button. The first: `if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) { value = value | 0x1; }`",
        "The bits are 0x1, 0x2, 0x4 and 0x8 for push buttons 1, 2, 3 and 4.",
        "The fourth button is in another port: `if (GpioDataRegs.GPFDAT.bit.GPIO160 == 0) { value = value | 0x8; }`",
      ],
      takeaway: "One number now holds all four buttons, and bitwise AND picks them out again: `(ReadSwitches() & 0x6) == 0x6` is true when buttons 2 and 3 are both pressed.",
    },
    {
      id: "in-checkpoint",
      kind: "code",
      mode: "checkpoint",
      title: "Buttons to LEDs",
      goal: "Show the four push buttons on LED1 to LED4: each LED lights while its button is pressed.",
      refs: [{ course: "Lab 2" }, { course: "HW1" }, { trm: "8.3" }],
      brief: `
This is the first demonstration of Lab 2: the LEDs show the state of the push buttons, all the time.

- push button 1 (GPIO157) lights **LED1** (GPIO22)
- push button 2 (GPIO158) lights **LED2** (GPIO94)
- push button 3 (GPIO159) lights **LED3** (GPIO95)
- push button 4 (GPIO160) lights **LED4** (GPIO97)

Any combination of buttons can be held at once. An LED must go dark again when its button is released.

You write everything: the set-up of four outputs and four inputs, and the loop.

Lab 2 splits the work into two functions, and that is a good plan here too: \`ReadSwitches()\` from the last level, and \`void SetLEDsOnOff(int16_t LEDvalue)\`, which tests each bit of its argument with \`&\` and turns the matching LED on or off.

Rules: change the LEDs only through \`GPxSET\` and \`GPxCLEAR\`. \`GPxDAT\` is for reading the buttons.
`,
      kit: "robot",
      durationMs: 21,
      starter: `void main(void)
{
${INIT}

    // Set up LED1 to LED4 as outputs and push buttons 1 to 4 as inputs

    while (1) {
        // Show the buttons on the LEDs
    }
}
`,
      solution: `${READ_SWITCHES}

void SetLEDsOnOff(int16_t LEDvalue)
{
    if ((LEDvalue & 0x1) == 0x1) {
        GpioDataRegs.GPASET.bit.GPIO22 = 1;
    } else {
        GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
    }
    if ((LEDvalue & 0x2) == 0x2) {
        GpioDataRegs.GPCSET.bit.GPIO94 = 1;
    } else {
        GpioDataRegs.GPCCLEAR.bit.GPIO94 = 1;
    }
    if ((LEDvalue & 0x4) == 0x4) {
        GpioDataRegs.GPCSET.bit.GPIO95 = 1;
    } else {
        GpioDataRegs.GPCCLEAR.bit.GPIO95 = 1;
    }
    if ((LEDvalue & 0x8) == 0x8) {
        GpioDataRegs.GPDSET.bit.GPIO97 = 1;
    } else {
        GpioDataRegs.GPDCLEAR.bit.GPIO97 = 1;
    }
}

void main(void)
{
${INIT}

${out(22)}
${out(94)}
${out(95)}
${out(97)}

${inp(157)}
${inp(158)}
${inp(159)}
${inp(160)}

    while (1) {
        SetLEDsOnOff(ReadSwitches());
    }
}
`,
      stimuli: [
        { at: 3, press: "PB1" },
        { at: 6, press: "PB3" },
        { at: 9, press: "PB4" },
        { at: 12, release: "PB1" },
        { at: 15, press: "PB2" },
        { at: 18, release: "PB2" },
        { at: 18, release: "PB3" },
        { at: 18, release: "PB4" },
      ],
      checks: [
        { kind: "steady", led: "LED1", from: 1, to: 2.5, on: false, label: "Nothing pressed: LED1 stays off", hint: "A flickering LED means a button pin is floating. Enable its pull-up." },
        { kind: "steady", led: "LED4", from: 1, to: 2.5, on: false, label: "Nothing pressed: LED4 stays off", hint: "Push button 4 needs its pull-up too, and it is read from GPFDAT." },
        { kind: "led", led: "LED1", at: 4.5, on: true, label: "PB1 pressed: LED1 is on" },
        { kind: "led", led: "LED2", at: 4.5, on: false, label: "PB1 pressed: LED2 is still off" },
        { kind: "led", led: "LED3", at: 7.5, on: true, label: "PB1 and PB3 pressed: LED3 is on" },
        { kind: "led", led: "LED1", at: 7.5, on: true, label: "PB1 and PB3 pressed: LED1 is still on" },
        { kind: "led", led: "LED4", at: 10.5, on: true, label: "PB4 pressed as well: LED4 is on", hint: "GPIO160 is in port F (GPFDAT). GPIO97 is in port D (GPDSET, GPDCLEAR)." },
        { kind: "led", led: "LED1", at: 13.5, on: false, label: "PB1 released: LED1 goes off", hint: "Each LED needs a CLEAR write for the released case." },
        { kind: "led", led: "LED3", at: 13.5, on: true, label: "PB1 released: LED3 stays on" },
        { kind: "led", led: "LED2", at: 16.5, on: true, label: "PB2 pressed: LED2 is on" },
        { kind: "led", led: "LED2", at: 19.5, on: false, label: "All released: LED2 is off" },
        { kind: "led", led: "LED3", at: 19.5, on: false, label: "All released: LED3 is off" },
        { kind: "led", led: "LED4", at: 19.5, on: false, label: "All released: LED4 is off" },
        { kind: "no-dat-write", label: "LEDs are changed through SET and CLEAR, not DAT" },
        { kind: "no-diagnostic", code: "short", label: "No button pin is driven as an output", hint: "GPIO157 to GPIO160 must be inputs. An output fighting a pressed button is a short circuit." },
      ],
      bonus: [
        {
          kind: "source",
          mustMatch: "(?=[\\s\\S]*int16_t\\s+ReadSwitches\\s*\\(\\s*void\\s*\\))(?=[\\s\\S]*void\\s+SetLEDsOnOff\\s*\\(\\s*int16_t\\s)",
          label: "Built from the two Lab 2 functions: int16_t ReadSwitches(void) and void SetLEDsOnOff(int16_t LEDvalue)",
          hint: "Read all four buttons into one number in the first function. Act on that number in the second.",
        },
        {
          kind: "latency",
          led: "LED3",
          after: 6,
          withinUs: 2,
          label: "LED3 lights within 2 microseconds of the press of PB3",
          hint: "The loop should do nothing but read the buttons and write the LEDs.",
        },
      ],
      hints: [
        "Set-up: four times the output pair of calls (22, 94, 95, 97), four times the input pair with GPIO_PULLUP (157 to 160).",
        "Ports: GPIO22 is A, GPIO94 and GPIO95 are C, GPIO97 is D. Buttons 1 to 3 are read from GPEDAT, button 4 from GPFDAT.",
        "In the loop: `SetLEDsOnOff(ReadSwitches());`. In SetLEDsOnOff, for each LED: `if ((LEDvalue & 0x1) == 0x1) { SET } else { CLEAR }`.",
      ],
      takeaway: "Read all inputs into one value, then act on that value. In Lab 2 the same two functions are called from a timer interrupt instead of a busy loop.",
    },
    {
      id: "in-count",
      tier: "practice",
      kind: "code",
      mode: "write",
      title: "One press, one count",
      goal: "Count how many times push button 1 is pressed, and toggle LED1 on every press.",
      refs: [{ course: "Lab 2" }, { course: "HW4" }, { trm: "8.3" }],
      brief: `
The loop runs millions of times per second. A press lasts thousands of passes. So this does not count presses, it counts passes:
\`\`\`c
if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) {
    presses++;
}
\`\`\`
Run the starter and watch \`presses\`.

A press is not a level. It is a **change** of level: the pin read 1 on the last pass and reads 0 on this one. That change is called a **falling edge**. To see it, the program must remember what the pin read on the pass before.

## Your task
- \`presses\` goes up by exactly 1 for every press of push button 1, however long the button is held.
- LED1 (GPIO22) changes state on every press: on after the first press, off after the second, and so on.
- Releasing the button does nothing.

The buttons in this level are ideal: they do not bounce.
`,
      kit: "robot",
      durationMs: 28,
      watch: ["presses"],
      starter: `int16_t presses = 0;

void main(void)
{
${INIT}

${out(22)}

${inp(157)}

    while (1) {
        // This counts loop passes, not presses
        if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) {
            presses++;
        }
    }
}
`,
      solution: `int16_t presses = 0;

void main(void)
{
    int16_t now = 1;
    int16_t last = 1;   // what GPIO157 read on the pass before: 1 = released

${INIT}

${out(22)}

${inp(157)}

    while (1) {
        now = GpioDataRegs.GPEDAT.bit.GPIO157;
        // Falling edge: released on the last pass, pressed on this one
        if (now == 0 && last == 1) {
            presses++;
            GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
        }
        last = now;
    }
}
`,
      stimuli: [...tap(3, "PB1", 2), ...tap(8, "PB1", 0.2), ...tap(12, "PB1", 8), { at: 24, press: "PB1" }],
      checks: [
        { kind: "var", name: "presses", at: 2, equals: 0, label: "No press yet: presses is 0" },
        { kind: "var", name: "presses", at: 4, equals: 1, label: "During the first press: presses is 1", hint: "Count only on the pass where the pin changes from 1 to 0." },
        { kind: "var", name: "presses", at: 7, equals: 1, label: "After the release: still 1", hint: "A release is a change from 0 to 1. It must not count." },
        { kind: "var", name: "presses", at: 10, equals: 2, label: "A short press of 0.2 ms counts too: 2" },
        { kind: "var", name: "presses", at: 19, equals: 3, label: "A long press of 8 ms counts once: 3", hint: "Update the remembered level on every pass, pressed or not." },
        { kind: "var", name: "presses", at: 26, equals: 4, label: "Fourth press: 4" },
        { kind: "led", led: "LED1", at: 4, on: true, label: "LED1 is on after the first press" },
        { kind: "led", led: "LED1", at: 10, on: false, label: "LED1 is off after the second press" },
        { kind: "steady", led: "LED1", from: 12.5, to: 23, on: true, label: "LED1 stays on during and after the long third press", hint: "Toggle in the same if that counts, so it happens once per press." },
        { kind: "led", led: "LED1", at: 26, on: false, label: "LED1 is off after the fourth press" },
      ],
      bonus: [
        {
          kind: "latency",
          led: "LED1",
          after: 12,
          withinUs: 1,
          label: "LED1 changes within 1 microsecond of the press",
          hint: "These buttons do not bounce, so no delay is needed anywhere.",
        },
      ],
      hints: [
        "Keep a variable with the level read on the previous pass. Start it at 1, the released level.",
        "A press is `now == 0 && last == 1`. Count and toggle inside that if.",
        "End every pass with `last = now;`, outside the if. Toggle with `GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;`",
      ],
      takeaway: "Levels tell you what is true now. Edges tell you what just happened. An edge is the level now compared with the level one pass ago.",
    },
    {
      id: "in-mask",
      tier: "practice",
      kind: "code",
      mode: "write",
      title: "One read per port",
      goal: "Write ReadSwitches() again, this time from whole-register reads with shifts and masks.",
      refs: [{ trm: "8.9.3" }, { trm: "8.3" }, { course: "HW1" }, { course: "Lab 2" }],
      brief: `
\`GpioDataRegs.GPEDAT.bit.GPIO157\` reads the whole 32-bit register and keeps one bit. Four such reads are four looks at the pins, at four slightly different times.

\`GpioDataRegs.GPEDAT.all\` gives you all 32 pins of port E from **one** look. The buttons sit at fixed places in it:

- Port E starts at GPIO128. GPIO157, 158 and 159 are bits **29**, **30** and **31** of \`GPEDAT\`.
- Port F starts at GPIO160. GPIO160 is bit **0** of \`GPFDAT\`.

## Your task
Write \`ReadSwitches()\` with the same result as before: bit 0 to bit 3 are 1 while push buttons 1 to 4 are pressed. This time:

- read \`GPEDAT.all\` once and \`GPFDAT.all\` once
- no \`.bit.\` reads of the button pins

Three tools do the work: \`~\` turns "pressed reads 0" into "pressed is 1", \`>>\` and \`<<\` move a bit to its place, and \`&\` keeps the bits you want.

Two warnings:

- The other pins of port E and port F float. Their bits are noise. Your mask must throw every one of them away.
- \`.all\` is 32 bits wide and an \`int\` on this chip is 16. Shift first, in 32 bits, then store the small result.
`,
      kit: "robot",
      durationMs: 14,
      watch: ["switches"],
      starter: `int16_t switches = 0;

int16_t ReadSwitches(void)
{
    int16_t value = 0;

    // Your code here: one read of GPEDAT.all, one read of GPFDAT.all

    return value;
}

void main(void)
{
${INIT}

${SETUP_BUTTONS}

    while (1) {
        switches = ReadSwitches();
    }
}
`,
      solution: `int16_t switches = 0;

int16_t ReadSwitches(void)
{
    // After the ~ a pressed button is 1
    Uint32 e = ~GpioDataRegs.GPEDAT.all;
    Uint32 f = ~GpioDataRegs.GPFDAT.all;

    // GPIO157 to GPIO159: bits 29 to 31 of port E, moved to bits 0 to 2.
    // GPIO160: bit 0 of port F, moved to bit 3.
    return (int16_t)(((e >> 29) & 0x7) | ((f & 0x1) << 3));
}

void main(void)
{
${INIT}

${SETUP_BUTTONS}

    while (1) {
        switches = ReadSwitches();
    }
}
`,
      stimuli: [
        { at: 2, press: "PB1" },
        { at: 4, press: "PB3" },
        { at: 6, press: "PB4" },
        { at: 8, release: "PB1" },
        { at: 10, press: "PB2" },
        { at: 12, release: "PB2" },
        { at: 12, release: "PB3" },
        { at: 12, release: "PB4" },
      ],
      checks: [
        { kind: "var", name: "switches", at: 1, equals: 0, label: "Nothing pressed: 0", hint: "Floating pins of the port read as noise. Mask them away: only bits 29 to 31 of port E and bit 0 of port F count." },
        { kind: "var", name: "switches", at: 3, equals: 1, label: "PB1 pressed: 0x1", hint: "GPIO157 is bit 29 of GPEDAT. Invert first: pressed reads 0." },
        { kind: "var", name: "switches", at: 5, equals: 5, label: "PB1 and PB3 pressed: 0x5" },
        { kind: "var", name: "switches", at: 7, equals: 13, label: "PB1, PB3 and PB4 pressed: 0xD", hint: "GPIO160 is bit 0 of GPFDAT. It must end up in bit 3." },
        { kind: "var", name: "switches", at: 9, equals: 12, label: "PB3 and PB4 pressed: 0xC" },
        { kind: "var", name: "switches", at: 11, equals: 14, label: "PB2, PB3 and PB4 pressed: 0xE" },
        { kind: "var", name: "switches", at: 13, equals: 0, label: "All released: 0 again" },
        {
          kind: "source",
          mustNotMatch: "DAT\\.bit\\.|GPIO_ReadPin",
          label: "The buttons are read through GPEDAT.all and GPFDAT.all only",
          hint: "No .bit read and no GPIO_ReadPin: take the whole register and pick the bits yourself.",
        },
      ],
      bonus: [
        {
          kind: "source",
          mustNotMatch: "\\bif\\b|\\?",
          label: "No if at all: shifts and masks only",
          hint: "Invert the register, shift bits 29 to 31 down to bits 0 to 2, and mask with 0x7.",
        },
      ],
      hints: [
        "Start with `Uint32 e = ~GpioDataRegs.GPEDAT.all;`. Now bit 29 of e is 1 while push button 1 is pressed.",
        "`(e >> 29) & 0x7` moves bits 29, 30 and 31 down to bits 0, 1 and 2 and drops everything else.",
        "Port F the same way: `(~GpioDataRegs.GPFDAT.all & 0x1) << 3`. OR the two parts together and return the result.",
      ],
      takeaway: "One .all read is a snapshot of 32 pins taken at one instant. Shifts and masks then pick out any group of pins, with no if in sight.",
    },
    {
      id: "in-debounce",
      tier: "expert",
      kind: "code",
      mode: "write",
      title: "Bouncing contacts",
      goal: "Count the real presses of a push button whose contacts bounce, and ignore noise spikes.",
      refs: [{ course: "HW4" }, { course: "Lab 2" }, { trm: "8.4.3" }],
      brief: `
A real push button is two pieces of metal. When they meet they **bounce**: the contact closes, opens and closes again several times before it settles. The same happens on release. HW4 warns about this for the buttons of your board. A fast loop sees every bounce as a press.

What this button does:

- When pressed or released, the contact bounces for **up to 1 ms**, then it is stable.
- A real press holds the contact closed for **at least 20 ms**. So does a real release.
- Now and then electrical noise pulls the pin low for **less than 0.5 ms**. That is not a press.

## Your task
- \`presses\` goes up by exactly 1 for every real press of push button 1.
- LED1 (GPIO22) changes state once per real press.
- A real press must be counted **within 12 ms** of the first contact.

The scope shows the bounce on GPIO157. Zoom in on a press.

You may use \`DELAY_US\`. Think about what your method does on a release, and on a noise spike, before you trust it.
`,
      kit: "robot",
      durationMs: 135,
      watch: ["presses"],
      starter: `int16_t presses = 0;

void main(void)
{
${INIT}

${out(22)}

${inp(157)}

    while (1) {
        // Count every real press of push button 1 once,
        // and toggle LED1 on each one
    }
}
`,
      solution: `int16_t presses = 0;

void main(void)
{
    int16_t raw = 1;
    int16_t state = 1;    // the debounced level: 1 = released
    int16_t differs = 0;  // samples in a row that disagree with state

${INIT}

${out(22)}

${inp(157)}

    while (1) {
        raw = GpioDataRegs.GPEDAT.bit.GPIO157;
        if (raw == state) {
            differs = 0;
        } else {
            differs++;
            // The new level held for 4 samples, 1 ms apart: accept it
            if (differs >= 4) {
                state = raw;
                differs = 0;
                if (state == 0) {
                    presses++;
                    GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
                }
            }
        }
        DELAY_US(1000);
    }
}
`,
      stimuli: [
        ...bouncyPress(5, "PB1"),
        ...bouncyRelease(30, "PB1"),
        ...tap(43, "PB1", 0.1),
        ...bouncyPress(50, "PB1"),
        ...bouncyRelease(75, "PB1"),
        ...tap(82, "PB1", 0.3),
        ...bouncyPress(95, "PB1"),
        ...bouncyRelease(120, "PB1"),
      ],
      checks: [
        { kind: "var", name: "presses", at: 17, equals: 1, label: "First press, 12 ms after first contact: presses is 1", hint: "More than 1: bounces are counted. 0: the method waits too long." },
        { kind: "var", name: "presses", at: 38, equals: 1, label: "After the first release: still 1", hint: "A release bounces too. Each bounce there looks like a new press to a fast loop." },
        { kind: "var", name: "presses", at: 48, equals: 1, label: "A 0.1 ms noise spike is not a press: still 1", hint: "Accept a new level only after it has stayed the same for longer than any bounce or spike." },
        { kind: "var", name: "presses", at: 62, equals: 2, label: "Second press: 2" },
        { kind: "var", name: "presses", at: 93, equals: 2, label: "A 0.3 ms noise spike is not a press: still 2" },
        { kind: "var", name: "presses", at: 107, equals: 3, label: "Third press: 3" },
        { kind: "var", name: "presses", at: 134, equals: 3, label: "At the end: exactly 3 presses" },
        { kind: "led", led: "LED1", at: 17, on: true, label: "LED1 is on after the first press" },
        { kind: "steady", led: "LED1", from: 17, to: 49, on: true, label: "LED1 does not change during the release or the noise spike" },
        { kind: "led", led: "LED1", at: 62, on: false, label: "LED1 is off after the second press" },
        { kind: "led", led: "LED1", at: 107, on: true, label: "LED1 is on after the third press" },
        { kind: "reg", reg: "GpioCtrlRegs.GPEPUD", field: "GPIO157", equals: 0, label: "The pull-up of GPIO157 is enabled" },
      ],
      bonus: [
        {
          kind: "var",
          name: "presses",
          at: 102,
          equals: 3,
          label: "Quick: the third press is counted within 7 ms of first contact",
          hint: "Sample more often than every few milliseconds, and accept a level once it has been stable for a little longer than the 1 ms of bounce.",
        },
      ],
      hints: [
        "Counting on a falling edge and then waiting 10 ms survives the bounce of a press. It does not survive the bounce of a release, or a noise spike.",
        "Keep a debounced state of your own. Sample the pin every 1 ms. Count how many samples in a row disagree with your state.",
        "When 4 samples in a row disagree, the pin has really changed: copy the new level into your state. If the new state is 0, that is one press.",
      ],
      takeaway: "Debouncing is a decision about time: a level is real once it has lasted longer than any bounce. The chip's own input qualification (TRM 8.4.3) looks at 6 samples at most 2.55 us apart, a window of about 13 us. That removes glitches, not milliseconds of bounce, so buttons are debounced in software.",
    },
    {
      id: "in-lock",
      tier: "expert",
      kind: "code",
      mode: "write",
      title: "Combination lock",
      goal: "Unlock LED5 when the push buttons are pressed in the order 3, 1, 4.",
      refs: [{ course: "Lab 2" }, { course: "HW1" }, { trm: "8.3" }],
      brief: `
Build a lock with the code **PB3, PB1, PB4**. The program keeps track of how many presses of the code are right so far.

## Rules
1. Only a **new press** counts: a button going from released to pressed. Holding a button counts once. Releasing a button counts for nothing.
2. The right button for the current position moves the lock one step forward.
3. A wrong button sends the lock back to the start. One exception: if the wrong button is **PB3**, it is the first button of a new try, so the lock goes to step 1.
4. After the third right press the lock is **unlocked**. It stays unlocked until the next press of any button. That press locks it again and counts for nothing else.
5. Buttons may overlap: the next button can go down while the one before is still held.

## Display
- **LED1** (GPIO22): lit when one or two presses are right so far
- **LED2** (GPIO94): lit when two presses are right so far
- **LED5** (GPIO111): lit while unlocked. LED1 and LED2 are off then.

The set-up and \`ReadSwitches()\` are given. The buttons in this level do not bounce, and two buttons never go down at the same instant.
`,
      kit: "robot",
      durationMs: 56,
      starter: `${READ_SWITCHES}

void main(void)
{
${INIT}

${out(22)}
${out(94)}
${out(111)}

${SETUP_BUTTONS}

    while (1) {
        // The lock: PB3, then PB1, then PB4
    }
}
`,
      solution: `${READ_SWITCHES}

// The code as ReadSwitches() bits: PB3, then PB1, then PB4
int16_t code[3] = {0x4, 0x1, 0x8};
int16_t step = 0;   // right presses so far; 3 = unlocked

void ShowStep(void)
{
    if (step == 1 || step == 2) {
        GpioDataRegs.GPASET.bit.GPIO22 = 1;
    } else {
        GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
    }
    if (step == 2) {
        GpioDataRegs.GPCSET.bit.GPIO94 = 1;
    } else {
        GpioDataRegs.GPCCLEAR.bit.GPIO94 = 1;
    }
    if (step == 3) {
        GpioDataRegs.GPDSET.bit.GPIO111 = 1;
    } else {
        GpioDataRegs.GPDCLEAR.bit.GPIO111 = 1;
    }
}

void main(void)
{
    int16_t now = 0;
    int16_t last = 0;
    int16_t pressed = 0;

${INIT}

${out(22)}
${out(94)}
${out(111)}

${SETUP_BUTTONS}

    while (1) {
        now = ReadSwitches();
        pressed = now & ~last;   // buttons that went down since the last pass
        last = now;
        if (pressed != 0) {
            if (step == 3) {
                step = 0;                    // unlocked: any press locks
            } else if (pressed == code[step]) {
                step++;                      // right button
            } else if (pressed == code[0]) {
                step = 1;                    // wrong, but it starts a new try
            } else {
                step = 0;                    // wrong
            }
            ShowStep();
        }
    }
}
`,
      stimuli: [
        ...tap(2, "PB1"),
        ...tap(5, "PB3"),
        ...tap(8, "PB1"),
        ...tap(11, "PB2"),
        ...tap(14, "PB3"),
        ...tap(17, "PB3"),
        ...tap(20, "PB1"),
        ...tap(23, "PB3"),
        ...tap(26, "PB1", 7),
        ...tap(29, "PB4", 2),
        ...tap(37, "PB2"),
        ...tap(41, "PB4"),
        ...tap(44, "PB3"),
        ...tap(47, "PB1"),
        { at: 50, press: "PB4" },
      ],
      checks: [
        { kind: "led", led: "LED1", at: 4, on: false, label: "PB1 first is wrong: LED1 stays off" },
        { kind: "led", led: "LED1", at: 7, on: true, label: "PB3: one right, LED1 is on", hint: "Releasing PB3 must not change anything. Only presses count." },
        { kind: "led", led: "LED2", at: 10, on: true, label: "PB3, PB1: two right, LED2 is on" },
        { kind: "led", led: "LED1", at: 10, on: true, label: "PB3, PB1: LED1 is still on" },
        { kind: "led", led: "LED1", at: 13, on: false, label: "Then PB2 is wrong: back to the start, LED1 is off" },
        { kind: "led", led: "LED2", at: 13, on: false, label: "Then PB2 is wrong: LED2 is off" },
        { kind: "led", led: "LED1", at: 19, on: true, label: "PB3, PB3: the second PB3 starts a new try, LED1 is on", hint: "Rule 3: a wrong press of PB3 goes to step 1, not to the start." },
        { kind: "led", led: "LED2", at: 19, on: false, label: "PB3, PB3: LED2 is off" },
        { kind: "led", led: "LED2", at: 22, on: true, label: "PB3, PB3, PB1: two right, LED2 is on" },
        { kind: "led", led: "LED2", at: 25, on: false, label: "Then PB3 instead of PB4: back to one right, LED2 is off" },
        { kind: "led", led: "LED1", at: 25, on: true, label: "Then PB3 instead of PB4: LED1 is on" },
        { kind: "steady", led: "LED2", from: 26.5, to: 28.9, on: true, label: "PB1 held down: counted once, LED2 stays on", hint: "A held button must count once. Compare the buttons with what they were on the pass before." },
        { kind: "led", led: "LED5", at: 30, on: true, label: "PB4 pressed while PB1 is still held: unlocked, LED5 is on", hint: "With PB1 still down, ReadSwitches() returns 0x9, not 0x8. Look at which bit is new." },
        { kind: "led", led: "LED1", at: 30, on: false, label: "Unlocked: LED1 is off" },
        { kind: "steady", led: "LED5", from: 30, to: 36.9, on: true, label: "Releasing PB4 and PB1 keeps it unlocked", hint: "A release is not a press." },
        { kind: "led", led: "LED5", at: 39, on: false, label: "The next press (PB2) locks it again" },
        { kind: "led", led: "LED1", at: 43, on: false, label: "PB4 first is wrong: LED1 stays off" },
        { kind: "led", led: "LED5", at: 49, on: false, label: "PB3, PB1: not unlocked yet" },
        { kind: "led", led: "LED5", at: 52, on: true, label: "PB3, PB1, PB4: unlocked" },
        { kind: "steady", led: "LED5", from: 51, to: 55.5, on: true, label: "Holding PB4 keeps it unlocked", hint: "A held button is not a new press." },
        { kind: "no-dat-write", label: "LEDs are changed through SET and CLEAR, not DAT" },
      ],
      bonus: [
        {
          kind: "latency",
          led: "LED5",
          after: 50,
          withinUs: 3,
          label: "LED5 lights within 3 microseconds of the last press",
          hint: "No delays: these buttons do not bounce. Keep the work per pass small.",
        },
        {
          kind: "max-lines",
          max: 80,
          label: "Compact: 80 lines of code or fewer",
          hint: "Keep the code in an array and the position in one variable. One test then serves every step.",
        },
      ],
      hints: [
        "Find the new presses of all four buttons in one line: `pressed = now & ~last;`, with `now = ReadSwitches();` and `last` the value from the pass before.",
        "Keep one variable for the position, 0 to 3. Act only on passes where `pressed != 0`.",
        "Order the tests: unlocked first (any press locks), then the right button (`pressed == code[step]`), then PB3 (step = 1), otherwise step = 0. Update the three LEDs from the step.",
      ],
      takeaway: "`now & ~last` finds the falling edges of every button at once. The rest is a state machine: one variable for where you are, and for each event a rule for where to go next.",
    },
    {
      id: "in-bare",
      tier: "expert",
      kind: "code",
      mode: "write",
      title: "Bare registers",
      goal: "Show the four push buttons on LED1 to LED4 with no GPIO helper function: registers only.",
      refs: [{ trm: "8.9.2" }, { trm: "8.9.3" }, { trm: "8.8" }, { trm: "8.3" }, { course: "Lab 2" }],
      brief: `
Same job as the checkpoint: each of LED1 to LED4 is lit while its push button is pressed. This time \`GPIO_SetupPinMux\`, \`GPIO_SetupPinOptions\`, \`GPIO_ReadPin\` and \`GPIO_WritePin\` are off the table. You write the registers they would have written.

After \`InitGpio()\` every pin is a GPIO (mux 0), an input (\`GPxDIR\` bit 0), with its pull-up off (\`GPxPUD\` bit 1).

The pins:

- LED1 to LED4: GPIO22, GPIO94, GPIO95, GPIO97
- push buttons 1 to 4: GPIO157, GPIO158, GPIO159, GPIO160

Work out the port and the bit number of each one. A port holds 32 pins: port A starts at GPIO0, B at 32, C at 64, D at 96, E at 128, F at 160.

## Requirements
- Change **only the bits of these eight pins** in \`GPxDIR\` and \`GPxPUD\`. The checks compare whole registers.
- The control registers are protected. See what the simulator says if you forget.
- No button pin may ever be an output.
- LEDs change through \`GPxSET\` and \`GPxCLEAR\`.
`,
      kit: "robot",
      durationMs: 14,
      inspect: ["GpioCtrlRegs.GPEPUD", "GpioCtrlRegs.GPFPUD", "GpioCtrlRegs.GPADIR", "GpioCtrlRegs.GPCDIR", "GpioCtrlRegs.GPDDIR"],
      starter: `void main(void)
{
${INIT}

    // Directions and pull-ups, written straight to the registers

    while (1) {
        // Show the buttons on the LEDs
    }
}
`,
      solution: `void main(void)
{
    Uint32 e = 0;   // port E inverted: 1 = pressed
    Uint32 f = 0;   // port F inverted

${INIT}

    EALLOW;
    GpioCtrlRegs.GPADIR.all |= 0x00400000;    // GPIO22: bit 22 of port A
    GpioCtrlRegs.GPCDIR.all |= 0xC0000000;    // GPIO94, GPIO95: bits 30, 31 of port C
    GpioCtrlRegs.GPDDIR.all |= 0x00000002;    // GPIO97: bit 1 of port D
    GpioCtrlRegs.GPEPUD.all &= ~0xE0000000;   // GPIO157 to 159: bits 29 to 31 of port E
    GpioCtrlRegs.GPFPUD.all &= ~0x00000001;   // GPIO160: bit 0 of port F
    EDIS;

    while (1) {
        e = ~GpioDataRegs.GPEDAT.all;
        f = ~GpioDataRegs.GPFDAT.all;

        // PB1 (bit 29 of E) to LED1 (bit 22 of A): shift right by 7
        GpioDataRegs.GPASET.all = (e >> 7) & 0x00400000;
        GpioDataRegs.GPACLEAR.all = (~e >> 7) & 0x00400000;

        // PB2, PB3 (bits 30, 31 of E) to LED2, LED3 (bits 30, 31 of C)
        GpioDataRegs.GPCSET.all = e & 0xC0000000;
        GpioDataRegs.GPCCLEAR.all = ~e & 0xC0000000;

        // PB4 (bit 0 of F) to LED4 (bit 1 of D): shift left by 1
        GpioDataRegs.GPDSET.all = (f << 1) & 0x00000002;
        GpioDataRegs.GPDCLEAR.all = (~f << 1) & 0x00000002;
    }
}
`,
      stimuli: [
        { at: 2, press: "PB1" },
        { at: 4, press: "PB3" },
        { at: 6, press: "PB4" },
        { at: 8, release: "PB1" },
        { at: 10, press: "PB2" },
        { at: 12, release: "PB2" },
        { at: 12, release: "PB3" },
        { at: 12, release: "PB4" },
      ],
      checks: [
        { kind: "steady", led: "LED1", from: 0.5, to: 1.9, on: false, label: "Nothing pressed: LED1 stays off", hint: "A flickering LED means its button pin floats. To enable a pull-up, clear its GPxPUD bit." },
        { kind: "steady", led: "LED4", from: 0.5, to: 1.9, on: false, label: "Nothing pressed: LED4 stays off", hint: "GPIO160 is bit 0 of port F: GPFPUD and GPFDAT." },
        { kind: "led", led: "LED1", at: 3, on: true, label: "PB1 pressed: LED1 is on", hint: "GPIO22 is bit 22 of port A. GPIO157 is bit 29 of port E." },
        { kind: "led", led: "LED2", at: 3, on: false, label: "PB1 pressed: LED2 is still off" },
        { kind: "led", led: "LED3", at: 5, on: true, label: "PB1 and PB3 pressed: LED3 is on", hint: "GPIO95 is bit 31 of port C. GPIO159 is bit 31 of port E." },
        { kind: "led", led: "LED4", at: 7, on: true, label: "PB4 pressed as well: LED4 is on", hint: "GPIO97 is bit 1 of port D, not bit 0." },
        { kind: "led", led: "LED1", at: 9, on: false, label: "PB1 released: LED1 goes off" },
        { kind: "led", led: "LED3", at: 9, on: true, label: "PB1 released: LED3 stays on" },
        { kind: "led", led: "LED2", at: 11, on: true, label: "PB2 pressed: LED2 is on" },
        { kind: "led", led: "LED2", at: 13, on: false, label: "All released: LED2 is off" },
        { kind: "led", led: "LED4", at: 13, on: false, label: "All released: LED4 is off" },
        { kind: "reg", reg: "GpioCtrlRegs.GPEPUD", equals: 0x1fffffff, label: "GPEPUD is 0x1FFFFFFF: only the pull-ups of GPIO157 to GPIO159 are enabled", hint: "Clear bits 29 to 31 and keep the rest: use &= with an inverted mask, not a plain assignment." },
        { kind: "reg", reg: "GpioCtrlRegs.GPFPUD", field: "GPIO160", equals: 0, label: "The pull-up of GPIO160 is enabled" },
        { kind: "reg", reg: "GpioCtrlRegs.GPFPUD", field: "GPIO161", equals: 1, label: "The pull-up of GPIO161 is still disabled", hint: "Change bit 0 of GPFPUD only." },
        { kind: "reg", reg: "GpioCtrlRegs.GPADIR", equals: 0x00400000, label: "GPADIR is 0x00400000: only GPIO22 is an output" },
        { kind: "reg", reg: "GpioCtrlRegs.GPCDIR", equals: 0xc0000000, label: "GPCDIR is 0xC0000000: only GPIO94 and GPIO95 are outputs" },
        { kind: "reg", reg: "GpioCtrlRegs.GPDDIR", equals: 0x00000002, label: "GPDDIR is 0x00000002: only GPIO97 is an output" },
        { kind: "reg", reg: "GpioCtrlRegs.GPEDIR", equals: 0, label: "No pin of port E is an output" },
        { kind: "no-diagnostic", code: "eallow", label: "Every protected write is between EALLOW and EDIS" },
        { kind: "no-diagnostic", code: "short", label: "No button pin is driven as an output" },
        { kind: "no-dat-write", label: "LEDs are changed through SET and CLEAR, not DAT" },
        { kind: "source", mustNotMatch: "GPIO_\\w+\\s*\\(", label: "No GPIO_ helper function is called" },
      ],
      bonus: [
        {
          kind: "source",
          mustNotMatch: "\\.bit\\.",
          label: "Whole registers only: no .bit anywhere, every access through .all",
          hint: "Build each mask from the bit number: bit 22 is 0x00400000, bits 30 and 31 are 0xC0000000.",
        },
        {
          kind: "source",
          mustNotMatch: "\\bif\\b|\\?",
          label: "No if in the program: masks move the button bits straight to the LED bits",
          hint: "Writing 0 to a SET or CLEAR bit does nothing. So write (pressed bits, moved into place) to SET and (released bits, moved into place) to CLEAR.",
        },
      ],
      hints: [
        "Bit number = pin number minus the first pin of its port. GPIO94 is 94 - 64 = bit 30 of port C. GPIO157 is 157 - 128 = bit 29 of port E.",
        "Between EALLOW and EDIS: set the DIR bits of the four LEDs (for example `GpioCtrlRegs.GPADIR.all |= 0x00400000;`) and clear the PUD bits of the four buttons (`GpioCtrlRegs.GPEPUD.all &= ~0xE0000000;`).",
        "Look at where the bits sit. GPIO158 and GPIO159 are bits 30 and 31 of port E. GPIO94 and GPIO95 are bits 30 and 31 of port C. Inverted button bits can go to GPCSET with one mask and no shift.",
      ],
      takeaway: "The helper functions are these same register writes with the arithmetic hidden. Knowing the port, the bit and the polarity of a pin is all there is underneath.",
    },
  ],
};
