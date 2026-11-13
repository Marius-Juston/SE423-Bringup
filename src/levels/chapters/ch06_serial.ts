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
    PieVectTable.SCIA_RX_INT = &RXAINT_recv_ready;   // given: the receive interrupt
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer2, 200, ${periodUs});   // ${comment}
    CpuTimer2Regs.TCR.all = 0x4000;

    init_serialSCIA(&SerialA, 115200);   // given: start SCIA at 115200 baud

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

// Stand-in for slow work in main(), used by the ring buffer level.
const SLOW_WORK = `// Stands for the work main() does with each character. Takes about 0.5 ms.
// Returns the character in upper case. Do not change it.
uint16_t slow_work(uint16_t c)
{
    uint16_t i;
    for (i = 0; i < 5000; i++) {
        workSum += i;
    }
    workDone++;
    if (c >= 'a' && c <= 'z') {
        c = c - 32;
    }
    return c;
}`;

const SET_LED = `// Switches LED n (1 to 5) on or off
void set_led(uint16_t n, uint16_t on)
{
    if (n == 1) {
        if (on) GpioDataRegs.GPASET.bit.GPIO22 = 1;
        else GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
    } else if (n == 2) {
        if (on) GpioDataRegs.GPCSET.bit.GPIO94 = 1;
        else GpioDataRegs.GPCCLEAR.bit.GPIO94 = 1;
    } else if (n == 3) {
        if (on) GpioDataRegs.GPCSET.bit.GPIO95 = 1;
        else GpioDataRegs.GPCCLEAR.bit.GPIO95 = 1;
    } else if (n == 4) {
        if (on) GpioDataRegs.GPDSET.bit.GPIO97 = 1;
        else GpioDataRegs.GPDCLEAR.bit.GPIO97 = 1;
    } else if (n == 5) {
        if (on) GpioDataRegs.GPDSET.bit.GPIO111 = 1;
        else GpioDataRegs.GPDCLEAR.bit.GPIO111 = 1;
    }
}`;

// Robot board: LED1 to LED5 as outputs (off), then the receive interrupt.
const FRAME_MAIN = `    InitSysCtrl();
    InitGpio();

    // LED1 to LED5: outputs, off
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
    GPIO_SetupPinMux(94, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(94, GPIO_OUTPUT, GPIO_PUSHPULL);
    GPIO_SetupPinMux(95, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(95, GPIO_OUTPUT, GPIO_PUSHPULL);
    GPIO_SetupPinMux(97, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(97, GPIO_OUTPUT, GPIO_PUSHPULL);
    GPIO_SetupPinMux(111, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(111, GPIO_OUTPUT, GPIO_PUSHPULL);

    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();

    EALLOW;
    PieVectTable.SCIA_RX_INT = &RXAINT_recv_ready;
    EDIS;

    init_serialSCIA(&SerialA, 115200);

    IER |= M_INT9;   // SCIA
    EINT;`;

// The body of RXAINT_recv_ready as it is in F28379dSerial.c.
const rxIsr = (extra: string, locals = "") => `// Runs each time a character arrives on SCIA (from F28379dSerial.c)
__interrupt void RXAINT_recv_ready(void)
{
${locals}    RXAdata = SciaRegs.SCIRXBUF.all;
    /* a receive error (bad parity or bad stop bit): reset the receiver */
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
\`serial_printf\` sends text from the chip to a terminal on your PC. The peripheral that does it is a **UART** (universal asynchronous receiver/transmitter). TI calls its UART the **SCI** (Serial Communications Interface). This chip has four: SCIA to SCID.

## Asynchronous: no clock wire
A UART link has one data wire in each direction: **TX** (transmit) and **RX** (receive), plus ground. There is no clock wire. Both sides must be set to the same speed beforehand, the **baud rate**, in bits per second. The course uses 115200.

## The frame
A character is sent as a **frame**:

- The line **idles high**.
- One **start bit**, always 0. The falling edge tells the receiver that a character begins.
- **8 data bits**, least significant bit (bit 0) first.
- One **stop bit**, always 1. It returns the line to the idle level.

That is 10 bits on the wire for 8 bits of data. The SCI can also add a parity bit (one extra bit for catching errors) or a second stop bit. The course uses neither. The receiver times itself from the start bit and samples the middle of each bit.

{{figure:uart-frame}}

Try it in the figure: type a character and follow each written bit to its place on the wire, then send two characters and change the baud rate.

## What the 8 bits mean
The 8 data bits are a number. Which number stands for which character is fixed by the **ASCII** table: \`'A'\` is 0x41, for example. The next level is about that table.

## Voltage levels
On the chip's pins a 1 is 3.3 V and a 0 is 0 V. The older **RS-232** standard (the 9-pin PC serial port) sends the same frame with other voltages: a 1 is a negative voltage (-3 V to -15 V) and a 0 a positive one (+3 V to +15 V). It is inverted and swings both ways, so connecting it straight to a pin of the chip would damage the pin. A **transceiver**, a small chip that converts between the two sets of voltages, must sit in between.

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
      id: "serial-ascii",
      kind: "quiz",
      title: "ASCII, strings and format codes",
      goal: "Check that you can tell a character from a number and pick the right format code.",
      refs: [{ course: "L4" }, { course: "HW1" }, { course: "Lab 1" }],
      brief: `
## ASCII: characters are numbers
A serial line carries numbers. **ASCII** (American Standard Code for Information Interchange) is the table that says which number means which character:

