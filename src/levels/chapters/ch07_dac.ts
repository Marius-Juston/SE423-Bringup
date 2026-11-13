import type { Chapter } from "../types";

const FREQ = `#define LAUNCHPAD_CPU_FREQUENCY 200`;

const PIE_INIT = `    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();`;

/** DACA switched on the way the course library does it (init_ADCsAndDACs in SE423Lib.c). */
const DAC_ON = `    EALLOW;
    DacaRegs.DACCTL.bit.DACREFSEL = 1;    // reference = VREFHI, 3.0 V on this board
    DacaRegs.DACOUTEN.bit.DACOUTEN = 1;   // connect the DAC to its pin
    DacaRegs.DACVALS.bit.DACVALS = 0;     // start at 0 V
    EDIS;
    DELAY_US(500);                        // buffer power-up time (data sheet: up to 500 us)`;

/**
 * TRM Table 12-2 protects only DACCTL, DACOUTEN, DACLOCK and DACTRIM, and
 * the course's setDACA writes DACVALS with no EALLOW. One sentence, used
 * wherever a level writes DACVALS.
 */
const VALS_NOTE =
  "Only `DACCTL` and `DACOUTEN` are protected. `DACVALS` is not, so it is written without `EALLOW`, as the course's `setDACA` does.";

/**
 * Holds the program until t = 1 ms, so that the tests do not depend on how
 * long the student's own set-up took. CPU timer 1 runs from reset, counting
 * down from 0xFFFFFFFF once per 5 ns.
 */
const SYNC = `    // Given: wait until 1 ms after reset, so the timer starts at a known time
    while (CpuTimer1Regs.TIM.all > 0xFFFFFFFF - 200000) {}`;

const SETDACA = `void setDACA(float dacouta0)
{
    if (dacouta0 > 3.0) dacouta0 = 3.0;
    if (dacouta0 < 0.0) dacouta0 = 0.0;

    DacaRegs.DACVALS.bit.DACVALS = dacouta0 * 4095.0 / 3.0;   // 0 V to 3 V becomes 0 to 4095
}`;

const TIMER0 = (us: number) => `    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, LAUNCHPAD_CPU_FREQUENCY, ${us});
    CpuTimer0Regs.TCR.all = 0x4000;

    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    EINT;`;

