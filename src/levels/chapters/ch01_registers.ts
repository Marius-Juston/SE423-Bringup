import type { Chapter } from "../types";

const LED_SETUP = `    // Given: start the chip and get three LED pins ready (chapter 2 explains these lines)
    InitSysCtrl();
    InitGpio();
    // LED1 (GPIO22), LED2 (GPIO94) and LED3 (GPIO95) as outputs, all off
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
    GPIO_SetupPinMux(94, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(94, GPIO_OUTPUT, GPIO_PUSHPULL);
    GPIO_SetupPinMux(95, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(95, GPIO_OUTPUT, GPIO_PUSHPULL);`;

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
      goal: "Learn where registers live in memory and the two ways C names their bits, then answer three questions.",
      refs: [{ course: "L2", slide: [8, 9, 10] }, { trm: "3.6.1" }, { trm: "8.9" }],
      brief: `
A microcontroller is a **CPU** (the part that runs your program) plus **peripherals**: hardware blocks built into the same chip, such as the pins, the timers and the serial ports. The CPU controls every peripheral by reading and writing **registers**: memory locations whose bits are wired to hardware. Writing a 1 to the right bit turns an LED on.

## Base address plus offset
Memory is a long row of 16-bit **words**, and every word has a number, its **address**. Reading or writing a register means reading or writing the memory at that register's address.

Each peripheral's registers sit together, starting at a **base address**. A register's address is the base plus its **offset**, the distance from the base counted in words:

- \`GpioDataRegs\` (the registers that drive the chip's pins) starts at \`0x7F00\`. Its registers \`GPADAT\`, \`GPASET\`, \`GPACLEAR\`, \`GPATOGGLE\` are 32 bits each (two 16-bit words), so they sit at offsets 0, 2, 4 and 6.
- \`CpuTimer0Regs\` (a timer) starts at \`0x0C00\`: \`TIM\` at offset 0, \`PRD\` at 2, \`TCR\` at 4. So \`TCR\` is at \`0x0C00\` + 4 = \`0x0C04\`.

{{figure:memory-map}}

Try it in the figure: pick a register and read its address off the strip, then click its bits and watch the \`.all\` value and the \`.bit\` field change together.

TI (Texas Instruments) makes the chip and supplies header files that give every register a C name, so you never type addresses.

## Two views of the same bits
\`\`\`c
GpioDataRegs.GPASET.all = 0x00000800;    // the whole register at once
GpioDataRegs.GPASET.bit.GPIO11 = 1;      // one named field
\`\`\`
Both lines do the same thing: bit 11 is \`0x800\`. \`.all\` is the full value. \`.bit.NAME\` is one **field**: a group of one or more bits with one meaning. This is the union of chapter C: two names for the same memory.
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
          prompt: "Which of these is a peripheral?",
          options: ["A timer built into the chip", "A variable called `count` in your program", "The `while (1)` loop of `main`", "The USB cable to your PC"],
          answer: 0,
          why: "A peripheral is a hardware block inside the chip that the CPU controls through registers: the pins, the timers, the serial ports.",
        },
      ],
      takeaway: "Register address = base + offset. `.all` is the whole value and `.bit.NAME` is one field of it.",
    },
    {
      id: "reg-address",
      kind: "calc",
      title: "Find the address",
      goal: "Work out where three registers live in memory.",
      refs: [{ course: "L2", slide: 10 }, { trm: "3.8" }, { trm: "8.9" }],
      brief: `
The chip has three CPU timers, and each has the same five registers. What they do comes in chapter 4. Here only their places matter. Offsets are in 16-bit words:

- \`TIM\` (counter, 32 bits): offset 0
- \`PRD\` (period, 32 bits): offset 2
- \`TCR\` (control, 16 bits): offset 4
- \`TPR\` (prescale, 16 bits): offset 6
- \`TPRH\` (prescale high, 16 bits): offset 7

Base addresses: \`CpuTimer0Regs\` = \`0x0C00\`, \`CpuTimer1Regs\` = \`0x0C08\`, \`CpuTimer2Regs\` = \`0x0C10\`.

\`GpioDataRegs\` starts at \`0x7F00\`. Port A's \`DAT\`, \`SET\`, \`CLEAR\`, \`TOGGLE\` come first (two words each), then the same four for port B, and so on.

{{figure:memory-map}}

The figure draws these registers to scale for timer 0 and port A: use it to check how the offsets come about, then do the three below by the same rule.

Add in hex the way you add in decimal, but a digit only carries when it passes F (fifteen): \`0x0C08\` + 4 is \`0x0C0C\`, because 8 + 4 is twelve and twelve is the digit C.

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
        "TCR of timer 0: 0x0C00 + 4. PRD of timer 1: 0x0C08 + 2. GPBSET: 0x7F00 + 8 for port B + 2 for SET. Write each sum in hex.",
      ],
    },
    {
      id: "reg-tcr",
      kind: "register",
      title: "Start a timer by its bits",
      goal: "Set the timer control register so the timer runs and its interrupt is enabled.",
      refs: [{ course: "L2", slide: [23, 24] }, { course: "Lab 1" }, { trm: "3.8" }],
      brief: `
