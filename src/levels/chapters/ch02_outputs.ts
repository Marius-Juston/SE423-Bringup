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
      title: "What a GPIO pin is",
      goal: "Learn what a GPIO pin is and what it can do, then answer three questions.",
      refs: [{ course: "L3" }, { trm: "8.1" }, { trm: "8.2" }, { trm: "8.8" }],
      brief: `
## What a pin is
The chip is a small black package with rows of metal contacts. Each contact is a **pin**. The pins are the only places where the chip touches the rest of the circuit. A **GPIO** pin (general-purpose input/output) is a pin that your software controls. "General purpose" means the pin has no fixed job: your code decides what it does.

{{figure:gpio-pin}}

The figure shows one pin and what the chip puts behind it. Flip its switches as you read, and watch the pin's voltage.

## Two voltages
A GPIO pin is **digital**: only two voltages count. About **3.3 V** is a logic 1, also called **high**. **0 V** is a logic 0, called **low**.

## Two directions
- As an **output**, the chip **drives** the pin: it forces the voltage to 3.3 V or to 0 V. This is how a program switches an LED.
- As an **input**, the chip only measures the voltage that the circuit outside puts on the pin. It changes nothing. This is how a program reads a push button.

After reset (power-up) every pin is an input.

In the figure, make the pin an input with nothing connected. Nothing sets its voltage, so the value read is unpredictable: the pin **floats**. The **pull-up** is a weak resistor inside the chip that pulls such a pin up to 3.3 V. Chapter 3 uses it for buttons.

## A pin signals, it does not power
One pin can deliver only a few milliamps of current. That is enough for an LED with its resistor, or for the input of another chip. It is not enough for a motor. A motor needs a separate driver circuit, and the pin only tells the driver what to do.

## Pin numbers
In code a pin is named by its **GPIO number**, such as GPIO22. That number is not the pin's position on the package or on the board's connectors. The board's documentation tells you which GPIO is wired to what. This chip has 169 of them, GPIO0 to GPIO168.
`,
      questions: [
        {
          prompt: "GPIO22 is set up as an **input**. What does the chip do with the pin?",
          options: ["It forces the pin to 0 V", "It forces the pin to 3.3 V", "It measures the pin's voltage and changes nothing", "It switches the pin off so no voltage can reach it"],
          answer: 2,
          why: "An input only measures. The voltage comes from the circuit outside, or from the pull-up if nothing else sets it.",
        },
        {
          prompt: "A pin is an input, nothing is connected to it, and its pull-up is off. What does the program read from it?",
          options: ["Always 0", "Always 1", "An unpredictable value: the pin floats", "The last value the program wrote"],
          answer: 2,
          why: "Nothing sets the voltage, so the reading is noise. A pull-up or an outside circuit must give every input a defined level.",
        },
        {
          prompt: "Which of these can a GPIO output pin run directly?",
          options: ["A robot's drive motor", "An LED with its resistor", "A 12 V lamp", "A loudspeaker at full volume"],
          answer: 1,
          why: "A pin delivers a few milliamps at 3.3 V. That lights an LED. Anything bigger needs a driver circuit, and the pin only tells the driver what to do.",
        },
      ],
      takeaway: "A GPIO pin is a contact whose job your code chooses: as an output it drives 3.3 V or 0 V, as an input it measures. It carries signals, not power.",
    },
    {
      id: "out-ports",
      kind: "quiz",
      title: "Which port?",
      goal: "Find the port, and so the register names, of the robot board's LEDs and buttons.",
      refs: [{ course: "Lab 1" }, { course: "Lab 2" }, { trm: "8.9" }],
      brief: `
The pins are grouped in **ports** of 32. The pins of a port share one set of registers, and the port letter is part of every register name: GPIO94 is in port C, so it is driven through \`GPCSET\` and \`GPCCLEAR\`.

- port **A**: GPIO0 to 31
- port **B**: GPIO32 to 63
- port **C**: GPIO64 to 95
- port **D**: GPIO96 to 127
- port **E**: GPIO128 to 159
- port **F**: GPIO160 to 168

The quick way: divide the GPIO number by 32 and drop the remainder. 0 is port A, 1 is B, 2 is C, 3 is D, 4 is E, 5 is F. The remainder is the pin's bit number inside the port's registers.

The robot board's LEDs are on GPIO22, 94, 95, 97 and 111. Its push buttons are on GPIO157, 158, 159 and 160.

{{figure:port-map}}

Try it in the figure: drag the GPIO number across a port boundary and watch the letter in the register names change.
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
      id: "out-drive",
      kind: "brief",
      title: "What it takes to drive a pin",
      goal: "Learn the three settings a pin needs before it can light an LED, then answer three questions.",
      refs: [{ course: "L3" }, { trm: "8.2" }, { trm: "8.3" }, { trm: "8.7" }],
      brief: `
## Three settings per pin
1. **Mux** (the pin multiplexer, a selector switch): the pin is a plain GPIO, or it carries the signal of one of the chip's peripherals (PWM, serial port...). Mux position 0 is plain GPIO.
2. **Direction**: input (0, the state after reset) or output (1). One bit per pin in the \`GPxDIR\` register, where x is the port letter.
3. **Output level**: the value the pin drives when it is an output. The chip keeps it in one bit per pin, the **output latch**.

The course code sets the first two with TI's helper functions:
\`\`\`c
GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
\`\`\`
The first line makes GPIO22 a plain GPIO (the last argument is the mux position). The second makes it an output. \`GPIO_MUX_CPU1\` says which of the chip's two CPUs owns the pin: always CPU1 in this course. \`GPIO_PUSHPULL\` is the normal kind of output, one that can drive both high and low.

## Changing the level: SET, CLEAR, TOGGLE
\`\`\`c
GpioDataRegs.GPASET.bit.GPIO22 = 1;     // high
GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;   // low
GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;  // flip
\`\`\`
You always write a **1**: to SET to go high, to CLEAR to go low, to TOGGLE to flip. Writing 0 to these registers does nothing.

\`GPxDAT\` reads the voltage on the pins. That is how a program reads an input. Do not use it to change outputs. A later level shows why.

## Lit by a 1 or by a 0?
That depends on how the LED is wired. The LEDs on the green robot board sit between the pin and 0 V, so they light when the pin is **high**. The two LEDs on the LaunchPad itself (blue on GPIO31, red on GPIO34) sit between 3.3 V and the pin, so they light when the pin is **low**.

{{figure:led-wiring}}

Try it in the figure: switch both pins between high and low and watch where current flows.
`,
      questions: [
        {
          prompt: "After reset, GPIO22 is a plain GPIO input. Which line makes it an output?",
          options: [
            "`GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);`",
            "`GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);`",
            "`GpioDataRegs.GPASET.bit.GPIO22 = 1;`",
            "`GpioDataRegs.GPADAT.bit.GPIO22 = 1;`",
          ],
          answer: 1,
          why: "GPIO_SetupPinOptions sets the direction. GPIO_SetupPinMux only selects the pin's job, and GPASET only loads the level that an output will drive.",
        },
        {
          prompt: "GPIO22 is an output and currently high. What does `GpioDataRegs.GPASET.bit.GPIO22 = 0;` do?",
          options: ["Drives the pin low", "Nothing", "Toggles the pin", "Makes the pin an input"],
          answer: 1,
          why: "Writing 0 to a SET register has no effect. To drive the pin low, write 1 to GPACLEAR.",
        },
        {
          prompt: "The LaunchPad's red LED (GPIO34, port B) lights when its pin is low. Which line turns it **on**?",
          options: ["`GpioDataRegs.GPBSET.bit.GPIO34 = 1;`", "`GpioDataRegs.GPBCLEAR.bit.GPIO34 = 1;`", "`GpioDataRegs.GPBTOGGLE.bit.GPIO34 = 0;`", "`GpioDataRegs.GPBCLEAR.bit.GPIO34 = 0;`"],
          answer: 1,
          why: "CLEAR drives the pin low, and low lights this LED. A 0 written to SET, CLEAR or TOGGLE does nothing.",
        },
      ],
      takeaway: "To drive a pin: mux to GPIO, direction to output, then write 1 to SET, CLEAR or TOGGLE. Whether high or low lights an LED depends on its wiring.",
    },
    {
      id: "out-dir",
      kind: "register",
      title: "Make two pins outputs",
      goal: "Set the direction register so GPIO22 and GPIO31 are outputs.",
      refs: [{ trm: "8.9" }, { course: "L3" }],
      brief: `
\`GpioCtrlRegs.GPADIR\` has one bit per pin of port A: 0 = input, 1 = output. After reset (power-up) every pin is an input.

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

The starter already has the two lines every course program begins with: \`InitSysCtrl()\` starts the chip's clock, and \`InitGpio()\` puts every pin in its reset state, a plain GPIO input. The \`while (1) {}\` at the end keeps the program running: on a microcontroller \`main\` must never return.

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
        "The two helper calls are written out in the task, with `pin` in place of 22.",
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
      bonus: [
        { kind: "duty", led: "LED2", pct: 0, tolPct: 0, label: "LED2 never lights, not even for an instant", hint: "Do not switch everything on first and then switch two LEDs off again." },
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

{{figure:led-wiring}}

Try it in the figure: drive both pins low and see which of the two LEDs lights.

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

{{figure:set-clear-toggle}}

Step through the figure: first the two lines through \`GPADAT.bit\`, then the same two lines through \`GPASET\` and \`GPACLEAR\`.

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
      bonus: [
        { kind: "source", mustNotMatch: "DELAY_US[\\s\\S]*DELAY_US", label: "No extra delay: the two changes stay back to back" },
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
      bonus: [
        { kind: "source", mustNotMatch: "\\bif\\b|\\?", label: "No `if` in the loop: TOGGLE does the work" },
      ],
      hints: [
        "100 ms is 100000 microseconds.",
        "LED1 lights when high and the red LED lights when low. If both pins are at the same level, exactly one LED is lit, and toggling both keeps it that way.",
        "Start with both pins high, then in the loop: `DELAY_US(100000);` followed by a TOGGLE write for each pin.",
      ],
      takeaway: "TOGGLE needs no knowledge of the current level. The busy wait works, but the CPU can do nothing else meanwhile: timers and interrupts fix that.",
    },
    {
      id: "out-heartbeat",
      tier: "practice",
      kind: "code",
      mode: "write",
      title: "Heartbeat",
      goal: "Flash LED3 briefly four times a second: 50 ms on, 200 ms off.",
      refs: [{ course: "Lab 1" }, { course: "L3" }],
      brief: `
A status LED that is on half the time wastes power and is hard to tell apart from a stuck one. A short flash reads better.

Make **LED3** (GPIO95) do this forever, starting with the LED on:

- on for **50 ms**
- off for **200 ms**

TOGGLE with one delay gives equal on and off times, so it will not do here. Look up the port of GPIO95 before you type a register name.
`,
      kit: "robot",
      durationMs: 1000,
      starter: `void main(void)
{
${INIT}

    // Set up GPIO95 as an output

    while (1) {
        // on, wait 50 ms, off, wait 200 ms
    }
}
`,
      solution: `void main(void)
{
${INIT}

${out(95)}

    while (1) {
        GpioDataRegs.GPCSET.bit.GPIO95 = 1;
        DELAY_US(50000);
        GpioDataRegs.GPCCLEAR.bit.GPIO95 = 1;
        DELAY_US(200000);
    }
}
`,
      checks: [
        { kind: "led", led: "LED3", at: 25, on: true, label: "LED3 is on 25 ms after the start" },
        { kind: "led", led: "LED3", at: 100, on: false, label: "LED3 is off at 100 ms" },
        { kind: "led", led: "LED3", at: 275, on: true, label: "LED3 is on again at 275 ms", hint: "One full cycle is 50 + 200 = 250 ms." },
        { kind: "led", led: "LED3", at: 400, on: false, label: "LED3 is off at 400 ms" },
        { kind: "duty", led: "LED3", pct: 20, label: "LED3 is on 20% of the time", hint: "50 ms out of every 250 ms is 20%." },
        { kind: "no-dat-write", label: "The output is changed through SET and CLEAR" },
      ],
      hints: [
        "GPIO95 is 95 / 32 = 2 remainder 31: port C.",
        "In the loop: SET, DELAY_US(50000), CLEAR, DELAY_US(200000).",
        "`GpioDataRegs.GPCSET.bit.GPIO95 = 1;` switches the LED on and `GpioDataRegs.GPCCLEAR.bit.GPIO95 = 1;` switches it off.",
      ],
      takeaway: "The share of time a signal is on is its duty cycle: here 50 / 250 = 20%. The PWM chapter makes the chip produce this without any delay loop.",
    },
    {
      id: "out-mixed",
      tier: "practice",
      kind: "code",
      mode: "debug",
      title: "Three lamps, four mistakes",
      goal: "LED5 and the blue LED should be on and the red LED off. None of the three is right. Fix it.",
      refs: [{ course: "Lab 1" }, { course: "L3" }, { trm: "8.3" }],
      brief: `
A status display uses three LEDs:

- **LED5** (GPIO111, lit when **high**): must be on
- **blue** LaunchPad LED (GPIO31, lit when **low**): must be on
- **red** LaunchPad LED (GPIO34, lit when **low**): must be off, and the pin must really be driven, not left as an input

The program compiles and every line looks plausible. There are four mistakes. Check each line against two questions: does this pin light its LED with a 1 or with a 0, and what does writing this value to this register do?
`,
      kit: "robot",
      durationMs: 2,
      starter: `void main(void)
{
${INIT}

${out(111)}
${out(31)}
    GPIO_SetupPinMux(34, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(34, GPIO_INPUT, GPIO_PUSHPULL);

    // LED5 on
    GpioDataRegs.GPDSET.bit.GPIO111 = 0;

    // Blue LED on
    GpioDataRegs.GPASET.bit.GPIO31 = 1;

    // Red LED off
    GpioDataRegs.GPBCLEAR.bit.GPIO34 = 0;

    while (1) {}
}
`,
      solution: `void main(void)
{
${INIT}

${out(111)}
${out(31)}
${out(34)}

    // LED5 on: lit when high, and SET needs a 1
    GpioDataRegs.GPDSET.bit.GPIO111 = 1;

    // Blue LED on: lit when low
    GpioDataRegs.GPACLEAR.bit.GPIO31 = 1;

    // Red LED off: high
    GpioDataRegs.GPBSET.bit.GPIO34 = 1;

    while (1) {}
}
`,
      checks: [
        { kind: "led", led: "LED5", at: 1.5, on: true, label: "LED5 is on", hint: "Writing 0 to a SET register does nothing." },
        { kind: "led", led: "BLUE", at: 1.5, on: true, label: "The blue LED is on", hint: "The LaunchPad's LEDs light when the pin is low." },
        { kind: "led", led: "RED", at: 1.5, on: false, label: "The red LED is off" },
        { kind: "reg", reg: "GpioCtrlRegs.GPBDIR", field: "GPIO34", equals: 1, label: "GPIO34 is an output", hint: "Look at the second argument of GPIO_SetupPinOptions for pin 34." },
        { kind: "pin", pin: 34, at: 1.5, level: 1, label: "GPIO34 is driven high", hint: "Off means high for this LED: write 1 to GPBSET." },
        { kind: "no-dat-write", label: "Outputs are changed through SET and CLEAR" },
      ],
      hints: [
        "SET and CLEAR only react to a 1. A line that writes 0 to them can be deleted without changing anything.",
        "Pin 34 is set up as GPIO_INPUT. An input cannot hold an LED off: the pin floats.",
        "LED5 on: `GPDSET ... = 1`. Blue on: `GPACLEAR ... = 1`. Red off: make GPIO34 an output and write `GPBSET ... = 1`.",
      ],
      takeaway: "Two separate questions decide every output line: which register (SET drives high, CLEAR drives low, both need a 1) and which level lights this LED. An LED that happens to be dark because its pin floats is not off.",
    },
    {
      id: "out-own-helpers",
      tier: "expert",
      kind: "code",
      mode: "write",
      title: "Write the helpers yourself",
      goal: "Replace GPIO_SetupPinMux and GPIO_SetupPinOptions with your own functions, built on raw register addresses, for any pin.",
      refs: [{ trm: "8.2" }, { trm: "8.7" }, { trm: "8.9.1" }, { trm: "8.9.2" }, { course: "L3" }],
      brief: `
Every program so far called TI's two helpers. Now write them.

- \`myPinMux(pin, muxPosition)\` selects one of the 16 mux positions. The **lower two bits** of the position go into the pin's 2-bit field of \`GPxMUX1\` (pins 0 to 15 of the port) or \`GPxMUX2\` (pins 16 to 31). The **upper two bits** go into the same field of \`GPxGMUX1\` or \`GPxGMUX2\`. The fields of other pins must not change.
- \`myMakeOutput(pin)\` sets the pin's bit in \`GPxDIR\`.

Both must work for any pin of any port, from the pin number alone. The TI helpers are not allowed.

The reference manual asks for an order when the group mux changes: first set the pin's \`GPxMUX\` field to 0, then write \`GPxGMUX\`, then write the final \`GPxMUX\` value. Otherwise the pin is briefly connected to a signal nobody asked for.

Register map: \`GpioCtrlRegs\` starts at \`0x7C00\` and each port takes \`0x40\` words, A first. Inside a port: \`GPxMUX1\` at offset \`0x06\`, \`GPxMUX2\` at \`0x08\`, \`GPxDIR\` at \`0x0A\`, \`GPxGMUX1\` at \`0x20\`, \`GPxGMUX2\` at \`0x22\`. All are 32 bits wide and EALLOW-protected.
`,
      kit: "robot",
      durationMs: 3,
      inspect: ["GpioCtrlRegs.GPAMUX2", "GpioCtrlRegs.GPAGMUX2", "GpioCtrlRegs.GPBMUX1", "GpioCtrlRegs.GPBGMUX1", "GpioCtrlRegs.GPDDIR"],
      starter: `// Select mux position 0..15 for any pin
void myPinMux(Uint16 pin, Uint16 muxPosition)
{
    // TODO
}

// Make any pin an output
void myMakeOutput(Uint16 pin)
{
    // TODO
}

void main(void)
{
    InitSysCtrl();
    InitGpio();

    // An earlier program left these pins switched to peripherals
    myPinMux(22, 5);
    myPinMux(23, 6);
    myPinMux(94, 15);
    myPinMux(111, 9);

    // The serial port's pins
    myPinMux(42, 15);
    myPinMux(43, 15);

    // The five LEDs: plain GPIO, output, on
    myPinMux(22, 0);
    myPinMux(94, 0);
    myPinMux(95, 0);
    myPinMux(97, 0);
    myPinMux(111, 0);
    myMakeOutput(22);
    myMakeOutput(94);
    myMakeOutput(95);
    myMakeOutput(97);
    myMakeOutput(111);
    GpioDataRegs.GPASET.bit.GPIO22 = 1;
    GpioDataRegs.GPCSET.bit.GPIO94 = 1;
    GpioDataRegs.GPCSET.bit.GPIO95 = 1;
    GpioDataRegs.GPDSET.bit.GPIO97 = 1;
    GpioDataRegs.GPDSET.bit.GPIO111 = 1;

    while (1) {}
}
`,
      solution: `#define CTRL_BASE    0x7C00     // GpioCtrlRegs
#define PORT_WORDS   0x40       // from one port's registers to the next port's
#define MUX1         0x06       // GPxMUX1; GPxMUX2 follows 2 words later
#define DIR          0x0A       // GPxDIR
#define GMUX1        0x20       // GPxGMUX1; GPxGMUX2 follows 2 words later

// The register at 'offset' in the port that 'pin' belongs to
volatile Uint32 *ctrlReg(Uint16 pin, Uint16 offset)
{
    return (volatile Uint32 *)(CTRL_BASE + (pin / 32) * PORT_WORDS + offset);
}

// Select mux position 0..15 for any pin
void myPinMux(Uint16 pin, Uint16 muxPosition)
{
    Uint16 half = ((pin % 32) / 16) * 2;        // 0: MUX1 / GMUX1, 2: MUX2 / GMUX2
    Uint16 shift = (pin % 16) * 2;              // two bits per pin
    volatile Uint32 *mux = ctrlReg(pin, MUX1 + half);
    volatile Uint32 *gmux = ctrlReg(pin, GMUX1 + half);

    EALLOW;
    *mux &= ~(3UL << shift);                    // GPIO first, as the manual asks
    *gmux = (*gmux & ~(3UL << shift)) | ((Uint32)(muxPosition >> 2) << shift);
    *mux |= (Uint32)(muxPosition & 3) << shift;
    EDIS;
}

// Make any pin an output
void myMakeOutput(Uint16 pin)
{
    EALLOW;
    *ctrlReg(pin, DIR) |= 1UL << (pin % 32);
    EDIS;
}

void main(void)
{
    InitSysCtrl();
    InitGpio();

    // An earlier program left these pins switched to peripherals
    myPinMux(22, 5);
    myPinMux(23, 6);
    myPinMux(94, 15);
    myPinMux(111, 9);

    // The serial port's pins
    myPinMux(42, 15);
    myPinMux(43, 15);

    // The five LEDs: plain GPIO, output, on
    myPinMux(22, 0);
    myPinMux(94, 0);
    myPinMux(95, 0);
    myPinMux(97, 0);
    myPinMux(111, 0);
    myMakeOutput(22);
    myMakeOutput(94);
    myMakeOutput(95);
    myMakeOutput(97);
    myMakeOutput(111);
    GpioDataRegs.GPASET.bit.GPIO22 = 1;
    GpioDataRegs.GPCSET.bit.GPIO94 = 1;
    GpioDataRegs.GPCSET.bit.GPIO95 = 1;
    GpioDataRegs.GPDSET.bit.GPIO97 = 1;
    GpioDataRegs.GPDSET.bit.GPIO111 = 1;

    while (1) {}
}
`,
      checks: [
        { kind: "led", led: "LED1", at: 2, on: true, label: "LED1 is on" },
        { kind: "led", led: "LED2", at: 2, on: true, label: "LED2 is on", hint: "GPIO94 was at mux position 15. Both its GPCMUX2 field and its GPCGMUX2 field must go back to 0." },
        { kind: "led", led: "LED3", at: 2, on: true, label: "LED3 is on" },
        { kind: "led", led: "LED4", at: 2, on: true, label: "LED4 is on" },
        { kind: "led", led: "LED5", at: 2, on: true, label: "LED5 is on" },
        { kind: "reg", reg: "GpioCtrlRegs.GPAMUX2", equals: 0x8000, label: "GPAMUX2 is 0x00008000: GPIO23 keeps 2, GPIO22 is back at 0", hint: "Position 6 is binary 01 10: GMUX gets 1 and MUX gets 2. Changing GPIO22 must not touch GPIO23's field." },
        { kind: "reg", reg: "GpioCtrlRegs.GPAGMUX2", equals: 0x4000, label: "GPAGMUX2 is 0x00004000: GPIO23 keeps 1, GPIO22 is back at 0" },
        { kind: "reg", reg: "GpioCtrlRegs.GPBMUX1", equals: 0x00f00000, label: "GPBMUX1 is 0x00F00000: GPIO42 and GPIO43 hold 3" },
        { kind: "reg", reg: "GpioCtrlRegs.GPBGMUX1", equals: 0x00f00000, label: "GPBGMUX1 is 0x00F00000: GPIO42 and GPIO43 hold 3" },
        { kind: "reg", reg: "GpioCtrlRegs.GPDGMUX1", equals: 0, label: "GPDGMUX1 is 0: GPIO111 is a plain GPIO again" },
        { kind: "reg", reg: "GpioCtrlRegs.GPDDIR", equals: 0x8002, label: "GPDDIR is 0x00008002: only GPIO97 and GPIO111 are outputs" },
        { kind: "no-diagnostic", code: "eallow", label: "No write to a protected register was ignored" },
        { kind: "no-diagnostic", code: "shift-16", label: "No shift that overflows a 16-bit int" },
        { kind: "source", mustNotMatch: "GPIO_Setup", label: "GPIO_SetupPinMux and GPIO_SetupPinOptions are not used" },
      ],
      bonus: [
        {
          kind: "source",
          mustNotMatch: "\\bswitch\\b|\\bif\\b|GP[A-F]G?MUX[12]|GP[A-F]DIR",
          label: "One address formula for every port: no `switch`, no `if`, no register names",
          hint: "The port number is pin / 32, and each port's registers start 0x40 words after the previous port's.",
        },
      ],
      hints: [
        "Three numbers describe a pin: its port (pin / 32), its bit in the port (pin % 32), and for the mux registers its field (pin % 16, two bits each) in register 1 or 2 ((pin % 32) / 16).",
        "The address of a register is 0x7C00 + port x 0x40 + offset. Cast it: `(volatile Uint32 *)address`. Use `1UL` and `3UL` for the masks: the shifts go up to 31.",
        "myPinMux, between EALLOW and EDIS: `*mux &= ~(3UL << shift);`, then replace the GMUX field with `muxPosition >> 2`, then `*mux |= (Uint32)(muxPosition & 3) << shift;`.",
      ],
      takeaway: "You have just rewritten the core of TI's GPIO_SetupPinMux. The helpers are not magic: they compute an address from the pin number and do a read, mask, write inside EALLOW ... EDIS.",
    },
    {
      id: "out-sixteen",
      tier: "expert",
      kind: "code",
      mode: "write",
      title: "Sixteen LEDs, six ports",
      goal: "Show a 16-bit value on the red board's 16 LEDs, then sweep a single light back and forth.",
      refs: [{ course: "HW1" }, { course: "Lab 2" }, { trm: "8.3" }, { trm: "8.9.1" }],
      brief: `
The homework red board has 16 LEDs, all lit when high. Their pins are scattered over all six ports. The starter lists them in order, LED1 first.

1. Write \`showWord(value)\`: bit 0 of \`value\` controls LED1, bit 1 controls LED2, up to bit 15 and LED16. A 1 lights the LED, a 0 switches it off.
2. Use it for a sweep. At the start only LED1 is lit. Every **50 ms** the light moves one LED further: LED1, LED2, up to LED16, then back down to LED1, and so on forever. Exactly one LED is lit at any time.

TI's \`GPIO_WritePin\` is not allowed. Thirty-two lines of SET and CLEAR would pass. The stars are for a version where the table does the work.

\`GpioDataRegs\` starts at \`0x7F00\`. Each port has DAT, SET, CLEAR and TOGGLE, two words each. \`GpioCtrlRegs\` starts at \`0x7C00\`, each port takes \`0x40\` words, and \`GPxDIR\` is at offset \`0x0A\`.
`,
      kit: "redboard",
      durationMs: 1700,
      starter: `// GPIO number of LED1 ... LED16
const Uint16 ledPin[16] = {22, 94, 95, 97, 111, 130, 131, 25, 26, 27, 60, 61, 157, 158, 159, 160};

// Bit 0 of value: LED1 ... bit 15: LED16. 1 = on.
void showWord(Uint16 value)
{
    // TODO
}

void main(void)
{
    InitSysCtrl();
    InitGpio();

    // TODO: make the 16 LED pins outputs

    while (1) {
        // TODO: the sweep, one step every 50 ms
    }
}
`,
      solution: `// GPIO number of LED1 ... LED16
const Uint16 ledPin[16] = {22, 94, 95, 97, 111, 130, 131, 25, 26, 27, 60, 61, 157, 158, 159, 160};

// Drive any pin high (on = 1) or low (on = 0)
void pinWrite(Uint16 pin, Uint16 on)
{
    // DAT, SET, CLEAR, TOGGLE of the pin's port: 8 words per port
    volatile Uint32 *data = (volatile Uint32 *)(0x7F00 + (pin / 32) * 8);
    Uint32 mask = 1UL << (pin % 32);

    if (on) {
        data[1] = mask;         // SET
    } else {
        data[2] = mask;         // CLEAR
    }
}

// Bit 0 of value: LED1 ... bit 15: LED16. 1 = on.
void showWord(Uint16 value)
{
    Uint16 i;

    for (i = 0; i < 16; i++) {
        pinWrite(ledPin[i], (value >> i) & 1);
    }
}

void main(void)
{
    Uint16 i;
    int16_t position = 0;
    int16_t step = 1;

    InitSysCtrl();
    InitGpio();

    // GPxDIR of each pin's port: 0x40 words per port, DIR at offset 0x0A
    EALLOW;
    for (i = 0; i < 16; i++) {
        *(volatile Uint32 *)(0x7C0A + (ledPin[i] / 32) * 0x40) |= 1UL << (ledPin[i] % 32);
    }
    EDIS;

    while (1) {
        showWord(1UL << position);
        DELAY_US(50000);
        if (position == 15) {
            step = -1;
        }
        if (position == 0) {
            step = 1;
        }
        position += step;
    }
}
`,
      checks: [
        { kind: "led", led: "LED1", at: 25, on: true, label: "LED1 is lit first" },
        { kind: "led", led: "LED2", at: 75, on: true, label: "LED2 is lit in the second step" },
        { kind: "led", led: "LED1", at: 75, on: false, label: "LED1 is off again in the second step", hint: "showWord must switch LEDs off as well as on." },
        { kind: "led", led: "LED6", at: 275, on: true, label: "LED6 (GPIO130, port E) is lit in step 6" },
        { kind: "led", led: "LED11", at: 525, on: true, label: "LED11 (GPIO60, port B) is lit in step 11" },
        { kind: "led", led: "LED16", at: 775, on: true, label: "LED16 (GPIO160, port F) is lit in step 16" },
        { kind: "led", led: "LED15", at: 825, on: true, label: "The light turns around at LED16: LED15 is next", hint: "LED16 is lit for one step only, then the direction reverses." },
        { kind: "led", led: "LED1", at: 1525, on: true, label: "The light is back at LED1 after 30 steps" },
        { kind: "led", led: "LED2", at: 1575, on: true, label: "The light turns around at LED1: LED2 is next" },
        { kind: "duty", led: "LED8", pct: 6.7, tolPct: 1, to: 1500, label: "LED8 is lit for 2 steps out of every 30" },
        { kind: "no-dat-write", label: "Outputs are changed through SET and CLEAR" },
        { kind: "no-diagnostic", code: "shift-16", label: "No shift that overflows a 16-bit int", hint: "`1 << 15` does not fit in a signed 16-bit int. Write `1UL << position`." },
        { kind: "source", mustNotMatch: "GPIO_WritePin", label: "GPIO_WritePin is not used" },
      ],
      bonus: [
        {
          kind: "source",
          mustNotMatch: "\\bswitch\\b|GP[A-F](SET|CLEAR|TOGGLE|DIR)",
          label: "Table-driven: no port register is named, the address comes from the pin number",
          hint: "The SET register of a pin's port is at 0x7F00 + (pin / 32) x 8 + 2.",
        },
        { kind: "source", mustNotMatch: "GPIO_", label: "No TI GPIO helper at all, not even for the setup" },
      ],
      hints: [
        "showWord: loop i from 0 to 15, test `(value >> i) & 1`, and switch the pin `ledPin[i]` on or off.",
        "A pin's port is pin / 32 and its bit is pin % 32. With `volatile Uint32 *data = (volatile Uint32 *)(0x7F00 + (pin / 32) * 8);`, `data[1]` is that port's SET register and `data[2]` its CLEAR register.",
        "The sweep: keep a position (0 to 15) and a step (+1 or -1). Each pass: `showWord(1UL << position);`, wait 50 ms, reverse the step at position 15 and at position 0, then add the step.",
      ],
      takeaway: "A table of pin numbers plus address arithmetic replaces a page of copied lines, and moving an LED to another pin becomes a one-number change. This is how TI's GPIO_WritePin works inside.",
    },
    {
      id: "out-glitch",
      tier: "expert",
      kind: "code",
      mode: "debug",
      title: "The pulse nobody ordered",
      goal: "GPIO31 goes low for an instant at power-up. Remove the pulse without changing what the program does afterwards.",
      refs: [{ trm: "8.2" }, { trm: "8.3" }, { course: "L3" }],
      brief: `
GPIO31 is the enable line of a motor driver: **low means enabled**. The blue LED sits on the same pin, so it shows the state. The program must hold the line high during a 5 ms self-test and pull it low afterwards.

On the bench the motor twitches at power-up. An oscilloscope shows why: GPIO31 goes low for a fraction of a microsecond, long before the self-test ends.

Every line of this program is one you have written before. Find where the low level comes from, and get rid of it. GPIO31 must still be a driven output for the whole self-test.

Section 8.2 of the reference manual, step 4, has the answer in two sentences.
`,
      kit: "launchpad",
      durationMs: 8,
      inspect: ["GpioCtrlRegs.GPADIR", "GpioDataRegs.GPADAT"],
      starter: `void main(void)
{
${INIT}

    // Motor enable (GPIO31, low = enabled): output, held high
${out(31)}
    GpioDataRegs.GPASET.bit.GPIO31 = 1;

    DELAY_US(5000);     // self-test

    GpioDataRegs.GPACLEAR.bit.GPIO31 = 1;   // enable the motor
    while (1) {}
}
`,
      solution: `void main(void)
{
${INIT}

    // Motor enable (GPIO31, low = enabled): output, held high.
    // Load the output latch first, while the pin is still an input.
    // When the pin becomes an output it drives high from the first instant.
    GpioDataRegs.GPASET.bit.GPIO31 = 1;
${out(31)}

    DELAY_US(5000);     // self-test

    GpioDataRegs.GPACLEAR.bit.GPIO31 = 1;   // enable the motor
    while (1) {}
}
`,
      checks: [
        {
          kind: "duty", led: "BLUE", pct: 0, tolPct: 0, to: 0.1,
          label: "No low pulse on GPIO31 at power-up (the first 100 microseconds)",
          hint: "After reset the output latch holds 0. The moment the pin becomes an output, it drives what the latch holds.",
        },
        { kind: "duty", pin: 31, pct: 100, tolPct: 0, from: 0.1, to: 4.9, label: "GPIO31 is high for the rest of the self-test" },
        { kind: "reg", reg: "GpioCtrlRegs.GPADIR", field: "GPIO31", equals: 1, at: 1, label: "GPIO31 is an output during the self-test" },
        { kind: "led", led: "BLUE", at: 6, on: true, label: "The motor is enabled after the self-test (blue LED on)" },
        { kind: "pin", pin: 31, at: 6, level: 0, label: "GPIO31 is driven low after the self-test" },
      ],
      bonus: [
        { kind: "source", mustNotMatch: "PULLUP|GPAPUD", label: "No pull-up needed: the latch alone holds the line" },
        { kind: "max-lines", max: 11, label: "No lines added: 11 lines or fewer" },
      ],
      hints: [
        "Step through the first lines and ask after each one: is the pin an output now, and what is in its output latch?",
        "GPASET, GPACLEAR and GPATOGGLE change the output latch even while the pin is an input. Nothing reaches the pin until the direction changes.",
        "Move the GPASET line above GPIO_SetupPinOptions. The latch then holds 1 before the pin starts driving.",
      ],
      takeaway: "Load the latch, then switch the direction. An LED hides a microsecond of the wrong level. A motor driver, a reset line or a chip select does not.",
    },
  ],
};
