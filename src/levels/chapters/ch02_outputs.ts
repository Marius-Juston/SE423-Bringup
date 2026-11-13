import type { Chapter } from "../types";

const INIT = `    InitSysCtrl();
    InitGpio();`;

const out = (pin: number) => `    GPIO_SetupPinMux(${pin}, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(${pin}, GPIO_OUTPUT, GPIO_PUSHPULL);`;

export const ch02: Chapter = {
  id: "outputs",
  number: 2,
  title: "Digital outputs",
  blurb: "Pin mux, direction, and SET / CLEAR / TOGGLE. Turn LEDs on and off.",
  requires: ["registers"],
  course: ["L3", "Lab 1", "Lab 2", "HW1"],
  levels: [
    {
      id: "out-brief",
      kind: "brief",
      title: "What it takes to drive a pin",
      goal: "Learn the three things a pin needs before it can light an LED.",
      refs: [{ course: "L3" }, { trm: "8.2" }, { trm: "8.3" }, { trm: "8.7" }],
      brief: `
The chip has 169 GPIO signals, GPIO0 to GPIO168, grouped in ports of 32:

- port **A**: GPIO0 to 31
- port **B**: GPIO32 to 63
- port **C**: GPIO64 to 95
- port **D**: GPIO96 to 127
- port **E**: GPIO128 to 159
- port **F**: GPIO160 to 168

The port letter appears in every register name: GPIO94 is controlled through \`GPC...\` registers.

## Three settings per pin
1. **Mux**: each pin can be a plain GPIO or one of several peripheral signals (PWM, serial, SPI...). Mux position 0 is plain GPIO.
2. **Direction**: input (0, the reset state) or output (1), in the \`GPxDIR\` register.
3. **Output level**: the value the pin drives when it is an output.

The course code sets the first two with TI's helper functions:
\`\`\`c
GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);                // GPIO22 is a plain GPIO
GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);  // and an output
\`\`\`

## Changing the level: SET, CLEAR, TOGGLE
\`\`\`c
GpioDataRegs.GPASET.bit.GPIO22 = 1;     // drive high
GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;   // drive low
GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;  // flip
\`\`\`
You always write a **1**: to the SET register to go high, to the CLEAR register to go low. Writing 0 to these registers does nothing.

\`GPxDAT\` can also be written, but avoid it for outputs: it reads the pins, so changing one bit rewrites the whole port from a reading that may be slightly out of date. A later level shows the damage.

## Lit by a 1 or by a 0?
An output pin is 3.3 V when high and 0 V when low. The LEDs on the green robot board light when the pin is **high**. The two LEDs on the LaunchPad itself (blue on GPIO31, red on GPIO34) are wired the other way round and light when the pin is **low**.
`,
      questions: [
        {
          prompt: "Which register drives GPIO97 high?",
          options: ["`GpioDataRegs.GPASET`", "`GpioDataRegs.GPCSET`", "`GpioDataRegs.GPDSET`", "`GpioDataRegs.GPESET`"],
          answer: 2,
          why: "GPIO96 to GPIO127 are port D.",
        },
        {
          prompt: "GPIO22 is an output and currently high. What does `GpioDataRegs.GPASET.bit.GPIO22 = 0;` do?",
          options: ["Drives the pin low", "Nothing", "Toggles the pin", "Makes the pin an input"],
          answer: 1,
          why: "Writing 0 to a SET register has no effect. To drive the pin low, write 1 to GPACLEAR.",
        },
        {
          prompt: "The LaunchPad's red LED (GPIO34) lights when its pin is low. Which line turns it **on**?",
          options: ["`GpioDataRegs.GPBSET.bit.GPIO34 = 1;`", "`GpioDataRegs.GPBCLEAR.bit.GPIO34 = 1;`", "`GpioDataRegs.GPASET.bit.GPIO34 = 1;`", "`GpioDataRegs.GPBCLEAR.bit.GPIO34 = 0;`"],
          answer: 1,
          why: "CLEAR drives the pin low, and low lights this LED. GPIO34 is in port B.",
        },
      ],
      takeaway: "Mux to GPIO, direction to output, then write 1 to SET, CLEAR or TOGGLE in the right port.",
    },
    {
      id: "out-ports",
      kind: "quiz",
      title: "Which port?",
      goal: "Match the robot board's LEDs and buttons to their ports.",
      refs: [{ course: "Lab 1" }, { course: "Lab 2" }, { trm: "8.9" }],
      brief: `
Lab 1 asks which registers drive the LEDs on the robot board. Divide the GPIO number by 32 and drop the remainder: 0 is port A, 1 is B, 2 is C, 3 is D, 4 is E, 5 is F.

The robot board's LEDs are on GPIO22, 94, 95, 97 and 111. Its push buttons are on GPIO157, 158, 159 and 160.
`,
      questions: [
        { prompt: "LED2 is on **GPIO94**. Which port?", options: ["B", "C", "D", "E"], answer: 1, why: "94 / 32 = 2 remainder 30: port C, bit 30." },
        { prompt: "LED5 is on **GPIO111**. Which port?", options: ["B", "C", "D", "E"], answer: 2, why: "111 / 32 = 3 remainder 15: port D, bit 15." },
        { prompt: "Push button 3 is on **GPIO159**. Which register do you read?", options: ["`GPDDAT`", "`GPEDAT`", "`GPFDAT`", "`GPADAT`"], answer: 1, why: "159 / 32 = 4 remainder 31: the last pin of port E." },
        { prompt: "Push button 4 is on **GPIO160**. Which register do you read?", options: ["`GPDDAT`", "`GPEDAT`", "`GPFDAT`", "`GPADAT`"], answer: 2, why: "160 / 32 = 5: the first pin of port F. Buttons 1 to 3 and button 4 are in different registers." },
      ],
      hints: ["Integer-divide the GPIO number by 32.", "0 to 31 is A, 32 to 63 is B, 64 to 95 is C, 96 to 127 is D, 128 to 159 is E, 160 and up is F."],
    },
    {
      id: "out-dir",
      kind: "register",
      title: "Make two pins outputs",
      goal: "Set the direction register so GPIO22 and GPIO31 are outputs.",
      refs: [{ trm: "8.9" }, { course: "L3" }],
      brief: `
\`GpioCtrlRegs.GPADIR\` has one bit per pin of port A: 0 = input, 1 = output. After reset every pin is an input.

Make **GPIO22** (LED1) and **GPIO31** (the LaunchPad's blue LED) outputs. Leave all other pins as inputs.
`,
      reg: "GpioCtrlRegs.GPADIR",
      initial: 0,
      targets: [
        { field: "GPIO22", value: 1 },
        { field: "GPIO31", value: 1 },
      ],
      code: "EALLOW;\nGpioCtrlRegs.GPADIR.bit.GPIO22 = 1;\nGpioCtrlRegs.GPADIR.bit.GPIO31 = 1;\nEDIS;\n// or in one write: GpioCtrlRegs.GPADIR.all = 0x80400000;",
      hints: ["The bit number is the GPIO number, because this is port A.", "Switch on bit 31 and bit 22.", "The value is 0x80400000."],
      takeaway: "GPIO_SetupPinOptions(pin, GPIO_OUTPUT, ...) sets exactly this bit for you, inside EALLOW ... EDIS.",
    },
    {
      id: "out-first-light",
      kind: "code",
      mode: "complete",
      title: "First light",
      goal: "Set up GPIO22 as an output and turn LED1 on.",
      refs: [{ course: "Lab 1" }, { course: "L3" }, { trm: "8.7" }],
      brief: `
LED1 on the robot board is connected to **GPIO22** and lights when the pin is high.

Three steps, each one line:
1. Select the GPIO function: \`GPIO_SetupPinMux(pin, GPIO_MUX_CPU1, 0);\`
2. Make the pin a push-pull output: \`GPIO_SetupPinOptions(pin, GPIO_OUTPUT, GPIO_PUSHPULL);\`
3. Drive it high through the SET register of its port.

Press **Run** to watch the board, and **Run tests** when the LED is on.
`,
      kit: "robot",
      durationMs: 2,
      starter: `void main(void)
{
${INIT}

    // TODO 1: select the GPIO function for pin 22

    // TODO 2: make pin 22 an output

    // TODO 3: drive GPIO22 high

    while (1) {}
}
`,
      solution: `void main(void)
{
${INIT}

${out(22)}

    GpioDataRegs.GPASET.bit.GPIO22 = 1;

    while (1) {}
}
`,
      checks: [
        { kind: "led", led: "LED1", at: 1.5, on: true, label: "LED1 is on" },
        { kind: "reg", reg: "GpioCtrlRegs.GPADIR", field: "GPIO22", equals: 1, label: "GPIO22 is an output" },
        { kind: "no-dat-write", label: "The pin is driven through SET, not DAT" },
      ],
      hints: [
        "Copy the two helper calls from the briefing with pin 22.",
        "GPIO22 is in port A, so the register is GpioDataRegs.GPASET.",
        "`GpioDataRegs.GPASET.bit.GPIO22 = 1;`",
      ],
    },
    {
      id: "out-pattern",
      kind: "code",
      mode: "write",
      title: "Every other LED",
      goal: "Light LED1, LED3 and LED5, and keep LED2 and LED4 dark.",
      refs: [{ course: "Lab 1" }, { course: "Lab 2" }, { course: "HW1" }],
      brief: `
The robot board's five LEDs:

- LED1: GPIO22
- LED2: GPIO94
- LED3: GPIO95
- LED4: GPIO97
- LED5: GPIO111

Set up **all five** as outputs. Turn LED1, LED3 and LED5 on. Make sure LED2 and LED4 are off: drive them low on purpose instead of relying on how they happen to start.

Watch the port letters. These five pins are in three different ports.
`,
      kit: "robot",
      durationMs: 2,
      starter: `void main(void)
{
${INIT}

    // Your code here

    while (1) {}
}
`,
      solution: `void main(void)
{
${INIT}

${out(22)}
${out(94)}
${out(95)}
${out(97)}
${out(111)}

    GpioDataRegs.GPASET.bit.GPIO22 = 1;
    GpioDataRegs.GPCCLEAR.bit.GPIO94 = 1;
    GpioDataRegs.GPCSET.bit.GPIO95 = 1;
    GpioDataRegs.GPDCLEAR.bit.GPIO97 = 1;
    GpioDataRegs.GPDSET.bit.GPIO111 = 1;

    while (1) {}
}
`,
      checks: [
        { kind: "led", led: "LED1", at: 1.5, on: true, label: "LED1 is on" },
        { kind: "pin", pin: 94, at: 1.5, level: 0, label: "LED2 is driven low (off)", hint: "LED2 must be an output that is driving low, not an input left alone." },
        { kind: "led", led: "LED3", at: 1.5, on: true, label: "LED3 is on" },
        { kind: "pin", pin: 97, at: 1.5, level: 0, label: "LED4 is driven low (off)" },
        { kind: "led", led: "LED5", at: 1.5, on: true, label: "LED5 is on" },
        { kind: "reg", reg: "GpioCtrlRegs.GPCDIR", field: "GPIO94", equals: 1, label: "LED2's pin is an output" },
        { kind: "reg", reg: "GpioCtrlRegs.GPDDIR", field: "GPIO97", equals: 1, label: "LED4's pin is an output" },
        { kind: "no-dat-write", label: "Outputs are changed through SET and CLEAR" },
      ],
      hints: [
        "Each LED needs GPIO_SetupPinMux and GPIO_SetupPinOptions, then one write to a SET or CLEAR register.",
        "GPIO22 is port A. GPIO94 and GPIO95 are port C. GPIO97 and GPIO111 are port D.",
        "For example: `GpioDataRegs.GPCCLEAR.bit.GPIO94 = 1;` and `GpioDataRegs.GPDSET.bit.GPIO111 = 1;`",
      ],
    },
    {
      id: "out-active-low",
      kind: "code",
      mode: "debug",
      title: "On means low",
      goal: "The LaunchPad's red LED should be on and the blue one off. Fix the code.",
      refs: [{ course: "Lab 1" }, { course: "L3" }],
      brief: `
The author of this program wanted the **red** LaunchPad LED on and the **blue** one off. It does the opposite.

The LaunchPad's own LEDs are connected between 3.3 V and the pin, so current flows, and the LED lights, when the pin is **low**.

- Blue LED: GPIO31 (port A)
- Red LED: GPIO34 (port B)

Fix the two lines that set the levels.
`,
      kit: "launchpad",
      durationMs: 2,
      starter: `void main(void)
{
${INIT}

${out(31)}
${out(34)}

    // Red LED on
    GpioDataRegs.GPBSET.bit.GPIO34 = 1;

    // Blue LED off
    GpioDataRegs.GPACLEAR.bit.GPIO31 = 1;

    while (1) {}
}
`,
      solution: `void main(void)
{
${INIT}

${out(31)}
${out(34)}

    // Red LED on: this LED lights when the pin is low
    GpioDataRegs.GPBCLEAR.bit.GPIO34 = 1;

    // Blue LED off: high
    GpioDataRegs.GPASET.bit.GPIO31 = 1;

    while (1) {}
}
`,
      checks: [
        { kind: "led", led: "RED", at: 1.5, on: true, label: "The red LED is on" },
        { kind: "led", led: "BLUE", at: 1.5, on: false, label: "The blue LED is off" },
        { kind: "pin", pin: 31, at: 1.5, level: 1, label: "GPIO31 is driven high" },
      ],
      hints: [
        "For these two LEDs, a low pin means on and a high pin means off.",
        "CLEAR drives a pin low; SET drives it high. Swap them.",
        "Red on: `GpioDataRegs.GPBCLEAR.bit.GPIO34 = 1;`. Blue off: `GpioDataRegs.GPASET.bit.GPIO31 = 1;`",
      ],
      takeaway: "Whether 1 means on depends on how the LED is wired. This is why the starter code turns the LaunchPad LEDs off with SET.",
    },
    {
      id: "out-dat",
      kind: "code",
      mode: "debug",
      title: "The change that vanished",
      goal: "LED1 should be on and the blue LED should be on. One of them is not. Fix it the right way.",
      refs: [{ trm: "8.3" }, { course: "L2" }, { course: "Lab 2" }],
      brief: `
This program changes two pins of port A through the data register \`GPADAT\`, one after the other. Only the second change survives.

Why: a \`.bit\` write cannot change one bit on its own. The CPU **reads** the whole register, changes one bit, and **writes** the whole register back. \`GPADAT\` reads the actual pin levels, and a pin needs a moment to follow a change. The second statement reads port A while GPIO22 still shows its old level, and writes that old level back.

The reference manual describes this exact case in section 8.3 and gives the fix: use \`GPASET\`, \`GPACLEAR\` and \`GPATOGGLE\`. They change only the bits you write as 1, with no read first.

Remember the blue LaunchPad LED lights when its pin is **low**.
`,
      kit: "robot",
      durationMs: 2,
      starter: `void main(void)
{
${INIT}

${out(22)}
${out(31)}
    GpioDataRegs.GPASET.bit.GPIO31 = 1;     // blue LED off to start with
    DELAY_US(100);

    // LED1 on
    GpioDataRegs.GPADAT.bit.GPIO22 = 1;

    // Blue LED on (it lights when the pin is low)
    GpioDataRegs.GPADAT.bit.GPIO31 = 0;

    while (1) {}
}
`,
      solution: `void main(void)
{
${INIT}

${out(22)}
${out(31)}
    GpioDataRegs.GPASET.bit.GPIO31 = 1;     // blue LED off to start with
    DELAY_US(100);

    // LED1 on
    GpioDataRegs.GPASET.bit.GPIO22 = 1;

    // Blue LED on (it lights when the pin is low)
    GpioDataRegs.GPACLEAR.bit.GPIO31 = 1;

    while (1) {}
}
`,
      checks: [
        { kind: "led", led: "LED1", at: 1.5, on: true, label: "LED1 is on" },
        { kind: "led", led: "BLUE", at: 1.5, on: true, label: "The blue LED is on" },
        { kind: "no-dat-write", label: "No output is changed through GPADAT" },
      ],
      hints: [
        "Putting a delay between the two lines would hide the problem. The tests ask for the real fix.",
        "Replace each GPADAT write with a write of 1 to GPASET (to go high) or GPACLEAR (to go low).",
        "`GpioDataRegs.GPASET.bit.GPIO22 = 1;` and `GpioDataRegs.GPACLEAR.bit.GPIO31 = 1;`",
      ],
      takeaway: "Read inputs from GPxDAT. Change outputs with GPxSET, GPxCLEAR and GPxTOGGLE. That rule also keeps an interrupt from corrupting a half-finished pin change.",
    },
    {
      id: "out-blink",
      kind: "code",
      mode: "checkpoint",
      title: "Blink",
      goal: "Blink LED1 five times a second, with the red LaunchPad LED lit whenever LED1 is dark.",
      refs: [{ course: "Lab 1" }, { course: "L3" }],
      brief: `
Make **LED1** (GPIO22) blink with a period of **200 ms**: 100 ms on, 100 ms off, forever.

The **red LaunchPad LED** (GPIO34, lit when low) must do the opposite: on while LED1 is off.

For the wait, use \`DELAY_US(microseconds);\`. It simply keeps the CPU busy for that long, which is fine for a first program. The next chapters replace it with a timer, so the CPU is free to do other work.

Think about the starting levels: if both pins start high and you toggle both every 100 ms, what do the two LEDs do?
`,
      kit: "robot",
      durationMs: 1000,
      starter: `void main(void)
{
${INIT}

    // Set up GPIO22 and GPIO34 as outputs and choose their starting levels

    while (1) {
        // Toggle, then wait
    }
}
`,
      solution: `void main(void)
{
${INIT}

${out(22)}
${out(34)}
    GpioDataRegs.GPASET.bit.GPIO22 = 1;   // LED1 on
    GpioDataRegs.GPBSET.bit.GPIO34 = 1;   // red off (lit when low)

    while (1) {
        DELAY_US(100000);
        GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
        GpioDataRegs.GPBTOGGLE.bit.GPIO34 = 1;
    }
}
`,
      checks: [
        { kind: "blink", led: "LED1", periodMs: 200, from: 50, label: "LED1 blinks with a 200 ms period" },
        { kind: "blink", led: "RED", periodMs: 200, from: 50, label: "The red LED blinks with a 200 ms period" },
        { kind: "opposite", a: "LED1", b: "RED", from: 60, to: 990, label: "Exactly one of the two LEDs is lit at any time", hint: "LED1 lights when its pin is high, the red LED when its pin is low." },
        { kind: "no-dat-write", label: "Outputs are changed through SET, CLEAR or TOGGLE" },
      ],
      hints: [
        "100 ms is 100000 microseconds.",
        "LED1 lights when high and the red LED lights when low. If both pins are at the same level, exactly one LED is lit, and toggling both keeps it that way.",
        "Start with both pins high, then in the loop: `DELAY_US(100000);` followed by a TOGGLE write for each pin.",
      ],
      takeaway: "TOGGLE needs no knowledge of the current level. The busy wait works, but the CPU can do nothing else meanwhile: timers and interrupts fix that.",
    },
  ],
};
