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
      goal: "Learn why an input needs a pull-up and what a push button makes the pin read.",
      refs: [{ course: "L3" }, { course: "Lab 2" }, { trm: "8.2" }, { trm: "8.8" }, { trm: "8.9" }],
      brief: `
An **input** pin does not drive anything. It only reports the voltage that the circuit outside puts on it: near 3.3 V reads as 1, near 0 V reads as 0.

## Floating inputs
If nothing outside drives the pin, its voltage is not defined. The pin is **floating**: it picks up electrical noise and reads 0 or 1 at random. A push button on its own has this problem. Pressed, it connects the pin to something. Released, it connects the pin to nothing.

## The pull-up resistor
A **pull-up** is a resistor between the pin and 3.3 V. It is weak: it holds the pin at 1 when nothing else drives it, and anything stronger wins. The chip has one built into every pin. You switch it on per pin.

The control register is \`GPxPUD\`, "pull-up **disable**", so the logic is upside down:

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
- pressed: the button connects the pin to ground and wins over the weak pull-up. It reads **0**.

So a pressed button reads 0. That feels backwards the first time.

## Reading the level
Read the pin from the data register of its port:
\`\`\`c
if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) {
    // push button 1 is pressed
}
\`\`\`
The push buttons are on GPIO157, 158, 159 and 160. The first three are in port E (\`GPEDAT\`). GPIO160 is the first pin of port F (\`GPFDAT\`).
`,
      questions: [
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
      takeaway: "Input + pull-up + button to ground: 1 when released, 0 when pressed. Read it from GPxDAT of the right port.",
    },
    {
      id: "in-wiring",
      kind: "wiring",
      title: "A level in both positions",
      goal: "Wire the pull-up and the push button so the pin never floats.",
      refs: [{ course: "L3" }, { course: "Lab 2" }, { trm: "8.8" }],
      brief: `
The pin must have a defined level when the button is released **and** when it is pressed.

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
\`GpioCtrlRegs.GPEPUD\` has one bit per pin of port E, GPIO128 to GPIO159. It is a pull-up **disable** register:

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
2. In the loop, read the button again and again. This is called **polling**. Turn LED1 on while the button is pressed and off while it is released.

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

Remember what a released button does: it connects the pin to nothing. Something else has to hold the pin at 1 then. If nothing does, the pin floats and every read is a coin toss.

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
Lab 2 asks for a worker function \`int16_t ReadSwitches(void)\`. It returns one number whose lowest four bits show the four push buttons:

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
      hints: [
        "Set-up: four times the output pair of calls (22, 94, 95, 97), four times the input pair with GPIO_PULLUP (157 to 160).",
        "Ports: GPIO22 is A, GPIO94 and GPIO95 are C, GPIO97 is D. Buttons 1 to 3 are read from GPEDAT, button 4 from GPFDAT.",
        "In the loop: `SetLEDsOnOff(ReadSwitches());`. In SetLEDsOnOff, for each LED: `if ((LEDvalue & 0x1) == 0x1) { SET } else { CLEAR }`.",
      ],
      takeaway: "Read all inputs into one value, then act on that value. In Lab 2 the same two functions are called from a timer interrupt instead of a busy loop.",
    },
  ],
};
