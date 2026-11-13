import type { Chapter } from "../types";

const INIT = `    InitSysCtrl();
    InitGpio();`;

const PIE_INIT = `    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();`;

/**
 * The EPWM12A set-up on LED1, with the given period and compare value. The
 * chapter runs it at 10 kHz (TBPRD = 5000): Lab 3 asks for 20 kHz and HW2
 * for 5 kHz, and the game does not hand out those numbers.
 */
const PWM12 = (tbprd: number, cmpa: number, note: string) => `    // EPWM12A on LED1: ${note}
    EPwm12Regs.TBCTL.bit.CTRMODE = 0;    // count up
    EPwm12Regs.TBCTL.bit.FREE_SOFT = 2;  // keep running at a breakpoint
    EPwm12Regs.TBCTL.bit.PHSEN = 0;      // no phase loading
    EPwm12Regs.TBCTL.bit.CLKDIV = 0;     // divide by 1
    EPwm12Regs.TBCTR = 0;                // start counting from zero
    EPwm12Regs.TBPRD = ${tbprd};
    EPwm12Regs.CMPA.bit.CMPA = ${cmpa};
    EPwm12Regs.AQCTLA.bit.CAU = 1;       // clear the pin when the counter reaches CMPA
    EPwm12Regs.AQCTLA.bit.ZRO = 2;       // set the pin when the counter is zero
    EPwm12Regs.TBPHS.bit.TBPHS = 0;      // phase: not used`;

const MUX12 = `    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 5);  // GPIO22 becomes EPWM12A
    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO22 = 1;      // pull-up off on a PWM pin
    EDIS;`;

const BUTTONS = `    // PB1 and PB2: inputs with pull-ups, they read 0 while pressed
    GPIO_SetupPinMux(157, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(157, GPIO_INPUT, GPIO_PULLUP);
    GPIO_SetupPinMux(158, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(158, GPIO_INPUT, GPIO_PULLUP);`;

const LED2 = `    // LED2, off
    GPIO_SetupPinMux(94, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(94, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPCCLEAR.bit.GPIO94 = 1;`;

// The signal measured in the last expert level: 1 kHz, high for 370 us, or
// for 625 us while PB1 is held, so the answer cannot be typed in.
const MYSTERY = `// The signal you have to measure on GPIO22, and the button that changes it.
// Do not change this part.
__interrupt void signal_isr(void)
{
    if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) {
        EPwm12Regs.CMPA.bit.CMPA = 31250;
    } else {
        EPwm12Regs.CMPA.bit.CMPA = 18500;
    }
    EPwm12Regs.ETCLR.bit.INT = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP3;
}

void start_signal(void)
{
    EPwm12Regs.TBCTL.bit.CTRMODE = 0;
    EPwm12Regs.TBCTL.bit.CLKDIV = 0;
    EPwm12Regs.TBCTR = 0;
    EPwm12Regs.TBPRD = 49999;
    EPwm12Regs.CMPA.bit.CMPA = 18500;
    EPwm12Regs.AQCTLA.bit.CAU = 1;
    EPwm12Regs.AQCTLA.bit.ZRO = 2;
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 5);

    GPIO_SetupPinMux(157, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(157, GPIO_INPUT, GPIO_PULLUP);

${PIE_INIT}

    EALLOW;
    PieVectTable.EPWM12_INT = &signal_isr;
    EDIS;
    EPwm12Regs.CMPB.bit.CMPB = 5000;
    EPwm12Regs.ETSEL.bit.INTSEL = 6;     // interrupt at CMPB, away from the edges
    EPwm12Regs.ETPS.bit.INTPRD = 1;
    EPwm12Regs.ETSEL.bit.INTEN = 1;
    PieCtrlRegs.PIEIER3.bit.INTx12 = 1;
    IER |= M_INT3;
    EINT;
}`;