- \`'0'\` is 0x30 (48), and the digits follow in order: \`'5'\` is 0x35 (53)
- \`'A'\` is 0x41 (65), \`'B'\` is 0x42, and so on to \`'Z'\`, 0x5A
- \`'a'\` is 0x61 (97): a lower-case letter is its upper-case letter plus 0x20
- \`'\\r'\` (carriage return) is 0x0D and \`'\\n'\` (line feed) is 0x0A

In C, single quotes make **one character**, which is just a number: \`'A'\` and \`0x41\` are the same value. So \`'5'\` is 53, not five. To turn a digit character into its value, subtract \`'0'\`: \`'5' - '0'\` is 5.

Double quotes make a **string**: an array of characters with a 0 added after the last one to mark the end. So \`"x"\` takes two elements: \`'x'\` and 0.

## Format codes
\`serial_printf\` replaces each code in the format string with the next value in the list. The code must match the **type** of the value. On this chip \`int\` is 16 bits:

- \`%d\`: a 16-bit integer (\`int16_t\`, \`uint16_t\`, \`int\`)
- \`%ld\`: a 32-bit integer (\`int32_t\`, \`uint32_t\`, \`long\`)
- \`%f\`: a \`float\`. \`%.3f\` prints 3 digits after the decimal point
- \`%c\`: one character, given as its ASCII number
- \`%s\`: a string
- \`%x\`: a 16-bit integer in hex

Example: \`serial_printf(&SerialA, "%d is %c\\r\\n", 65, 65);\` prints \`65 is A\`.

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
          prompt: '`serial_printf(&SerialA, "%c%c", 0x32, 69);` What appears on the terminal?',
          options: ["3269", "0x3269", "50 69", "2E"],
          answer: 3,
          why: "%c prints the character with that ASCII number: 0x32 is '2', two after '0'. 69 is 0x45, four after 'A' (0x41), so 'E'.",
        },
        {
          prompt: "`float volts = 1.6504;` What does `%.2f` print for it?",
          options: ["1.65", "1.6504", "1.7", "2"],
          answer: 0,
          why: ".2 asks for two digits after the decimal point, rounded.",
        },
      ],
      hints: ["Count from the anchors in the list: '0' is 0x30 and 'A' is 0x41.", "Count the 0 at the end of a string.", "16-bit values take %d, 32-bit values take %ld."],
    },
    {
      id: "serial-frame-b",
      kind: "timing",
      title: "Draw an E",
      goal: "Draw what the TX pin does while the character 'E' is sent.",
      refs: [{ course: "HW1" }, { course: "L4" }, { trm: "19.6" }],
      brief: `
