import type { Chapter } from "../types";

const LED_SETUP = `    InitSysCtrl();
    InitGpio();
    // LED1 (GPIO22) and LED2 (GPIO94) as outputs, both off
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
    GPIO_SetupPinMux(94, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(94, GPIO_OUTPUT, GPIO_PUSHPULL);`;

export const ch01: Chapter = {
  id: "registers",
  number: 1,
  title: "Registers",
  blurb: "Memory-mapped registers, .all and .bit, and the EALLOW lock.",
  requires: ["bits"],
  course: ["L2", "Lab 2"],
  levels: [
    {
      id: "reg-brief",
      kind: "brief",
      title: "A register is memory with wires attached",
      goal: "Learn how C code reaches the hardware, then answer three questions.",
      refs: [{ course: "L2" }, { trm: "3.6.1" }, { trm: "8.9" }],
      brief: `
The CPU controls every peripheral (pins, timers, serial ports) by reading and writing **registers**: memory locations whose bits are wired to hardware. Writing a 1 to the right bit turns an LED on.

## Base address plus offset
Each peripheral's registers sit together, starting at a **base address**. A register's address is the base plus its **offset**:

- \`GpioDataRegs\` starts at \`0x7F00\`. Its registers \`GPADAT\`, \`GPASET\`, \`GPACLEAR\`, \`GPATOGGLE\` are 32 bits each (two 16-bit words), so they sit at offsets 0, 2, 4 and 6.
- \`CpuTimer0Regs\` starts at \`0x0C00\`: \`TIM\` at offset 0, \`PRD\` at 2, \`TCR\` at 4.

TI's header files give every register a C name, so you never type addresses.

## Two views of the same bits
\`\`\`c
GpioDataRegs.GPASET.all = 0x00000800;    // the whole register at once
GpioDataRegs.GPASET.bit.GPIO11 = 1;      // one named field
\`\`\`
Both lines do the same thing: bit 11 is \`0x800\`. \`.all\` is the full value, \`.bit.NAME\` is one field.

## Protected registers
Registers that could break the system if written by accident (pin configuration, the interrupt vector table, clocks) are **EALLOW-protected**. A write only takes effect between \`EALLOW;\` and \`EDIS;\`. Outside that pair the write is silently ignored: no error, nothing happens.

\`\`\`c
EALLOW;
GpioCtrlRegs.GPADIR.bit.GPIO22 = 1;   // protected: needs EALLOW
EDIS;
\`\`\`
`,
      questions: [
        {
          prompt: "`GpioDataRegs` starts at `0x7F00` and each of its registers is two words long. What is the address of `GPACLEAR`, the third register?",
          options: ["`0x7F02`", "`0x7F03`", "`0x7F04`", "`0x7F06`"],
          answer: 2,
          why: "GPADAT is at offset 0, GPASET at 2, GPACLEAR at 4: 0x7F00 + 4 = 0x7F04.",
        },
        {
          prompt: "Which `.all` write does the same as `GpioDataRegs.GPASET.bit.GPIO4 = 1;`?",
          options: ["`GpioDataRegs.GPASET.all = 4;`", "`GpioDataRegs.GPASET.all = 0x10;`", "`GpioDataRegs.GPASET.all = 0x40;`", "`GpioDataRegs.GPASET.all = 0x04;`"],
          answer: 1,
          why: "Bit 4 is worth 2^4 = 16 = 0x10. Writing 4 would set bit 2.",
        },
        {
          prompt: "A program writes to an EALLOW-protected register without `EALLOW;`. What happens on the real chip?",
          options: ["The program stops with an error", "The compiler refuses to build it", "The write is ignored and the program carries on", "The register is set to 0"],
          answer: 2,
          why: "Nothing warns you, which is what makes this bug hard to see on the bench. In this game the simulator tells you.",
        },
      ],
      takeaway: "Register address = base + offset; `.all` is the whole value and `.bit.NAME` one field; protected registers need EALLOW ... EDIS.",
    },
    {
      id: "reg-address",
      kind: "calc",
      title: "Find the address",
      goal: "Work out where three registers live in memory.",
      refs: [{ course: "L2" }, { trm: "3.8" }, { trm: "8.9" }],
      brief: `
Each CPU timer has the same five registers. Offsets are in 16-bit words:

- \`TIM\` (counter, 32 bits): offset 0
- \`PRD\` (period, 32 bits): offset 2
- \`TCR\` (control, 16 bits): offset 4
- \`TPR\` (prescale, 16 bits): offset 6
- \`TPRH\` (prescale high, 16 bits): offset 7

Base addresses: \`CpuTimer0Regs\` = \`0x0C00\`, \`CpuTimer1Regs\` = \`0x0C08\`, \`CpuTimer2Regs\` = \`0x0C10\`.

\`GpioDataRegs\` starts at \`0x7F00\`. Port A's \`DAT\`, \`SET\`, \`CLEAR\`, \`TOGGLE\` come first (two words each), then the same four for port B, and so on.

Give each address in hex.
`,
      fields: [
        { id: "a", label: "CpuTimer0Regs.TCR", format: "hex", answer: 0x0c04, why: "0x0C00 + 4." },
        { id: "b", label: "CpuTimer1Regs.PRD", format: "hex", answer: 0x0c0a, why: "0x0C08 + 2 = 0x0C0A." },
        { id: "c", label: "GpioDataRegs.GPBSET", format: "hex", answer: 0x7f0a, why: "Port A uses offsets 0 to 7. Port B starts at 8, and SET is the second register: 8 + 2 = 0xA." },
      ],
      hints: [
        "Address = base + offset, and hex addition carries at 16: 8 + 2 = 0xA.",
        "Port B's four registers start right after port A's four, which take 4 x 2 = 8 words.",
        "The answers are 0x0C04, 0x0C0A and 0x7F0A.",
      ],
    },
    {
      id: "reg-tcr",
      kind: "register",
      title: "Start a timer by its bits",
      goal: "Set the timer control register so the timer runs and its interrupt is enabled.",
      refs: [{ trm: "3.8" }, { course: "L2" }, { course: "Lab 1" }],
      brief: `
This is the real control register of CPU Timer 0, with the fields TI gives it. Right now the timer is **stopped** (\`TSS\` = 1).

Change the bits so that:
- the timer **runs**: \`TSS\` (timer stop status) = 0
- the timer **interrupt is enabled**: \`TIE\` = 1

Leave every other bit at 0. Then look at the hex value: you will recognise it from the course starter code.
`,
      reg: "CpuTimer0Regs.TCR",
      initial: 0x0010,
      targets: [
        { field: "TSS", value: 0 },
        { field: "TIE", value: 1 },
      ],
      code: "CpuTimer0Regs.TCR.all = 0x4000;   // TIE = 1 (bit 14), TSS = 0: run, interrupt enabled",
      hints: [
        "The table under the bits lists each field and which bit it is.",
        "TSS is bit 4: switch it off. TIE is bit 14: switch it on.",
        "The value is 0x4000.",
      ],
      takeaway: "`CpuTimer0Regs.TCR.all = 0x4000;` in the starter code is not a magic number: it is TIE = 1 with everything else 0.",
    },
    {
      id: "reg-all-bit",
      kind: "code",
      mode: "complete",
      title: ".all and .bit",
      goal: "Turn on LED1 with a whole-register write and LED2 with a single-field write.",
      refs: [{ course: "Lab 2" }, { course: "L2" }, { trm: "8.3" }],
      brief: `
The pins are already set up as outputs. Writing a 1 to a pin's bit in a \`SET\` register drives that pin high, which lights these LEDs.

- **LED1** is on GPIO22, in port A. Turn it on by writing the right hex mask to \`GpioDataRegs.GPASET.all\`.
- **LED2** is on GPIO94, in port C (GPIO64 to GPIO95). Turn it on with \`GpioDataRegs.GPCSET.bit.GPIO94\`.

For the mask: bit 22 as hex. 22 = 20 + 2, bit 20 is \`0x00100000\`, and two bits further left multiplies by 4.
`,
      kit: "robot",
      durationMs: 2,
      starter: `void main(void)
{
${LED_SETUP}

    // TODO: turn LED1 (GPIO22) on with one write to GpioDataRegs.GPASET.all

    // TODO: turn LED2 (GPIO94) on with GpioDataRegs.GPCSET.bit.GPIO94

    while (1) {}
}
`,
      solution: `void main(void)
{
${LED_SETUP}

    GpioDataRegs.GPASET.all = 0x00400000;

    GpioDataRegs.GPCSET.bit.GPIO94 = 1;

    while (1) {}
}
`,
      checks: [
        { kind: "led", led: "LED1", at: 1.5, on: true, label: "LED1 is on", hint: "Bit 22 is 0x00400000." },
        { kind: "led", led: "LED2", at: 1.5, on: true, label: "LED2 is on" },
        { kind: "source", mustMatch: "GPASET\\s*\\.\\s*all\\s*=", label: "LED1 uses GPASET.all" },
        { kind: "source", mustMatch: "GPCSET\\s*\\.\\s*bit\\s*\\.\\s*GPIO94\\s*=", label: "LED2 uses GPCSET.bit.GPIO94" },
        { kind: "led", led: "LED3", at: 1.5, on: false, label: "No other LED was switched on" },
      ],
      hints: [
        "A mask for bit n is `1UL << n`, or work it out in hex: every 4 bits is one hex digit.",
        "Bit 22: hex digit number 5 (bits 23 to 20) with value 4, so 0x00400000.",
        "`GpioDataRegs.GPASET.all = 0x00400000;` and `GpioDataRegs.GPCSET.bit.GPIO94 = 1;`",
      ],
      takeaway: "`.bit` is easier to read and harder to get wrong. `.all` is useful when several bits must change in one write.",
    },
    {
      id: "reg-eallow",
      kind: "code",
      mode: "debug",
      title: "The write that did nothing",
      goal: "Find out why LED1 stays dark, and fix it.",
      refs: [{ trm: "3.6.1" }, { course: "L2" }],
      brief: `
This program sets GPIO22 as an output by writing the direction register directly, then drives it high. It compiles, it runs, and LED1 stays off.

Run it and read the message under the editor. Then open the **Registers** tab and look at \`GpioCtrlRegs.GPADIR\`: is the bit really set?

Fix the program so LED1 lights.
`,
      kit: "robot",
      durationMs: 2,
      inspect: ["GpioCtrlRegs.GPADIR"],
      starter: `void main(void)
{
    InitSysCtrl();
    InitGpio();

    // Make GPIO22 (LED1) an output
    GpioCtrlRegs.GPADIR.bit.GPIO22 = 1;

    // Drive it high
    GpioDataRegs.GPASET.bit.GPIO22 = 1;

    while (1) {}
}
`,
      solution: `void main(void)
{
    InitSysCtrl();
    InitGpio();

    // Make GPIO22 (LED1) an output
    EALLOW;
    GpioCtrlRegs.GPADIR.bit.GPIO22 = 1;
    EDIS;

    // Drive it high
    GpioDataRegs.GPASET.bit.GPIO22 = 1;

    while (1) {}
}
`,
      checks: [
        { kind: "led", led: "LED1", at: 1.5, on: true, label: "LED1 is on" },
        { kind: "reg", reg: "GpioCtrlRegs.GPADIR", field: "GPIO22", equals: 1, label: "GPADIR says GPIO22 is an output" },
        { kind: "no-diagnostic", code: "eallow", label: "No write to a protected register was ignored" },
      ],
      hints: [
        "The `GpioCtrlRegs` registers are protected. The `GpioDataRegs` registers are not.",
        "A protected write must sit between `EALLOW;` and `EDIS;`.",
        "Put `EALLOW;` on the line before the GPADIR write and `EDIS;` on the line after it.",
      ],
      takeaway: "On the real board nothing tells you a protected write was ignored. When a configuration \"does not take\", check for EALLOW first. Helper functions such as GPIO_SetupPinOptions do the EALLOW / EDIS for you.",
    },
  ],
};
