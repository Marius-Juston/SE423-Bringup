import type { Chapter } from "../types";

// The course starter's set-up, cut down to what these levels use.
const PIE_INIT = `    InitSysCtrl();
    InitGpio();

    // Red LED on LaunchPad, off to start with (it lights when the pin is low)
    GPIO_SetupPinMux(34, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(34, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPBSET.bit.GPIO34 = 1;

    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();`;

const timerMain = (periodUs: number, comment: string) => `${PIE_INIT}

    EALLOW;
    PieVectTable.TIMER2_INT = &cpu_timer2_isr;
    PieVectTable.SCIA_RX_INT = &RXAINT_recv_ready;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer2, 200, ${periodUs});   // ${comment}
    CpuTimer2Regs.TCR.all = 0x4000;

    init_serialSCIA(&SerialA, 115200);

    IER |= M_INT9;   // SCIA
    IER |= M_INT14;  // CPU Timer 2
    EINT;`;

const RX_MAIN = `${PIE_INIT}

    EALLOW;
    PieVectTable.SCIA_RX_INT = &RXAINT_recv_ready;
    EDIS;

    init_serialSCIA(&SerialA, 115200);

    IER |= M_INT9;   // SCIA
    EINT;`;

// The body of RXAINT_recv_ready as it is in F28379dSerial.c.
const rxIsr = (extra: string) => `// Runs each time a character arrives on SCIA (from F28379dSerial.c)
__interrupt void RXAINT_recv_ready(void)
{
    RXAdata = SciaRegs.SCIRXBUF.all;
    /* SCI PE or FE error */
    if (RXAdata & 0xC000) {
        SciaRegs.SCICTL1.bit.SWRESET = 0;
        SciaRegs.SCICTL1.bit.SWRESET = 1;
        SciaRegs.SCIFFRX.bit.RXFIFORESET = 0;
        SciaRegs.SCIFFRX.bit.RXFIFORESET = 1;
    } else {
        RXAdata = RXAdata & 0x00FF;
        numRXA ++;
${extra}
    }
    SciaRegs.SCIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP9;
}
`;