export const pwm: Chapter = {
  id: "pwm",
  number: 9,
  title: "PWM",
  blurb: "Time base, compare and duty cycle.",
  requires: ["inputs"],
  course: ["L6-7", "Lab 3", "HW2"],
  levels: [
    {
      id: "pwm-brief",
      kind: "brief",
      title: "Power by switching",
      goal: "Understand what duty cycle is and why a digital pin can dim an LED or throttle a motor.",
      refs: [{ course: "L6-7", slide: [58, 59] }, { course: "Lab 3" }, { trm: "15.1" }],
      brief: `
A GPIO pin has two levels, so an LED on it is fully on or off. How do you get half brightness, or a motor at 30 % power?

## Switch fast and vary the on-time
**Pulse width modulation (PWM)** switches the pin at a fixed rate and changes how long it stays high in each cycle.

- The **period** is the time of one cycle. Cycles per second is the **carrier frequency**, 1 / period: a period of 100 us is 10 kHz.
- The **duty cycle** is the fraction of the period the pin is high: \`duty = high time / period\`. High for 25 us of every 100 us is 25 %.
- The **average voltage** is the duty cycle times the high level: 25 % of 3.3 V is 0.825 V.

One high stretch is a **pulse**: narrow at 25 %, wide at 75 %, at the same rate. Try it in the figure: move the duty cycle, then switch slowly and fast, and press Play to see when the LED stops blinking and starts dimming.

{{figure:pwm-average}}

## Why the load sees the average
The **load** is whatever the pin drives. The switching is faster than the load can follow. At 10 kHz your eye sees no flicker, only the average brightness. A motor is heavy and its coils resist fast changes of current, so it feels the average voltage. The robot's motors are switched at 20 kHz, too high to hear, so they do not whine.

## Why not a steady in-between voltage
A transistor that is fully on or fully off wastes almost no power. Held halfway, it turns the rest into heat. That is why the **motor amplifier**, the circuit that switches battery power to the motors, is driven with PWM.

## The ePWM peripheral
Toggling a pin in software with \`DELAY_US\` keeps the CPU from doing anything else. The chip has 12 **ePWM** (enhanced PWM) modules that make the waveform in hardware: you write one number for the period and one for the high time into registers, and the pin does the rest. On the robot, EPWM12A is on LED1 (GPIO22), and EPWM1A and EPWM2A go to the motor amplifier.
`,
      questions: [
        {
          prompt: "A pin switches between 0 V and 3.3 V at 20 kHz. It is high for 10 us of every 50 us period. What is the duty cycle?",
          options: ["10 %", "20 %", "50 %", "80 %"],
          answer: 1,
          why: "Duty cycle is high time over period: 10 us / 50 us = 0.2.",
        },
        {
          prompt: "You raise the duty cycle of LED1 from 25 % to 75 % and keep the period. What changes in the waveform?",
          options: ["The pulses come three times as often", "Each pulse gets three times as wide", "The high level rises from 0.8 V to 2.5 V", "The pulses get narrower"],
          answer: 1,
          why: "The carrier frequency stays the same. Only the width of each pulse changes. The pin never outputs anything but 0 V or 3.3 V.",
        },
        {
          prompt: "Why does a motor driven with 20 kHz PWM turn smoothly instead of jerking 20 000 times a second?",
          options: [
            "The amplifier converts the pulses into a steady voltage first",
            "The motor is too slow to follow each pulse, so it responds to the average",
            "The pulses are too small to move the motor",
            "The chip synchronises the pulses with the motor's rotation",
          ],
          answer: 1,
          why: "The load smooths the pulses out. Engineers say it acts as a low-pass filter: slow changes pass, fast ones are averaged away. As long as the carrier is much faster than the load, only the average matters.",
        },
      ],
      takeaway: "PWM sets an average by changing the width of pulses that repeat at a fixed frequency.",
    },
    {
      id: "pwm-sawtooth",
      kind: "timing",
      title: "From the counter to the pin",
      goal: "Draw the EPWM12A output that a small counter and one compare value produce.",
      refs: [{ course: "L6-7", slide: [67, 62] }, { course: "Lab 3" }, { trm: "15.4.6" }, { trm: "15.5.4" }, { trm: "15.6.5" }],
      brief: `
A **clock** is a signal inside the chip that ticks at a fixed, known rate. A **counter** is a register that adds 1 to itself on every tick, so its value tells how much time has passed. An ePWM module builds its waveform from a counter, in three parts.

1. **Time base.** A 16-bit counter, \`TBCTR\`, counts 0, 1, 2 ... When it reaches the value in the period register \`TBPRD\`, the next tick takes it back to 0. Plotted over time this is a **sawtooth**. One tooth is one PWM period.
2. **Counter compare.** The module compares the counter with the value in the register \`CMPA\` all the time. The moment they are equal is an **event**.
3. **Action qualifier.** For each event you choose what the pin does: nothing, go low, go high, or toggle.

The course's set-up uses two events:

- counter = **0**: **set** the pin (high)
- counter = **CMPA** while counting up: **clear** the pin (low)

So the pin is high from the start of each tooth until the counter gets to \`CMPA\`. A bigger \`CMPA\` means a longer high time. Try it in the figure: drag the \`CMPA\` and \`TBPRD\` lines and watch the pin, the period and the duty cycle follow.

{{figure:pwm-waveform}}

## Your turn
Here \`TBPRD = 7\` and \`CMPA = 3\`. The slots are the counter values of two teeth. The two grey rows mark where the events happen. Draw the pin: click a cell to switch it between low and high.

The pin changes **at** the event, so it is already low during the slot where the counter is 3.
`,
      slots: ["0", "1", "2", "3", "4", "5", "6", "7", "0", "1", "2", "3", "4", "5", "6", "7"],
      rows: [
        {
          name: "counter = 0",
          editable: false,
          initial: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
          answer: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
        },
        {
          name: "counter = CMPA",
          editable: false,
          initial: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
          answer: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
        },
        {
          name: "EPWM12A (GPIO22)",
          editable: true,
          initial: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          answer: [1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0],
        },
      ],
      hints: [
        "The pin goes high in the slot where the counter is 0 and stays high until the compare event.",
        "The compare event is in the slot where the counter is 3. From that slot on the pin is low, until the counter is 0 again.",
        "High in slots 0, 1 and 2 of each tooth, low in slots 3 to 7.",
      ],
      takeaway:
        "The tooth has TBPRD + 1 = 8 steps and the pin is high for CMPA = 3 of them: a duty cycle of 3/8. Duty = CMPA / (TBPRD + 1), which is very close to CMPA / TBPRD when TBPRD is in the thousands.",
    },
    {
      id: "pwm-numbers",
      kind: "calc",
      title: "Period and compare values",
      goal: "Work out TBPRD for a carrier frequency and CMPA for a duty cycle.",
      refs: [{ course: "L6-7", slide: [62, 72] }, { course: "Lab 3" }, { course: "HW2" }, { trm: "15.4.3" }, { trm: "15.15.2" }],
      brief: `
## How fast the counter ticks
The chip's main clock, **SYSCLK**, ticks 200 million times a second: 200 MHz. The ePWM modules get half of that, 100 MHz. A **clock divider** passes on only every 2nd, 4th ... tick, and the time base has two of them, set in the register \`TBCTL\`:

\`counter clock = 100 MHz / (HSPCLKDIV x CLKDIV)\`

\`HSPCLKDIV\` divides by **2 after reset** and the course never changes it. \`CLKDIV\` divides by 1 after reset. So the counter clock, \`TBCLK\` in the figure, ticks at **50 MHz**. One tick, called a **count**, lasts 1 / 50 000 000 s = **20 ns**. This is the "50 MHz clock" that Lab 3 and HW2 tell you to remember. Try it in the figure: change the two dividers and see how long one count lasts, then pick a frequency and read how many counts a period needs.

{{figure:pwm-clock-tree}}

## Period
A period is a number of counts. This chapter drives LED1 at **10 kHz**, a period of 1 / 10 000 s = 100 us:

\`100 us / 20 ns = 5000 counts\` (the same as 50 MHz / 10 kHz)

The labs write that round number into \`TBPRD\`, and so will you: \`TBPRD = 5000\`. Strictly, the counter runs 0, 1, ... TBPRD, which is TBPRD + 1 = 5001 counts: 0.02 % too long. Nobody sees that on an LED or a motor. The first three answers below let you check it.

Lab 3 asks for 20 kHz and homework 2 for 5 kHz. You work those out the same way.

## Duty cycle
With "set at zero, clear at CMPA" the pin is high for CMPA counts:

\`CMPA = duty x TBPRD\`

For 20 % at \`TBPRD = 5000\`: 0.20 x 5000 = 1000.
`,
      fields: [
        {
          id: "counts",
          label: "Counts of 20 ns in one 100 us period",
          answer: 5000,
          why: "100 us / 20 ns = 5000. The same number as 50 MHz / 10 kHz.",
        },
        {
          id: "exact",
          label: "TBPRD that makes the period exactly 5000 counts",
          answer: 4999,
          why: "The counter needs TBPRD + 1 counts for one period, because it also spends one count at 0. So TBPRD = 5000 - 1.",
        },
        {
          id: "round",
          label: "Carrier frequency with the round number, TBPRD = 5000",
          unit: "Hz",
          answer: 9998,
          tolPct: 0.01,
          why: "50 000 000 / 5001 = 9998 Hz. Close enough to 10 kHz for an LED or a motor.",
        },
        {
          id: "k4",
          label: "Counts in one period of a 4 kHz carrier",
          answer: 12500,
          why: "50 MHz / 4 kHz = 12 500 counts, a period of 250 us.",
        },
        {
          id: "cmpa",
          label: "CMPA for a 30 % duty cycle with TBPRD = 5000",
          answer: 1500,
          why: "0.30 x 5000 = 1500 counts high out of each period.",
        },
      ],
      hints: [
        "Divide the counter clock (50 000 000 counts per second) by the frequency you want: that is the number of counts in one period.",
        "One count is 20 ns. 100 us is 5000 of them, 250 us is 12 500.",
        "Exact TBPRD is counts - 1. Frequency is 50 000 000 / (TBPRD + 1). CMPA is duty x TBPRD.",
      ],
      takeaway: "Counts per period = 50 MHz / frequency. The exact register value is one less, and the course rounds it away.",
    },
    {
      id: "pwm-tbctl",
      kind: "register",
      title: "Start the counter: TBCTL",
      goal: "Change the time-base control register from its reset value to up-count, free run.",
      refs: [{ course: "L6-7", slide: [71, 60] }, { course: "Lab 3" }, { trm: "15.15.2" }, { trm: "15.4.2" }],
      brief: `
\`TBCTL\` is the time-base control register. After reset it holds \`0x0083\`. Its fields:

- \`CTRMODE\` (bits 1-0), the count mode: 0 = up, 1 = down, 2 = up-down, **3 = freeze**. Reset is 3, so the counter is **stopped** until you change it.
- \`PHSEN\` (bit 2), phase enable: 1 lets another ePWM module restart this counter, to keep several modules in step. The course leaves it at 0.
- \`HSPCLKDIV\` (bits 9-7): first clock divider. Reset is 1, which means /2. Leave it.
- \`CLKDIV\` (bits 12-10): second clock divider. The field holds a code, not the divisor: 0 = /1, 1 = /2, 2 = /4 ... 7 = /128.
- \`FREE_SOFT\` (bits 15-14): what the counter does when you pause the program from the PC to look inside it (the tool for that is the **debugger**). 0 stops the counter at once, 2 or 3 let it **run free**. A motor amplifier should not be left with its PWM frozen high, so the course sets free run.

Lab 3 has you write four of them. Set the register for: **count up**, **free run** (use 2), phase loading off, clock divide by 1. Two of those four are already what you want. Do not touch \`HSPCLKDIV\`.
`,
      reg: "EPwm12Regs.TBCTL",
      initial: 0x0083,
      targets: [
        { field: "CTRMODE", value: 0 },
        { field: "FREE_SOFT", value: 2 },
      ],
      code: "EPwm12Regs.TBCTL.bit.CTRMODE = 0;    // count up\nEPwm12Regs.TBCTL.bit.FREE_SOFT = 2;  // free run\nEPwm12Regs.TBCTL.bit.PHSEN = 0;      // already 0 after reset\nEPwm12Regs.TBCTL.bit.CLKDIV = 0;     // already 0 after reset",
      hints: [
        "Two fields differ from what you need: the count mode (CTRMODE) and FREE_SOFT.",
        "CTRMODE is 3 (both bits set) after reset. Up-count is 0, so clear bits 1 and 0.",
        "Clear bits 1 and 0, set bit 15. Bit 7 (HSPCLKDIV) stays set. The result is 0x8080.",
      ],
      takeaway:
        "The counter is frozen after reset. Writing CTRMODE = 0 is what starts the PWM. The .bit writes change one field and leave HSPCLKDIV alone, which is why the clock is 50 MHz and not 100 MHz.",
    },
    {
      id: "pwm-aqctla",
      kind: "register",
      title: "Choose the actions: AQCTLA",
      goal: "Set the action qualifier so the pin goes high at zero and low at the compare match.",
      refs: [{ course: "L6-7", slide: [65, 66] }, { course: "Lab 3" }, { trm: "15.6.2" }, { trm: "15.15.2" }],
      brief: `
Each ePWM module has two output pins, A and B. \`AQCTLA\` (action qualifier control A) says what output **A** does at each event of the time base. Every event has a 2-bit field:

- \`ZRO\` (bits 1-0): counter = 0
- \`PRD\` (bits 3-2): counter = TBPRD
- \`CAU\` (bits 5-4): counter = CMPA while counting **up**
- \`CAD\` (bits 7-6): counter = CMPA while counting **down**
- \`CBU\`, \`CBD\` (bits 11-8): the same for \`CMPB\`, a second compare register

The value in a field is the action:

- 0: do nothing
- 1: **clear**, the pin goes low
- 2: **set**, the pin goes high
- 3: toggle

After reset the whole register is 0: no event does anything, so the pin never moves even if the counter runs. Try it in the figure: open **More controls** and give the zero event and the compare event each of the four actions, and see what swapping set and clear does to the pin.

{{figure:pwm-waveform}}

Build the course's setting: **set** the pin when the counter is zero, **clear** it when the counter reaches CMPA on the way up.
`,
      reg: "EPwm12Regs.AQCTLA",
      initial: 0x0000,
      targets: [
        { field: "ZRO", value: 2 },
        { field: "CAU", value: 1 },
      ],
      code: "EPwm12Regs.AQCTLA.bit.CAU = 1;  // clear when the counter reaches CMPA\nEPwm12Regs.AQCTLA.bit.ZRO = 2;  // set when the counter is zero",
      hints: [
        "You need two fields: ZRO and CAU. The others stay 0.",
        "Set is 2 (binary 10), clear is 1 (binary 01).",
        "ZRO = 2 sets bit 1. CAU = 1 sets bit 4. The result is 0x0012.",
      ],
      takeaway: "Swap the two values and the waveform is upside down: low at the start of the period and high after the compare. You will meet that bug later.",
    },
    {
      id: "pwm-init",
      kind: "code",
      mode: "complete",
      title: "Half brightness",
      goal: "Complete the EPWM12A set-up so LED1 is driven at 10 kHz with a 50 % duty cycle.",
      refs: [{ course: "L6-7", slide: 71 }, { course: "Lab 3" }, { course: "HW2" }, { trm: "15.4" }, { trm: "15.6" }, { trm: "15.2" }],
      brief: `
This is the pattern of the first exercise of Lab 3, at another carrier frequency. The first five lines are the time base from the \`TBCTL\` puzzle, plus one that starts the counter at 0. You add the numbers and the pin.

1. **Period.** 10 kHz from the 50 MHz counter clock. Use the round number of counts, as the labs do.
2. **Compare.** Start at a 50 % duty cycle.
3. **Action qualifier.** Two lines, as in the \`AQCTLA\` puzzle: set the pin when the counter is zero, clear it when the counter reaches \`CMPA\`.
4. **Pin mux.** GPIO22 is a plain GPIO (mux position 0) until you say otherwise. The course's pin mux table lists what each position of each pin carries. For GPIO22, EPWM12A is position **5**:
\`\`\`c
GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 5);
\`\`\`

## The pull-up line
A pin's internal pull-up is a resistor to 3.3 V. On an input it keeps the pin from floating. On a PWM output it does nothing useful, and whenever the pin is low a small current flows through it for no reason. Following TI's examples, Lab 3 switches it off on every PWM pin. In \`GPAPUD\` a **1 disables** the pull-up.

LED1 lights when its pin is high, so the duty cycle is its brightness.
`,
      kit: "robot",
      durationMs: 20,
      starter: `void main(void)
{
${INIT}

    // Time base: done for you
    EPwm12Regs.TBCTL.bit.CTRMODE = 0;    // count up
    EPwm12Regs.TBCTL.bit.FREE_SOFT = 2;  // keep running at a breakpoint
    EPwm12Regs.TBCTL.bit.PHSEN = 0;      // no phase loading
    EPwm12Regs.TBCTL.bit.CLKDIV = 0;     // divide by 1
    EPwm12Regs.TBCTR = 0;                // start counting from zero

    // 1. Period: 10 kHz from the 50 MHz counter clock
    EPwm12Regs.TBPRD = 0;

    // 2. Duty cycle: 50 %
    EPwm12Regs.CMPA.bit.CMPA = 0;

    // 3. Action qualifier: set at zero, clear at CMPA

    EPwm12Regs.TBPHS.bit.TBPHS = 0;      // phase: not used

    // 4. Pin mux: GPIO22 must become EPWM12A
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO22 = 1;  // pull-up off on a PWM pin
    EDIS;

    while (1) {
    }
}
`,
      solution: `void main(void)
{
${INIT}

    // Time base: done for you
    EPwm12Regs.TBCTL.bit.CTRMODE = 0;    // count up
    EPwm12Regs.TBCTL.bit.FREE_SOFT = 2;  // keep running at a breakpoint
    EPwm12Regs.TBCTL.bit.PHSEN = 0;      // no phase loading
    EPwm12Regs.TBCTL.bit.CLKDIV = 0;     // divide by 1
    EPwm12Regs.TBCTR = 0;                // start counting from zero

    // 1. Period: 10 kHz from the 50 MHz counter clock
    EPwm12Regs.TBPRD = 5000;

    // 2. Duty cycle: 50 %
    EPwm12Regs.CMPA.bit.CMPA = 2500;

    // 3. Action qualifier: set at zero, clear at CMPA
    EPwm12Regs.AQCTLA.bit.CAU = 1;
    EPwm12Regs.AQCTLA.bit.ZRO = 2;

    EPwm12Regs.TBPHS.bit.TBPHS = 0;      // phase: not used

    // 4. Pin mux: GPIO22 must become EPWM12A
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 5);
    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO22 = 1;  // pull-up off on a PWM pin
    EDIS;

    while (1) {
    }
}
`,
      checks: [
        { kind: "reg", reg: "EPwm12Regs.TBPRD", equals: 5000, label: "TBPRD holds the counts of one 10 kHz period", hint: "The counter clock is 50 MHz, not 100 MHz: 50 000 000 / 10 000 counts." },
        { kind: "reg", reg: "EPwm12Regs.AQCTLA", field: "ZRO", equals: 2, label: "The pin is set when the counter is zero", hint: "Add EPwm12Regs.AQCTLA.bit.ZRO = 2; The action codes are 2 for set (high) and 1 for clear (low)." },
        { kind: "reg", reg: "EPwm12Regs.AQCTLA", field: "CAU", equals: 1, label: "The pin is cleared at the compare match", hint: "Add EPwm12Regs.AQCTLA.bit.CAU = 1; If you swapped 1 and 2, LED1 is dark when it should be lit." },
        { kind: "no-diagnostic", code: "pwm-mux", label: "EPWM12A is connected to its pin", hint: "The last argument of GPIO_SetupPinMux is still 0, plain GPIO. EPWM12A is position 5." },
        { kind: "duty", led: "LED1", pct: 50, tolPct: 1, from: 1, label: "LED1 is on half of the time", hint: "CMPA is a number of counts, not a percentage: half of TBPRD. If LED1 is on 0 % or 100 % of the time, fix the checks above first." },
        { kind: "blink", led: "LED1", periodMs: 0.1, tolPct: 1, label: "LED1 switches at 10 kHz", hint: "This is measured from the time between changes, so it only comes out right once the duty cycle is 50 %. Fix the checks above first." },
      ],
      inspect: ["EPwm12Regs.TBCTL", "EPwm12Regs.TBPRD", "EPwm12Regs.CMPA", "EPwm12Regs.AQCTLA"],
      hints: [
        "Four things are missing or wrong: TBPRD, CMPA, two AQCTLA lines, and the mux position. Run after each one and watch which check turns green.",
        "TBPRD is 50 MHz / 10 kHz counts and CMPA is half of that. The action values are 2 for set and 1 for clear.",
        "EPwm12Regs.AQCTLA.bit.CAU = 1; EPwm12Regs.AQCTLA.bit.ZRO = 2; and GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 5);",
      ],
      takeaway: "Period in TBPRD, duty in CMPA, actions in AQCTLA, and the pin mux. Leave one out and the pin stays still.",
    },
    {
      id: "pwm-own",
      kind: "code",
      mode: "write",
      title: "The whole set-up, from nothing",
      goal: "Write every line of an EPWM12A set-up yourself: LED1 at 4 kHz with a 30 % duty cycle.",
      refs: [{ course: "L6-7", slide: 71 }, { course: "Lab 3" }, { course: "HW2" }, { trm: "15.4" }, { trm: "15.6" }, { trm: "15.2" }],
      brief: `
In the lab nobody hands you the time-base lines. Write the whole set-up once, with new numbers: LED1 at **4 kHz**, on **30 %** of the time.

Every register belongs to \`EPwm12Regs\`. This is the list to work through, and each step is something you have done in this chapter:

1. \`TBCTL\`, four fields: \`CTRMODE\` count up, \`FREE_SOFT\` free run (2), \`PHSEN\` off, \`CLKDIV\` divide by 1.
2. \`TBCTR = 0\`: start counting from zero.
3. \`TBPRD\`: the counts of one 4 kHz period, at 20 ns per count. You worked this number out two levels ago.
4. \`CMPA.bit.CMPA\`: 30 % of \`TBPRD\`.
5. \`AQCTLA\`: set at zero (\`ZRO\`), clear at the compare match (\`CAU\`).
6. \`TBPHS.bit.TBPHS = 0\`.
7. The pin: mux position 5 for GPIO22, and its pull-up off (\`GPAPUD\`, between \`EALLOW;\` and \`EDIS;\`).

Two spellings to watch: \`TBCTR\` and \`TBPRD\` are written directly (\`EPwm12Regs.TBPRD = ...\`), the others through \`.bit\`.

Run often. The checks are in the order of the list, so the first red one is the next thing to fix.
`,
      kit: "robot",
      durationMs: 20,
      inspect: ["EPwm12Regs.TBCTL", "EPwm12Regs.TBPRD", "EPwm12Regs.CMPA", "EPwm12Regs.AQCTLA"],
      starter: `void main(void)
{
${INIT}

    // EPWM12A on LED1: 4 kHz, 30 %

    while (1) {
    }
}
`,
      solution: `void main(void)
{
${INIT}

${PWM12(12500, 3750, "4 kHz, 30 %")}
${MUX12}

    while (1) {
    }
}
`,
      checks: [
        { kind: "reg", reg: "EPwm12Regs.TBCTL", field: "CTRMODE", equals: 0, label: "1. The counter counts up", hint: "After reset CTRMODE is 3, frozen. EPwm12Regs.TBCTL.bit.CTRMODE = 0; starts it." },
        { kind: "reg", reg: "EPwm12Regs.TBCTL", field: "FREE_SOFT", equals: 2, label: "1. The counter runs free at a debugger halt", hint: "EPwm12Regs.TBCTL.bit.FREE_SOFT = 2;" },
        { kind: "reg", reg: "EPwm12Regs.TBCTL", field: "CLKDIV", equals: 0, label: "1. The counter clock is 50 MHz" },
        { kind: "reg", reg: "EPwm12Regs.TBPRD", equals: 12500, label: "3. TBPRD holds the counts of one 4 kHz period", hint: "50 000 000 counts per second / 4000 periods per second." },
        { kind: "reg", reg: "EPwm12Regs.CMPA", field: "CMPA", equals: 3750, label: "4. CMPA is 30 % of TBPRD", hint: "CMPA is in counts: 0.30 x 12500. Write the whole number, not 0.3 and not 30." },
        { kind: "reg", reg: "EPwm12Regs.AQCTLA", field: "ZRO", equals: 2, label: "5. The pin is set when the counter is zero", hint: "EPwm12Regs.AQCTLA.bit.ZRO = 2; (2 is set, 1 is clear)" },
        { kind: "reg", reg: "EPwm12Regs.AQCTLA", field: "CAU", equals: 1, label: "5. The pin is cleared at the compare match", hint: "EPwm12Regs.AQCTLA.bit.CAU = 1; (2 is set, 1 is clear)" },
        { kind: "no-diagnostic", code: "pwm-mux", label: "7. EPWM12A is connected to GPIO22", hint: "GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 5);" },
        { kind: "reg", reg: "GpioCtrlRegs.GPAPUD", field: "GPIO22", equals: 1, label: "7. The pull-up of GPIO22 is off", hint: "EALLOW; GpioCtrlRegs.GPAPUD.bit.GPIO22 = 1; EDIS;" },
        { kind: "duty", led: "LED1", pct: 30, tolPct: 1, from: 1, label: "LED1 is on 30 % of the time", hint: "Fix the first red check above: this one follows from them. If the counter is frozen or no pin is connected, LED1 stays dark." },
      ],
      hints: [
        "Open the level Half brightness next to this one: the lines are the same, only two numbers change.",
        "TBPRD = 12500 (50 MHz / 4 kHz) and CMPA = 3750 (0.30 x 12500).",
        "CTRMODE = 0; FREE_SOFT = 2; PHSEN = 0; CLKDIV = 0; TBCTR = 0; TBPRD = 12500; CMPA.bit.CMPA = 3750; AQCTLA.bit.CAU = 1; AQCTLA.bit.ZRO = 2; TBPHS.bit.TBPHS = 0; then GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 5); and the GPAPUD line.",
      ],
      takeaway: "Ten register lines and one mux line: that is every PWM set-up in the labs. Only the module number, the two numbers and the pin change.",
    },
    {
      id: "pwm-ramp",
      kind: "code",
      mode: "write",
      title: "Breathing LED",
      goal: "Ramp the brightness of LED1 up and down by changing CMPA a little every millisecond.",
      refs: [{ course: "L6-7", slide: 72, note: "duty cycle follows CMPA" }, { course: "Lab 3" }, { course: "HW2" }, { trm: "15.5" }],
      brief: `
Brightness is \`CMPA\`. Change \`CMPA\` a little at a time and LED1 fades. The PWM set-up is the one you wrote in the last level, now at 10 kHz (\`TBPRD = 5000\`).

The \`while (1)\` loop is given: it waits 1 ms with \`DELAY_US(1000)\` and then runs your code. Once per pass:

- While going up, raise \`CMPA\`. When it reaches the value in \`TBPRD\`, switch to going down.
- While going down, lower \`CMPA\`. When it reaches 0, switch to going up.

Keep the direction in the global \`int16_t updown\`: 1 means up, 0 means down. Change \`CMPA\` by **50** per pass: 5000 / 50 = 100 passes, so one ramp takes 100 ms.

\`CMPA\` starts at 0 and \`updown\` at 1.

You can read a register the same way you write it:
\`\`\`c
EPwm12Regs.CMPA.bit.CMPA = EPwm12Regs.CMPA.bit.CMPA + 50;   // 50 more than now
if (EPwm12Regs.CMPA.bit.CMPA == EPwm12Regs.TBPRD) {         // at the top?
\`\`\`

Lab 3 and HW2 ask for the same fade with a step of 1, in a function that a timer calls (chapters 4 and 5) instead of a loop with a delay. The body stays the same.
`,
      kit: "robot",
      durationMs: 232,
      watch: ["updown"],
      inspect: ["EPwm12Regs.CMPA", "EPwm12Regs.TBPRD"],
      starter: `int16_t updown = 1;   // 1: brightness going up, 0: going down

void main(void)
{
${INIT}

${PWM12(5000, 0, "10 kHz, starts dark")}
${MUX12}

    while (1) {
        DELAY_US(1000);   // once per millisecond

        // TODO: one step of the ramp

    }
}
`,
      solution: `int16_t updown = 1;   // 1: brightness going up, 0: going down

void main(void)
{
${INIT}

${PWM12(5000, 0, "10 kHz, starts dark")}
${MUX12}

    while (1) {
        DELAY_US(1000);   // once per millisecond

        if (updown == 1) {
            EPwm12Regs.CMPA.bit.CMPA = EPwm12Regs.CMPA.bit.CMPA + 50;
            if (EPwm12Regs.CMPA.bit.CMPA == EPwm12Regs.TBPRD) {
                updown = 0;
            }
        } else {
            EPwm12Regs.CMPA.bit.CMPA = EPwm12Regs.CMPA.bit.CMPA - 50;
            if (EPwm12Regs.CMPA.bit.CMPA == 0) {
                updown = 1;
            }
        }
    }
}
`,
      checks: [
        { kind: "reg", reg: "EPwm12Regs.CMPA", field: "CMPA", at: 20.5, equals: 1000, label: "After 20 ms CMPA is 1000", hint: "Add 50 to CMPA on every pass while updown is 1." },
        { kind: "reg", reg: "EPwm12Regs.CMPA", field: "CMPA", at: 80.5, equals: 4000, label: "After 80 ms CMPA is 4000", hint: "The step is 50 per pass. If CMPA is far too small, check the step. If it is 0, check that you add inside the while loop, after DELAY_US." },
        { kind: "duty", led: "LED1", pct: 98, tolPct: 2.5, from: 98, to: 102, label: "LED1 is brightest around 100 ms" },
        { kind: "reg", reg: "EPwm12Regs.CMPA", field: "CMPA", at: 140.5, equals: 3000, label: "After 140 ms CMPA is back down to 3000", hint: "When CMPA equals TBPRD, set updown to 0 and start subtracting." },
        { kind: "reg", reg: "EPwm12Regs.CMPA", field: "CMPA", at: 180.5, equals: 1000, label: "After 180 ms CMPA is 1000" },
        { kind: "reg", reg: "EPwm12Regs.CMPA", field: "CMPA", at: 220.5, equals: 1000, label: "After 220 ms CMPA is rising again", hint: "When CMPA is 0, set updown back to 1. Without that, CMPA wraps below zero to 65486." },
        { kind: "no-diagnostic", code: "cmp-over-period", label: "CMPA never goes above TBPRD", hint: "The ramp ran past an end. Going up, test for CMPA == TBPRD right after adding. Going down, test for CMPA == 0 right after subtracting." },
      ],
      hints: [
        "An if on updown with two branches: one adds 50, the other subtracts 50.",
        "After adding, compare CMPA with TBPRD and clear updown. After subtracting, compare CMPA with 0 and set updown.",
        "if (updown == 1) { CMPA = CMPA + 50; if (CMPA == TBPRD) updown = 0; } else { CMPA = CMPA - 50; if (CMPA == 0) updown = 1; } with the full register names.",
      ],
      takeaway:
        "The PWM runs by itself. Your code only writes a new compare value now and then. A new CMPA waits in a holding copy, the shadow register, and is used from the next period on, so the pulse in progress is never cut.",
    },
    {
      id: "pwm-debug-mux",
      kind: "code",
      mode: "debug",
      title: "LED1 stays dark",
      goal: "Find out why a PWM that is running does not reach LED1.",
      refs: [{ course: "L3", slide: [19, 23] }, { course: "Lab 3" }, { trm: "15.2" }, { trm: "8.7" }],
      brief: `
A lab partner set up EPWM12A for 75 % brightness. The registers look right in the debugger, the counter runs, and LED1 is dark.

A PWM module and its pin are two separate things. The module makes the waveform. The **pin mux** decides which signal a pin carries, and every pin offers several. The position is different for every pin, so a line copied from another PWM is usually wrong:

- GPIO0 carries EPWM1A at position 1.
- GPIO22 carries EPWM12A at position 5. At position 1 it belongs to a different peripheral (EQEP1S, an input of the encoder counter in chapter 11).

The course's pin mux table is where you look these up.

Run the code and read the message under the editor. Then fix the line.
`,
      kit: "robot",
      durationMs: 10,
      inspect: ["EPwm12Regs.TBCTR", "GpioCtrlRegs.GPAMUX2", "GpioCtrlRegs.GPAGMUX2"],
      starter: `void main(void)
{
${INIT}

${PWM12(5000, 3750, "10 kHz, 75 %")}

    // Copied from the EPWM1A set-up
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 1);
    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO22 = 1;      // pull-up off on a PWM pin
    EDIS;

    while (1) {
    }
}
`,
      solution: `void main(void)
{
${INIT}

${PWM12(5000, 3750, "10 kHz, 75 %")}

    // EPWM12A is index 5 on GPIO22
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 5);
    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO22 = 1;      // pull-up off on a PWM pin
    EDIS;

    while (1) {
    }
}
`,
      checks: [
        { kind: "duty", led: "LED1", pct: 75, tolPct: 1, from: 1, label: "LED1 is on 75 % of the time", hint: "The PWM registers are right. Look at what GPIO22 is connected to." },
        { kind: "no-diagnostic", code: "pwm-mux", label: "EPWM12A is connected to its pin", hint: "GPIO22 is at mux position 1, which is not EPWM12A. The position is the last argument of GPIO_SetupPinMux." },
      ],
      hints: [
        "The module is producing a waveform. The question is whether GPIO22 is listening to it.",
        "The third argument of GPIO_SetupPinMux is the mux position. For EPWM12A on GPIO22 the table says 5.",
        "Change the line to GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 5);",
      ],
      takeaway: "When a peripheral's registers look right and the pin does nothing, check the pin mux. The position number belongs to the pin, not to the peripheral.",
    },
    {
      id: "pwm-checkpoint",
      kind: "code",
      mode: "checkpoint",
      title: "Dimmer",
      goal: "Build a dimmer: PB1 makes LED1 brighter and PB2 makes it darker, without ever leaving 0 to 100 %.",
      refs: [{ course: "L6-7", slide: 72, note: "duty cycle follows CMPA" }, { course: "Lab 3" }, { course: "HW2" }, { course: "Lab 2" }, { trm: "15.5" }],
      brief: `
Put PWM together with the buttons.

The \`while (1)\` loop is given: it waits **10 ms** and then runs your code. Once per pass:

- While **PB1** (GPIO157) is held, raise \`CMPA\` of EPWM12 by **100**.
- While **PB2** (GPIO158) is held, lower it by **100**.
- Never let \`CMPA\` go above \`TBPRD\` or below 0. \`CMPA\` is unsigned (chapter 0): it has no negative values, so 0 minus 100 wraps around to 65436, far above the period. A test such as \`CMPA < 0\` is never true. Check **before** you change it: add only while \`CMPA <= TBPRD - 100\`, subtract only while \`CMPA >= 100\`.

A pressed button reads 0. Both buttons are on port E: \`GpioDataRegs.GPEDAT.bit.GPIO157\`.

LED1 starts dark (\`CMPA = 0\`). The PWM and the buttons are set up.
`,
      kit: "robot",
      durationMs: 1700,
      inspect: ["EPwm12Regs.CMPA"],
      stimuli: [
        { at: 5, press: "PB1" },
        { at: 255, release: "PB1" },
        { at: 305, press: "PB1" },
        { at: 995, release: "PB1" },
        { at: 1005, press: "PB2" },
        { at: 1295, release: "PB2" },
        { at: 1345, press: "PB2" },
        { at: 1695, release: "PB2" },
      ],
      starter: `void main(void)
{
${INIT}

${PWM12(5000, 0, "10 kHz, starts dark")}
${MUX12}

${BUTTONS}

    while (1) {
        DELAY_US(10000);   // once every 10 ms

        // TODO: PB1 brighter, PB2 darker, never outside 0 to TBPRD

    }
}
`,
      solution: `void main(void)
{
${INIT}

${PWM12(5000, 0, "10 kHz, starts dark")}
${MUX12}

${BUTTONS}

    while (1) {
        DELAY_US(10000);   // once every 10 ms

        if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) {
            if (EPwm12Regs.CMPA.bit.CMPA <= EPwm12Regs.TBPRD - 100) {
                EPwm12Regs.CMPA.bit.CMPA = EPwm12Regs.CMPA.bit.CMPA + 100;
            }
        }
        if (GpioDataRegs.GPEDAT.bit.GPIO158 == 0) {
            if (EPwm12Regs.CMPA.bit.CMPA >= 100) {
                EPwm12Regs.CMPA.bit.CMPA = EPwm12Regs.CMPA.bit.CMPA - 100;
            }
        }
    }
}
`,
      checks: [
        { kind: "reg", reg: "EPwm12Regs.CMPA", field: "CMPA", at: 300, equals: 2500, label: "PB1 held for 250 ms: CMPA is 2500", hint: "25 passes with PB1 pressed, 100 counts each. If CMPA stays 0, check the button test: a pressed button reads 0, and PB1 is GpioDataRegs.GPEDAT.bit.GPIO157." },
        { kind: "duty", led: "LED1", pct: 50, tolPct: 1, from: 270, to: 300, label: "LED1 is at half brightness" },
        { kind: "reg", reg: "EPwm12Regs.CMPA", field: "CMPA", at: 900, equals: 5000, label: "PB1 held longer: CMPA stops at TBPRD", hint: "Only add 100 while CMPA is at most TBPRD - 100." },
        { kind: "duty", led: "LED1", pct: 100, tolPct: 1, from: 700, to: 900, label: "LED1 is fully on" },
        { kind: "reg", reg: "EPwm12Regs.CMPA", field: "CMPA", at: 1300, equals: 2100, label: "PB2 held for 290 ms: CMPA is 2100", hint: "PB2 is GPIO158, also in GPEDAT. 29 passes of 100 down from 5000." },
        { kind: "reg", reg: "EPwm12Regs.CMPA", field: "CMPA", at: 1690, equals: 0, label: "PB2 held longer: CMPA stops at 0", hint: "CMPA is unsigned. Subtract only while CMPA is at least 100." },
        { kind: "no-diagnostic", code: "cmp-over-period", label: "CMPA never goes above TBPRD", hint: "A limit is missing or is tested too late. Test before you add or subtract, not after." },
      ],
      hints: [
        "Two separate ifs, one per button. Inside each, a second if guards the limit.",
        "Up: only if CMPA <= TBPRD - 100. Down: only if CMPA >= 100.",
        "if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) { if (EPwm12Regs.CMPA.bit.CMPA <= EPwm12Regs.TBPRD - 100) { ... + 100; } } and the mirror image for GPIO158.",
      ],
      takeaway: "Limit a value before you write it to a compare register. Stopping at a limit is called saturating. An unsigned value that wraps does not become a small negative number: it becomes a huge one.",
    },

    // ---------------------------------------------------------------- practice
    {
      id: "pwm-modes",
      kind: "calc",
      tier: "practice",
      title: "Other modes, other limits",
      goal: "Calculate periods in up-down mode and see how carrier frequency trades against resolution.",
      refs: [{ course: "L6-7", slide: [62, 70] }, { trm: "15.4.3" }, { trm: "15.4.6" }, { trm: "15.15.2" }],
      brief: `
## Count modes
\`TBCTL.CTRMODE\` selects the shape of the counter:

- **Up** (0): a sawtooth, 0 up to TBPRD, then back to 0. Period = (TBPRD + 1) counts. This is what the course uses.
- **Down** (1): the mirror image, TBPRD down to 0. Same period.
- **Up-down** (2): a **triangle**, 0 up to TBPRD and back down to 0. Period = **2 x TBPRD** counts. With a set on the way up and a clear on the way down, the pulse is centred in the period.
- **Freeze** (3): stopped. The reset state.

Try it in the figure: switch the count to up-down and see the triangle, the doubled period and the centred pulse.

{{figure:pwm-waveform}}

## Resolution
**Resolution** is the smallest step you can set. The compare value is a whole number of counts, so a period of N counts gives N + 1 duty cycles from 0 to 100 %: with 5000 counts one step is 1 / 5000 = 0.02 %. A faster carrier means fewer counts per period and coarser steps. You trade frequency for resolution, because their product is fixed by the counter clock:

\`counts per period = 50 MHz / carrier frequency\` (up-count)

## Slow carriers
\`TBPRD\` is 16 bits: at most 65 535. For a slower PWM than that allows, divide the clock with \`CLKDIV\` (/1, /2, /4 ... /128).
`,
      fields: [
        {
          id: "updown",
          label: "TBPRD for 20 kHz in up-down mode (50 MHz counter clock)",
          answer: 1250,
          why: "The period is 2 x TBPRD counts. 2500 counts / 2 = 1250.",
        },
        {
          id: "counts200",
          label: "Counts in one period at a 200 kHz carrier (up-count)",
          answer: 250,
          why: "50 MHz / 200 kHz = 250 counts.",
        },
        {
          id: "step",
          label: "Smallest duty-cycle step at 200 kHz",
          unit: "%",
          answer: 0.4,
          tolPct: 1,
          why: "One count out of 250 is 0.4 %. At 20 kHz it is one out of 2500: 0.04 %.",
        },
        {
          id: "fmax",
          label: "Highest carrier frequency that still has 1000 counts per period",
          unit: "Hz",
          answer: 50000,
          why: "50 MHz / 1000 = 50 kHz.",
        },
        {
          id: "fmin",
          label: "Lowest up-count frequency with CLKDIV = 0 (TBPRD = 65535)",
          unit: "Hz",
          answer: 762.94,
          tolPct: 0.1,
          why: "50 000 000 / 65 536 = 762.9 Hz. A 50 Hz servo signal does not fit: it needs a clock divider.",
        },
      ],
      hints: [
        "Start every answer from 50 000 000 counts per second.",
        "Up-down counts every value twice per period, so TBPRD is half the number of counts.",
        "1250, 250, 100 / 250, 50 000 000 / 1000, 50 000 000 / 65 536.",
      ],
      takeaway: "Counts per period is the resolution. Raise the carrier and you lose steps. Lower it far enough and you need CLKDIV.",
    },
    {
      id: "pwm-lab",
      kind: "quiz",
      tier: "practice",
      title: "PWM lab",
      goal: "Find out by experiment what the count mode, the compare value, the actions and the clock divider do to the pin.",
      refs: [{ course: "L6-7", slide: [62, 68, 69] }, { trm: "15.4.3" }, { trm: "15.6.3" }, { trm: "15.6.5" }, { trm: "15.10.1" }],
      brief: `
So far you met the ePWM one register at a time. Here is the whole module on one time axis. Nothing in this level has to be worked out on paper: **set it up in the figure and look**.

{{figure:pwm-playground}}

## How to use it
- **Start from** loads a complete set-up. "LED dimmer" is the one you wrote in this chapter.
- The picture shows the counter with \`TBPRD\`, \`CMPA\` and \`CMPB\` as dashed lines, then the two pins of the module. Dots on the counter are **events**: \`ZRO\` (counter = 0), \`PRD\` (counter = TBPRD), \`CAU\` and \`CAD\` (counter = CMPA on the way up, on the way down). A large orange dot moved a pin.
- The controls are in groups. **Clock and period** holds the count mode, \`TBPRD\` and \`CLKDIV\`. **Compare** holds \`CMPA\`. **What each event does** is \`AQCTLA\` as a row of cells: press a cell to step through none, clear, set and toggle.
- The sentence under the numbers says what the pins are doing and why. Read it after every change.
- **Triggers and interrupt** can send a pulse called **SOCA** at an event of your choice. The ADC of chapter 8 can use that pulse as its "measure now" signal.

Two words you need: a pulse is **centred** when its middle is the middle of the period, with equal low time before and after it. A signal is **active low** when the part it drives is on while the pin is low.

For each question, build the set-up and watch the pin, the duty cycle and the frequency.
`,
      questions: [
        {
          prompt: "Start from \"LED dimmer\". Which change puts the pulse in the middle of the period instead of at its start?",
          options: [
            "Count down, with ZRO = set and CAU = clear",
            "Count up, with CMPA = TBPRD / 2",
            "Count up-down, with CAU = set, CAD = clear and ZRO = none",
            "Count up-down, with ZRO = set and PRD = clear",
          ],
          answer: 2,
          why: "On the triangle the counter passes CMPA twice, at equal distances from the peak. Setting on the way up and clearing on the way down puts the pulse around the peak. ZRO set and PRD clear gives a pulse that starts at the beginning of the period.",
        },
        {
          prompt: "\"LED dimmer\" again (up count, TBPRD = 5000). Type CMPA = 6000. What does the pin do?",
          options: ["It stays low: 0 %", "It stays high: 100 %", "It is high for 6000 counts, so the period gets longer", "It goes back to 50 %"],
          answer: 1,
          why: "The counter turns back at 5000 and never reaches 6000, so CAU never happens. Only the set at zero is left. The period does not change: only TBPRD sets it.",
        },
        {
          prompt: "\"LED dimmer\" with CMPA = 0. The pin is set at zero and cleared at CMPA, and now both fall on count 0. What do you see?",
          options: ["The pin stays high: the zero event wins", "A pulse one count wide", "The pin toggles every period", "The pin stays low: the compare event wins"],
          answer: 3,
          why: "When two events share a count, the chip acts on one of them. In up count the compare event has priority over the zero event, so the pin is cleared and never set. That is why CMPA = 0 is a clean 0 %.",
        },
        {
          prompt: "A fan is on while its pin is low. It must be on for 25 % of each period. Up count, TBPRD = 5000, CMPA = 1250. Which actions do that?",
          options: ["ZRO = clear, CAU = set", "ZRO = set, CAU = clear", "ZRO = toggle, CAU = none", "ZRO = clear, CAU = clear"],
          answer: 0,
          why: "The pin goes low at zero and high at CMPA: low for 1250 of the 5001 counts. The duty cycle read-out shows 75 % because it counts the high time. Swapping the two actions turns the waveform upside down.",
        },
        {
          prompt: "Up count, CLKDIV = 2 and TBPRD = 31249. What is the frequency of the counter?",
          options: ["1600 Hz", "400 Hz", "800 Hz", "200 Hz"],
          answer: 1,
          why: "CLKDIV = 2 divides by 4: 50 MHz / 4 = 12.5 MHz. One period is 31249 + 1 = 31250 counts, and 12 500 000 / 31 250 = 400.",
        },
        {
          prompt: "Start from \"Centred, triggers ADC\" (up-down count, SOCASEL = 2). Where in the period does the SOCA pulse come?",
          options: [
            "At the valley of the triangle, where the counter is 0",
            "At both edges of the pulse on the pin",
            "At the peak of the triangle, in the middle of the pulse on the pin",
            "At CMPA on the way up",
          ],
          answer: 2,
          why: "SOCASEL = 2 selects the event counter = TBPRD, the peak. With a centred pulse that is its middle, as far as possible from both edges, where switching disturbs a measurement least.",
        },
      ],
      hints: [
        "Every answer can be read off the figure. Load the preset the question names, change only what it says, and read the sentence under the numbers.",
        "Count mode, TBPRD and CLKDIV are in \"Clock and period\". CMPA is in \"Compare\". The actions are in \"What each event does\". SOCA is in \"Triggers and interrupt\".",
        "Centred: up-down with CAU set and CAD clear. CMPA above TBPRD: stuck high. CMPA = 0: stuck low. Active low: clear at zero, set at CMPA. 12.5 MHz / 31250. The peak.",
      ],
      takeaway: "The counter makes events, the action qualifier turns events into edges, and a compare value the counter never reaches makes no event at all. When in doubt, set it up and look.",
    },
    {
      id: "pwm-second",
      kind: "calc",
      tier: "practice",
      title: "The second output",
      goal: "Use EPWMxB and CMPB: a second pin on the same counter with its own duty cycle.",
      refs: [{ course: "L6-7", slide: 67, note: "EPWMxB with CMPB on the same counter" }, { course: "HW4" }, { trm: "15.5.3" }, { trm: "15.6.5" }, { trm: "15.15.2" }],
      brief: `
Every ePWM module has **two** pins. You used the first, **EPWM12A**. The second is **EPWM12B**, on GPIO23 for module 12. The robot's two RC servos hang on the A and B pins of one module (chapter 10).

The two pins share everything in the time base: one counter, one \`TBPRD\`, one clock. So they always have the **same period**. What each pin has of its own:

- its own action register: \`AQCTLA\` for pin A, \`AQCTLB\` for pin B. Same fields, same four actions.
- a second compare register, \`CMPB\`, with its own events: \`CBU\` (counter = CMPB going up) and \`CBD\` (going down).

Either action register may use either compare value. The usual choice mirrors pin A:

\`\`\`c
EPwm12Regs.CMPB.bit.CMPB = 3000;
EPwm12Regs.AQCTLB.bit.ZRO = 2;   // set B at zero
EPwm12Regs.AQCTLB.bit.CBU = 1;   // clear B at CMPB
\`\`\`

Pin B is then high for CMPB counts, as pin A is for CMPA counts.

Because \`AQCTLB\` can use both, pin B can also start at one compare value and stop at the other: set at \`CAU\`, clear at \`CBU\`. The pulse then sits anywhere in the period.

Try it in the figure: load "LED dimmer", open **What each event does** and give the \`AQCTLB\` row ZRO = set and CBU = clear. Then drag the dotted \`CMPB\` line.

{{figure:pwm-playground}}

In \`AQCTLB\`, as in \`AQCTLA\`, each field is two bits: ZRO in bits 1-0, PRD in 3-2, CAU in 5-4, CAD in 7-6, CBU in 9-8, CBD in 11-10. This chapter's numbers: up count, \`TBPRD = 5000\`, one count is 20 ns.
`,
      fields: [
        {
          id: "cmpb",
          label: "CMPB for 60 % on EPWM12B (set at zero, clear at CBU)",
          answer: 3000,
          why: "0.60 x 5000 = 3000, the same rule as CMPA = duty x TBPRD.",
        },
        {
          id: "period",
          label: "Period of EPWM12B when EPWM12A has a period of 100 us",
          unit: "us",
          answer: 100,
          why: "Both pins come from the same counter and the same TBPRD. They cannot have different periods.",
        },
        {
          id: "between",
          label: "AQCTLB: CAU = set, CBU = clear. CMPA = 1000, CMPB = 3000. Counts pin B is high in a period",
          answer: 2000,
          why: "High from count 1000 to count 3000: 3000 - 1000 = 2000 counts.",
        },
        {
          id: "duty",
          label: "That pulse as a duty cycle",
          unit: "%",
          answer: 40,
          tolPct: 0.5,
          why: "2000 / 5000 = 40 % (39.99 % with the exact 5001 counts).",
        },
        {
          id: "reg",
          label: "Value of AQCTLB with ZRO = 2 and CBU = 1, as a decimal number",
          answer: 258,
          why: "ZRO = 2 in bits 1-0 is 2. CBU = 1 in bits 9-8 is 1 x 256. 256 + 2 = 258 (0x0102).",
        },
      ],
      hints: [
        "Pin B follows the same rules as pin A, with CMPB and AQCTLB in place of CMPA and AQCTLA.",
        "A pulse from one compare value to the other is as long as their difference. A field in bits 9-8 is worth its value times 256.",
        "0.6 x 5000, 100, 3000 - 1000, 2000 / 5000, 256 + 2.",
      ],
      takeaway: "One module is one counter and two pins. A and B can differ in duty cycle and in where the pulse sits, never in period.",
    },
    {
      id: "pwm-deadband",
      kind: "calc",
      tier: "practice",
      title: "A gap between two switches",
      goal: "Work out the delays of the dead-band unit that keep two transistors from conducting together.",
      refs: [{ course: "L6-7", slide: 76, note: "shoot-through in an H-bridge leg" }, { trm: "15.7.1" }, { trm: "15.7.3" }, { trm: "15.15.2" }],
      brief: `
A motor amplifier (chapter 10) has pairs of transistors in a row between the battery and ground. One connects the motor wire to the battery, the other to ground. They get opposite signals: a **complementary pair**, one on while the other is off.

A transistor needs a moment to switch off. If its partner switches on in that moment, both conduct and short the battery. So the "on" edge of each signal is held back a little. For that time both are off: the **dead time**.

The ePWM has a **dead-band unit** for this, after the action qualifier. It takes pin A's signal and makes both pins from it:

- \`DBCTL.OUT_MODE = 3\` switches both delays on.
- \`DBRED\` is the **rising-edge delay**: pin A goes high that many counts late. It goes low on time.
- \`DBFED\` is the **falling-edge delay** for the second signal. With \`DBCTL.POLSEL = 2\` that signal is then inverted, so pin B goes high \`DBFED\` counts after pin A went low.

Both delays are counts of the counter clock: \`delay = register x 20 ns\` at 50 MHz.

Try it in the figure: load "Pair with dead time", press **+** next to View to zoom in, and step through the edges. Then open **Dead band** and change the two delays.

{{figure:pwm-playground}}

The numbers below use that preset: up-down count, \`TBPRD = 1250\` (a period of 2500 counts), \`CMPA = 625\`, set at CAU and clear at CAD, so the signal is high for 1250 counts before the dead band. The game's simulator has no dead-band unit, so this level is paper and figure only. The expert level "Two outputs that never overlap" builds the same gap in code with CMPA and CMPB.
`,
      fields: [
        {
          id: "dbred",
          label: "DBRED for a rising-edge delay of 1 us (one count is 20 ns)",
          answer: 50,
          why: "1 us / 20 ns = 50 counts.",
        },
        {
          id: "high",
          label: "Counts pin A is high per period with DBRED = 100",
          answer: 1150,
          why: "The rising edge comes 100 counts late and the falling edge on time: 1250 - 100 = 1150.",
        },
        {
          id: "duty",
          label: "Duty cycle of pin A with DBRED = 100",
          unit: "%",
          answer: 46,
          tolPct: 0.5,
          why: "1150 / 2500 = 46 %. The dead time is taken out of the pulse.",
        },
        {
          id: "both",
          label: "Time per period in which both pins are low, with DBRED = DBFED = 100",
          unit: "us",
          answer: 4,
          why: "Two gaps per period, one at each switch-over: 2 x 100 counts x 20 ns = 4 us.",
        },
        {
          id: "slow",
          label: "Rising-edge delay with DBRED = 100 after CLKDIV is changed to 1",
          unit: "us",
          answer: 4,
          why: "CLKDIV = 1 halves the counter clock to 25 MHz: one count is 40 ns, and 100 x 40 ns = 4 us. The delay is in counts, so it follows the clock.",
        },
      ],
      hints: [
        "Turn each time into counts of 20 ns, or each count into time.",
        "Only the rising edge of pin A moves. Its high time shrinks by DBRED counts. There is one gap after each of the two switch-overs in a period.",
        "50, 1250 - 100, 1150 / 2500, 2 x 100 x 20 ns, 100 x 40 ns.",
      ],
      takeaway: "The dead-band unit makes a complementary pair from one signal and delays each switch-on edge by a number of counts. The gap is paid for out of the pulse.",
    },
    {
      id: "pwm-debug-three",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "Three wrong lines",
      goal: "Fix a 2 kHz PWM whose frequency, polarity and compare value are all wrong.",
      refs: [{ course: "L6-7", slide: [71, 68] }, { course: "HW2" }, { course: "Lab 3" }, { trm: "15.6.2" }, { trm: "15.15.2" }, { trm: "15.5" }],
      brief: `
This code should drive LED1 at **2 kHz** with a brightness of **25 %**, and 10 ms later of **60 %**. It has three separate bugs, each from a pitfall the handouts mention.

1. **The clock divider.** \`CLKDIV\` is a code, not a number to divide by: 0 is /1, 1 is /2, 2 is /4. Read the comment and then the value.
2. **The actions.** Set and clear are easy to swap. Draw the waveform the two lines produce and compare it with the one you want.
3. **A float in an integer register.** Lab 3 warns about this: C cuts the fraction off when a \`float\` is assigned to an integer, it does not round. 0.25 becomes 0. \`CMPA\` holds counts, not a fraction.

Fix all three. \`set_brightness\` must work for any brightness from 0.0 to 1.0: compute the compare value from its argument and from \`TBPRD\`.
`,
      kit: "robot",
      durationMs: 20,
      inspect: ["EPwm12Regs.TBCTL", "EPwm12Regs.AQCTLA", "EPwm12Regs.CMPA"],
      starter: `void set_brightness(float brightness);

void main(void)
{
${INIT}

    EPwm12Regs.TBCTL.bit.CTRMODE = 0;    // count up
    EPwm12Regs.TBCTL.bit.FREE_SOFT = 2;  // keep running at a breakpoint
    EPwm12Regs.TBCTL.bit.PHSEN = 0;      // no phase loading
    EPwm12Regs.TBCTL.bit.CLKDIV = 1;     // divide by 1
    EPwm12Regs.TBCTR = 0;
    EPwm12Regs.TBPRD = 25000;            // 2 kHz
    EPwm12Regs.AQCTLA.bit.CAU = 2;       // at the compare match
    EPwm12Regs.AQCTLA.bit.ZRO = 1;       // at zero
    EPwm12Regs.TBPHS.bit.TBPHS = 0;

${MUX12}

    set_brightness(0.25);
    DELAY_US(10000);
    set_brightness(0.6);

    while (1) {
    }
}

// brightness: 0.0 is dark, 1.0 is fully on
void set_brightness(float brightness)
{
    EPwm12Regs.CMPA.bit.CMPA = brightness;
}
`,
      solution: `void set_brightness(float brightness);

void main(void)
{
${INIT}

    EPwm12Regs.TBCTL.bit.CTRMODE = 0;    // count up
    EPwm12Regs.TBCTL.bit.FREE_SOFT = 2;  // keep running at a breakpoint
    EPwm12Regs.TBCTL.bit.PHSEN = 0;      // no phase loading
    EPwm12Regs.TBCTL.bit.CLKDIV = 0;     // divide by 1
    EPwm12Regs.TBCTR = 0;
    EPwm12Regs.TBPRD = 25000;            // 2 kHz
    EPwm12Regs.AQCTLA.bit.CAU = 1;       // clear at the compare match
    EPwm12Regs.AQCTLA.bit.ZRO = 2;       // set at zero
    EPwm12Regs.TBPHS.bit.TBPHS = 0;

${MUX12}

    set_brightness(0.25);
    DELAY_US(10000);
    set_brightness(0.6);

    while (1) {
    }
}

// brightness: 0.0 is dark, 1.0 is fully on
void set_brightness(float brightness)
{
    EPwm12Regs.CMPA.bit.CMPA = brightness * EPwm12Regs.TBPRD;
}
`,
      checks: [
        { kind: "reg", reg: "EPwm12Regs.TBCTL", field: "CLKDIV", equals: 0, label: "The counter clock is 50 MHz, so TBPRD = 25000 is 2 kHz", hint: "CLKDIV = 1 divides by 2, which halves the frequency." },
        { kind: "duty", led: "LED1", pct: 25, tolPct: 1, from: 1, to: 9.5, label: "LED1 is on 25 % of the time at first", hint: "CMPA must be 0.25 x TBPRD counts, and the pin must be set at zero and cleared at the match." },
        { kind: "duty", led: "LED1", pct: 60, tolPct: 1, from: 11, to: 20, label: "and 60 % after the second call", hint: "Compute CMPA from the argument: brightness * EPwm12Regs.TBPRD. A constant only works for one brightness." },
        { kind: "reg", reg: "EPwm12Regs.AQCTLA", field: "ZRO", equals: 2, label: "The pin is set when the counter is zero" },
        { kind: "no-diagnostic", code: "cmp-float", label: "No fraction is lost in CMPA" },
      ],
      hints: [
        "One bug is in a TBCTL line, one in the two AQCTLA lines, one in set_brightness.",
        "CLKDIV must be 0. CAU must be 1 (clear) and ZRO 2 (set). CMPA needs counts: a fraction of TBPRD.",
        "EPwm12Regs.CMPA.bit.CMPA = brightness * EPwm12Regs.TBPRD;",
      ],
      takeaway:
        "0.25 assigned to an integer is 0. Multiply by the period first: 0.25 x 25000 = 6250 counts. The product is still a float and is still cut off, but now it loses less than one count.",
    },

    {
      id: "pwm-req",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "From the requirements alone",
      goal: "Write a complete PWM set-up for another module and another pin from its requirements, with no list of lines to follow.",
      refs: [{ course: "L6-7", slide: 71 }, { course: "Lab 3" }, { trm: "15.4" }, { trm: "15.4.3" }, { trm: "15.6" }, { trm: "15.15.2" }, { trm: "15.2" }],
      brief: `
In "The whole set-up, from nothing" a list told you which lines to write. A lab gives you less: what the signal must be, and on which pin. Which registers that takes is for you to know.

## Requirements
- Output: **EPWM1A** on **GPIO0**. The course's pin mux table says: GPIO0, position **1**, EPWM1A.
- Frequency: **250 Hz**.
- Duty cycle: **40 %**, high at the start of each period.
- Up-count. Free run when the program is paused from the PC.
- **Finest steps:** use the smallest clock divider for which one period still fits in \`TBPRD\`.
- Pull-up of the pin off, as on every PWM pin.

## What is new
Only one thing: the number does not fit. At 50 MHz one period of 250 Hz is 50 000 000 / 250 = 200 000 counts, and \`TBPRD\` has 16 bits: **65535** at most. Written anyway, the value is cut off to its lowest 16 bits and the frequency is wrong.

So the counter has to count slower. \`TBCTL.CLKDIV\` divides its clock, and the field holds a **code**: 0 = /1, 1 = /2, 2 = /4, 3 = /8. Each step halves the counts per period. Take the first divider that brings the count to 65535 or less, then work out \`TBPRD\` and \`CMPA\` from the slower clock. Use the round number of counts, as before.

A slower clock means longer counts, so coarser duty-cycle steps. That is why you take the smallest divider that works.

The registers are those of \`EPwm1Regs\`. The test measures GPIO0 for 40 ms.
`,
      kit: "robot",
      durationMs: 40,
      inspect: ["EPwm1Regs.TBCTL", "EPwm1Regs.TBPRD", "EPwm1Regs.CMPA", "EPwm1Regs.AQCTLA"],
      starter: `void main(void)
{
${INIT}

    // EPWM1A on GPIO0: 250 Hz, 40 %

    while (1) {
    }
}
`,
      solution: `void main(void)
{
${INIT}

    // EPWM1A on GPIO0: 250 Hz, 40 %
    EPwm1Regs.TBCTL.bit.CTRMODE = 0;     // count up
    EPwm1Regs.TBCTL.bit.FREE_SOFT = 2;   // keep running at a breakpoint
    EPwm1Regs.TBCTL.bit.PHSEN = 0;       // no phase loading
    EPwm1Regs.TBCTL.bit.CLKDIV = 2;      // divide by 4: 12.5 MHz, 80 ns per count
    EPwm1Regs.TBCTR = 0;                 // start counting from zero
    EPwm1Regs.TBPRD = 50000;             // 12 500 000 / 250
    EPwm1Regs.CMPA.bit.CMPA = 20000;     // 40 % of 50000
    EPwm1Regs.AQCTLA.bit.CAU = 1;        // clear the pin when the counter reaches CMPA
    EPwm1Regs.AQCTLA.bit.ZRO = 2;        // set the pin when the counter is zero
    EPwm1Regs.TBPHS.bit.TBPHS = 0;       // phase: not used

    GPIO_SetupPinMux(0, GPIO_MUX_CPU1, 1);   // GPIO0 becomes EPWM1A
    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO0 = 1;       // pull-up off on a PWM pin
    EDIS;

    while (1) {
    }
}
`,
      checks: [
        { kind: "reg", reg: "EPwm1Regs.TBCTL", field: "CTRMODE", equals: 0, label: "The counter counts up", hint: "TBCTL.CTRMODE is 3 after reset: frozen. 0 is up-count." },
        { kind: "reg", reg: "EPwm1Regs.TBCTL", field: "FREE_SOFT", equals: 2, label: "The counter runs free when the program is paused", hint: "TBCTL.FREE_SOFT = 2." },
        {
          kind: "reg",
          reg: "EPwm1Regs.TBCTL",
          field: "CLKDIV",
          equals: 2,
          label: "The clock divider is the smallest that fits: divide by 4",
          hint: "CLKDIV holds a code: 0 = /1, 1 = /2, 2 = /4. 200 000 counts halve to 100 000 (too many), then to 50 000 (fits). A larger divider works but makes the steps coarser.",
        },
        {
          kind: "reg",
          reg: "EPwm1Regs.TBPRD",
          equals: 50000,
          label: "TBPRD holds the counts of one 250 Hz period at the divided clock",
          hint: "12 500 000 counts per second / 250 periods per second. If you see 3392: you wrote 200 000, which was cut off to 16 bits.",
        },
        { kind: "reg", reg: "EPwm1Regs.CMPA", field: "CMPA", equals: 20000, label: "CMPA is 40 % of TBPRD", hint: "CMPA is a number of counts: 0.40 x TBPRD. Not 40 and not 0.4." },
        { kind: "reg", reg: "EPwm1Regs.AQCTLA", field: "ZRO", equals: 2, label: "The pin is set when the counter is zero", hint: "AQCTLA.ZRO chooses the action at zero: 2 is set, 1 is clear." },
        { kind: "reg", reg: "EPwm1Regs.AQCTLA", field: "CAU", equals: 1, label: "The pin is cleared at the compare match", hint: "AQCTLA.CAU chooses the action when the counter reaches CMPA: 1 is clear." },
        { kind: "no-diagnostic", code: "pwm-mux", label: "EPWM1A is connected to GPIO0", hint: "GPIO_SetupPinMux(0, GPIO_MUX_CPU1, 1); The position comes from the pin mux table: it is not 5 for every pin." },
        { kind: "reg", reg: "GpioCtrlRegs.GPAPUD", field: "GPIO0", equals: 1, label: "The pull-up of GPIO0 is off", hint: "GPAPUD is protected: EALLOW; GpioCtrlRegs.GPAPUD.bit.GPIO0 = 1; EDIS;" },
        { kind: "no-diagnostic", code: "eallow", label: "Every protected write is between EALLOW; and EDIS;" },
        { kind: "duty", pin: 0, pct: 40, tolPct: 1, from: 4, label: "GPIO0 is high 40 % of the time", hint: "0 %: the counter is frozen, no pin is connected, or the two actions are missing. 60 %: the actions are swapped. 100 %: CMPA is larger than TBPRD, so the counter never reaches it." },
        { kind: "pin", pin: 0, at: 21.5, level: 1, label: "A period lasts 4 ms: high 1.5 ms after the start of the sixth period", hint: "Fix the red checks above first. If they are all green, the frequency is wrong: counts x time per count must be 4 ms, so look at CLKDIV and TBPRD together." },
        { kind: "pin", pin: 0, at: 21.7, level: 0, label: "and low 1.7 ms after it", hint: "Fix the red checks above first. If they are all green, the frequency is wrong: counts x time per count must be 4 ms, so look at CLKDIV and TBPRD together." },
        { kind: "pin", pin: 0, at: 24.1, level: 1, label: "and high again when the seventh period has begun", hint: "Fix the red checks above first. If they are all green, the frequency is wrong: counts x time per count must be 4 ms, so look at CLKDIV and TBPRD together." },
      ],
      hints: [
        "It is the set-up you wrote for EPWM12A, with EPwm1Regs, three new numbers and another pin. Find the divider first.",
        "Divide by 4 (CLKDIV = 2): the clock is 12.5 MHz, one period is 50 000 counts, and 40 % of that is 20 000.",
        "CTRMODE = 0; FREE_SOFT = 2; PHSEN = 0; CLKDIV = 2; TBCTR = 0; TBPRD = 50000; CMPA.bit.CMPA = 20000; AQCTLA.bit.CAU = 1; AQCTLA.bit.ZRO = 2; TBPHS.bit.TBPHS = 0; then GPIO_SetupPinMux(0, GPIO_MUX_CPU1, 1); and the GPAPUD line for GPIO0.",
      ],
      takeaway: "A requirement turns into registers in a fixed order: clock and divider, period, compare, actions, pin. When the period does not fit in 16 bits, slow the counter with CLKDIV.",
    },

    // ---------------------------------------------------------------- expert
    {
      id: "pwm-x-trigger",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "A PWM module as a timer",
      goal: "Use EPWM5 with no pin at all as a 1 kHz interrupt source, through its event trigger and the PIE.",
      refs: [{ course: "L4", slide: 33, note: "EPWMx_INT at counter zero or period" }, { course: "L8-9", slide: 20, note: "an ePWM as a timer: ETSEL and ETPS" }, { course: "HW2" }, { trm: "15.10" }, { trm: "15.10.1" }, { trm: "3.4.5" }, { trm: "15.4.3" }],
      brief: `
**This level needs chapter 5 (interrupts).** An ePWM time base is a timer, whether or not a pin is attached. HW2 uses one this way to tell the ADC (chapter 8) when to measure. The part that turns time-base events into pulses is the **event trigger**:

- \`ETSEL\` selects the event and enables each output. For the interrupt: \`INTSEL\` (1 = counter is zero, 2 = counter equals TBPRD) and \`INTEN\`. The ADC triggers have their own fields, \`SOCASEL\` and \`SOCAEN\`.
- \`ETPS\` is a prescaler: \`INTPRD\` = 1 passes every event, 2 every second, 3 every third. **0 passes none**, and 0 is the reset value.
- \`ETFLG.INT\` is set with each interrupt. Until you clear it by writing 1 to \`ETCLR.INT\`, the module sends **no further interrupt**.

The interrupt of EPWM*n* is **INT3.*n*** in the PIE. So this is a group 3 interrupt, with everything that belongs to one.

## Task
No CPU timer is used in this level.

- Make EPWM5 count up with a period of **1 ms**.
- Make it interrupt on every period, in a function \`epwm5_isr\`.
- In \`epwm5_isr\`: count the call in \`ticks\`, and toggle LED2 (GPIO94) on every 50th call. \`ticks % 50\` is the remainder of \`ticks / 50\`: it is 0 on every 50th call.

LED2 then blinks with a period of 100 ms.
`,
      kit: "robot",
      durationMs: 500.5,
      watch: ["ticks"],
      inspect: ["EPwm5Regs.ETSEL", "EPwm5Regs.ETPS", "EPwm5Regs.ETFLG", "PieCtrlRegs.PIEIER3"],
      starter: `__interrupt void epwm5_isr(void);

uint32_t ticks = 0;

void main(void)
{
${INIT}

${LED2}

${PIE_INIT}

    // EPWM5 as a 1 kHz interrupt source

    while (1) {
    }
}

__interrupt void epwm5_isr(void)
{
}
`,
      solution: `__interrupt void epwm5_isr(void);

uint32_t ticks = 0;

void main(void)
{
${INIT}

${LED2}

${PIE_INIT}

    EALLOW;
    PieVectTable.EPWM5_INT = &epwm5_isr;
    EDIS;

    EPwm5Regs.TBCTL.bit.CTRMODE = 3;     // frozen while it is set up
    EPwm5Regs.TBCTL.bit.CLKDIV = 0;      // 50 MHz
    EPwm5Regs.TBCTR = 0;
    EPwm5Regs.TBPRD = 49999;             // 50000 counts of 20 ns = 1 ms
    EPwm5Regs.ETSEL.bit.INTSEL = 1;      // interrupt when the counter is zero
    EPwm5Regs.ETPS.bit.INTPRD = 1;       // on every event
    EPwm5Regs.ETSEL.bit.INTEN = 1;
    EPwm5Regs.TBCTL.bit.CTRMODE = 0;     // count up

    PieCtrlRegs.PIEIER3.bit.INTx5 = 1;   // EPWM5 is INT3.5
    IER |= M_INT3;
    EINT;
    ERTM;

    while (1) {
    }
}

__interrupt void epwm5_isr(void)
{
    ticks++;
    if ((ticks % 50) == 0) {
        GpioDataRegs.GPCTOGGLE.bit.GPIO94 = 1;
    }
    EPwm5Regs.ETCLR.bit.INT = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP3;
}
`,
      checks: [
        { kind: "isr", fn: "epwm5_isr", min: 495, max: 502, label: "epwm5_isr runs about 500 times in 500 ms", hint: "If it runs once: ETCLR.INT or PIEACK is missing. If never: check INTPRD, INTEN, PIEIER3, IER and the vector." },
        { kind: "blink", led: "LED2", periodMs: 100, tolPct: 1, label: "LED2 blinks with a period of 100 ms" },
        { kind: "var", name: "ticks", min: 495, max: 502, label: "ticks counts the calls" },
        { kind: "reg", reg: "CpuTimer0Regs.TCR", field: "TIE", equals: 0, label: "No CPU timer interrupt is used" },
      ],
      bonus: [
        { kind: "blink", led: "LED2", periodMs: 100, tolPct: 0.001, label: "The period is exactly 1 ms, not 1 ms plus one count", hint: "The counter needs TBPRD + 1 counts per period." },
      ],
      hints: [
        "Five things: the vector, the time base (CTRMODE, TBPRD), the event trigger (INTSEL, INTPRD, INTEN), the PIE (PIEIER3, IER, EINT), and two clears at the end of the function.",
        "1 ms is 50 000 counts of 20 ns. ETPS.INTPRD resets to 0, which blocks every interrupt. EPWM5 is channel 5 of group 3.",
        "In the function: EPwm5Regs.ETCLR.bit.INT = 1; and PieCtrlRegs.PIEACK.all = PIEACK_GROUP3;",
      ],
      takeaway:
        "ETSEL picks the event, ETPS thins it out, ETCLR re-arms it. The ADC start-of-conversion pulses SOCA and SOCB work the same way, except that they need no clearing to keep coming.",
    },
    {
      id: "pwm-x-deadtime",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Two outputs that never overlap",
      goal: "Make a centred, complementary pair on EPWM6A and EPWM6B with a gap between them, using up-down count, CMPA and CMPB.",
      refs: [{ course: "L6-7", slide: [69, 76] }, { trm: "15.4.6" }, { trm: "15.6.3" }, { trm: "15.6.5" }, { trm: "15.5.4" }],
      brief: `
A half bridge is two transistors in a row between the battery and ground, with the load connected between them: the high-side one switches the load to the battery, the low-side one to ground. If both conduct at once, even for a moment, they connect the battery straight to ground, a short circuit. So the two drive signals must be opposite **with a gap** in which both are off: the **dead time**. The ePWM has a dead-band unit for this. Here you do it by hand, which shows what the unit does.

## The triangle
In **up-down** mode the counter is a triangle: 0 up to TBPRD, back down to 0. One period is 2 x TBPRD counts. Each compare value is crossed twice, once going up (\`CAU\`, \`CBU\`) and once going down (\`CAD\`, \`CBD\`). One module has two outputs, A and B. They share the counter and the period, and \`AQCTLA\` and \`AQCTLB\` can each use either compare register.

Sketch the triangle and two horizontal lines on it, CMPB below CMPA:

- **EPWM6A** is high around the **peak**: set at CMPA going up, clear at CMPA going down.
- **EPWM6B** is high around the **valley**: clear at CMPB going up, set at CMPB going down.

Between the two lines neither output is high. That strip is the dead time, once on each slope.

## Task
- EPWM6, up-down count, **20 kHz**. Outputs on GPIO10 (EPWM6A) and GPIO11 (EPWM6B), both at mux index 1.
- Write \`void set_duty(float d)\`: output A is high for the fraction \`d\` of the period, and the dead time is **1 us** on each side.
- \`main\` calls \`set_duty(0.5)\` and later \`set_duty(0.2)\`. Those lines are written.

Do not use the dead-band registers.
`,
      kit: "robot",
      durationMs: 12,
      inspect: ["EPwm6Regs.TBCTL", "EPwm6Regs.CMPA", "EPwm6Regs.CMPB", "EPwm6Regs.AQCTLA", "EPwm6Regs.AQCTLB"],
      starter: `void set_duty(float d);

void main(void)
{
${INIT}

    // EPWM6: up-down count, 20 kHz, A and B on GPIO10 and GPIO11

    set_duty(0.5);
    DELAY_US(6000);
    set_duty(0.2);

    while (1) {
    }
}

// Output A high for the fraction d of the period, 1 us dead time on each side
void set_duty(float d)
{
}
`,
      solution: `void set_duty(float d);

void main(void)
{
${INIT}

    // EPWM6: up-down count, 20 kHz, A and B on GPIO10 and GPIO11
    EPwm6Regs.TBCTL.bit.CTRMODE = 2;     // up-down
    EPwm6Regs.TBCTL.bit.FREE_SOFT = 2;
    EPwm6Regs.TBCTL.bit.PHSEN = 0;
    EPwm6Regs.TBCTL.bit.CLKDIV = 0;
    EPwm6Regs.TBCTR = 0;
    EPwm6Regs.TBPRD = 1250;              // 2 x 1250 counts of 20 ns = 50 us
    EPwm6Regs.AQCTLA.bit.CAU = 2;        // A: set going up
    EPwm6Regs.AQCTLA.bit.CAD = 1;        //    clear going down
    EPwm6Regs.AQCTLB.bit.CBU = 1;        // B: clear going up
    EPwm6Regs.AQCTLB.bit.CBD = 2;        //    set going down
    GPIO_SetupPinMux(10, GPIO_MUX_CPU1, 1);
    GPIO_SetupPinMux(11, GPIO_MUX_CPU1, 1);
    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO10 = 1;
    GpioCtrlRegs.GPAPUD.bit.GPIO11 = 1;
    EDIS;

    set_duty(0.5);
    DELAY_US(6000);
    set_duty(0.2);

    while (1) {
    }
}

// Output A high for the fraction d of the period, 1 us dead time on each side
void set_duty(float d)
{
    // A is high from CMPA up to CMPA down: 2 x (TBPRD - CMPA) counts
    float cmpa = (1.0 - d) * 1250.0;
    EPwm6Regs.CMPA.bit.CMPA = cmpa;
    // 1 us is 50 counts of 20 ns
    EPwm6Regs.CMPB.bit.CMPB = cmpa - 50.0;
}
`,
      checks: [
        { kind: "blink", pin: 10, periodMs: 0.05, tolPct: 1, to: 5, label: "EPWM6A switches at 20 kHz", hint: "In up-down mode the period is 2 x TBPRD counts." },
        { kind: "duty", pin: 10, pct: 50, tolPct: 0.5, from: 1, to: 5, label: "A is high 50 % of the time after set_duty(0.5)", hint: "A is high for 2 x (TBPRD - CMPA) counts." },
        { kind: "duty", pin: 11, pct: 46, tolPct: 0.5, from: 1, to: 5, label: "B is high 46 %: the rest minus 1 us on each side", hint: "B is high for 2 x CMPB counts. CMPB is 50 counts below CMPA." },
        { kind: "duty", pin: 10, pct: 20, tolPct: 0.5, from: 7, to: 12, label: "A is high 20 % after set_duty(0.2)" },
        { kind: "duty", pin: 11, pct: 76, tolPct: 0.5, from: 7, to: 12, label: "B is high 76 %" },
        { kind: "reg", reg: "EPwm6Regs.AQCTLA", field: "CAU", equals: 2, label: "A is set at CMPA going up" },
        { kind: "reg", reg: "EPwm6Regs.AQCTLA", field: "CAD", equals: 1, label: "A is cleared at CMPA going down" },
        { kind: "reg", reg: "EPwm6Regs.AQCTLB", field: "CBU", equals: 1, label: "B is cleared at CMPB going up" },
        { kind: "reg", reg: "EPwm6Regs.AQCTLB", field: "CBD", equals: 2, label: "B is set at CMPB going down" },
        { kind: "reg", reg: "EPwm6Regs.DBCTL", field: "OUT_MODE", equals: 0, label: "The dead-band unit is not used" },
      ],
      hints: [
        "TBPRD is 1250. On the triangle, A's high time is the part above the CMPA line: 2 x (1250 - CMPA) counts out of 2500.",
        "So CMPA = (1 - d) x 1250. The gap on each slope is CMPA - CMPB counts, and 1 us is 50 counts.",
        "AQCTLA: CAU = 2, CAD = 1. AQCTLB: CBU = 1, CBD = 2. CMPB = CMPA - 50.",
      ],
      takeaway:
        "Up-down counting gives two matches per compare value, mirrored around the peak, so pulses are centred and a pair with a fixed gap needs only two numbers. The dead-band unit produces the same picture from one compare value.",
    },
    {
      id: "pwm-x-scope",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Be the oscilloscope",
      goal: "Measure the high time, period and duty cycle of a signal on a pin with a free-running CPU timer.",
      refs: [{ course: "L6-7", slide: 58, note: "duty cycle = high time / period" }, { course: "Lab 3" }, { trm: "3.8" }, { trm: "8.3" }],
      brief: `
\`start_signal()\` puts a PWM signal on GPIO22. You do not know its numbers, they change while **PB1** is held, and you may not read them out of the ePWM registers. Measure the signal the way an instrument does: from the pin.

**This level needs chapter 4 (CPU timers).** The given part also uses an interrupt (chapter 5). You do not have to touch it.

## Tools
- The pin level, also while the pin belongs to a peripheral: \`GpioDataRegs.GPADAT.bit.GPIO22\`.
- A stopwatch: CPU Timer 1 runs from reset, counts **down** from 0xFFFFFFFF, one count per SYSCLK cycle of **5 ns**. Read it with \`CpuTimer1Regs.TIM.all\`. The time between two readings is the first minus the second.

## Method
A measurement must start on an edge, not somewhere in the middle of a pulse.

1. Wait for the pin to be low, then for it to go high: a rising edge. Read the timer.
2. Wait for it to go low: the falling edge. Read the timer.
3. Wait for it to go high again: the next rising edge. Read the timer.

Rising to falling is the high time. Rising to rising is the period.

## Task
Measure **again and again** in the \`while (1)\` loop and store each result in the three globals, in microseconds and percent. \`TIM\` is 32 bits wide: use \`uint32_t\` for the readings and convert the differences to \`float\`.
`,
      kit: "robot",
      durationMs: 14,
      stimuli: [{ at: 6.3, press: "PB1" }],
      watch: ["high_us", "period_us", "duty_pct"],
      starter: `float high_us = 0;     // time the signal is high in one period, microseconds
float period_us = 0;   // period, microseconds
float duty_pct = 0;    // duty cycle, percent

${MYSTERY}

void main(void)
{
${INIT}

    start_signal();

    while (1) {
        // Measure GPIO22 with CpuTimer1Regs.TIM.all

    }
}
`,
      solution: `float high_us = 0;     // time the signal is high in one period, microseconds
float period_us = 0;   // period, microseconds
float duty_pct = 0;    // duty cycle, percent

${MYSTERY}

void main(void)
{
    uint32_t rise1;
    uint32_t fall;
    uint32_t rise2;

${INIT}

    start_signal();

    while (1) {
        // Start on a rising edge
        while (GpioDataRegs.GPADAT.bit.GPIO22 == 1) {
        }
        while (GpioDataRegs.GPADAT.bit.GPIO22 == 0) {
        }
        rise1 = CpuTimer1Regs.TIM.all;
        while (GpioDataRegs.GPADAT.bit.GPIO22 == 1) {
        }
        fall = CpuTimer1Regs.TIM.all;
        while (GpioDataRegs.GPADAT.bit.GPIO22 == 0) {
        }
        rise2 = CpuTimer1Regs.TIM.all;

        // The timer counts down, 5 ns per count: 200 counts per microsecond
        high_us = (float)(rise1 - fall) / 200.0;
        period_us = (float)(rise1 - rise2) / 200.0;
        duty_pct = 100.0 * high_us / period_us;
    }
}
`,
      checks: [
        { kind: "var", name: "period_us", at: 6, min: 999, max: 1001, label: "period_us is the period of the signal", hint: "Rising edge to the next rising edge. 200 timer counts are 1 us." },
        { kind: "var", name: "high_us", at: 6, min: 369, max: 371, label: "high_us is the high time", hint: "The timer counts down: the earlier reading is the larger one." },
        { kind: "var", name: "duty_pct", at: 6, min: 36.9, max: 37.1, label: "duty_pct is the duty cycle" },
        { kind: "var", name: "high_us", min: 624, max: 626, label: "With PB1 held the pulse is wider, and high_us follows", hint: "Measure in the while (1) loop, not once." },
        { kind: "var", name: "duty_pct", min: 62.4, max: 62.6, label: "and so does duty_pct" },
        { kind: "source", mustMatch: "CpuTimer1Regs\\.TIM", label: "The time comes from CPU Timer 1" },
        { kind: "source", mustNotMatch: "[=(,<>+*/&-]\\s*EPwm12Regs", label: "Nothing is read from the EPWM12 registers" },
      ],
      hints: [
        "Four empty while loops on the pin level, with a timer reading after the second, third and fourth.",
        "while (pin == 1) {} while (pin == 0) {} is a rising edge. Then while (pin == 1) {} is the falling edge.",
        "high_us = (float)(rise1 - fall) / 200.0; period_us = (float)(rise1 - rise2) / 200.0; duty_pct = 100.0 * high_us / period_us;",
      ],
      takeaway:
        "Period and high time are two time differences between edges. This is how an input-capture unit measures a PWM sensor signal, and how you check your own PWM when no scope is at hand.",
    },
  ],
};