CPU Timer 0 is a counter built into the chip. This is its real control register, with the fields TI gives it. A **field** is a group of one or more bits with one meaning. Right now the timer is **stopped** (\`TSS\` = 1).

Change the bits so that:
- the timer **runs**: \`TSS\` (timer stop status) = 0
- the timer **interrupt is enabled**: \`TIE\` = 1. An interrupt lets the timer call one of your functions each time it finishes counting. Chapter 5 uses it.

Leave every other bit at 0. Then look at the hex value: the starter code of the labs writes exactly this number.
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
      refs: [{ course: "L2", slide: [13, 10] }, { course: "Lab 2" }, { trm: "8.3" }],
      brief: `
The chip's pins are numbered GPIO0 to GPIO168 and grouped in **ports** of 32: port A is GPIO0 to GPIO31, port B is GPIO32 to GPIO63, port C is GPIO64 to GPIO95. Each port has its own registers, with the port letter in the name.

A **pin** is one of the chip's metal contacts. The first lines of \`main\` start the chip and set up three pins so the program can drive the LEDs wired to them. The next chapter explains those lines. Writing a 1 to a pin's bit in a \`SET\` register drives that pin **high** (3.3 V), which lights its LED. Bits written as 0 change nothing.

- **LED1** is on GPIO22, in port A. Turn it on by writing the right hex mask to \`GpioDataRegs.GPASET.all\`.
- **LED2** is on GPIO94, in port C (GPIO64 to GPIO95). Turn it on with \`GpioDataRegs.GPCSET.bit.GPIO94\`.

For the mask you need bit 22 as a 32-bit hex number. Bits 23 to 20 are the sixth hex digit from the right, and bit 22 is worth 4 inside that digit: \`0x00400000\`. Or let C do it: \`1UL << 22\`. The \`UL\` makes the 1 a 32-bit value. A plain \`1\` is a 16-bit \`int\` and cannot be shifted that far.

Light LED1 and LED2 only. LED3 (GPIO95) shares port C with LED2 and must stay off.
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

    GpioDataRegs.GPASET.all = 1UL << 22;    // bit 22, the same as 0x00400000

    GpioDataRegs.GPCSET.bit.GPIO94 = 1;

    while (1) {}
}
`,
      checks: [
        { kind: "led", led: "LED1", at: 1.5, on: true, label: "LED1 is on", hint: "The value written to GPASET.all must have a 1 in bit 22 and nowhere else: `1UL << 22`, which is 0x00400000. Writing the number 22 sets other bits, and a plain `1 << 22` gives 0 on this chip." },
        { kind: "led", led: "LED2", at: 1.5, on: true, label: "LED2 is on", hint: "GPIO94 is in port C: `GpioDataRegs.GPCSET.bit.GPIO94 = 1;`. A 0 written to a SET register does nothing." },
        { kind: "source", mustMatch: "GPASET\\s*\\.\\s*all\\s*\\|?=", label: "LED1 uses GPASET.all" },
        { kind: "source", mustMatch: "GPCSET\\s*\\.\\s*bit\\s*\\.\\s*GPIO94\\s*=", label: "LED2 uses GPCSET.bit.GPIO94" },
        { kind: "led", led: "LED3", at: 1.5, on: false, label: "LED3 stays off: only the bits you mean are written", hint: "GPIO95 is LED3. A write to GPCSET must have a 1 only in the bit of GPIO94." },
        {
          kind: "latch",
          port: "A",
          equals: 0x00400000,
          label: "The write to GPASET.all has a 1 in bit 22 and in no other bit",
          hint: "A 1 written to the bit of a pin that is not an output lights nothing, but the port remembers it. The mask must be exactly `1UL << 22`, which is 0x00400000.",
        },
        {
          kind: "latch",
          port: "C",
          equals: 0x40000000,
          label: "In port C only GPIO94's bit is written",
          hint: "GPIO94 is bit 30 of port C (94 - 64 = 30). `GpioDataRegs.GPCSET.bit.GPIO94 = 1;` writes that bit and no other.",
        },
      ],
      bonus: [
        {
          kind: "source",
          mustMatch: "GPASET\\s*\\.\\s*all\\s*=\\s*\\(?\\s*1UL\\s*<<\\s*22\\b",
          label: "LED1's mask is written as `1UL << 22`, so the bit number can be read off the code",
          hint: "A plain `1 << 22` is a 16-bit shift on this chip and gives 0. The UL makes the 1 a 32-bit value.",
        },
      ],
      hints: [
        "A mask for bit n is `1UL << n`, or work it out in hex: every 4 bits is one hex digit.",
        "Bit 22 sits in the hex digit that holds bits 23 to 20, as the value 4: 0x00400000.",
        "`GpioDataRegs.GPASET.all = 1UL << 22;` (or `= 0x00400000;`) and `GpioDataRegs.GPCSET.bit.GPIO94 = 1;`",
      ],
      takeaway: "`.bit` is easier to read and harder to get wrong. `.all` is useful when several bits must change in one write.",
    },
    {
      id: "reg-eallow",
      kind: "code",
      mode: "debug",
      title: "The write that did nothing",
      goal: "Find out why LED1 stays dark, and fix it.",
      refs: [{ course: "L2", slide: [12, 11] }, { trm: "3.6.1" }],
      brief: `
## Protected registers
Some registers could break the system if they were written by accident: pin configuration, speed settings and a few others. They are **EALLOW-protected**. A write only takes effect between \`EALLOW;\`, which unlocks them, and \`EDIS;\`, which locks them again. Outside that pair the write is silently ignored: no error, nothing happens.

\`\`\`c
EALLOW;
GpioCtrlRegs.GPADIR.bit.GPIO22 = 1;   // protected: needs EALLOW
EDIS;
\`\`\`

{{figure:eallow-lock}}

Try it in the figure: run the write first, on its own, then again after \`EALLOW;\`.

## Your task
This program makes GPIO22 an output by writing 1 to its bit in the direction register \`GPADIR\`, then drives the pin high. It compiles, it runs, and LED1 stays off.

Run it and read the message under the editor. Then open the **Registers** tab and look at \`GpioCtrlRegs.GPADIR\`: is the bit really set? Fix the program so LED1 lights.
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
        { kind: "led", led: "LED1", at: 1.5, on: true, label: "LED1 is on", hint: "The pin only drives the LED once it is an output. Check the next test first." },
        { kind: "reg", reg: "GpioCtrlRegs.GPADIR", field: "GPIO22", equals: 1, label: "GPADIR says GPIO22 is an output", hint: "The GPADIR write was ignored. `EALLOW;` must come before that line and `EDIS;` after it. Each is a statement on its own, with a semicolon and no brackets." },
        { kind: "no-diagnostic", code: "eallow", label: "No write to a protected register was ignored", hint: "Put `EALLOW;` on the line before the GPADIR write, not after it." },
      ],
      bonus: [
        {
          kind: "source",
          mustMatch: "EDIS\\s*;[\\s\\S]*GPASET",
          label: "Protection is switched back on (EDIS) before the pin is driven",
          hint: "Keep the unlocked stretch as short as possible: EALLOW, the protected write, EDIS. GPASET is not protected.",
        },
      ],
      hints: [
        "The `GpioCtrlRegs` registers are protected. The `GpioDataRegs` registers are not.",
        "A protected write must sit between `EALLOW;` and `EDIS;`.",
        "Put `EALLOW;` on the line before the GPADIR write and `EDIS;` on the line after it.",
      ],
      takeaway: "On the real board nothing tells you a protected write was ignored. When a configuration \"does not take\", check for EALLOW first. Helper functions such as GPIO_SetupPinOptions do the EALLOW / EDIS for you.",
    },
    {
      id: "reg-mux-field",
      kind: "register",
      title: "Two bits per pin",
      goal: "Change two pin multiplexer fields of GPBMUX1 and leave every other field alone.",
      refs: [{ course: "L3", slide: [21, 22] }, { trm: "8.7" }, { trm: "8.9.2" }],
      brief: `
The chip has more peripherals than pins, so most pins can do one of several jobs. A **pin multiplexer** (mux for short) is the selector switch behind each pin: it connects the pin either to plain input/output (GPIO) or to one of the peripherals.

Not every field is one bit wide. \`GpioCtrlRegs.GPBMUX1\` holds the mux setting of GPIO32 to GPIO47, with **two bits per pin**: GPIO32 uses bits 1 to 0, GPIO33 bits 3 to 2, and so on. The value 0 means plain GPIO.

The register reads \`0x00300010\`:

- **GPIO34** (the LaunchPad's red LED) holds 1. The pin is switched to a peripheral, so the LED cannot be driven as a GPIO. It should be 0.
- **GPIO42** holds 3: it is connected to the serial port's transmitter. That is correct. Leave it.
- **GPIO43** holds 0. It should be 3, like GPIO42, to connect it to the serial port's receiver.

Fix GPIO34 and GPIO43. Every other field must keep its value.

A full mux position has four bits, 0 to 15. The upper two are in a second register, \`GPBGMUX1\`, with the same layout. This puzzle only changes the lower two.
`,
      reg: "GpioCtrlRegs.GPBMUX1",
      initial: 0x00300010,
      targets: [
        { field: "GPIO34", value: 0 },
        { field: "GPIO43", value: 3 },
      ],
      code: "EALLOW;\nGpioCtrlRegs.GPBMUX1.bit.GPIO34 = 0;\nGpioCtrlRegs.GPBMUX1.bit.GPIO43 = 3;\nEDIS;\n// with masks: GPBMUX1.all = (GPBMUX1.all & ~0x00000030) | 0x00C00000;",
      hints: [
        "The field of GPIOn starts at bit 2 x (n - 32). GPIO34 is bits 5 to 4.",
        "GPIO43 is bits 23 to 22. The value 3 means both bits on.",
        "Switch bit 4 off and bits 23 and 22 on. The value is 0x00F00000.",
      ],
      takeaway: "The course code never writes these fields by hand. TI's helper GPIO_SetupPinMux(43, GPIO_MUX_CPU1, 15) does it: 15 is binary 1111, so it writes 3 to the GPBGMUX1 field and 3 to the GPBMUX1 field of GPIO43. Position 0 is plain GPIO.",
    },
    {
      id: "reg-page",
      kind: "quiz",
      title: "Read a register page",
      goal: "Find a field's bits, its reset value, its access type and its write protection on the manual's page of a register.",
      refs: [{ course: "L2", slide: [13, 9] }, { course: "HW2", note: "fill in the blanks from the register descriptions" }, { trm: "3.15.2" }, { trm: "3.15.6" }],
      brief: `
## Where the bits come from
Every register in this game is described in one book: the chip's **Technical Reference Manual**, about 2,500 pages. Nobody knows it by heart. You open the page of the register you need and read it. The homeworks and labs hand you code with blanks and tell you to do exactly that.

{{figure:register-page}}

The figure is the manual's page for \`TCR\`, the timer control register of the earlier puzzle. A page says everything twice:

- **The picture.** Bit numbers on top, the field names in boxes, and under each box a code such as \`R/W-0h\`.
- **The table.** One row per field: Bit, Field, Type, Reset, Description.

## Worked example: TSS
Find \`TSS\` in the picture. The number above it is 4, so \`TSS\` is bit 4. Under it stands \`R/W-0h\`:

- **Type R/W**: you can read it and write it.
- **Reset 0h**: the value it holds after a **reset**, the moment the chip starts again from the beginning (power on, or the reset button). The \`h\` says the number is hexadecimal.
- The **Description** row says what each value does: 0 means the timer runs, 1 stops it.

So after a reset the timer runs. Choose \`TSS\` in the figure to see the same thing in words and in C.

## Three more things to look for
- **R/W1C**: a flag the hardware sets. You put it back to 0 by writing 1. Writing 0 does nothing.
- **RESERVED**: bits the chip keeps for itself. Leave them alone.
- **Write Protection**: \`EALLOW\` here means the register is one of the protected ones from the EALLOW level. This line comes from the list of the peripheral's registers, one page earlier in the manual.

Answer from the page. Use the **Register** buttons under the picture to turn to another page.
`,
      questions: [
        {
          prompt: "Turn to the page of `XINT1CR`. Which bits does its `POLARITY` field occupy?",
          options: ["Bit 0", "Bits 1 to 0", "Bits 3 to 2", "Bits 15 to 4"],
          answer: 2,
          why: "POLARITY sits under the numbers 3 and 2 in the picture, and its row of the table starts with 3-2. Bits 15 to 4 are RESERVED and bit 0 is ENABLE.",
        },
        {
          prompt: "Back on the page of `TCR`: right after a reset, what do its four lowest bits (3 to 0) hold?",
          options: ["0", "1", "15", "The page does not say"],
          answer: 1,
          why: "Under that RESERVED box stands R-1h: read only, reset value 1. That is also why the heading says [reset = 1h] for the whole register.",
        },
        {
          prompt: "The timer has set the flag `TIF`. Which line puts it back to 0?",
          options: [
            "`CpuTimer0Regs.TCR.bit.TIF = 0;`",
            "`CpuTimer0Regs.TCR.bit.TIF = 1;`",
            "Nothing: `TIF` is read only",
            "`CpuTimer0Regs.TCR.bit.TIE = 0;`",
          ],
          answer: 1,
          why: "TIF has Type R/W1C: write 1 to clear. The Description says the same: writes of 0 are ignored, writing a 1 clears the flag.",
        },
        {
          prompt: "Which of these registers must be written between `EALLOW;` and `EDIS;`?",
          options: ["`TCR`", "`XINT1CR`", "`GPAMUX1`", "All three"],
          answer: 2,
          why: "Only the page of GPAMUX1 has Write Protection: EALLOW. The other two say none. Never guess this: a write to a protected register without EALLOW is ignored without any error.",
        },
        {
          prompt: "On the page of `XINT1CR`: which value of `POLARITY` selects a positive (rising) edge only?",
          options: ["0", "1", "2", "3"],
          answer: 1,
          why: "The Description lists the values in binary: 01 is positive edge. 00 and 10 are both the negative edge, and 11 is both edges.",
        },
      ],
      hints: [
        "Each question names a register. Turn to its page with the Register buttons first.",
        "Bits: the numbers above the box. Reset and access: the code under the box, such as R/W1C-0h. Meaning of each value: the Description column.",
        "POLARITY is under 3 and 2. The lowest box of TCR says R-1h. TIF is R/W1C. Look for the line Write Protection on each page.",
      ],
      takeaway: "A register page answers four questions: which bits, what they hold after reset, how they may be accessed, and what each value means. Read it instead of guessing.",
    },
    {
      id: "reg-page-set",
      kind: "register",
      tier: "practice",
      title: "Set a register from its page",
      goal: "Set XINT2CR for an interrupt on both edges, with every value read from the manual's page.",
      refs: [{ course: "L2", slide: 13 }, { trm: "3.15.6" }],
      brief: `
An **external interrupt** lets a pin call one of your functions when its voltage changes, for example when a button is pressed. Chapter 5 uses it. Its control register decides which change counts: a rising edge (low to high), a falling edge (high to low), or both.

The puzzle is the register \`XINT2CR\`. The manual prints one page for each of the five registers \`XINT1CR\` to \`XINT5CR\`, and all five have the same fields.

{{figure:register-page}}

Choose **XINT1CR** under the picture in the figure and read its page. Then set the puzzle so that:

- the interrupt reacts to **both** edges, rising and falling
- the interrupt is **enabled**

The register starts at \`0x0004\`. Leave the reserved bits at 0.

The puzzle shows where the fields are, but not what their values mean. Only the Description column of the page tells you that.
`,
      reg: "XintRegs.XINT2CR",
      initial: 0x0004,
      targets: [
        { field: "POLARITY", value: 3 },
        { field: "ENABLE", value: 1 },
      ],
      code: "XintRegs.XINT2CR.bit.POLARITY = 3;   // 11: positive or negative edge\nXintRegs.XINT2CR.bit.ENABLE = 1;     // 1: interrupt enabled",
      hints: [
        "Two fields matter: POLARITY and ENABLE. The page lists what each of their values does.",
        "The values of POLARITY are printed in binary. Find the line that says positive or negative edge.",
        "POLARITY must be 11 (both of its bits on) and ENABLE 1. The value is 0x000D.",
      ],
      takeaway: "The field names tell you where to write. Only the Description column tells you what to write.",
    },
    {
      id: "reg-raw",
      tier: "practice",
      kind: "code",
      mode: "complete",
      title: "Registers without their names",
      goal: "Light LED1 and LED2 by writing to raw addresses.",
      refs: [{ course: "L2", slide: [10, 13] }, { course: "L3", slide: 22, note: "volatile pointers to register addresses" }, { trm: "8.9.1" }, { trm: "8.3" }],
      brief: `
The names in TI's header files are a convenience. Underneath, \`GpioDataRegs.GPASET\` is the 32-bit value at address \`0x7F02\`, and a pointer reaches it directly:

\`\`\`c
*(volatile Uint32 *)0x7F02 = 0x00400000;   // same as GpioDataRegs.GPASET.all = 0x00400000;
\`\`\`

Read it from the inside out: take the number \`0x7F02\`, treat it as the address of a 32-bit value, and store to it. \`Uint32\` is TI's older name for \`uint32_t\` (and \`Uint16\` for \`uint16_t\`). \`volatile\` tells the compiler that hardware is on the other end, so every access must really happen.

The starter wraps this in a \`#define\` with an argument: wherever you write \`REG32(0x7F02)\`, the compiler pastes in the long expression with \`0x7F02\` as the address.

Light **LED1** (GPIO22) and **LED2** (GPIO94) without the name \`GpioDataRegs\`. You need two facts: \`GpioDataRegs\` starts at \`0x7F00\`, and each port has DAT, SET, CLEAR and TOGGLE (two words each), port A first, then B, then C.
`,
      kit: "robot",
      durationMs: 2,
      starter: `#define REG32(address) (*(volatile Uint32 *)(address))

void main(void)
{
${LED_SETUP}

    // TODO: LED1 on. GPASET is at 0x7F02; GPIO22 is bit 22 of port A.
    REG32(0x7F02) = 0;

    // TODO: LED2 on. Work out the address of GPCSET and the bit of GPIO94 in port C.

    while (1) {}
}
`,
      solution: `#define REG32(address) (*(volatile Uint32 *)(address))

void main(void)
{
${LED_SETUP}

    // LED1 on. GPASET is at 0x7F02; GPIO22 is bit 22 of port A.
    REG32(0x7F02) = 0x00400000;

    // LED2 on. Port C starts 2 x 8 words after port A, and SET is 2 words in: 0x7F12.
    // GPIO94 is bit 94 - 64 = 30 of port C.
    REG32(0x7F12) = 0x40000000;

    while (1) {}
}
`,
      checks: [
        { kind: "led", led: "LED1", at: 1.5, on: true, label: "LED1 is on", hint: "Bit 22 is 0x00400000." },
        { kind: "led", led: "LED2", at: 1.5, on: true, label: "LED2 is on", hint: "Each port takes 8 words. Port C is the third port, and SET is its second register." },
        { kind: "led", led: "LED3", at: 1.5, on: false, label: "LED3 (GPIO95) stays off", hint: "GPIO95 is bit 31 of port C. GPIO94 is bit 30." },
        { kind: "source", mustNotMatch: "GpioDataRegs", label: "The name GpioDataRegs is not used" },
        { kind: "no-dat-write", label: "The pins are driven through SET registers, not DAT" },
      ],
      hints: [
        "Port A's four registers use offsets 0, 2, 4 and 6. Port B starts at offset 8, port C at offset 16 (0x10).",
        "GPCSET is at 0x7F00 + 0x10 + 2 = 0x7F12. GPIO94 is bit 94 - 64 = 30.",
        "`REG32(0x7F02) = 0x00400000;` and `REG32(0x7F12) = 0x40000000;`",
      ],
      takeaway: "A register name is an address with a type. TI's own GPIO_SetupPinMux works this way: it computes the address from the pin number, because a name cannot be chosen at run time.",
    },
    {
      id: "reg-all-wipe",
      tier: "expert",
      kind: "code",
      mode: "debug",
      title: "Three innocent lines",
      goal: "Since the red LED was added, the serial message is gone and LED11 is dark. Repair the damage.",
      refs: [{ course: "L2", slide: 20 }, { course: "L3", slide: 22, note: "changing one pin's field only" }, { trm: "8.9.2" }, { trm: "8.7" }, { trm: "3.6.1" }],
      brief: `
This program printed \`ready\` and lit LED11 (GPIO60). Then a teammate added the LaunchPad's red LED (GPIO34) with three \`.all\` writes. Each value is right for GPIO34. The red LED works. The message and LED11 do not.

Two of the three new lines do damage. The third is harmless, and you should be able to say why.

Find out what the lines do to the other pins of port B, and fix them. Moving code around so that the damage is repaired afterwards is not a fix.

The **Registers** tab shows \`GpioCtrlRegs.GPBMUX1\` and \`GpioCtrlRegs.GPBDIR\` before and after.
`,
      kit: "redboard",
      durationMs: 5,
      inspect: ["GpioCtrlRegs.GPBMUX1", "GpioCtrlRegs.GPBGMUX1", "GpioCtrlRegs.GPBDIR"],
      starter: `void main(void)
{
    InitSysCtrl();
    InitGpio();
    init_serialSCIA(&SerialA, 115200);

    // LED11 (GPIO60) on
    GPIO_SetupPinMux(60, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(60, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPBSET.bit.GPIO60 = 1;

    // New: red LaunchPad LED (GPIO34 is bit 2 of port B, lit when low)
    EALLOW;
    GpioCtrlRegs.GPBMUX1.all = 0x00000000;      // GPIO34: plain GPIO
    GpioCtrlRegs.GPBDIR.all = 0x00000004;       // GPIO34: output
    EDIS;
    GpioDataRegs.GPBCLEAR.all = 0x00000004;     // GPIO34: low, LED on

    serial_printf(&SerialA, "ready\\r\\n");
    while (1) {}
}
`,
      solution: `void main(void)
{
    InitSysCtrl();
    InitGpio();
    init_serialSCIA(&SerialA, 115200);

    // LED11 (GPIO60) on
    GPIO_SetupPinMux(60, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(60, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPBSET.bit.GPIO60 = 1;

    // New: red LaunchPad LED (GPIO34 is bit 2 of port B, lit when low)
    EALLOW;
    GpioCtrlRegs.GPBMUX1.bit.GPIO34 = 0;        // only GPIO34's field: the serial pins keep theirs
    GpioCtrlRegs.GPBDIR.bit.GPIO34 = 1;         // only GPIO34's bit: GPIO60 stays an output
    EDIS;
    GpioDataRegs.GPBCLEAR.all = 0x00000004;     // harmless: CLEAR only acts on bits written as 1

    serial_printf(&SerialA, "ready\\r\\n");
    while (1) {}
}
`,
      checks: [
        { kind: "serial", includes: "ready\r\n", label: "The terminal shows: ready", hint: "The serial pins GPIO42 and GPIO43 have fields in GPBMUX1 too." },
        { kind: "led", led: "LED11", at: 4, on: true, label: "LED11 is on", hint: "GPIO60 is bit 28 of GPBDIR. What does the new GPBDIR write store there?" },
        { kind: "led", led: "RED", at: 4, on: true, label: "The red LED is on" },
        { kind: "reg", reg: "GpioCtrlRegs.GPBMUX1", field: "GPIO42", equals: 3, label: "GPIO42 is still switched to the serial port" },
        { kind: "no-diagnostic", code: "sci-mux", label: "The serial port reaches its pin" },
        {
          kind: "source",
          mustNotMatch: "GpioCtrlRegs\\s*\\.\\s*\\w+\\s*\\.\\s*all\\s*=(?!=)",
          label: "No pin configuration register is overwritten as a whole",
          hint: "`.all = value` replaces all 32 bits. Use `.bit.GPIO34`, or `|=` and `&= ~` with a mask.",
        },
      ],
      bonus: [
        {
          kind: "source",
          mustMatch: "GPBCLEAR\\s*\\.\\s*all\\s*=\\s*0x0*4\\b",
          label: "The harmless `.all` write is left exactly as it was",
          hint: "SET, CLEAR and TOGGLE registers ignore every bit written as 0. A whole-register write to them touches only the pins you name.",
        },
      ],
      hints: [
        "`.all = value` writes all 32 bits. Every pin of port B that is not GPIO34 gets a 0 in that register.",
        "A 0 in GPBMUX1 takes GPIO42 and GPIO43 away from the serial port. A 0 in GPBDIR turns GPIO60 back into an input. A 0 written to GPBCLEAR does nothing at all.",
        "`GpioCtrlRegs.GPBMUX1.bit.GPIO34 = 0;` and `GpioCtrlRegs.GPBDIR.bit.GPIO34 = 1;` change one pin each.",
      ],
      takeaway: "A configuration register holds settings for many pins, and other code owns most of them. Change your field and keep the rest: `.bit`, or read, mask and write. Registers that act only on 1s (SET, CLEAR, TOGGLE, PIEACK) are the exception, and `.all` is the right tool there.",
    },
    {
      id: "reg-fields",
      tier: "expert",
      kind: "code",
      mode: "write",
      title: "Your own .bit",
      goal: "Write setField and getField: they change or read any field of any 32-bit register, given only numbers.",
      refs: [{ course: "L2", slide: [19, 20] }, { course: "L3", slide: 22, note: "fields written with mask and shift" }, { trm: "3.6.1" }, { trm: "8.9.2" }, { trm: "3.8" }],
      brief: `
\`.bit.NAME\` only works when the register and the field are known while you type. Library code gets them as numbers. Write the two functions such code is built on:

- \`setField(address, shift, width, value)\`: stores \`value\` in the field that is \`width\` bits wide and starts at bit \`shift\` of the 32-bit register at \`address\`. No other bit of the register may change. A value too wide for the field must not spill into its neighbours.
- \`getField(address, shift, width)\`: returns that field, moved down to bit 0.

\`main\` uses them on four real registers. Some are EALLOW-protected, so \`setField\` has to deal with that. \`width\` goes from 1 to 32. \`Uint16\` and \`Uint32\` are TI's older names for \`uint16_t\` and \`uint32_t\`.

The addresses used: \`GPAMUX2\` 0x7C08, \`GPADIR\` 0x7C0A, \`CpuTimer0Regs.PRD\` 0x0C02, \`GPASET\` 0x7F02.
`,
      kit: "robot",
      durationMs: 2,
      watch: ["mux22", "period", "periodLow"],
      inspect: ["GpioCtrlRegs.GPADIR", "GpioCtrlRegs.GPAMUX2", "CpuTimer0Regs.PRD"],
      starter: `Uint32 mux22, period, periodLow;

void setField(Uint32 address, Uint16 shift, Uint16 width, Uint32 value)
{
    // TODO
}

Uint32 getField(Uint32 address, Uint16 shift, Uint16 width)
{
    // TODO
    return 0;
}

void main(void)
{
    InitSysCtrl();
    InitGpio();

    setField(0x7C0A, 22, 1, 1);         // GPADIR: GPIO22 is an output
    setField(0x7C0A, 31, 1, 1);         // GPADIR: GPIO31 too ...
    setField(0x7C0A, 31, 1, 0);         // ... and back to an input

    setField(0x7C08, 12, 2, 7);         // GPAMUX2, GPIO22's field: 7 does not fit in 2 bits
    mux22 = getField(0x7C08, 12, 2);
    setField(0x7C08, 12, 2, 0);         // back to plain GPIO

    setField(0x0C02, 0, 32, 199999);    // CpuTimer0Regs.PRD: the whole register
    period = getField(0x0C02, 0, 32);
    periodLow = getField(0x0C02, 0, 16);

    setField(0x7F02, 22, 1, 1);         // GPASET: LED1 on

    while (1) {}
}
`,
      solution: `Uint32 mux22, period, periodLow;

// width ones at the bottom of a 32-bit value (width 1 to 32)
Uint32 ones(Uint16 width)
{
    return 0xFFFFFFFFUL >> (32 - width);
}

void setField(Uint32 address, Uint16 shift, Uint16 width, Uint32 value)
{
    volatile Uint32 *reg = (volatile Uint32 *)address;
    Uint32 mask = ones(width) << shift;

    EALLOW;     // needed by some registers, harmless for the rest
    *reg = (*reg & ~mask) | ((value << shift) & mask);
    EDIS;
}

Uint32 getField(Uint32 address, Uint16 shift, Uint16 width)
{
    return (*(volatile Uint32 *)address >> shift) & ones(width);
}

void main(void)
{
    InitSysCtrl();
    InitGpio();

    setField(0x7C0A, 22, 1, 1);         // GPADIR: GPIO22 is an output
    setField(0x7C0A, 31, 1, 1);         // GPADIR: GPIO31 too ...
    setField(0x7C0A, 31, 1, 0);         // ... and back to an input

    setField(0x7C08, 12, 2, 7);         // GPAMUX2, GPIO22's field: 7 does not fit in 2 bits
    mux22 = getField(0x7C08, 12, 2);
    setField(0x7C08, 12, 2, 0);         // back to plain GPIO

    setField(0x0C02, 0, 32, 199999);    // CpuTimer0Regs.PRD: the whole register
    period = getField(0x0C02, 0, 32);
    periodLow = getField(0x0C02, 0, 16);

    setField(0x7F02, 22, 1, 1);         // GPASET: LED1 on

    while (1) {}
}
`,
      checks: [
        { kind: "reg", reg: "GpioCtrlRegs.GPADIR", equals: 0x00400000, label: "GPADIR ends as 0x00400000: bit 22 survived the changes to bit 31", hint: "Clear the field with AND and the inverted mask, then OR the new value in. Do not write the register as a whole." },
        { kind: "no-diagnostic", code: "eallow", label: "No write to a protected register was ignored", hint: "setField cannot know which registers are protected. EALLOW ... EDIS around the write costs nothing for the others." },
        { kind: "var", name: "mux22", equals: 3, label: "The value 7 was cut to the field's 2 bits: getField returns 3" },
        { kind: "reg", reg: "GpioCtrlRegs.GPAMUX2", equals: 0, label: "GPAMUX2 is 0 again: nothing leaked into GPIO23's field", hint: "Mask the shifted value with the field mask before the OR." },
        { kind: "var", name: "period", equals: 199999, label: "A 32-bit wide field works: the period reads 199999", hint: "`(1UL << 32) - 1` is not a valid way to make 32 ones. Shift 0xFFFFFFFFUL right instead." },
        { kind: "var", name: "periodLow", equals: 3391, label: "The low 16 bits of the period read 3391 (0x0D3F)" },
        { kind: "led", led: "LED1", at: 1.5, on: true, label: "LED1 is on" },
        { kind: "no-diagnostic", code: "shift-16", label: "No shift that overflows a 16-bit int" },
        { kind: "no-diagnostic", code: "shift-width", label: "No shift by 32 or more", hint: "For a 32-bit wide field `1UL << width` is a shift by 32, which C does not define. Build the ones with `0xFFFFFFFFUL >> (32 - width)`." },
      ],
      bonus: [
        { kind: "source", mustNotMatch: "\\bif\\b|\\?|\\bswitch\\b", label: "No `if`, `?:` or `switch`: one formula for every width and register" },
      ],
      hints: [
        "Turn the address into a pointer: `volatile Uint32 *reg = (volatile Uint32 *)address;`. Then `*reg` is the register.",
        "Build `mask` with `width` ones starting at `shift`. New value: `(*reg & ~mask) | ((value << shift) & mask)`. Put EALLOW before the write and EDIS after it.",
        "`width` ones: `0xFFFFFFFFUL >> (32 - width)`. This also works for width 32, where `(1UL << width) - 1` is undefined.",
      ],
      takeaway: "This is what `.bit` compiles to: read the register, clear the field, insert the new value, write it back. It also shows the weak point: between the read and the write, an interrupt could change the same register, and its change would be lost.",
    },
    {
      id: "reg-dump",
      tier: "expert",
      kind: "calc",
      title: "Read a memory dump",
      goal: "Work out what a program configured from the raw words in the debugger's memory view.",
      refs: [{ course: "L2", slide: [9, 10] }, { trm: "3.8" }, { trm: "8.9.2" }],
      brief: `
A debugger's memory view shows 16-bit words and nothing else. The names are up to you.

A 32-bit register takes two words, and this CPU stores the **low word first**: the value \`0x12345678\` at address A appears as \`0x5678\` at A and \`0x1234\` at A + 1.

\`\`\`c
0x0C00:  0x86A0 0x0001 0x0D3F 0x0003 0x4010 0x0000 0x0000 0x0000
0x7C0A:  0x0000 0x8040
0x7C46:  0x0000 0x00F0
\`\`\`

What you need to know:

- \`CpuTimer0Regs\` starts at \`0x0C00\`: \`TIM\` (32 bits), \`PRD\` (32 bits), then \`TCR\` (16 bits) with \`TSS\` in bit 4 and \`TIE\` in bit 14.
- \`0x7C0A\` is \`GpioCtrlRegs.GPADIR\`: one bit per pin, GPIO0 to GPIO31.
- \`0x7C46\` is \`GpioCtrlRegs.GPBMUX1\`: two bits per pin, GPIO32 to GPIO47.
`,
      fields: [
        { id: "prd", label: "CpuTimer0Regs.PRD.all", format: "hex", answer: 0x00030d3f, why: "PRD is at 0x0C02 and 0x0C03: low word 0x0D3F, high word 0x0003. Together 0x00030D3F, which is 199999." },
        { id: "hi", label: "Address of the word that holds bits 31 to 16 of TIM", format: "hex", answer: 0x0c01, why: "The low word comes first, at 0x0C00. The high word is the next one, 0x0C01." },
        { id: "tcr", label: "TCR.all after `CpuTimer0Regs.TCR.bit.TSS = 0;`", format: "hex", answer: 0x4000, why: "TCR is the fifth word, 0x4010: TIE (bit 14) and TSS (bit 4) are set. Clearing TSS leaves 0x4000." },
        { id: "out", label: "Lowest-numbered pin of port A that is an output (GPIO number)", answer: 22, why: "GPADIR is 0x80400000: bits 31 and 22 are set. Bit 22 is in the high word, at position 22 - 16 = 6, and 0x0040 is bit 6." },
        { id: "mux", label: "Lowest-numbered pin of port B that is not a plain GPIO (GPIO number)", answer: 42, why: "GPBMUX1 is 0x00F00000: bits 23 to 20 are set. Two bits per pin, so these are pins 10 and 11 of the register: GPIO42 and GPIO43, the serial port." },
      ],
      hints: [
        "Number the words of each line from its start address. For a 32-bit register, write the second word in front of the first.",
        "GPADIR is 0x80400000 and GPBMUX1 is 0x00F00000. Find which bits are 1.",
        "In GPBMUX1 the field of GPIOn starts at bit 2 x (n - 32). Bits 21 to 20 belong to n = 42.",
      ],
      takeaway: "When a board misbehaves, the memory view is the ground truth: it shows what the registers hold, not what the code meant to write. Low word first, then count bits.",
    },
  ],
};