export const ch06: Chapter = {
  id: "serial",
  number: 6,
  title: "Serial and ASCII",
  blurb: "One wire, ten bits per character: print to the terminal and react to typed keys.",
  requires: ["interrupts"],
  course: ["L4", "Lab 1", "HW1"],
  levels: [
    {
      id: "serial-brief",
      kind: "brief",
      title: "One wire, no clock",
      goal: "Learn how a character travels over a serial line, then answer three questions.",
      refs: [{ course: "L4" }, { trm: "19.1" }, { trm: "19.6" }, { trm: "19.10" }],
      brief: `
\`serial_printf\` sends text from the chip to a terminal on your PC. The peripheral that does it is the **SCI** (Serial Communications Interface), TI's name for a UART. This chip has four: SCIA to SCID.

## Asynchronous: no clock wire
A UART link has one data wire in each direction: **TX** (transmit) and **RX** (receive), plus ground. There is no clock wire. Both sides must be set to the same speed beforehand, the **baud rate**, in bits per second. The course uses 115200.

## The frame
A character is sent as a **frame**:

- The line **idles high**.
- One **start bit**, always 0. The falling edge tells the receiver that a character begins.
- **8 data bits**, least significant bit (bit 0) first.
- One **stop bit**, always 1. It returns the line to the idle level.

That is 10 bits on the wire for 8 bits of data. The SCI can also add a parity bit or a second stop bit; the course uses neither. The receiver times itself from the start bit and samples the middle of each bit.

## ASCII: characters are numbers
The 8 data bits are a number. ASCII is the table that says which number means which character:

- \`'0'\` is 0x30 (48), and the digits follow in order: \`'4'\` is 0x34
- \`'A'\` is 0x41 (65), \`'B'\` is 0x42, and so on
- \`'a'\` is 0x61 (97): a lower-case letter is its upper-case letter plus 0x20
- \`'\\r'\` (carriage return) is 0x0D and \`'\\n'\` (line feed) is 0x0A

In C, single quotes make **one character**, which is just a number: \`'A'\` and \`0x41\` are the same value. Double quotes make a **string**: an array of characters with a 0 byte added after the last one to mark the end. So \`"x"\` takes two elements: \`'x'\` and 0.

## Voltage levels
On the chip's pins a 1 is 3.3 V and a 0 is 0 V. The older **RS-232** standard (the 9-pin PC serial port) sends the same frame with other voltages: a 1 is a negative voltage (-3 V to -15 V) and a 0 a positive one (+3 V to +15 V). It is inverted and swings both ways, so connecting it straight to a pin of the chip would damage the pin: a **transceiver** chip must sit in between.

You do not need one on the LaunchPad. Its USB port carries **SCIA** (TX on GPIO42, RX on GPIO43) and appears on the PC as a COM port.
`,
      questions: [
        {
          prompt: "How does the receiver know when a character starts?",
          options: [
            "A separate clock wire starts toggling",
            "The line falls from its idle high level to 0: the start bit",
            "The transmitter sends the character's length first",
            "The line rises from its idle low level to 1",
          ],
          answer: 1,
          why: "The line idles high. The start bit is always 0, so every frame begins with a falling edge. There is no clock wire.",
        },
        {
          prompt: "The character `'A'` (0x41 = 0100 0001) is sent. Which data bit follows the start bit?",
          options: ["Bit 7, a 0", "Bit 0, a 1", "Bit 6, a 1", "Bit 0, a 0"],
          answer: 1,
          why: "Data goes out least significant bit first. Bit 0 of 0x41 is 1.",
        },
        {
          prompt: "Why can an RS-232 port not be wired straight to the chip's RX pin?",
          options: [
            "RS-232 uses a different baud rate",
            "RS-232 sends the most significant bit first",
            "RS-232 uses negative and positive voltages well outside 0 V to 3.3 V, and inverted",
            "RS-232 needs a clock wire",
          ],
          answer: 2,
          why: "The frame is the same, the voltages are not: a 1 is negative and a 0 positive, up to 15 V either way. A transceiver converts the levels.",
        },
      ],
      takeaway: "Idle high, start bit 0, 8 data bits from bit 0 up, stop bit 1. Both ends only agree on the baud rate.",
    },
    {
      id: "serial-frame-b",
      kind: "timing",
      title: "Draw a B",
      goal: "Draw what the TX pin does while the character 'B' is sent.",
      refs: [{ course: "HW1" }, { course: "L4" }, { trm: "19.6" }],
      brief: `
HW1 asks what an oscilloscope on the TX pin shows when a character is sent. Draw it for \`'B'\`.

\`'B'\` is 0x42, which is \`0100 0010\` in binary. Bit 7 is on the left and bit 0 on the right.

The slots are: idle, the start bit, data bits **b0 to b7 in the order they are sent**, the stop bit, idle again. Click a cell to switch it between high and low.

Settings are the course's: 8 data bits, no parity, 1 stop bit.
`,
      slots: ["idle", "start", "b0", "b1", "b2", "b3", "b4", "b5", "b6", "b7", "stop", "idle"],
      rows: [
        {
          name: "TX (GPIO42)",
          editable: true,
          initial: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          answer: [1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1],
        },
      ],
      hints: [
        "The start bit is always low. The stop bit and the idle line are always high.",
        "Read 0100 0010 from right to left: b0 = 0, b1 = 1, then four 0s, b6 = 1, b7 = 0.",
        "Low cells: start, b0, b2, b3, b4, b5, b7. Everything else is high.",
      ],
      takeaway: "On the scope the bits appear in reverse of how you write the number, because bit 0 is sent first.",
    },
    {
      id: "serial-frame-4b",
      kind: "timing",
      title: "Two characters back to back",
      goal: "Draw the TX pin while '4' and then 'B' are sent with no pause, as in HW1.",
      refs: [{ course: "HW1" }, { trm: "19.6" }, { trm: "19.10" }],
      brief: `
This is the HW1 exercise: the characters \`'4'\` and \`'B'\` are sent one right after the other at 115200 baud.

- \`'4'\` is 0x34 = \`0011 0100\`. It is the **character** 4, not the number 4.
- \`'B'\` is 0x42 = \`0100 0010\`.

When characters follow each other without a pause, the stop bit of one is followed directly by the start bit of the next. The stop bit is the only high time between them.

Each character has its own start bit (S), data bits 0 to 7 and stop bit (P). Each slot lasts 1 / 115200 s, about 8.7 microseconds.
`,
      slots: ["idle", "S", "0", "1", "2", "3", "4", "5", "6", "7", "P", "S", "0", "1", "2", "3", "4", "5", "6", "7", "P", "idle"],
      rows: [
        {
          name: "TX (GPIO42)",
          editable: true,
          initial: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          answer: [1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1],
        },
      ],
      hints: [
        "Do one character at a time: start low, eight data bits from bit 0, stop high. The second character is the one from the previous level.",
        "0x34 from bit 0 up is 0, 0, 1, 0, 1, 1, 0, 0.",
        "First frame: low, low, low, high, low, high, high, low, low, high. Second frame: low, low, high, low, low, low, low, high, low, high.",
      ],
      takeaway: "The start bit of every character lets the receiver line up again, so small differences between the two clocks never add up over a long message.",
    },
    {
      id: "serial-baud",
      kind: "calc",
      title: "Baud rate arithmetic",
      goal: "Work out the baud rate register value and how long characters take.",
      refs: [{ trm: "19.12" }, { trm: "19.14.2" }, { course: "HW1" }, { course: "L4" }],
      brief: `
The SCI makes its bit clock by dividing the low-speed peripheral clock, **LSPCLK**, which is 50 MHz in the course projects:

**baud = LSPCLK / ((BRR + 1) x 8)**

BRR is a 16-bit number split over two registers: \`SCIHBAUD\` (upper 8 bits) and \`SCILBAUD\` (lower 8 bits).

Turn the formula around to get BRR = LSPCLK / (baud x 8) - 1. The result is rarely a whole number. The course library, \`init_serialSCIA\`, does this with integer arithmetic, so the fraction is dropped.

Each character is a frame of **10 bits**: start, 8 data, stop.
`,
      fields: [
        {
          id: "brr",
          label: "BRR stored by init_serialSCIA(&SerialA, 115200)",
          answer: 53,
          why: "50000000 / (115200 x 8) - 1 = 53.25. Integer arithmetic drops the fraction: 53, so SCIHBAUD = 0 and SCILBAUD = 53.",
        },
        {
          id: "actual",
          label: "Baud rate the chip really produces with BRR = 53",
          unit: "bits/s",
          answer: 115741,
          tolPct: 0.1,
          why: "50000000 / (54 x 8) = 115741. That is 0.47 % fast, well inside what a UART tolerates, because the receiver lines up again on every start bit.",
        },
        {
          id: "tchar",
          label: "Time to send one character at 9600 baud",
          unit: "ms",
          answer: 1.0417,
          tolPct: 1,
          why: "10 bits x (1 / 9600) s = 10 / 9600 s = 1.04 ms. This is the HW1 question.",
        },
        {
          id: "cps",
          label: "Characters per second at 115200 baud, sent back to back",
          unit: "characters/s",
          answer: 11520,
          tolPct: 0.5,
          why: "115200 bits per second / 10 bits per character = 11520.",
        },
      ],
      hints: [
        "For BRR, divide 50000000 by (115200 x 8), subtract 1, and drop the fraction.",
        "For the real baud rate, put BRR = 53 back into the formula: 50000000 / (54 x 8).",
        "A character is 10 bits, so it takes 10 / baud seconds, and baud / 10 characters fit in a second.",
      ],
      takeaway: "A 40-character line takes about 3.5 ms at 115200 baud. That is far too long to spend inside an interrupt function.",
    },
    {
      id: "serial-ascii",
      kind: "quiz",
      title: "Characters, strings and format codes",
      goal: "Check that you can tell a character from a number and pick the right format code.",
      refs: [{ course: "L4" }, { course: "HW1" }, { course: "Lab 1" }],
      brief: `
## Characters and strings
\`'5'\` is the character 5, the number 0x35 (53). \`5\` is the number five. To turn a digit character into its value, subtract \`'0'\`: \`'5' - '0'\` is 5.

A string in double quotes ends with a hidden 0 byte, so an array holding it needs one more element than the text has characters.

## Format codes
\`serial_printf\` replaces each code in the format string with the next value in the list. The code must match the **type** of the value. On this chip \`int\` is 16 bits:

- \`%d\`: a 16-bit integer (\`int16_t\`, \`uint16_t\`, \`int\`)
- \`%ld\`: a 32-bit integer (\`int32_t\`, \`uint32_t\`, \`long\`)
- \`%f\`: a \`float\`. \`%.3f\` prints 3 digits after the decimal point
- \`%c\`: one character, given as its ASCII number
- \`%s\`: a string
- \`%x\`: a 16-bit integer in hex

A wrong code does not give a compile error. It prints a wrong number.

End each line with \`\\r\\n\`: carriage return (back to the first column) and line feed (down one line).
`,
      questions: [
        {
          prompt: "`uint16_t c = '5';` What is stored in `c`?",
          options: ["5", "53 (0x35)", "0x05", "Nothing: a character cannot be stored in an integer"],
          answer: 1,
          why: "'5' is the ASCII code of the character 5, which is 0x35 = 53.",
        },
        {
          prompt: "`char word[] = \"hello\";` How many elements does `word` have?",
          options: ["4", "5", "6", "10"],
          answer: 2,
          why: "Five letters plus the 0 byte that marks the end of the string.",
        },
        {
          prompt: "`uint32_t numRXA = 70000;` Which line prints 70000?",
          options: [
            '`serial_printf(&SerialA, "%d\\r\\n", numRXA);`',
            '`serial_printf(&SerialA, "%ld\\r\\n", numRXA);`',
            '`serial_printf(&SerialA, "%f\\r\\n", numRXA);`',
            '`serial_printf(&SerialA, "%c\\r\\n", numRXA);`',
          ],
          answer: 1,
          why: "numRXA is 32 bits wide, so it needs %ld. With %d only 16 of its bits are printed: 4464.",
        },
        {
          prompt: '`serial_printf(&SerialA, "%c%c", 0x34, 66);` What appears on the terminal?',
          options: ["3466", "4B", "0x3466", "52 66"],
          answer: 1,
          why: "%c prints the character with that ASCII number: 0x34 is '4' and 66 (0x42) is 'B'.",
        },
        {
          prompt: "`float volts = 1.6504;` What does `%.2f` print for it?",
          options: ["1.6504", "1.65", "1.7", "2"],
          answer: 1,
          why: ".2 asks for two digits after the decimal point, rounded.",
        },
      ],
      hints: ["Look up each character in the ASCII list of the first level.", "Count the hidden 0 byte at the end of a string.", "16-bit values take %d, 32-bit values take %ld."],
    },
    {
      id: "serial-print",
      kind: "code",
      mode: "complete",
      title: "Four lines a second",
      goal: "Print the timer count on the terminal every 250 ms, the way the course starter does.",
      refs: [{ course: "HW1" }, { course: "Lab 1" }, { trm: "19.13.1" }],
      brief: `
Printing is slow: one character takes 10 bit times, so a 30-character line takes about 2.6 ms at 115200 baud. The course rule is: **never print inside an interrupt function**. The starter code uses a flag instead:

- the interrupt function only sets \`UARTPrint = 1;\`
- the \`while (1)\` loop in \`main()\` sees the flag, prints, and sets it back to 0

In this program CPU Timer 2 calls \`cpu_timer2_isr\` every **50 ms**, and \`CpuTimer2.InterruptCount\` counts the calls. As in HW1, make it print **every 250 ms**:

1. Change the modulus so the flag is set on the right calls.
2. Print this line, with both values (both are \`uint32_t\`):
\`\`\`c
Num Timer2:5 Num SerialRX: 0
\`\`\`
3. Clear the flag after printing.

The format string for that line is \`"Num Timer2:%ld Num SerialRX: %ld\\r\\n"\`. The values are \`CpuTimer2.InterruptCount\` and \`numRXA\`, the number of characters received so far.
`,
      kit: "launchpad",
      durationMs: 1100,
      starter: `__interrupt void cpu_timer2_isr(void);

extern uint32_t numRXA;
uint16_t UARTPrint = 0;

void main(void)
{
${timerMain(50000, "every 50 ms")}

    while (1) {
        if (UARTPrint == 1) {
            // TODO 2: print the line with serial_printf

            // TODO 3: clear the flag

        }
    }
}

__interrupt void cpu_timer2_isr(void)
{
    CpuTimer2.InterruptCount++;

    // TODO 1: this sets the flag every 500 ms. Make it every 250 ms.
    if ((CpuTimer2.InterruptCount % 10) == 0) {
        UARTPrint = 1;
    }
}
`,
      solution: `__interrupt void cpu_timer2_isr(void);

extern uint32_t numRXA;
uint16_t UARTPrint = 0;

void main(void)
{
${timerMain(50000, "every 50 ms")}

    while (1) {
        if (UARTPrint == 1) {
            serial_printf(&SerialA, "Num Timer2:%ld Num SerialRX: %ld\\r\\n",
                          CpuTimer2.InterruptCount, numRXA);
            UARTPrint = 0;
        }
    }
}

__interrupt void cpu_timer2_isr(void)
{
    CpuTimer2.InterruptCount++;

    if ((CpuTimer2.InterruptCount % 5) == 0) {
        UARTPrint = 1;
    }
}
`,
      checks: [
        {
          kind: "serial",
          matches: "^Num Timer2:5 Num SerialRX: 0\\r\\nNum Timer2:10 Num SerialRX: 0\\r\\n",
          label: "The first lines are: Num Timer2:5 Num SerialRX: 0, then Num Timer2:10 Num SerialRX: 0",
          hint: "Check the text character by character, including the spaces, and end the line with \\r\\n.",
        },
        {
          kind: "serial-period",
          periodMs: 250,
          label: "A line is printed every 250 ms",
          hint: "The timer interrupt comes every 50 ms. If lines pour out without a pause, the flag is never cleared.",
        },
        { kind: "no-diagnostic", code: "printf-type", label: "The format codes match the 32-bit values", hint: "Both values are uint32_t: use %ld." },
        { kind: "no-diagnostic", code: "print-in-isr", label: "Nothing is printed inside an interrupt function" },
      ],
      watch: ["UARTPrint", "numRXA"],
      hints: [
        "250 ms is 5 timer periods of 50 ms.",
        "Use `% 5` in the interrupt function, and `UARTPrint = 0;` after the print.",
        '`serial_printf(&SerialA, "Num Timer2:%ld Num SerialRX: %ld\\r\\n", CpuTimer2.InterruptCount, numRXA);`',
      ],
      takeaway: "The interrupt function decides when, the while(1) loop does the slow work. Every later lab prints this way.",
    },
    {
      id: "serial-debug",
      kind: "code",
      mode: "debug",
      title: "Slow and wrong",
      goal: "This program prints from the wrong place and prints wrong numbers. Fix both.",
      refs: [{ course: "HW1" }, { course: "Lab 1" }, { course: "L4" }],
      brief: `
CPU Timer 2 interrupts every 250 ms. Each time, the program should print how many times the timer has fired and the elapsed time in microseconds:

\`\`\`c
1 calls, 250000 us
2 calls, 500000 us
\`\`\`

Run it and read the terminal and the messages under the editor. Two things are wrong:

- **The print is inside the interrupt function.** While it runs, no other interrupt can. Move it to the \`while (1)\` loop with the \`UARTPrint\` flag.
- **The format codes do not match the values.** Both are \`uint32_t\`. A 32-bit value is passed as two 16-bit halves, and each \`%d\` takes only one half. So the first \`%d\` prints the lower half of the count, and the second \`%d\` prints the *upper half of the count*, not the time.

Keep the counting and the time calculation in the interrupt function. They are fast.
`,
      kit: "launchpad",
      durationMs: 1100,
      starter: `__interrupt void cpu_timer2_isr(void);

uint32_t timeUs = 0;
uint16_t UARTPrint = 0;

void main(void)
{
${timerMain(250000, "every 250 ms")}

    while (1) {
        if (UARTPrint == 1) {
            UARTPrint = 0;
        }
    }
}

__interrupt void cpu_timer2_isr(void)
{
    CpuTimer2.InterruptCount++;
    timeUs = CpuTimer2.InterruptCount * 250000;

    serial_printf(&SerialA, "%d calls, %d us\\r\\n", CpuTimer2.InterruptCount, timeUs);
}
`,
      solution: `__interrupt void cpu_timer2_isr(void);

uint32_t timeUs = 0;
uint16_t UARTPrint = 0;

void main(void)
{
${timerMain(250000, "every 250 ms")}

    while (1) {
        if (UARTPrint == 1) {
            serial_printf(&SerialA, "%ld calls, %ld us\\r\\n", CpuTimer2.InterruptCount, timeUs);
            UARTPrint = 0;
        }
    }
}

__interrupt void cpu_timer2_isr(void)
{
    CpuTimer2.InterruptCount++;
    timeUs = CpuTimer2.InterruptCount * 250000;

    UARTPrint = 1;
}
`,
      checks: [
        {
          kind: "serial",
          matches: "^1 calls, 250000 us\\r\\n2 calls, 500000 us\\r\\n3 calls, 750000 us\\r\\n",
          label: "The terminal shows 1 calls, 250000 us, then 2 calls, 500000 us, and so on",
          hint: "%d prints 16 bits. Both values are 32 bits wide.",
        },
        { kind: "serial-period", periodMs: 250, label: "A line is printed every 250 ms" },
        {
          kind: "no-diagnostic",
          code: "print-in-isr",
          label: "Nothing is printed inside an interrupt function",
          hint: "Set UARTPrint = 1 in cpu_timer2_isr and call serial_printf in the while(1) loop.",
        },
        { kind: "no-diagnostic", code: "printf-type", label: "The format codes match the values" },
      ],
      watch: ["timeUs", "UARTPrint"],
      hints: [
        "The warnings under the editor name the line and the problem.",
        "Move the whole serial_printf line into the `if (UARTPrint == 1)` block, before `UARTPrint = 0;`, and put `UARTPrint = 1;` in its place.",
        'Change both `%d` to `%ld`: `"%ld calls, %ld us\\r\\n"`.',
      ],
      takeaway: "A wrong format code also shifts every value after it. When a print shows nonsense, check the codes against the variable types first.",
    },
    {
      id: "serial-rx-led",
      kind: "code",
      mode: "complete",
      title: "Keys that switch an LED",
      goal: "Turn the red LED on when 'a' is typed and off when 'b' is typed.",
      refs: [{ course: "Lab 1" }, { trm: "19.11" }, { trm: "19.13.1" }, { trm: "3.4.5" }],
      brief: `
Receiving works by interrupt. \`init_serialSCIA\` sets SCIA up so that every character that arrives causes the SCIA receive interrupt (PIE group 9, interrupt 1). The function that runs is \`RXAINT_recv_ready\`, in the course file \`F28379dSerial.c\`. Three things connect it, all already in this program:

- \`PieVectTable.SCIA_RX_INT = &RXAINT_recv_ready;\`
- \`IER |= M_INT9;\`
- \`EINT;\`

In Lab 1 you add your own code to that function. It is shown below as it is in the course file:

- reading \`SciaRegs.SCIRXBUF.all\` takes the character out of the receive buffer
- the two upper bits report a receive error; otherwise the character is the lower 8 bits, kept in \`RXAdata\`
- \`numRXA\` counts the characters received
- the last two lines clear the SCI's interrupt flag and acknowledge PIE group 9, so the next character can interrupt again

## Your task
Where the TODO is, compare \`RXAdata\` with character constants:

- \`'a'\` turns the **red LaunchPad LED on**
- \`'b'\` turns it **off**
- any other character changes nothing

The red LED is on GPIO34 (port B) and lights when the pin is **low**. The tests type \`a\`, \`x\`, \`b\` and \`a\`, a few milliseconds apart.
`,
      kit: "launchpad",
      durationMs: 30,
      stimuli: [
        { at: 5, type: "a" },
        { at: 10, type: "x" },
        { at: 15, type: "b" },
        { at: 20, type: "a" },
      ],
      starter: `void main(void)
{
${RX_MAIN}

    while (1) {}
}

${rxIsr("        // TODO: 'a' turns the red LED on, 'b' turns it off\n")}`,
      solution: `void main(void)
{
${RX_MAIN}

    while (1) {}
}

${rxIsr(`        if (RXAdata == 'a') {
            GpioDataRegs.GPBCLEAR.bit.GPIO34 = 1;   // red LED on (lit when low)
        } else if (RXAdata == 'b') {
            GpioDataRegs.GPBSET.bit.GPIO34 = 1;     // red LED off
        }`)}`,
      checks: [
        { kind: "led", led: "RED", at: 3, on: false, label: "The red LED is off before anything is typed" },
        { kind: "led", led: "RED", at: 8, on: true, label: "Typing a turns the red LED on", hint: "This LED lights when GPIO34 is low: write 1 to GPBCLEAR." },
        { kind: "led", led: "RED", at: 13, on: true, label: "Typing x changes nothing", hint: "Only 'a' and 'b' may change the LED. Do not toggle it." },
        { kind: "led", led: "RED", at: 18, on: false, label: "Typing b turns the red LED off" },
        { kind: "led", led: "RED", at: 23, on: true, label: "Typing a again turns it back on" },
        {
          kind: "var",
          name: "numRXA",
          equals: 4,
          label: "numRXA counted the four characters",
          hint: "Keep the lines that were already in RXAINT_recv_ready. Without the last two, only the first character causes an interrupt.",
        },
        { kind: "no-dat-write", label: "The LED is changed through SET and CLEAR" },
      ],
      watch: ["RXAdata", "numRXA"],
      hints: [
        "A character constant is a number, so you can compare directly: `if (RXAdata == 'a')`.",
        "On is low for this LED: GPBCLEAR turns it on, GPBSET turns it off.",
        "`if (RXAdata == 'a') { GpioDataRegs.GPBCLEAR.bit.GPIO34 = 1; } else if (RXAdata == 'b') { GpioDataRegs.GPBSET.bit.GPIO34 = 1; }`",
      ],
      takeaway: "Receiving is an interrupt like any other: a vector, an enable, and an acknowledge at the end. What arrives is just an ASCII number.",
    },
    {
      id: "serial-echo",
      kind: "code",
      mode: "checkpoint",
      title: "Answer in capitals",
      goal: "Reply to every typed character with its upper-case form and the number of characters received.",
      refs: [{ course: "Lab 1" }, { course: "HW1" }, { course: "L4" }, { trm: "19.11" }],
      brief: `
Put the chapter together. For every character typed in the terminal, print one line with:

- the character, changed to **upper case** if it is a lower-case letter, unchanged otherwise
- a space
- \`numRXA\`, the number of characters received so far

The tests type \`s\`, \`e\` and \`4\`, a few milliseconds apart. The terminal must show exactly:

\`\`\`c
S 1
E 2
4 3
\`\`\`

Each line ends with \`\\r\\n\`.

## Rules
- Do not print inside \`RXAINT_recv_ready\`. Save the character in a global variable, set a flag, and print from the \`while (1)\` loop.
- In ASCII, \`'a'\` to \`'z'\` are 0x61 to 0x7A and \`'A'\` to \`'Z'\` are 0x41 to 0x5A: a lower-case letter is its capital plus 32.
- \`%c\` prints a character. \`numRXA\` is a \`uint32_t\`.
`,
      kit: "launchpad",
      durationMs: 30,
      stimuli: [
        { at: 5, type: "s" },
        { at: 12, type: "e" },
        { at: 19, type: "4" },
      ],
      starter: `extern uint32_t numRXA;

// Add your global variables here

void main(void)
{
${RX_MAIN}

    while (1) {
        // Print here when a character has arrived
    }
}

${rxIsr("        // Save the character and tell main() about it\n")}`,
      solution: `extern uint32_t numRXA;

uint16_t newChar = 0;
uint16_t gotChar = 0;

void main(void)
{
${RX_MAIN}

    while (1) {
        if (gotChar == 1) {
            if (newChar >= 'a' && newChar <= 'z') {
                newChar = newChar - 32;
            }
            serial_printf(&SerialA, "%c %ld\\r\\n", newChar, numRXA);
            gotChar = 0;
        }
    }
}

${rxIsr(`        newChar = RXAdata;
        gotChar = 1;`)}`,
      checks: [
        {
          kind: "serial",
          equals: "S 1\r\nE 2\r\n4 3\r\n",
          label: "The terminal shows S 1, E 2 and 4 3, each on its own line",
          hint: "Only 'a' to 'z' are changed. Subtracting 32 from '4' gives a control character.",
        },
        { kind: "var", name: "numRXA", equals: 3, label: "numRXA counted the three characters" },
        {
          kind: "no-diagnostic",
          code: "print-in-isr",
          label: "Nothing is printed inside an interrupt function",
          hint: "Set a flag in RXAINT_recv_ready and call serial_printf in the while(1) loop.",
        },
        { kind: "no-diagnostic", code: "printf-type", label: "The format codes match the values", hint: "%c for the character (16 bits), %ld for numRXA (32 bits)." },
      ],
      watch: ["RXAdata", "numRXA"],
      hints: [
        "You need two globals: one for the saved character and one flag. Set both in the interrupt function, after `numRXA ++;`.",
        "In the loop: `if (c >= 'a' && c <= 'z') { c = c - 32; }` before printing.",
        '`serial_printf(&SerialA, "%c %ld\\r\\n", newChar, numRXA);` then clear the flag.',
      ],
      takeaway: "One saved character is enough when keys arrive slowly. If characters come faster than you can print, some are lost: later labs store them in an array instead.",
    },
  ],
};