export const ch07: Chapter = {
  id: "dac",
  number: 7,
  title: "DAC",
  blurb: "From a number to a voltage: 12 bits, 3.0 V and setDACA.",
  requires: ["interrupts"],
  course: ["L5"],
  levels: [
    {
      id: "dac-brief",
      kind: "brief",
      title: "A number becomes a voltage",
      goal: "Learn what a DAC is and how its 12-bit number sets the output voltage.",
      refs: [{ course: "L5", slide: [6, 9] }, { trm: "12.1" }, { trm: "12.2" }],
      brief: `
A GPIO pin is **digital**: it has two levels, 0 V or 3.3 V. A speaker, a motor driver input or a test signal needs a voltage **in between**, and one that can change smoothly. A voltage that can take any value in a range is called **analog**.

A **DAC** (digital-to-analog converter) turns a number into a voltage. You write a number to a register, and a pin goes to the matching voltage and stays there until you write another number.

## The formula
The F28379D's DAC takes a **12-bit** number, 0 to 4095. That is 2^12 = 4096 different values. The output is that fraction of a **reference voltage**: a fixed, accurate voltage that the chip uses as its yardstick. It is 3.0 V on the course boards:

\`\`\`c
Vout = DACVAL * 3.0 / 4096
\`\`\`

- \`DACVAL = 0\` gives 0 V
- \`DACVAL = 2048\` gives 1.5 V, exactly half
- \`DACVAL = 4095\` gives 2.99927 V, the highest it can go

One step of the number moves the output by 3.0 V / 4096 = **0.732 mV**. That step is the DAC's **resolution**. More bits would mean smaller steps.

{{figure:dac-staircase}}

Try it in the figure: drag the number, then switch to 3 or 4 bits to see the single steps.

## Inside
The number goes to a network of resistors and switches, one switch per bit. Every bit adds **half as much** voltage as the bit above it. You flip those switches yourself two levels from now.

A resistor network cannot deliver current: connect anything that draws current and the voltage sags. So the chip puts a **buffer** behind it: a circuit that copies the voltage at its input to its output and supplies the current itself. The formula is the ideal value. The data sheet (the manufacturer's list of the chip's electrical limits) promises it only from 0.3 V up, because the buffer cannot pull its output all the way down to 0 V. The simulator shows the ideal value.

## On this chip
There are three: **DACA**, **DACB** and **DACC**, with registers \`DacaRegs\`, \`DacbRegs\`, \`DaccRegs\`. The course library sets up DACA and DACB and gives you \`setDACA(volts)\` and \`setDACB(volts)\`. In this chapter you write them yourself.
`,
      questions: [
        {
          prompt: "The reference is 3.0 V. Which voltage does `DACVAL = 1024` give?",
          options: ["0.25 V", "0.75 V", "1.024 V", "1.5 V"],
          answer: 1,
          why: "1024 / 4096 is one quarter, and a quarter of 3.0 V is 0.75 V.",
        },
        {
          prompt: "Why can the output never be exactly 3.0 V?",
          options: [
            "The buffer loses 0.732 mV",
            "The largest 12-bit number is 4095, one step below 4096",
            "The reference is really 2.999 V",
            "DACVAL = 4095 is reserved",
          ],
          answer: 1,
          why: "Vout = DACVAL * 3.0 / 4096 and DACVAL stops at 4095, so the top is 4095/4096 of 3.0 V.",
        },
        {
          prompt: "You write 2048 to the DAC once and then do nothing. What does the pin do?",
          options: [
            "It gives one short pulse of 1.5 V",
            "It stays at 1.5 V until another number is written",
            "It falls back to 0 V after one clock cycle",
            "It switches between 0 V and 3.0 V so that the average is 1.5 V",
          ],
          answer: 1,
          why: "A DAC holds its output. The voltage only changes when the number changes. (The last option describes PWM, a later chapter.)",
        },
      ],
      takeaway: "Vout = DACVAL x 3.0 V / 4096. Twelve bits give 4096 steps of 0.732 mV, from 0 V to just under 3.0 V.",
    },
    {
      id: "dac-calc",
      kind: "calc",
      title: "Volts and numbers",
      goal: "Convert between the 12-bit DAC number and the output voltage, in both directions.",
      refs: [{ trm: "12.2" }, { course: "L5", slide: 6 }],
      brief: `
The manual's formula, with the 3.0 V reference of the course boards:

\`\`\`c
Vout = DACVAL * 3.0 / 4096
\`\`\`

Going the other way, you want a voltage and need the number:

\`\`\`c
DACVAL = Vout * 4096 / 3.0
\`\`\`

The register only holds whole numbers, so drop the fraction (C does this when it stores a \`float\` in an integer). Example: 0.5 V needs 0.5 x 4096 / 3.0 = 682.67, so the register gets 682.

Work out the four values. Give voltages in volts.
`,
      fields: [
        {
          id: "v3072",
          label: "Output for DACVAL = 3072",
          unit: "V",
          answer: 2.25,
          tolPct: 0.1,
          why: "3072 / 4096 = 0.75, and 0.75 x 3.0 V = 2.25 V.",
        },
        {
          id: "code1",
          label: "DACVAL for 1.0 V (whole number, fraction dropped)",
          answer: 1365,
          why: "1.0 x 4096 / 3.0 = 1365.33. The register keeps 1365, which gives 0.99976 V.",
        },
        {
          id: "step",
          label: "Change of the output when DACVAL goes up by 1",
          unit: "mV",
          answer: 0.732,
          tolPct: 1,
          why: "3.0 V / 4096 = 0.000732 V = 0.732 mV. This is the resolution.",
        },
        {
          id: "bit7",
          label: "Voltage added by bit 7 alone (DACVAL = 0x080)",
          unit: "V",
          answer: 0.09375,
          tolPct: 0.5,
          why: "0x080 is 128, and 128 x 3.0 / 4096 = 0.09375 V. It is also 1.5 V halved four times: bits 11, 10, 9, 8, then 7.",
        },
      ],
      hints: [
        "Multiply by 3.0 and divide by 4096 to get volts. Multiply by 4096 and divide by 3.0 to get the number.",
        "For the step, put DACVAL = 1 in the formula. The answer is asked in millivolts.",
        "2.25 V, 1365, 0.732 mV, 0.09375 V.",
      ],
      takeaway: "Number to volts: times 3.0, divided by 4096. Volts to number: times 4096, divided by 3.0, fraction dropped.",
    },
    {
      id: "dac-ladder",
      kind: "register",
      title: "Flip the ladder switches",
      goal: "Set the switches of an 8-bit R-2R ladder so that it outputs 1.125 V.",
      refs: [{ course: "L5", slide: 7 }, { trm: "12.1.2" }],
      brief: `
This is the resistor network inside a DAC, here with **8 bits** and a 3.0 V reference. It is called an **R-2R ladder**: it is built from only two resistor values, R and 2R, drawn like the rungs of a ladder. Each bit is one switch. A switch that is on adds its share to the output: bit 7 adds 3.0 / 2 = **1.5 V**, and every lower bit adds half of the one before.

{{figure:r2r-ladder}}

Flip the switches in the figure: the output is the sum of the bits that are on.

Set the switches so that the output is **1.125 V**.

Start from the top. Would bit 7 alone already be too much? If yes, leave it off and try the next one. If a bit fits, keep it and see what is still missing. You will meet this "try the big bit first" method again in the ADC chapter: it is how the ADC works out a voltage.
`,
      custom: {
        bits: 8,
        fields: [
          { name: "b7", hi: 7, lo: 7, desc: "adds 1.5 V" },
          { name: "b6", hi: 6, lo: 6, desc: "adds 0.75 V" },
          { name: "b5", hi: 5, lo: 5, desc: "adds 0.375 V" },
          { name: "b4", hi: 4, lo: 4, desc: "adds 0.1875 V" },
          { name: "b3", hi: 3, lo: 3, desc: "adds 0.09375 V" },
          { name: "b2_0", hi: 2, lo: 0, desc: "three smallest steps" },
        ],
      },
      initial: 0,
      value: 0x60,
      code: `// 0x60 = 0110 0000: 0.75 V + 0.375 V = 1.125 V
// Check with the formula: 96 * 3.0 / 256 = 1.125 V`,
      hints: [
        "1.5 V is more than 1.125 V, so bit 7 stays off.",
        "0.75 V fits. What is still missing? 1.125 - 0.75 = 0.375 V.",
        "Bits 6 and 5 on, everything else off: 0110 0000.",
      ],
      takeaway: "Each bit is worth half of the one above it. The output is the sum of the bits that are 1, which is just the binary number times one step.",
    },
    {
      id: "dac-order",
      kind: "order",
      title: "Switching the DAC on",
      goal: "Put the steps that bring up DACA in the order the reference manual gives.",
      refs: [{ trm: "12.2.1" }, { trm: "12.4.2" }, { course: "L5", slide: [11, 8] }],
      brief: `
After reset the DAC is off: its output pin is not driven at all. Three registers bring it up.

- \`DacaRegs.DACCTL.bit.DACREFSEL\` picks the **reference**. 0 selects a separate pin called VDAC. 1 selects **VREFHI**, the same 3.0 V reference the ADC uses. The course always uses 1.
- \`DacaRegs.DACOUTEN.bit.DACOUTEN = 1\` powers up the buffer and **connects it to the pin**. Without it you can write any value you like and the pin shows nothing.
- \`DacaRegs.DACVALS.bit.DACVALS\` is the 12-bit number. The S stands for *shadow*: what you write is copied to the active register \`DACVALA\` on the next clock cycle, and \`DACVALA\` is what the ladder sees.

\`DACCTL\` and \`DACOUTEN\` are **protected** registers: a write only counts between \`EALLOW;\` and \`EDIS;\`.

The buffer needs time to power up: the data sheet allows up to **500 us**, so wait that long with \`DELAY_US(500);\`. (The Lecture 5 slide calls DACREFSEL "0 internal, 1 external" and waits 10 us. Follow the manual and the data sheet.)

The manual's sequence is: choose the reference, enable the output, wait for the buffer to power up, and only then expect a voltage. Order the steps.
`,
      steps: [
        "EALLOW;  (open the protected registers)",
        "DacaRegs.DACCTL.bit.DACREFSEL = 1;  (reference = VREFHI, 3.0 V)",
        "DacaRegs.DACOUTEN.bit.DACOUTEN = 1;  (power up the buffer, drive the pin)",
        "EDIS;  (close the protected registers)",
        "DELAY_US(500);  (wait for the buffer to power up)",
        "DacaRegs.DACVALS.bit.DACVALS = 2048;  (ask for 1.5 V)",
      ],
      hints: [
        "EALLOW comes before the first protected write and EDIS after the last one.",
        "The reference is chosen before the output is enabled, so the pin never shows a voltage made from the wrong reference.",
        "EALLOW, DACREFSEL, DACOUTEN, EDIS, wait, then the value.",
      ],
      takeaway: "Reference, output enable, a short wait, then values. DACOUTEN is the one people forget: no enable, no voltage.",
    },
    {
      id: "dac-first",
      kind: "code",
      mode: "complete",
      title: "Half scale",
      goal: "Bring up DACA and make it output 1.5 V.",
      refs: [{ course: "L5", slide: [11, 6] }, { trm: "12.2.1" }, { trm: "12.2" }],
      brief: `
The robot board has a meter on the DACA pin. Right now it reads 0 V, because the DAC is off.

Fill in the three lines:

1. Select **VREFHI** as the reference: \`DACREFSEL = 1\`.
2. Enable the output: \`DACOUTEN = 1\`.
3. Write the 12-bit number for **1.5 V** to \`DACVALS\`.

All three registers are written as \`DacaRegs.<REGISTER>.bit.<FIELD>\`, and for these three the field has the same name as the register, except \`DACCTL.bit.DACREFSEL\`.

\`DACVALS\` takes the 12-bit **number**, not volts. Work it out with \`DACVAL = Vout * 4096 / 3.0\`.

The two set-up registers are protected, so the lines sit between \`EALLOW;\` and \`EDIS;\`, which are already there.
`,
      kit: "robot",
      durationMs: 2,
      starter: `void main(void)
{
    InitSysCtrl();

    EALLOW;
    // TODO 1: reference = VREFHI

    // TODO 2: enable the DAC output

    // TODO 3: the number for 1.5 V
    DacaRegs.DACVALS.bit.DACVALS = 0;
    EDIS;

    while (1) {}
}
`,
      solution: `void main(void)
{
    InitSysCtrl();

    EALLOW;
    DacaRegs.DACCTL.bit.DACREFSEL = 1;
    DacaRegs.DACOUTEN.bit.DACOUTEN = 1;
    DacaRegs.DACVALS.bit.DACVALS = 2048;
    EDIS;

    while (1) {}
}
`,
      checks: [
        {
          kind: "reg",
          reg: "DacaRegs.DACCTL",
          field: "DACREFSEL",
          equals: 1,
          label: "The reference is VREFHI (DACREFSEL = 1)",
          hint: "Add DacaRegs.DACCTL.bit.DACREFSEL = 1; after EALLOW; and before EDIS;.",
        },
        {
          kind: "reg",
          reg: "DacaRegs.DACOUTEN",
          field: "DACOUTEN",
          equals: 1,
          label: "The DAC output is enabled",
          hint: "DacaRegs.DACOUTEN.bit.DACOUTEN = 1; connects the DAC to its pin. It must be between EALLOW; and EDIS;.",
        },
        {
          kind: "signal",
          name: "DACA",
          equals: 1.5,
          tol: 0.001,
          label: "The DACA pin is at 1.5 V",
          hint: "At 0 V the output is still off (DACOUTEN) or the number is too small. DACVALS takes the 12-bit number, not volts: 1.5 V is half of 3.0 V, so write half of 4096.",
        },
      ],
      inspect: ["DacaRegs.DACCTL", "DacaRegs.DACOUTEN", "DacaRegs.DACVALS", "DacaRegs.DACVALA"],
      hints: [
        "Half of the reference needs half of 4096.",
        "`DacaRegs.DACCTL.bit.DACREFSEL = 1;` and `DacaRegs.DACOUTEN.bit.DACOUTEN = 1;`",
        "`DacaRegs.DACVALS.bit.DACVALS = 2048;`",
      ],
      takeaway: "You write DACVALS. The chip copies it to DACVALA one clock later, and DACVALA x 3.0 / 4096 appears on the pin.",
    },
    {
      id: "dac-setdaca",
      kind: "code",
      mode: "write",
      title: "Write setDACA",
      goal: "Write the course's setDACA(volts) helper, including the limits at 0 V and 3 V.",
      refs: [{ course: "L5", slide: [11, 6], note: "DACVALS keeps only 12 bits: clamp first" }, { course: "Lab 4" }, { trm: "12.2" }, { trm: "12.4.2" }],
      brief: `
Nobody wants to think in 12-bit numbers. The course library has a helper that takes **volts**:

\`\`\`c
setDACA(2.25);   // DACA now outputs 2.25 V
\`\`\`

Write its body. The parameter \`dacouta0\` (the course's name for it) is the wanted voltage in volts. The function has two jobs.

## 1. Saturate
The DAC can only do 0 V to 3 V. If the caller asks for more, give 3 V. If the caller asks for less than 0, give 0 V. Limiting a value to its allowed range is called **saturation**.

This matters more than it looks. \`DACVALS\` keeps only 12 bits. Store 5000 in it and the top bit is cut off: 5000 - 4096 = 904, which is 0.66 V. Ask for more and get less.

## 2. Scale
Turn 0 V to 3 V into 0 to 4095 and store it in \`DacaRegs.DACVALS.bit.DACVALS\`. Storing a \`float\` in the register drops the fraction. Example: 2.25 V becomes 2.25 x 4095 / 3.0 = 3071.25, stored as 3071.

The course library scales with \`volts * 4095.0 / 3.0\`, so that 3.0 V lands exactly on 4095, the largest number. The manual's formula says \`volts * 4096.0 / 3.0\`, which gives 4096 for 3.0 V, one too many. The two differ by less than one step (0.732 mV). Either passes here, but with 4096 you must also limit the number to 4095.

${VALS_NOTE}

\`main()\` switches the DAC on, then asks for 2.25 V, 5 V and -1 V, one millisecond apart.
`,
      kit: "robot",
      durationMs: 4,
      starter: `void setDACA(float dacouta0)
{
    // 1. limit dacouta0 to 0.0 ... 3.0

    // 2. scale to 0 ... 4095 and store it in DACVALS

}

void main(void)
{
    InitSysCtrl();

${DAC_ON}

    setDACA(2.25);
    DELAY_US(1000);
    setDACA(5.0);
    DELAY_US(1000);
    setDACA(-1.0);

    while (1) {}
}
`,
      solution: `${SETDACA}

void main(void)
{
    InitSysCtrl();

${DAC_ON}

    setDACA(2.25);
    DELAY_US(1000);
    setDACA(5.0);
    DELAY_US(1000);
    setDACA(-1.0);

    while (1) {}
}
`,
      checks: [
        {
          kind: "signal",
          name: "DACA",
          at: 1.0,
          equals: 2.25,
          tol: 0.002,
          label: "setDACA(2.25) gives 2.25 V",
          hint: "At 0 V nothing useful reached DACVALS. Multiply first, then divide: dacouta0 * 4095.0 / 3.0, stored in DacaRegs.DACVALS.bit.DACVALS.",
        },
        {
          kind: "signal",
          name: "DACA",
          at: 2.0,
          min: 2.997,
          max: 3.0,
          label: "setDACA(5.0) is limited to the top of the range",
          hint: "Without the limit, the 12-bit register cuts the number off and the output drops. Add: if (dacouta0 > 3.0) dacouta0 = 3.0;",
        },
        {
          kind: "signal",
          name: "DACA",
          at: 3.5,
          equals: 0,
          tol: 0.001,
          label: "setDACA(-1.0) is limited to 0 V",
          hint: "A negative float stored in an unsigned register becomes a large number. Add: if (dacouta0 < 0.0) dacouta0 = 0.0;",
        },
      ],
      inspect: ["DacaRegs.DACVALS", "DacaRegs.DACVALA"],
      hints: [
        "Two `if` lines for the limits, then one assignment.",
        "`if (dacouta0 > 3.0) dacouta0 = 3.0;` and the same idea for 0.0.",
        "`DacaRegs.DACVALS.bit.DACVALS = dacouta0 * 4095.0 / 3.0;` after the two limit lines.",
      ],
      takeaway: "Saturate first, then scale. A 12-bit register does not complain about a number that is too big, it silently keeps the low 12 bits.",
    },
    {
      id: "dac-debug",
      kind: "code",
      mode: "debug",
      title: "The meter stays at zero",
      goal: "Find the two reasons this program shows 0 V instead of 1 V and then 2 V.",
      refs: [{ trm: "12.4.2" }, { trm: "12.2.1" }, { course: "L5", slide: 11 }],
      brief: `
This program should put **1.0 V** on DACA, wait a millisecond, and then go to **2.0 V**. \`setDACA\` is correct.

The meter shows 0 V the whole time. There are **two** separate mistakes in \`main()\`, both in the set-up, and each one alone is enough to keep the pin at 0 V.

Run it and read what the simulator reports. Then compare the set-up with the sequence from the manual: reference, output enable, value.
`,
      kit: "robot",
      durationMs: 3,
      starter: `${SETDACA}

void main(void)
{
    InitSysCtrl();

    DacaRegs.DACCTL.bit.DACREFSEL = 1;    // reference = VREFHI
    EALLOW;
    DacaRegs.DACVALS.bit.DACVALS = 0;     // start at 0 V
    EDIS;
    DELAY_US(500);

    setDACA(1.0);
    DELAY_US(1000);
    setDACA(2.0);

    while (1) {}
}
`,
      solution: `${SETDACA}

void main(void)
{
    InitSysCtrl();

    EALLOW;
    DacaRegs.DACCTL.bit.DACREFSEL = 1;    // reference = VREFHI
    DacaRegs.DACOUTEN.bit.DACOUTEN = 1;   // connect the DAC to its pin
    DacaRegs.DACVALS.bit.DACVALS = 0;     // start at 0 V
    EDIS;
    DELAY_US(500);

    setDACA(1.0);
    DELAY_US(1000);
    setDACA(2.0);

    while (1) {}
}
`,
      checks: [
        {
          kind: "no-diagnostic",
          code: "eallow",
          label: "No write to a protected register is ignored",
          hint: "DACCTL is protected. Move EALLOW; above the DACREFSEL line.",
        },
        {
          kind: "reg",
          reg: "DacaRegs.DACCTL",
          field: "DACREFSEL",
          equals: 1,
          label: "The reference is VREFHI",
          hint: "The DACREFSEL line is there, but it runs before EALLOW; so the chip ignores it.",
        },
        {
          kind: "signal",
          name: "DACA",
          at: 1.0,
          equals: 1.0,
          tol: 0.002,
          label: "DACA is at 1.0 V first",
          hint: "The number is in DACVALA, but is the DAC connected to its pin? Look for DACOUTEN.",
        },
        { kind: "signal", name: "DACA", equals: 2.0, tol: 0.002, label: "DACA ends at 2.0 V" },
      ],
      inspect: ["DacaRegs.DACCTL", "DacaRegs.DACOUTEN", "DacaRegs.DACVALA"],
      hints: [
        "One mistake is reported by the simulator: a protected register is written outside EALLOW and EDIS.",
        "The other is a missing line. Open the inspector: DACVALA holds the right number, yet the pin is at 0 V.",
        "Move `EALLOW;` up one line and add `DacaRegs.DACOUTEN.bit.DACOUTEN = 1;` before `EDIS;`.",
      ],
      takeaway: "A DAC that shows nothing: check EALLOW around the set-up, then DACOUTEN. The value register can be perfectly right while the pin is disconnected.",
    },
    {
      id: "dac-ramp",
      kind: "code",
      mode: "checkpoint",
      title: "Sawtooth from a timer",
      goal: "Use the timer 0 interrupt to step DACA from 0 V to 3 V over 100 ms, again and again.",
      refs: [{ course: "L5", slide: 11 }, { course: "Lab 4" }, { trm: "12.2" }, { trm: "3.4.4" }],
      brief: `
A voltage that changes in time needs two things you already have: a **timer interrupt** to say when, and the **DAC** to say how much.

Make a **sawtooth**: the output climbs in equal steps, then drops back to 0 V and starts again.

- Timer 0 interrupts every **1 ms**. Its set-up and vector are already in \`main()\`.
- In \`cpu_timer0_isr\`, count the interrupts in \`step\`. After interrupt number k the output is **k x 0.03 V**: 0.03 V after the first, 0.30 V after the tenth, 3.0 V after number 100.
- On the next interrupt after 3.0 V, start over at 0 V (\`step\` back to 0), then 0.03 V, and so on.
- Use \`setDACA\`, which is given. It limits and scales for you.

Count with an integer and multiply (\`step * 0.03\`). Adding 0.03 to a \`float\` a hundred times collects rounding errors, an integer count does not.

Do not forget what every group 1 interrupt function ends with.
`,
      kit: "robot",
      durationMs: 115,
      starter: `${FREQ}

__interrupt void cpu_timer0_isr(void);

int16_t step = 0;

${SETDACA}

void main(void)
{
    InitSysCtrl();

${DAC_ON}

${PIE_INIT}

${TIMER0(1000)}

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    // TODO: count, wrap after 100, set the output

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      solution: `${FREQ}

__interrupt void cpu_timer0_isr(void);

int16_t step = 0;

${SETDACA}

void main(void)
{
    InitSysCtrl();

${DAC_ON}

${PIE_INIT}

${TIMER0(1000)}

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    step++;
    if (step > 100) {
        step = 0;
    }
    setDACA(step * 0.03);

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      checks: [
        {
          kind: "signal",
          name: "DACA",
          at: 2.0,
          equals: 0.03,
          tol: 0.003,
          label: "0.03 V after the first interrupt",
          hint: "Still 0 V? Increase step before you call setDACA, and multiply by 0.03: step * 3 / 100 is integer division and gives 0.",
        },
        {
          kind: "signal",
          name: "DACA",
          at: 11.0,
          equals: 0.3,
          tol: 0.003,
          label: "0.30 V after 10 ms",
          hint: "Each interrupt adds 1 to step and outputs step * 0.03. If the output stopped at 0.03 V, the PIEACK line at the end is missing.",
        },
        { kind: "signal", name: "DACA", at: 51.0, equals: 1.5, tol: 0.003, label: "1.5 V after 50 ms" },
        {
          kind: "signal",
          name: "DACA",
          at: 101.0,
          min: 2.995,
          max: 3.0,
          label: "The top of the range after 100 ms",
          hint: "Interrupt number 100 must still output 3.0 V. Wrap when step is greater than 100, not when it reaches 100.",
        },
        {
          kind: "signal",
          name: "DACA",
          at: 102.0,
          equals: 0,
          tol: 0.003,
          label: "Back to 0 V on the next interrupt",
          hint: "After 3.0 V the next value is 0 V: set step to 0 and output that.",
        },
        { kind: "signal", name: "DACA", at: 112.0, equals: 0.3, tol: 0.003, label: "The second ramp climbs like the first" },
        {
          kind: "isr",
          fn: "cpu_timer0_isr",
          min: 110,
          max: 116,
          label: "The interrupt runs every 1 ms",
          hint: "If it ran once, the function no longer ends with PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;",
        },
      ],
      watch: ["step"],
      hints: [
        "Three lines: increase `step`, wrap it, call `setDACA`.",
        "`if (step > 100) { step = 0; }` keeps step in 0 to 100.",
        "`step++; if (step > 100) { step = 0; } setDACA(step * 0.03);`",
      ],
      takeaway: "Timer interrupt for the time axis, DAC for the voltage axis: together they draw any waveform you can compute.",
    },
    {
      id: "dac-wrap",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "Louder makes it quieter",
      goal: "Fix a program that doubles a signal and whose output collapses when the result goes above 3 V.",
      refs: [{ course: "L5", slide: 11, note: "a value above 4095 wraps to a low output" }, { trm: "12.4.2" }],
      brief: `
This program is a small amplifier: it makes a signal bigger. Every millisecond the timer interrupt takes the next value of a test signal, multiplies it by 2 (the factor is called the **gain**), and sends it to DACA.

The test signal goes 0.5 V, 1.0 V, 1.4 V, 1.6 V, 2.0 V. Times two, that is 1.0 V, 2.0 V, 2.8 V, then 3.2 V and 4.0 V. The last two are more than the DAC can do, so the output should simply stay at the top, 3.0 V.

Instead the output **drops** to 0.2 V and 1.0 V on the last two values.

{{figure:dac-staircase}}

Find out why. In the figure, push the number past 4095 and watch the output. Then look at what number the code stores for 3.2 V, and remember how many bits \`DACVALS\` keeps. Then fix \`setDACA\` so that it can be trusted with any input.
`,
      kit: "robot",
      durationMs: 7,
      starter: `${FREQ}

__interrupt void cpu_timer0_isr(void);

float signal[5] = {0.5, 1.0, 1.4, 1.6, 2.0};
int16_t n = 0;

void setDACA(float dacouta0)
{
    EALLOW;
    DacaRegs.DACVALS.bit.DACVALS = dacouta0 * 4095.0 / 3.0;
    EDIS;
}

void main(void)
{
    InitSysCtrl();

${DAC_ON}

${PIE_INIT}

${TIMER0(1000)}

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    if (n < 5) {
        setDACA(2.0 * signal[n]);
        n++;
    }

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      solution: `${FREQ}

__interrupt void cpu_timer0_isr(void);

float signal[5] = {0.5, 1.0, 1.4, 1.6, 2.0};
int16_t n = 0;

${SETDACA}

void main(void)
{
    InitSysCtrl();

${DAC_ON}

${PIE_INIT}

${TIMER0(1000)}

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    if (n < 5) {
        setDACA(2.0 * signal[n]);
        n++;
    }

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      checks: [
        { kind: "signal", name: "DACA", at: 2.0, equals: 1.0, tol: 0.003, label: "0.5 V in, 1.0 V out" },
        { kind: "signal", name: "DACA", at: 4.0, equals: 2.8, tol: 0.003, label: "1.4 V in, 2.8 V out" },
        {
          kind: "signal",
          name: "DACA",
          at: 5.0,
          min: 2.995,
          max: 3.0,
          label: "1.6 V in: the output stays at the top",
          hint: "3.2 V scales to 4368, and 4368 does not fit in 12 bits: 4368 - 4096 = 272 is stored. Limit the voltage before scaling.",
        },
        {
          kind: "signal",
          name: "DACA",
          at: 6.0,
          min: 2.995,
          max: 3.0,
          label: "2.0 V in: still at the top",
          hint: "Same cause: 4.0 V scales to 5460, stored as 5460 - 4096 = 1364. Add if (dacouta0 > 3.0) dacouta0 = 3.0; before the scaling line.",
        },
      ],
      watch: ["n"],
      inspect: ["DacaRegs.DACVALS"],
      hints: [
        "3.2 * 4095 / 3 = 4368. The largest 12-bit number is 4095.",
        "The register keeps the low 12 bits: 4368 becomes 272, which is 0.2 V. This is called wrap-around.",
        "Add the two limit lines at the top of `setDACA`: `if (dacouta0 > 3.0) dacouta0 = 3.0;` and `if (dacouta0 < 0.0) dacouta0 = 0.0;`",
      ],
      takeaway: "Wrap-around turns 'a bit too much' into 'almost nothing'. Every value that goes to hardware gets saturated first.",
    },
    {
      id: "dac-two",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "Two outputs, one total",
      goal: "Bring up DACB yourself and keep DACA + DACB at 3 V while DACA steps up.",
      refs: [{ course: "L5", slide: [11, 9] }, { trm: "12.2.1" }, { trm: "12.4.1" }],
      brief: `
The second DAC works exactly like the first. Its registers are \`DacbRegs\`, and the robot board has a meter on it too.

This time nothing is given for DACB.

1. In \`main()\`, bring up **DACB** the same way DACA is brought up: reference VREFHI, output enabled, value 0. The given wait after it covers the power-up time.
2. Write \`setDACB(float volts)\`, with the same limits and scaling as \`setDACA\`.
3. \`main()\` already steps a voltage \`v\` through 0.5 V, 1.25 V and 2.75 V, one millisecond apart. After each step, DACA must output \`v\` and DACB must output **3.0 - v**, so that the two always add up to 3 V.

Two voltages that move in opposite directions around a middle are how many motor drivers and audio amplifiers want their input.
`,
      kit: "robot",
      durationMs: 4.5,
      starter: `${SETDACA}

void setDACB(float dacouta1)
{
    // TODO
}

void main(void)
{
    float v[3] = {0.5, 1.25, 2.75};
    int16_t i = 0;

    InitSysCtrl();

${DAC_ON}

    // TODO: bring up DACB

${SYNC}

    for (i = 0; i < 3; i++) {
        // TODO: DACA = v[i], DACB = 3.0 - v[i]

        DELAY_US(1000);
    }

    while (1) {}
}
`,
      solution: `${SETDACA}

void setDACB(float dacouta1)
{
    if (dacouta1 > 3.0) dacouta1 = 3.0;
    if (dacouta1 < 0.0) dacouta1 = 0.0;

    EALLOW;
    DacbRegs.DACVALS.bit.DACVALS = dacouta1 * 4095.0 / 3.0;
    EDIS;
}

void main(void)
{
    float v[3] = {0.5, 1.25, 2.75};
    int16_t i = 0;

    InitSysCtrl();

${DAC_ON}

    EALLOW;
    DacbRegs.DACCTL.bit.DACREFSEL = 1;
    DacbRegs.DACOUTEN.bit.DACOUTEN = 1;
    DacbRegs.DACVALS.bit.DACVALS = 0;
    EDIS;

${SYNC}

    for (i = 0; i < 3; i++) {
        setDACA(v[i]);
        setDACB(3.0 - v[i]);
        DELAY_US(1000);
    }

    while (1) {}
}
`,
      checks: [
        {
          kind: "reg",
          reg: "DacbRegs.DACOUTEN",
          field: "DACOUTEN",
          equals: 1,
          label: "The DACB output is enabled",
          hint: "DacbRegs.DACOUTEN.bit.DACOUTEN = 1; between EALLOW; and EDIS;. Until then DACB produces no voltage at all.",
        },
        {
          kind: "reg",
          reg: "DacbRegs.DACCTL",
          field: "DACREFSEL",
          equals: 1,
          label: "DACB uses VREFHI",
          hint: "DacbRegs.DACCTL.bit.DACREFSEL = 1; between EALLOW; and EDIS;.",
        },
        {
          kind: "signal",
          name: "DACA",
          at: 1.5,
          equals: 0.5,
          tol: 0.003,
          label: "Step 1: DACA at 0.5 V",
          hint: "Call setDACA(v[i]); inside the for loop, before the DELAY_US line.",
        },
        {
          kind: "signal",
          name: "DACB",
          at: 1.5,
          equals: 2.5,
          tol: 0.003,
          label: "Step 1: DACB at 2.5 V",
          hint: "\"Never produced a value\" means DACB is still off (DACOUTEN). At 0 V, setDACB is empty or is not called with 3.0 - v[i].",
        },
        { kind: "signal", name: "DACB", at: 2.5, equals: 1.75, tol: 0.003, label: "Step 2: DACB at 1.75 V" },
        { kind: "signal", name: "DACA", at: 3.5, equals: 2.75, tol: 0.003, label: "Step 3: DACA at 2.75 V" },
        { kind: "signal", name: "DACB", at: 3.5, equals: 0.25, tol: 0.003, label: "Step 3: DACB at 0.25 V" },
      ],
      inspect: ["DacbRegs.DACCTL", "DacbRegs.DACOUTEN", "DacbRegs.DACVALS"],
      hints: [
        "Copy the DACA set-up and change every `Daca` to `Dacb`.",
        "`setDACB` is `setDACA` with `DacbRegs`.",
        "In the loop: `setDACA(v[i]); setDACB(3.0 - v[i]);`",
      ],
      takeaway: "The three DACs are identical blocks. Only the register name changes.",
    },
    {
      id: "dac-sine",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "A clean 100 Hz sine",
      goal: "Output a 100 Hz sine wave between 0.5 V and 2.5 V from a 10 kHz interrupt that stays short.",
      refs: [{ course: "L5", slide: [11, 6] }, { course: "Lab 4" }, { trm: "12.2" }, { trm: "3.8" }],
      brief: `
Generate this on DACA:

\`\`\`c
v(t) = 1.5 + 1.0 * sin(2 * PI * 100 * t)      // volts, t in seconds
\`\`\`

\`sin(x)\` is the C library's sine function. It swings smoothly between -1 and +1 and repeats every time \`x\` grows by 2 x PI (about 6.28): \`x\` is an angle in **radians**, where 2 x PI is one full turn. So \`v\` swings between 0.5 V and 2.5 V around 1.5 V, 100 times a second.

A new value goes out every **100 us** (10 kHz), so one period of 10 ms is drawn with 100 points. Point \`i\` is at t = i x 100 us, where the angle is 2 x PI x i / 100. Point 25, a quarter turn, gives sin = 1: 2.5 V. Timer 0 and its vector are set up for you. A given line holds the program until 1 ms after reset before the timer starts, so your set-up may take as long as it needs.

## The budget
\`sin()\` is slow on a real microcontroller: hundreds of clock cycles. This interrupt runs ten thousand times a second. So the interrupt function may **not** call \`sin()\`: compute the 100 values once in \`main()\`, before the timer starts, store them in an array (a **lookup table**), and only read the next entry in the interrupt. (The simulator does not charge extra time for \`sin()\`. The real chip does.)

You get an extra star if the table already holds 12-bit DAC numbers, so that the interrupt function does no floating-point work and calls no helper: it only writes \`DACVALS\`.

Nothing else is given: bring up the DAC, build the table, write the interrupt function. ${VALS_NOTE}
`,
      kit: "robot",
      durationMs: 22,
      starter: `${FREQ}
#define PI 3.14159265

__interrupt void cpu_timer0_isr(void);

void main(void)
{
    InitSysCtrl();

    // TODO: DAC set-up and the table

${SYNC}

${PIE_INIT}

${TIMER0(100)}

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    // TODO

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      solution: `${FREQ}
#define PI 3.14159265

__interrupt void cpu_timer0_isr(void);

uint16_t table[100];
int16_t k = 0;

void main(void)
{
    int16_t i = 0;
    float v = 0;

    InitSysCtrl();

${DAC_ON}

    for (i = 0; i < 100; i++) {
        v = 1.5 + 1.0 * sin(2.0 * PI * i / 100.0);
        table[i] = v * 4095.0 / 3.0;
    }

${SYNC}

${PIE_INIT}

${TIMER0(100)}

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    k++;
    if (k >= 100) k = 0;
    DacaRegs.DACVALS.bit.DACVALS = table[k];

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      checks: [
        {
          kind: "signal",
          name: "DACA",
          at: 3.55,
          equals: 2.5,
          tol: 0.01,
          label: "The peak, 2.5 V, a quarter period after the timer starts",
          hint: "\"Never produced a value\" means the DAC is still off: reference, DACOUTEN, wait. Otherwise check that entry 25 of your table is 2.5 V.",
        },
        { kind: "signal", name: "DACA", at: 6.05, equals: 1.5, tol: 0.07, label: "Back at 1.5 V after half a period" },
        { kind: "signal", name: "DACA", at: 8.55, equals: 0.5, tol: 0.01, label: "The trough, 0.5 V, at three quarters" },
        {
          kind: "signal",
          name: "DACA",
          at: 11.85,
          equals: 2.0,
          tol: 0.09,
          label: "2.0 V one twelfth into the second period (sin 30 degrees = 0.5)",
          hint: "The table must wrap: after entry 99 comes entry 0.",
        },
        { kind: "signal", name: "DACA", at: 18.55, equals: 0.5, tol: 0.01, label: "The second period has its trough too" },
        { kind: "isr", fn: "cpu_timer0_isr", min: 200, max: 214, label: "A new value every 100 us" },
        {
          kind: "source",
          mustNotMatch: "cpu_timer0_isr\\s*\\(\\s*void\\s*\\)\\s*\\{[^}]*sin",
          label: "The interrupt function does not call sin()",
          hint: "Fill an array in main() and index it in the interrupt function.",
        },
      ],
      bonus: [
        {
          kind: "source",
          mustNotMatch: "cpu_timer0_isr\\s*\\(\\s*void\\s*\\)\\s*\\{[^}]*(\\d\\.\\d|float|setDAC)",
          label: "The interrupt function only looks up and writes: no float arithmetic, no helper call",
          hint: "Store 12-bit numbers in a uint16_t table and write DacaRegs.DACVALS.bit.DACVALS = table[k]; directly.",
        },
      ],
      watch: ["k"],
      hints: [
        "Entry i of the table is the value for t = i x 100 us: the angle is 2 PI i / 100.",
        "Scale in main(): `table[i] = v * 4095.0 / 3.0;` with a `uint16_t` table. No limit is needed, 0.5 V to 2.5 V is inside the range.",
        "In the interrupt: advance the index, wrap at 100, `DacaRegs.DACVALS.bit.DACVALS = table[k];`.",
      ],
      takeaway: "Work that can be done once goes in main(). An interrupt that runs 10 000 times a second should look things up, not compute them.",
    },
    {
      id: "dac-triangle",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Triangle, integers only",
      goal: "Generate a triangle wave on DACB from raw registers, with integer arithmetic only and no helper.",
      refs: [{ course: "L5", slide: 11 }, { trm: "12.2" }, { trm: "12.4.2" }, { trm: "3.8" }],
      brief: `
No \`float\`, no \`setDACB\`, no given set-up. Just registers.

On **DACB**, generate a triangle wave made of 12-bit numbers:

- Timer 0 interrupts every **50 us**. That part is given, with a line that holds the program until 1 ms after reset before the timer starts.
- The number starts at 0 and goes **up by 64** on every interrupt: 64, 128, ... until it reaches **4032**.
- Then it goes **down by 64** on every interrupt until it reaches 0, then up again, and so on.
- The number must never leave 0 to 4032. In volts that is 0 V to 2.953 V.

One full period is 63 steps up and 63 steps down: 126 x 50 us = **6.3 ms**.

The first interrupt outputs 64, the 63rd outputs 4032, the 64th outputs 3968.

Think about where the direction changes. A value that overshoots to 4096 would be stored as 0, and the wave would get a sharp spike. An unsigned value that goes "below 0" becomes 65472 and is stored as 4032.

${VALS_NOTE}
`,
      kit: "robot",
      durationMs: 15,
      starter: `${FREQ}

__interrupt void cpu_timer0_isr(void);

void main(void)
{
    InitSysCtrl();

    // TODO: bring up DACB

${SYNC}

${PIE_INIT}

${TIMER0(50)}

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    // TODO

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      solution: `${FREQ}

__interrupt void cpu_timer0_isr(void);

uint16_t code = 0;
uint16_t goingUp = 1;

void main(void)
{
    InitSysCtrl();

    EALLOW;
    DacbRegs.DACCTL.bit.DACREFSEL = 1;
    DacbRegs.DACOUTEN.bit.DACOUTEN = 1;
    DacbRegs.DACVALS.bit.DACVALS = 0;
    EDIS;

${SYNC}

${PIE_INIT}

${TIMER0(50)}

    while (1) {}
}

__interrupt void cpu_timer0_isr(void)
{
    if (goingUp == 1) {
        code += 64;
        if (code >= 4032) goingUp = 0;
    } else {
        code -= 64;
        if (code == 0) goingUp = 1;
    }
    DacbRegs.DACVALS.bit.DACVALS = code;

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`,
      checks: [
        {
          kind: "signal",
          name: "DACB",
          at: 1.075,
          equals: (64 * 3) / 4096,
          tol: 0.001,
          label: "64 after the first interrupt",
          hint: "\"Never produced a value\" means DACB is still off: set DACREFSEL and DACOUTEN of DacbRegs between EALLOW; and EDIS;.",
        },
        { kind: "signal", name: "DACB", at: 2.625, equals: (2048 * 3) / 4096, tol: 0.001, label: "2048 (1.5 V) after 32 interrupts" },
        {
          kind: "signal",
          name: "DACB",
          at: 4.175,
          equals: (4032 * 3) / 4096,
          tol: 0.001,
          label: "The peak, 4032, after 63 interrupts",
          hint: "Change direction when the number reaches 4032, before it can become 4096.",
        },
        {
          kind: "signal",
          name: "DACB",
          at: 4.225,
          equals: (3968 * 3) / 4096,
          tol: 0.001,
          label: "3968 on the next interrupt: it turns without a spike",
          hint: "0 V here means the number went on to 4096. Turn round when it is equal to 4032, not when it is above.",
        },
        {
          kind: "signal",
          name: "DACB",
          at: 7.325,
          equals: 0,
          tol: 0.001,
          label: "Back at 0 after 126 interrupts",
          hint: "Change direction at 0. One step further and an unsigned number wraps to 65472.",
        },
        { kind: "signal", name: "DACB", at: 7.375, equals: (64 * 3) / 4096, tol: 0.001, label: "Then up again" },
        { kind: "signal", name: "DACB", at: 10.475, equals: (4032 * 3) / 4096, tol: 0.001, label: "The second peak comes 6.3 ms after the first" },
        { kind: "source", mustNotMatch: "float|setDAC|\\d\\.\\d", label: "No float and no helper function" },
      ],
      inspect: ["DacbRegs.DACVALS", "DacbRegs.DACVALA"],
      hints: [
        "Keep two globals: the number and the direction.",
        "Going up: add 64, and if the number is now 4032 switch to going down. Going down: subtract 64, and if it is now 0 switch to going up.",
        "Write the number with `DacbRegs.DACVALS.bit.DACVALS = code;` after updating it.",
      ],
      takeaway: "With integers you see every number that reaches the register. The turning points are where wrap-around hides, so test exactly there.",
    },
  ],
};