HW1 asks what an oscilloscope on the TX pin shows when characters are sent. Practise on \`'E'\`.

\`'E'\` is 0x45, which is \`0100 0101\` in binary. Bit 7 is on the left and bit 0 on the right.

The slots are: idle, the start bit, data bits **b0 to b7 in the order they are sent**, the stop bit, idle again. Click a cell to switch it between high and low.

Settings are the course's: 8 data bits, no parity, 1 stop bit.
`,
      slots: ["idle", "start", "b0", "b1", "b2", "b3", "b4", "b5", "b6", "b7", "stop", "idle"],
      rows: [
        {
          name: "TX (GPIO42)",
          editable: true,
          initial: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          answer: [1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1],
        },
      ],
      hints: [
        "The start bit is always low. The stop bit and the idle line are always high.",
        "Read 0100 0101 from right to left: b0 = 1, b1 = 0, b2 = 1, then three 0s, b6 = 1, b7 = 0.",
        "Low cells: start, b1, b3, b4, b5, b7. Everything else is high.",
      ],
      takeaway: "On the scope the bits appear in reverse of how you write the number, because bit 0 is sent first.",
    },
    {
      id: "serial-frame-4b",
      kind: "timing",
      title: "Two characters back to back",
      goal: "Draw the TX pin while '2' and then 'E' are sent with no pause.",
      refs: [{ course: "HW1" }, { trm: "19.6" }, { trm: "19.10" }],
      brief: `
HW1 has an exercise of this kind with two other characters. Here \`'2'\` and \`'E'\` are sent one right after the other at 115200 baud.

- \`'2'\` is 0x32 = \`0011 0010\`. It is the **character** 2, not the number 2.
- \`'E'\` is 0x45 = \`0100 0101\`.

When characters follow each other without a pause, the stop bit of one is followed directly by the start bit of the next. The stop bit is the only high time between them.

Each character has its own start bit (S), data bits 0 to 7 and stop bit (P). Each slot lasts 1 / 115200 s, about 8.7 microseconds.
`,
      slots: ["idle", "S", "0", "1", "2", "3", "4", "5", "6", "7", "P", "S", "0", "1", "2", "3", "4", "5", "6", "7", "P", "idle"],
      rows: [
        {
          name: "TX (GPIO42)",
          editable: true,
          initial: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          answer: [1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1],
        },
      ],
      hints: [
        "Do one character at a time: start low, eight data bits from bit 0, stop high. The second character is the one from the previous level.",
        "0x32 from bit 0 up is 0, 1, 0, 0, 1, 1, 0, 0.",
        "First frame: low, low, high, low, low, high, high, low, low, high. Second frame: low, high, low, high, low, low, low, high, low, high.",
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

Example for 9600 baud: 50 000 000 / (9600 x 8) - 1 = 650.04, so BRR = 650. Put back into the first formula: 50 000 000 / (651 x 8) = 9601 bits per second.

{{figure:baud-mismatch}}

Dropping the fraction makes the real baud rate slightly different from the one you asked for. Try it in the figure: see how far the receiver's clock may be off before a character is misread.

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
          label: "Time to send one character at 19200 baud",
          unit: "ms",
          answer: 0.5208,
          tolPct: 1,
          why: "10 bits x (1 / 19200) s = 0.52 ms. HW1 asks you to explain the same sum for another baud rate.",
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
      id: "serial-print",
      kind: "code",
      mode: "complete",
      title: "Four lines a second",
      goal: "Print the timer count on the terminal every 250 ms, the way the course starter does.",
      refs: [{ course: "HW1" }, { course: "Lab 1" }, { trm: "19.13.1" }],
      brief: `
Printing is slow: a 30-character line takes about 2.6 ms at 115200 baud. The course rule is: **never print inside an interrupt function**. Use the flag of chapter 5: the interrupt function sets \`UARTPrint = 1;\`, and the \`while (1)\` loop sees the flag, prints, and sets it back to 0.

Given in this program, and the same in every lab:

- \`init_serialSCIA(&SerialA, 115200);\` starts the serial port SCIA at 115200 baud. \`SerialA\` is the library's struct for that port, and \`serial_printf(&SerialA, ...)\` prints through it.
- \`extern uint32_t numRXA;\` says that \`numRXA\` exists in another file, the course's serial library. It counts the characters received.
- The \`SCIA_RX_INT\` vector and \`IER |= M_INT9;\` are for receiving. A later level uses them.
- \`CpuTimer2.InterruptCount\` is a counter inside TI's struct for timer 2, free for you to use.

CPU Timer 2 calls \`cpu_timer2_isr\` every **50 ms**. As in HW1, make the program print **every 250 ms**:

1. Change the number after \`%\` so the flag is set on the right calls.
2. Print this line, with both values (both are \`uint32_t\`):
\`\`\`c
Num Timer2:5 Num SerialRX: 0
\`\`\`
3. Clear the flag after printing.

The format string for that line is \`"Num Timer2:%ld Num SerialRX: %ld\\r\\n"\`. The values, in this order, are \`CpuTimer2.InterruptCount\` and \`numRXA\`.
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
          hint: "Check the text character by character, including the spaces, and end the line with \\r\\n. The values go after the format string, separated by commas: first CpuTimer2.InterruptCount, then numRXA. Plain `printf` writes to the console, not to the serial terminal: use `serial_printf(&SerialA, ...)`.",
        },
        {
          kind: "serial-period",
          periodMs: 250,
          label: "A line is printed every 250 ms",
          hint: "The timer interrupt comes every 50 ms, so the flag must be set on every 5th call: `% 5`. If lines pour out without a pause, the flag is never cleared: `UARTPrint = 0;` after the print.",
        },
        { kind: "no-diagnostic", code: "printf-type", label: "The format codes match the 32-bit values", hint: "Both values are uint32_t: use %ld." },
        { kind: "no-diagnostic", code: "print-in-isr", label: "Nothing is printed inside an interrupt function", hint: "The serial_printf line belongs in the `if (UARTPrint == 1)` block of main, not in cpu_timer2_isr." },
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
- the two upper bits report a receive error, and the four lines under that \`if\` reset the receiver; otherwise the character is the lower 8 bits, kept in \`RXAdata\` (a global of the library)
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
        { kind: "led", led: "RED", at: 8, on: true, label: "Typing a turns the red LED on", hint: "Compare with single quotes: `if (RXAdata == 'a')`. Double quotes make a string, and a bare a is a variable name. This LED lights when GPIO34 is low: write 1 to GPBCLEAR." },
        { kind: "led", led: "RED", at: 13, on: true, label: "Typing x changes nothing", hint: "Only 'a' and 'b' may change the LED. Do not toggle it." },
        { kind: "led", led: "RED", at: 18, on: false, label: "Typing b turns the red LED off", hint: "`else if (RXAdata == 'b')` with single quotes, then write 1 to GPBSET: off is high for this LED." },
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
- Do not print inside \`RXAINT_recv_ready\`. Save the character in a global variable of your own (\`uint16_t\`), set a flag (another global), and print from the \`while (1)\` loop, as in "Four lines a second".
- In ASCII, \`'a'\` to \`'z'\` are 0x61 to 0x7A and \`'A'\` to \`'Z'\` are 0x41 to 0x5A: a lower-case letter is its capital plus 32.
- To test for a lower-case letter: \`if (c >= 'a' && c <= 'z')\`.
- \`%c\` prints a character. \`numRXA\` is a \`uint32_t\`, so it takes \`%ld\`.
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
          hint: "Compare your terminal output with the three lines. Nothing printed: is the flag set in RXAINT_recv_ready and tested in main? A number such as 83 where a letter should be: print the character with %c. A wrong character on the last line: only 'a' to 'z' are changed, by subtracting 32. Lines running together: end the format with \\r\\n.",
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
    {
      id: "serial-double",
      tier: "practice",
      kind: "code",
      mode: "write",
      title: "Twice the number",
      goal: "Read a number typed as ASCII digits and answer with its double.",
      refs: [{ course: "Lab 1" }, { course: "HW1" }, { course: "L4" }, { trm: "19.11" }],
      brief: `
A number typed in the terminal does not arrive as a number. \`305\` arrives as three characters: \`'3'\`, \`'0'\`, \`'5'\`, then \`'\\r'\` when Enter is pressed.

## Building the number
Each new digit makes the number so far ten times bigger and adds itself:

\`\`\`c
value = value * 10 + (RXAdata - '0');
\`\`\`

For \`305\`: 0, then 3, then 30, then 305.

## What to build
- Collect digits in \`RXAINT_recv_ready\`. Ignore every character that is not a digit or \`'\\r'\`.
- On \`'\\r'\` the number is complete: hand it to \`main()\` and start the next one from 0.
- \`main()\` prints **twice the number** on its own line, ending in \`\\r\\n\`.

The tests type \`21\`, \`305\` and \`40000\`, each followed by Enter. The terminal must show:

\`\`\`c
42
610
80000
\`\`\`

Look at the last one before you choose your variable types and your format code.
`,
      kit: "launchpad",
      durationMs: 25,
      stimuli: [
        { at: 5, type: "21\r" },
        { at: 10, type: "305\r" },
        { at: 15, type: "40000\r" },
      ],
      starter: `extern uint32_t numRXA;

// Add your global variables here

void main(void)
{
${RX_MAIN}

    while (1) {
        // Print twice the number when one is complete
    }
}

${rxIsr("        // A digit: add it to the number. '\\r': the number is complete.\n")}`,
      solution: `extern uint32_t numRXA;

uint32_t value = 0;       // number typed so far
uint32_t number = 0;      // last complete number, for main()
uint16_t gotNumber = 0;

void main(void)
{
${RX_MAIN}

    while (1) {
        if (gotNumber == 1) {
            serial_printf(&SerialA, "%ld\\r\\n", number * 2);
            gotNumber = 0;
        }
    }
}

${rxIsr(`        if (RXAdata >= '0' && RXAdata <= '9') {
            value = value * 10 + (RXAdata - '0');
        } else if (RXAdata == '\\r') {
            number = value;
            value = 0;
            gotNumber = 1;
        }`)}`,
      checks: [
        { kind: "serial", matches: "^42\\r\\n", label: "Typing 21 and Enter prints 42", hint: "Subtract '0' from each digit character. Without that, '2' counts as 50." },
        { kind: "serial", matches: "^42\\r\\n610\\r\\n", label: "Typing 305 and Enter prints 610", hint: "Set the number back to 0 after Enter, or the next one starts from the old value." },
        { kind: "serial", equals: "42\r\n610\r\n80000\r\n", label: "Typing 40000 and Enter prints 80000", hint: "80000 does not fit in 16 bits. Use uint32_t and %ld." },
        { kind: "var", name: "numRXA", equals: 13, label: "numRXA counted all 13 characters" },
        { kind: "no-diagnostic", code: "print-in-isr", label: "Nothing is printed inside an interrupt function" },
        { kind: "no-diagnostic", code: "printf-type", label: "The format code matches the 32-bit value" },
      ],
      watch: ["RXAdata", "numRXA"],
      hints: [
        "Three globals: the number being built, the finished number, and a flag. Make the two numbers uint32_t.",
        "In the interrupt function: `if (RXAdata >= '0' && RXAdata <= '9') { value = value * 10 + (RXAdata - '0'); }`",
        "`else if (RXAdata == '\\r') { number = value; value = 0; gotNumber = 1; }` and in main: `serial_printf(&SerialA, \"%ld\\r\\n\", number * 2);` then clear the flag.",
      ],
      takeaway: "Text to number: times ten, plus the digit minus '0'. Every command you will ever type at a robot goes through these two steps.",
    },
    {
      id: "serial-fifo",
      tier: "practice",
      kind: "code",
      mode: "debug",
      title: "Sixteen and no more",
      goal: "This program sends the alphabet through the transmit register, but only part of it arrives. Fix it.",
      refs: [{ trm: "19.13.1" }, { trm: "19.14.2" }, { trm: "19.2" }, { course: "L4" }],
      brief: `
\`serial_printf\` hides what happens to a character on its way out. This program does it by hand: it writes each character of the alphabet to the transmit register, \`SciaRegs.SCITXBUF\`.

Run it and look at the terminal and the message under the editor.

## What happens to a written character
- A write to \`SCITXBUF\` puts the character in the **transmit FIFO**, a queue of **16** places inside the SCI.
- The SCI takes one character at a time from the queue and shifts it out on the TX pin. That takes 10 bit times: about 87 microseconds at 115200 baud.
- \`SciaRegs.SCIFFTX.bit.TXFFST\` reads how many characters are waiting in the queue, 0 to 16.

The CPU writes a character in a fraction of a microsecond. The loop fills the queue long before the first character has left. A write to a full queue is not an error for the chip. The character is simply dropped.

## Your task
Before each write, wait until the queue has room. Do it by reading the status field, not by guessing a delay. Keep writing \`SCITXBUF\` yourself: no \`serial_printf\`.
`,
      kit: "launchpad",
      durationMs: 5,
      starter: `char text[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ\\r\\n";

void main(void)
{
    uint16_t i;

    InitSysCtrl();
    InitGpio();

    init_serialSCIA(&SerialA, 115200);

    for (i = 0; text[i] != 0; i++) {
        SciaRegs.SCITXBUF.all = text[i];
    }

    while (1) {}
}
`,
      solution: `char text[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ\\r\\n";

void main(void)
{
    uint16_t i;

    InitSysCtrl();
    InitGpio();

    init_serialSCIA(&SerialA, 115200);

    for (i = 0; text[i] != 0; i++) {
        // Wait while all 16 places of the transmit FIFO are taken
        while (SciaRegs.SCIFFTX.bit.TXFFST == 16) {}
        SciaRegs.SCITXBUF.all = text[i];
    }

    while (1) {}
}
`,
      checks: [
        { kind: "serial", equals: "ABCDEFGHIJKLMNOPQRSTUVWXYZ\r\n", label: "The terminal shows the whole alphabet and a line end", hint: "Only the first 16 characters arrive: the rest were written while the FIFO was full." },
        { kind: "no-diagnostic", code: "sci-tx-overflow", label: "No character is written to a full transmit FIFO" },
        { kind: "source", mustMatch: "SCITXBUF", mustNotMatch: "serial_printf|serial_send", label: "The characters are written to SCITXBUF by your code" },
      ],
      bonus: [
        { kind: "source", mustMatch: "TXFFST", mustNotMatch: "DELAY_US", label: "No guessed delay: the loop waits on TXFFST", hint: "A delay that is right at 115200 baud is wrong at 9600. The status field is right at any speed." },
      ],
      inspect: ["SciaRegs.SCIFFTX", "SciaRegs.SCICTL2"],
      hints: [
        "The error message names the status field to read.",
        "Waiting in C is a loop with an empty body: `while (condition) {}`. The condition is \"the queue is full\".",
        "Put `while (SciaRegs.SCIFFTX.bit.TXFFST == 16) {}` on the line before the write to SCITXBUF.",
      ],
      takeaway: "The CPU is thousands of times faster than the wire. Every transmitter needs a way to wait for the hardware, and the honest way is a status bit, never a delay.",
    },
    {
      id: "serial-bare",
      tier: "expert",
      kind: "code",
      mode: "write",
      title: "No library",
      goal: "Bring SCIA up from its registers and print text and 32-bit numbers with code you wrote yourself.",
      refs: [{ trm: "19.14.2" }, { trm: "19.12" }, { trm: "19.13.1" }, { trm: "19.4" }, { trm: "8.7" }, { course: "L4" }],
      brief: `
The course library is gone: no \`init_serialSCIA\`, no \`serial_printf\`, no \`sprintf\`. Only the registers are left, and the terminal still expects 115200 baud, 8 data bits, no parity, 1 stop bit.

## What the terminal must show
\`\`\`c
SE 423 raw serial port
0
423
-7
115200
-2147483648
\`\`\`
The first line is fixed text. The five numbers are the elements of \`data\`, in order, printed by a function of yours that works for **any** \`int32_t\`. Every line ends with \`\\r\\n\`.

## Facts you need
- **The pin.** SCIA transmits on GPIO42, at mux position 15. A mux position is two fields: \`GPBGMUX1\` holds its upper two bits and \`GPBMUX1\` its lower two. Both registers are EALLOW protected.
- **Reset.** Clear \`SCICTL1.bit.SWRESET\` while you configure, set it when you are done.
- **Frame.** \`SCICCR\`: the field \`SCICHAR\` is the number of data bits minus 1. \`STOPBITS\` and \`PARITYENA\` are 0 for the course settings.
- **Baud.** baud = 50 MHz / ((BRR + 1) x 8). The upper byte of BRR goes in \`SCIHBAUD\`, the lower byte in \`SCILBAUD\`.
- **FIFO.** \`SCIFFTX.bit.SCIFFENA\` switches the FIFOs on and \`SCIFFTX.bit.TXFIFORESET = 1\` takes the transmit FIFO out of reset. \`SCIFFTX.bit.TXFFST\` reads how many characters are waiting, 16 at most. A write to \`SCITXBUF\` when it is full is lost.
- **Transmitter.** \`SCICTL1.bit.TXENA\`.

## Numbers
The digits of a number come out of \`% 10\` and \`/ 10\` in the wrong order, last digit first. And one of the five values has no positive twin: think about what \`-v\` does to it.

You may use \`InitSysCtrl()\`, \`InitGpio()\` and the GPIO helper functions.
`,
      kit: "launchpad",
      durationMs: 8,
      starter: `int32_t data[5] = {0, 423, -7, 115200, (-2147483647L - 1)};

void main(void)
{
    InitSysCtrl();
    InitGpio();

    // Bring up SCIA, then send the six lines

    while (1) {}
}
`,
      solution: `int32_t data[5] = {0, 423, -7, 115200, (-2147483647L - 1)};

void sci_init(void);
void sci_putc(char c);
void sci_puts(char *s);
void sci_putlong(int32_t v);

void main(void)
{
    uint16_t i;

    InitSysCtrl();
    InitGpio();

    sci_init();

    sci_puts("SE 423 raw serial port\\r\\n");
    for (i = 0; i < 5; i++) {
        sci_putlong(data[i]);
        sci_puts("\\r\\n");
    }

    while (1) {}
}

void sci_init(void)
{
    // GPIO42 becomes SCIA's transmit pin: mux position 15 is GMUX = 3, MUX = 3.
    // GMUX is written first, while MUX is still 0, so the pin never passes
    // through another peripheral on the way.
    EALLOW;
    GpioCtrlRegs.GPBGMUX1.bit.GPIO42 = 3;
    GpioCtrlRegs.GPBMUX1.bit.GPIO42 = 3;
    EDIS;

    SciaRegs.SCICTL1.bit.SWRESET = 0;       // hold the SCI in reset during set-up
    SciaRegs.SCICCR.all = 0x0007;           // 8 data bits, no parity, 1 stop bit
    SciaRegs.SCIHBAUD.all = 0;              // BRR = 50000000 / (115200 x 8) - 1 = 53
    SciaRegs.SCILBAUD.all = 53;
    SciaRegs.SCIFFTX.bit.SCIFFENA = 1;      // use the FIFOs
    SciaRegs.SCIFFTX.bit.TXFIFORESET = 1;   // transmit FIFO out of reset
    SciaRegs.SCICTL1.bit.TXENA = 1;         // transmitter on
    SciaRegs.SCICTL1.bit.SWRESET = 1;       // release the SCI
}

void sci_putc(char c)
{
    // Wait while all 16 places of the transmit FIFO are taken
    while (SciaRegs.SCIFFTX.bit.TXFFST == 16) {}
    SciaRegs.SCITXBUF.all = c;
}

void sci_puts(char *s)
{
    while (*s != 0) {
        sci_putc(*s);
        s++;
    }
}

void sci_putlong(int32_t v)
{
    char digits[10];        // a 32-bit number has at most 10 digits
    uint16_t n = 0;
    uint32_t mag;           // the number without its sign

    if (v < 0) {
        sci_putc('-');
        // -v overflows for -2147483648. Unsigned arithmetic does not.
        mag = 0 - (uint32_t)v;
    } else {
        mag = v;
    }

    // The digits come out last one first: store them, then send them backwards
    do {
        digits[n] = '0' + (mag % 10);
        n++;
        mag = mag / 10;
    } while (mag != 0);
    while (n > 0) {
        n--;
        sci_putc(digits[n]);
    }
}
`,
      checks: [
        { kind: "serial", matches: "^SE 423 raw serial port\\r\\n", label: "The first line is SE 423 raw serial port", hint: "Nothing arrives: check the pin mux (GPIO42, position 15) and TXENA. The line is cut short: you wrote to a full FIFO." },
        { kind: "serial", includes: "\r\n0\r\n423\r\n", label: "0 and 423 are printed", hint: "0 still needs one digit. A loop that runs while the number is not 0 prints nothing for it." },
        { kind: "serial", includes: "\r\n-7\r\n115200\r\n", label: "-7 and 115200 are printed", hint: "115200 needs 32-bit arithmetic all the way through." },
        { kind: "serial", equals: "SE 423 raw serial port\r\n0\r\n423\r\n-7\r\n115200\r\n-2147483648\r\n", label: "-2147483648 is printed and nothing else follows", hint: "+2147483648 does not fit in an int32_t, so -v is still negative. Take the magnitude as a uint32_t: 0 - (uint32_t)v." },
        { kind: "no-diagnostic", code: "sci-tx-overflow", label: "No character is written to a full transmit FIFO", hint: "Wait while SciaRegs.SCIFFTX.bit.TXFFST is 16 before each write to SCITXBUF." },
        { kind: "reg", reg: "SciaRegs.SCICCR", field: "SCICHAR", equals: 7, label: "The frame has 8 data bits (SCICHAR = 7)" },
        { kind: "reg", reg: "SciaRegs.SCICCR", field: "STOPBITS", equals: 0, label: "One stop bit" },
        { kind: "reg", reg: "SciaRegs.SCICCR", field: "PARITYENA", equals: 0, label: "No parity" },
        { kind: "reg", reg: "SciaRegs.SCIHBAUD", equals: 0, label: "SCIHBAUD holds the upper byte of BRR" },
        { kind: "reg", reg: "SciaRegs.SCILBAUD", equals: 53, label: "SCILBAUD holds the lower byte of BRR: 115200 baud", hint: "BRR = 50000000 / (115200 x 8) - 1, fraction dropped." },
        { kind: "reg", reg: "SciaRegs.SCIFFTX", field: "SCIFFENA", equals: 1, label: "The FIFOs are switched on" },
        { kind: "reg", reg: "SciaRegs.SCIFFTX", field: "TXFIFORESET", equals: 1, label: "The transmit FIFO is out of reset" },
        { kind: "reg", reg: "SciaRegs.SCICTL1", field: "SWRESET", equals: 1, label: "The SCI is released from reset" },
        { kind: "source", mustNotMatch: "init_serial|serial_|printf", label: "No course serial library and no printf family" },
      ],
      bonus: [
        { kind: "source", mustMatch: "GPBGMUX1", mustNotMatch: "GPIO_SetupPinMux", label: "The pin mux is written by hand: no GPIO_SetupPinMux", hint: "Position 15 is binary 1111: GPBGMUX1.bit.GPIO42 = 3 and GPBMUX1.bit.GPIO42 = 3, between EALLOW and EDIS. Write GMUX first." },
      ],
      inspect: ["SciaRegs.SCICCR", "SciaRegs.SCICTL1", "SciaRegs.SCIFFTX", "GpioCtrlRegs.GPBMUX1", "GpioCtrlRegs.GPBGMUX1"],
      hints: [
        "Build it in layers and test each one: set-up plus one character, then a function that sends one character and waits for room, then a string, then a number.",
        "Order of the set-up: pin mux, SWRESET = 0, SCICCR, the two baud registers, SCIFFENA and TXFIFORESET, TXENA, SWRESET = 1. Sending: `while (SciaRegs.SCIFFTX.bit.TXFFST == 16) {}` then `SciaRegs.SCITXBUF.all = c;`",
        "Number: send '-' and take `mag = 0 - (uint32_t)v;` if v is negative. Then `do { digits[n] = '0' + (mag % 10); n++; mag = mag / 10; } while (mag != 0);` and send digits[n-1] down to digits[0].",
      ],
      takeaway: "init_serialSCIA and serial_printf are a few register writes, a wait on a status field and a division loop. Knowing what is under a library is what lets you fix it when it does not do what you need.",
    },
    {
      id: "serial-ring",
      tier: "expert",
      kind: "code",
      mode: "write",
      title: "Faster than you can read",
      goal: "Characters arrive ten times faster than main() can handle them. Lose none, until the buffer is truly full.",
      refs: [{ course: "Lab 1" }, { course: "L4" }, { trm: "19.11" }, { trm: "19.13.1" }],
      brief: `
The echo program of this chapter kept **one** character for \`main()\`. That works for a person typing. A program on the other end sends a whole line at once: at 115200 baud a character arrives every 87 microseconds.

Here \`main()\` needs about 0.5 ms for each character. \`slow_work()\` stands for that. It returns the character in upper case, and \`main()\` prints what it returns (\`'\\r'\` is printed as \`\\r\\n\`). Run the starter and read what is left of the text.

## What to build
A **ring buffer** between \`RXAINT_recv_ready\` and \`main()\`:

- an array of **64** elements, and no other storage for characters
- the interrupt function stores each character at the write position
- \`main()\` takes characters from the read position, in the order they arrived, and calls \`slow_work()\` exactly once for each
- both positions go back to 0 after 63: that is the ring
- if the buffer is full, the **new** character is thrown away and counted in \`dropped\`. Nothing already stored may be overwritten.

## The tests
1. A 44-character line. It must come out complete.
2. A 40-character line, later. Together they are more than 64 characters, so the positions must wrap.
3. 120 digits in one burst. That is more than the buffer and \`main()\` can take. The first 60 must come out in order, and \`dropped\` must count the ones that found the buffer full.

## Think about
\`main()\` can be interrupted between any two statements, and on the real chip in the middle of one. Which variables do both sides write? A design in which each variable has only **one** writer needs no \`DINT\`.
`,
      kit: "launchpad",
      durationMs: 150,
      stimuli: [
        { at: 5, type: "the quick brown fox jumps over the lazy dog\r" },
        { at: 40, type: "pack my box with five dozen liquor jugs\r" },
        { at: 75, type: "012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789" },
      ],
      starter: `extern uint32_t numRXA;

uint16_t newChar = 0;
uint16_t gotChar = 0;
uint32_t dropped = 0;       // characters thrown away because the buffer was full
uint32_t workDone = 0;
uint32_t workSum = 0;

${SLOW_WORK}

void main(void)
{
    uint16_t c;

${RX_MAIN}

    while (1) {
        if (gotChar == 1) {
            gotChar = 0;
            c = slow_work(newChar);
            if (c == '\\r') {
                serial_printf(&SerialA, "\\r\\n");
            } else {
                serial_printf(&SerialA, "%c", c);
            }
        }
    }
}

${rxIsr(`        newChar = RXAdata;
        gotChar = 1;`)}`,
      solution: `extern uint32_t numRXA;

#define RING_SIZE 64

uint16_t ring[RING_SIZE];
uint16_t head = 0;          // next place to write: changed only by the interrupt function
uint16_t tail = 0;          // next place to read: changed only by main()
uint32_t dropped = 0;       // characters thrown away because the buffer was full
uint32_t workDone = 0;
uint32_t workSum = 0;

${SLOW_WORK}

void main(void)
{
    uint16_t c;

${RX_MAIN}

    while (1) {
        // head == tail means empty
        if (tail != head) {
            c = ring[tail];
            tail = (tail + 1) % RING_SIZE;
            c = slow_work(c);
            if (c == '\\r') {
                serial_printf(&SerialA, "\\r\\n");
            } else {
                serial_printf(&SerialA, "%c", c);
            }
        }
    }
}

${rxIsr(`        // One place always stays free, so that a full buffer does not
        // look like an empty one (head == tail)
        if (((head + 1) % RING_SIZE) == tail) {
            dropped++;
        } else {
            ring[head] = RXAdata;
            head = (head + 1) % RING_SIZE;
        }`)}`,
      checks: [
        { kind: "serial", matches: "^THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG\\r\\n", label: "The first line comes out complete and in order", hint: "44 characters arrive in under 4 ms, and main() handles about 8 of them in that time. The rest must wait in the buffer." },
        { kind: "serial", includes: "DOG\r\nPACK MY BOX WITH FIVE DOZEN LIQUOR JUGS\r\n", label: "The second line comes out complete: the positions wrap around", hint: "After element 63 comes element 0: `(index + 1) % 64`." },
        { kind: "serial", includes: "JUGS\r\n012345678901234567890123456789012345678901234567890123456789", label: "The first 60 digits of the burst come out in order", hint: "When the buffer is full, drop the new character. Overwriting an old one scrambles the order." },
        { kind: "var", name: "dropped", min: 30, max: 40, label: "dropped counts the digits that found the buffer full (about 35)", hint: "0: the buffer holds more than 64 characters. Far more than 40: it holds fewer, or main() is not taking them out." },
        { kind: "var", name: "workDone", min: 164, max: 174, label: "slow_work ran once for every character that was stored", hint: "204 characters arrive. Each one is either handled once or counted in dropped." },
        { kind: "var", name: "numRXA", equals: 204, label: "numRXA counted all 204 characters" },
        { kind: "no-diagnostic", code: "print-in-isr", label: "Nothing is printed inside an interrupt function" },
      ],
      bonus: [
        { kind: "isr-time", fn: "RXAINT_recv_ready", maxUs: 1, label: "RXAINT_recv_ready never takes more than 1 microsecond", hint: "Store one character and move one index. No loops, no searching, no slow_work." },
      ],
      watch: ["numRXA", "dropped", "workDone"],
      hints: [
        "Two indices: `head`, where the interrupt function writes next, and `tail`, where main() reads next. The buffer is empty when they are equal.",
        "Interrupt function: work out `(head + 1) % 64`. If that equals tail the buffer is full: count the character in dropped. Otherwise store it at ring[head] and move head.",
        "main(): `if (tail != head) { c = ring[tail]; tail = (tail + 1) % 64; ... }`. Only the interrupt function writes head and only main() writes tail, so neither side can corrupt the other.",
      ],
      takeaway: "A ring buffer turns a burst into a queue: the interrupt function is fast and never waits, main() is slow and never misses. It works without switching interrupts off because each index has exactly one writer.",
    },
    {
      id: "serial-frames",
      tier: "expert",
      kind: "code",
      mode: "write",
      title: "Trust nothing on the wire",
      goal: "Receive checksummed command frames, carry out the good ones and refuse the damaged ones.",
      refs: [{ course: "L4" }, { course: "Lab 1" }, { trm: "19.11" }, { trm: "19.6" }],
      brief: `
A serial line has no error correction. A loose wire or a motor switching nearby flips a bit, and \`L11\` becomes \`L51\`. Real links wrap each message in a **frame** with a **checksum**, so the receiver can tell. This one is the format GPS receivers use (NMEA 0183).

## The frame
\`\`\`c
$L31*4E<CR>
\`\`\`
- \`$\` starts a frame. Always: a \`$\` in the middle of a frame throws away what came before and starts a new one.
- The **payload**: 1 to 8 characters. Here \`L31\`.
- \`*\` ends the payload.
- Two **upper-case hex digits**: the XOR of all payload characters. \`'L' ^ '3' ^ '1'\` is 0x4C ^ 0x33 ^ 0x31 = 0x4E.
- \`'\\r'\` ends the frame.

Characters outside a frame are noise. Ignore them.

## The commands
- \`Lns\`: LED n (1 to 5) on if s is \`1\`, off if s is \`0\`
- \`As\`: all five LEDs on or off

## The replies
One line for every complete frame, ending in \`\\r\\n\`:

- \`OK\`: the checksum matches and the command was carried out
- \`ERR\`: the checksum matches but the payload is not a valid command. Nothing changes.
- \`BAD\`: the checksum does not match. Nothing changes.

Noise, and a frame cut off by a new \`$\`, get no reply.

## Rules
- Each character is handled as it arrives, in \`RXAINT_recv_ready\`. Do not print there.
- \`set_led(n, on)\` is given.

The tests send good frames, a damaged one, noise, a frame cut off by another, two frames back to back, an unknown command and a frame without its \`$\`.
`,
      kit: "robot",
      durationMs: 60,
      stimuli: [
        { at: 5, type: "$L31*4E\r" },
        { at: 10, type: "$L11*4D\r" },
        { at: 15, type: "hi$L5$L51*48\r" },
        { at: 20, type: "$L21*4F\r$L41*49\r" },
        { at: 25, type: "$Z9*63\r" },
        { at: 30, type: "$L30*4F\r" },
        { at: 35, type: "L11*4C\r" },
        { at: 40, type: "$A1*70\r" },
        { at: 45, type: "$L61*4B\r" },
        { at: 50, type: "$A0*71\r$L11*4C\r" },
      ],
      starter: `extern uint32_t numRXA;

// Add your global variables here

${SET_LED}

void main(void)
{
${FRAME_MAIN}

    while (1) {
        // Carry out a finished frame and print the reply
    }
}

${rxIsr("        // One character of a frame: $ payload * two hex digits '\\r'\n")}`,
      solution: `extern uint32_t numRXA;

#define MAX_PAYLOAD 8

// Where the receiver is in a frame
#define WAIT_START 0    // waiting for '$'
#define IN_PAYLOAD 1    // collecting characters until '*'
#define CHECK_HIGH 2    // first hex digit of the checksum
#define CHECK_LOW  3    // second hex digit
#define WAIT_END   4    // waiting for '\\r'

uint16_t state = WAIT_START;
uint16_t payload[MAX_PAYLOAD];
uint16_t length = 0;
uint16_t sum = 0;           // XOR of the payload so far
uint16_t sent = 0;          // checksum that came with the frame

uint16_t cmd[MAX_PAYLOAD];  // copy of a finished frame, for main()
uint16_t cmdLength = 0;
uint16_t frameReady = 0;    // 1: good frame in cmd, 2: bad checksum

${SET_LED}

// Value of a hex digit character, or 16 if it is not one
uint16_t hex_value(uint16_t c)
{
    if (c >= '0' && c <= '9') {
        return c - '0';
    }
    if (c >= 'A' && c <= 'F') {
        return c - 'A' + 10;
    }
    return 16;
}

// Carries out the command in cmd. Returns 1 if it was a valid command.
uint16_t run_command(void)
{
    uint16_t n;

    if (cmd[0] == 'L' && cmdLength == 3 && cmd[1] >= '1' && cmd[1] <= '5'
            && (cmd[2] == '0' || cmd[2] == '1')) {
        set_led(cmd[1] - '0', cmd[2] - '0');
        return 1;
    }
    if (cmd[0] == 'A' && cmdLength == 2 && (cmd[1] == '0' || cmd[1] == '1')) {
        for (n = 1; n <= 5; n++) {
            set_led(n, cmd[1] - '0');
        }
        return 1;
    }
    return 0;
}

void main(void)
{
${FRAME_MAIN}

    while (1) {
        if (frameReady == 1) {
            frameReady = 0;
            if (run_command() == 1) {
                serial_printf(&SerialA, "OK\\r\\n");
            } else {
                serial_printf(&SerialA, "ERR\\r\\n");
            }
        }
        if (frameReady == 2) {
            frameReady = 0;
            serial_printf(&SerialA, "BAD\\r\\n");
        }
    }
}

${rxIsr(`        if (RXAdata == '$') {
            // A '$' always starts a new frame, whatever came before
            state = IN_PAYLOAD;
            length = 0;
            sum = 0;
        } else if (state == IN_PAYLOAD) {
            if (RXAdata == '*') {
                state = CHECK_HIGH;
            } else if (length < MAX_PAYLOAD) {
                payload[length] = RXAdata;
                length++;
                sum = sum ^ RXAdata;
            } else {
                state = WAIT_START;     // too long: not a frame
            }
        } else if (state == CHECK_HIGH) {
            sent = hex_value(RXAdata) << 4;
            state = CHECK_LOW;
        } else if (state == CHECK_LOW) {
            sent = sent | hex_value(RXAdata);
            state = WAIT_END;
        } else if (state == WAIT_END) {
            if (RXAdata == '\\r') {
                if (sent == sum) {
                    for (i = 0; i < length; i++) {
                        cmd[i] = payload[i];
                    }
                    cmdLength = length;
                    frameReady = 1;
                } else {
                    frameReady = 2;
                }
            }
            state = WAIT_START;
        }`, "    uint16_t i;\n\n")}`,
      checks: [
        { kind: "led", led: "LED3", at: 8, on: true, label: "$L31*4E switches LED3 on", hint: "Check the order: $, payload, *, two hex digits, \\r. The checksum is the XOR of the payload characters only." },
        { kind: "led", led: "LED1", at: 13, on: false, label: "$L11*4D has a wrong checksum: LED1 stays off", hint: "Carry out a command only after the whole frame has arrived and its checksum matched." },
        { kind: "led", led: "LED5", at: 18, on: true, label: "Noise and a frame cut off by a new $ are ignored, then $L51*48 switches LED5 on", hint: "A '$' restarts the frame in every state, and the checksum starts again from 0." },
        { kind: "led", led: "LED2", at: 23, on: true, label: "Two frames back to back: LED2 is on" },
        { kind: "led", led: "LED4", at: 23, on: true, label: "Two frames back to back: LED4 is on", hint: "The second frame arrives 0.8 ms after the first. Do not lose it while handling the first." },
        { kind: "led", led: "LED3", at: 33, on: false, label: "$L30*4F switches LED3 off" },
        { kind: "led", led: "LED1", at: 38, on: false, label: "A frame without its $ is ignored" },
        { kind: "led", led: "LED1", at: 43, on: true, label: "$A1*70 switches all LEDs on" },
        { kind: "led", led: "LED5", at: 57, on: false, label: "$A0*71 switches all LEDs off" },
        { kind: "led", led: "LED1", at: 57, on: true, label: "$L11*4C then switches LED1 on again" },
        {
          kind: "serial",
          equals: "OK\r\nBAD\r\nOK\r\nOK\r\nOK\r\nERR\r\nOK\r\nOK\r\nERR\r\nOK\r\nOK\r\n",
          label: "The replies are OK, BAD, OK, OK, OK, ERR, OK, OK, ERR, OK, OK",
          hint: "ERR is for a good checksum with an unknown command ($Z9*63) or a value out of range ($L61*4B). Noise and cut-off frames get no reply.",
        },
        { kind: "no-diagnostic", code: "print-in-isr", label: "Nothing is printed inside an interrupt function" },
      ],
      bonus: [
        { kind: "isr-time", fn: "RXAINT_recv_ready", maxUs: 2, label: "RXAINT_recv_ready never takes more than 2 microseconds", hint: "Handle one character per call: keep a running XOR instead of adding up the payload at the end." },
      ],
      watch: ["RXAdata", "numRXA"],
      hints: [
        "It is a state machine with five states: waiting for $, in the payload, first checksum digit, second checksum digit, waiting for \\r. One global holds the state, and each character moves it on.",
        "Keep a running XOR while the payload arrives: `sum = sum ^ RXAdata;`. A hex digit is `c - '0'` for 0 to 9 and `c - 'A' + 10` for A to F. The checksum that was sent is `(high << 4) | low`.",
        "On '\\r': if the two checksums are equal, copy the payload for main() and set a flag to 1, otherwise set it to 2. main() checks the command (`cmd[0] == 'L'`, three characters, n from '1' to '5', s '0' or '1'), calls set_led(cmd[1] - '0', cmd[2] - '0') and prints OK, ERR or BAD.",
      ],
      takeaway: "A receiver is a state machine that believes nothing until the checksum agrees. Start marker, length or end marker, checksum: you will meet this same shape in GPS receivers, in the LIDAR and in every link you design yourself.",
    },
  ],
};
