import type { Chapter } from "../types";

// ---- timing diagrams -------------------------------------------------------
// One byte, 0xA5 = 1010 0101, is carried through the whole chapter (it is
// also the byte of the interactive figure). Each bit time is drawn as two
// cells: "a" is its first half, "b" its second half.
const BYTE = 0xa5;
const BITS = [7, 6, 5, 4, 3, 2, 1, 0];
const SLOTS = ["rest", ...BITS.flatMap((k) => [`${k}a`, `${k}b`]), "rest"];
const bit = (v: number, k: number) => ((v >> k) & 1) as 0 | 1;
/** A data line holding each bit for its whole bit time; `before` is the old bit still on the line. */
const dataRow = (v: number, before: 0 | 1 = 0): (0 | 1)[] => [before, ...BITS.flatMap((k) => [bit(v, k), bit(v, k)]), bit(v, 0)];
/**
 * SPICLK for one byte (TRM Figure 18-7). The clock rests at CLKPOLARITY.
 * Without delay (CLK_PHASE = 0) it leaves the rest level at the start of each
 * bit time; with delay (CLK_PHASE = 1) half a bit time later.
 */
const clockRow = (pol: 0 | 1, phase: 0 | 1): (0 | 1)[] => {
  const away = (1 - pol) as 0 | 1;
  return [pol, ...BITS.flatMap(() => (phase === 0 ? [away, pol] : [pol, away])), pol];
};
const LOW = SLOTS.map(() => 0 as 0 | 1);
/** A waveform as text for a code block: two characters per cell. */
const wave = (row: (0 | 1)[]) => row.map((v) => (v ? "--" : "__")).join("");
/** Column heads for \`wave\`: r = rest, then the bit numbers, each over its four characters. */
const HEADER = `r ${BITS.map((k) => `${k}   `).join("")}r`;

// ---- C building blocks (HW3 exercise 3, and setupSpib() in SE423Lib.c) ------
const PINS = `    // GPIO66 is the chip select of the MPU-9250: high means "not selected"
    GPIO_SetupPinMux(66, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(66, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;

    GPIO_SetupPinMux(63, GPIO_MUX_CPU1, 15);  // GPIO63 is SPISIMOB
    GPIO_SetupPinMux(64, GPIO_MUX_CPU1, 15);  // GPIO64 is SPISOMIB
    GPIO_SetupPinMux(65, GPIO_MUX_CPU1, 15);  // GPIO65 is SPICLKB
    EALLOW;
    GpioCtrlRegs.GPBPUD.bit.GPIO63 = 0;       // given: pull-ups on (0 = on), TI's advice for SPI
    GpioCtrlRegs.GPCPUD.bit.GPIO64 = 0;
    GpioCtrlRegs.GPCPUD.bit.GPIO65 = 0;
    GpioCtrlRegs.GPBQSEL2.bit.GPIO63 = 3;     // given: 3 = pin goes to the SPI unfiltered
    GpioCtrlRegs.GPCQSEL1.bit.GPIO64 = 3;
    GpioCtrlRegs.GPCQSEL1.bit.GPIO65 = 3;
    EDIS;`;

interface SpibOpts {
  phase?: number;
  char?: string;
  loopback?: boolean;
  fifo?: boolean;
  rxffil?: number;
  /** SPIBRR. Default: 99 (500 kHz) in loopback, 49 (1 MHz, the MPU-9250's limit) with a device. */
  brr?: number;
}
const rateNote = (brr: number) => `50 MHz / (${brr} + 1) = ${50 / (brr + 1) >= 1 ? `${50 / (brr + 1)} MHz` : `${50000 / (brr + 1)} kHz`}`;
/** The register part of the course's SPIB set-up. */
const spib = (o: SpibOpts = {}) => `    SpibRegs.SPICCR.bit.SPISWRESET = 0;       // hold the SPI in reset while it is set up

    SpibRegs.SPICTL.bit.CLK_PHASE = ${o.phase ?? 1};        // with CLKPOLARITY = 0: clock rests low,
    SpibRegs.SPICCR.bit.CLKPOLARITY = 0;      // data is read on the rising edge
    SpibRegs.SPICTL.bit.MASTER_SLAVE = 1;     // this chip is the master
    SpibRegs.SPICCR.bit.SPICHAR = ${o.char ?? "0xF"};        // bits per word, minus 1
    SpibRegs.SPICTL.bit.TALK = 1;             // drive the SIMO pin
    SpibRegs.SPIPRI.bit.FREE = 1;             // keep running when the debugger halts
    SpibRegs.SPICTL.bit.SPIINTENA = 0;        // the interrupt used without FIFOs: off
    SpibRegs.SPIBRR.bit.SPI_BIT_RATE = ${o.brr ?? (o.loopback ? 99 : 49)};    // ${rateNote(o.brr ?? (o.loopback ? 99 : 49))}
    SpibRegs.SPISTS.all = 0x0000;             // status register, as the course code writes it
${o.loopback ? "    SpibRegs.SPICCR.bit.SPILBK = 1;           // loopback: SIMO joined to SOMI inside the chip\n" : ""}${
  o.fifo === false
    ? ""
    : `
    SpibRegs.SPIFFTX.bit.SPIRST = 1;          // FIFOs out of reset
    SpibRegs.SPIFFTX.bit.SPIFFENA = 1;        // use the FIFOs
    SpibRegs.SPIFFTX.bit.TXFIFO = 0;          // empty the transmit FIFO and hold it
    SpibRegs.SPIFFTX.bit.TXFFINTCLR = 1;      // clear old flags: transmit interrupt,
    SpibRegs.SPIFFRX.bit.RXFIFORESET = 0;     // empty the receive FIFO and hold it
    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;      // receive overflow (FIFO was full),
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;      // receive interrupt
    SpibRegs.SPIFFRX.bit.RXFFIENA = 1;        // interrupt when RXFFST >= RXFFIL
    SpibRegs.SPIFFCT.bit.TXDLY = 0;           // no pause between words
`
}
    SpibRegs.SPICCR.bit.SPISWRESET = 1;       // set-up done: release the SPI
${
  o.fifo === false
    ? ""
    : `
    SpibRegs.SPIFFTX.bit.TXFIFO = 1;          // release the FIFOs
    SpibRegs.SPIFFRX.bit.RXFIFORESET = 1;
    SpibRegs.SPIFFRX.bit.RXFFIL = ${o.rxffil ?? 16};${o.rxffil === undefined ? "          // changed before each transfer" : ""}
`
}`;

const PIE_INIT = `    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();`;

/** Timer 0 every `us` microseconds and the SPIB receive interrupt (INT6.3), then interrupts on. */
const VECTORS = (us: number, extra = "") => `    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    PieVectTable.SPIB_RX_INT = &SPIB_isr;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, ${us});
    CpuTimer0Regs.TCR.all = 0x4000;
${extra}
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;        // timer 0 is INT1.7
    PieCtrlRegs.PIEIER6.bit.INTx3 = 1;        // SPIB receive is INT6.3
    IER |= M_INT1;
    IER |= M_INT6;
    EINT;`;

const START = `    InitSysCtrl();
    InitGpio();
`;

// ---- the set-up ladder: spi-setup-own (checklist) and spi-x-scratch (requirements only) ----
const OWN_ISRS = (us: number) => `// Every ${us / 1000} ms: ask the chip on the bus for its identity number
__interrupt void cpu_timer0_isr(void)
{
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;     // chip select low
    SpibRegs.SPIFFRX.bit.RXFFIL = 1;          // the answer is one word
    SpibRegs.SPITXBUF = 0xF500;               // "which chip are you?"

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}`;

const OWN_RX_ISR = `// When the answer has arrived
__interrupt void SPIB_isr(void)
{
    answer = SpibRegs.SPIRXBUF;
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;       // chip select high
    numTransfers++;

    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}`;

const OWN_HEAD = `__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);

int16_t answer = 0;           // the word the chip sent back
uint32_t numTransfers = 0;`;

const TIMER_GIVEN = (us: number) => `    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, ${us});
    CpuTimer0Regs.TCR.all = 0x4000;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;        // timer 0 is INT1.7
    IER |= M_INT1;`;

const setupOwn = (o: { body: string; vector: string; enable: string }) => `${OWN_HEAD}

// The whole SPIB set-up: pins, chip select, registers, FIFOs
void setupSpib(void)
{
${o.body}
}

void main(void)
{
${START}
    setupSpib();

${PIE_INIT}

    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
${o.vector}
    EDIS;

${TIMER_GIVEN(1000)}
${o.enable}
    EINT;

    while (1) {
    }
}

${OWN_ISRS(1000)}

${OWN_RX_ISR}
`;

const SCRATCH_SPIB = `    // chip select: output, high
    GPIO_SetupPinMux(66, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(66, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;

    GPIO_SetupPinMux(63, GPIO_MUX_CPU1, 15);  // SPISIMOB
    GPIO_SetupPinMux(64, GPIO_MUX_CPU1, 15);  // SPISOMIB
    GPIO_SetupPinMux(65, GPIO_MUX_CPU1, 15);  // SPICLKB
    EALLOW;
    GpioCtrlRegs.GPBPUD.bit.GPIO63 = 0;
    GpioCtrlRegs.GPCPUD.bit.GPIO64 = 0;
    GpioCtrlRegs.GPCPUD.bit.GPIO65 = 0;
    GpioCtrlRegs.GPBQSEL2.bit.GPIO63 = 3;
    GpioCtrlRegs.GPCQSEL1.bit.GPIO64 = 3;
    GpioCtrlRegs.GPCQSEL1.bit.GPIO65 = 3;
    EDIS;

    SpibRegs.SPICCR.bit.SPISWRESET = 0;       // hold the SPI in reset
    SpibRegs.SPICCR.bit.CLKPOLARITY = 1;      // clock rests high,
    SpibRegs.SPICTL.bit.CLK_PHASE = 0;        // data is read on the rising edge
    SpibRegs.SPICTL.bit.MASTER_SLAVE = 1;
    SpibRegs.SPICCR.bit.SPICHAR = 0xF;        // 16 bits per word
    SpibRegs.SPICTL.bit.TALK = 1;
    SpibRegs.SPIPRI.bit.FREE = 1;
    SpibRegs.SPICTL.bit.SPIINTENA = 0;
    SpibRegs.SPIBRR.bit.SPI_BIT_RATE = 124;   // 50 MHz / (124 + 1) = 400 kHz
    SpibRegs.SPISTS.all = 0x0000;

    SpibRegs.SPIFFTX.bit.SPIRST = 1;
    SpibRegs.SPIFFTX.bit.SPIFFENA = 1;
    SpibRegs.SPIFFTX.bit.TXFIFO = 0;
    SpibRegs.SPIFFTX.bit.TXFFINTCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFIFORESET = 0;
    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFIENA = 1;        // interrupt when RXFFST >= RXFFIL
    SpibRegs.SPIFFCT.bit.TXDLY = 0;

    SpibRegs.SPICCR.bit.SPISWRESET = 1;       // release the SPI

    SpibRegs.SPIFFTX.bit.TXFIFO = 1;          // release the FIFOs
    SpibRegs.SPIFFRX.bit.RXFIFORESET = 1;
    SpibRegs.SPIFFRX.bit.RXFFIL = 1;          // the answer is one word`;

const scratch = (o: { spib: string; vector: string; enable: string; isr: string }) => `${OWN_HEAD}

void main(void)
{
${START}
${o.spib}

${PIE_INIT}

    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
${o.vector}
    EDIS;

${TIMER_GIVEN(2000)}
${o.enable}
    EINT;

    while (1) {
    }
}

${OWN_ISRS(2000).replace("    SpibRegs.SPIFFRX.bit.RXFFIL = 1;          // the answer is one word\n", "")}

// When the answer has arrived
__interrupt void SPIB_isr(void)
{
${o.isr}
}
`;

export const ch12: Chapter = {
  id: "spi",
  number: 12,
  title: "SPI",
  blurb: "A clock wire, a chip select, and a word back for every word sent.",
  requires: ["serial"],
  course: ["L10", "HW2", "HW3"],
  levels: [
    {
      id: "spi-brief",
      kind: "brief",
      title: "A wire that says when",
      goal: "Learn what the clock line is for and how two chips swap a byte, then answer three questions.",
      refs: [{ course: "L10" }, { trm: "18.1" }, { trm: "18.3.1" }],
      brief: `
A UART has no clock wire: both ends agree on a baud rate and each measures time by itself (**asynchronous**). **SPI** (Serial Peripheral Interface) is **synchronous**: one extra wire, the **clock**, tells the receiver when to look at the data wire. The robot's motion sensor, the MPU-9250, speaks SPI. It holds a **gyro** (how fast the robot turns) and an **accelerometer** (how hard it speeds up or slows down).

## What the clock line is for
A data wire only carries a level: \`1 1 1\` is just a wire that stays high. So the clock wire goes up and down once per bit. An **edge** is the moment a wire changes level: a **rising edge** goes from low to high, a **falling edge** from high to low. The receiver waits for a clock edge and reads the data wire at that moment.

## Master and slave
The **master** makes the clock and decides when a transfer happens. The **slave** follows. The F28379D is the master, the sensors are slaves.

## Four wires
- **SPICLK**: the clock, from the master.
- **SPISIMO** ("slave in, master out", also called MOSI): data from the master to the slave.
- **SPISOMI** ("slave out, master in", also called MISO): data from the slave to the master.
- **Chip select** (CS or SS, active low): the master pulls it low to tell one slave "this transfer is for you". A slave whose chip select is high ignores the clock and lets go of SPISOMI: it stops driving the wire, like a pin set as an input.

## A swap, one bit per clock
A **word** is the group of bits sent as one unit: 8 or 16 bits here. Each chip holds its word in a **shift register**: a row of bits that all move one place to the left on a clock edge. The top bit leaves on the data wire, so a word travels **most significant bit first**: bit 7 of a byte, then bit 6. At the same moment the other chip's bit enters at the bottom. After 8 clock cycles the two registers have swapped contents. Sending in both directions at once is called **full duplex**.

Step through the eight clocks in the figure and follow one bit round the ring.

{{figure:spi-shift}}

So **every word you send is also a word you receive**. To read from a sensor you must send something, often zeros, to make the clock run. When you only want to send, a word still arrives and must be read out.
`,
      questions: [
        {
          prompt: "What does the clock line tell the receiver?",
          options: [
            "Which slave the data is for",
            "The moment at which to read the data line: one bit per clock cycle",
            "How many bits the word has",
            "Whether the bit is a 1 or a 0",
          ],
          answer: 1,
          why: "The data line only carries a level. The clock marks the instants at which that level is one bit of the word.",
        },
        {
          prompt: "The master shifts out 0xA5 = `1010 0101`. Which bit is on SPISIMO first?",
          options: ["Bit 0, a 1", "Bit 7, a 1", "Bit 0, a 0", "Bit 7, a 0"],
          answer: 1,
          why: "SPI sends the most significant bit first. Bit 7 of 0xA5 is 1. (A UART would send bit 0 first.)",
        },
        {
          prompt: "A program sends three words to a sensor and is not interested in any answer. How many words arrive in the master's receiver?",
          options: ["None", "One", "Three", "It depends on the sensor"],
          answer: 2,
          why: "Each clock cycle moves a bit in both directions, so three words sent are three words received, meaningful or not. They must be read out, or they pile up.",
        },
      ],
      takeaway: "The clock says when, the data lines say what, the chip select says who. Every word sent is a word received.",
    },
    {
      id: "spi-wiring",
      kind: "wiring",
      title: "One bus, two slaves",
      goal: "Wire the F28379D to the two SPI devices on the robot board.",
      refs: [{ course: "L10" }, { course: "HW3" }, { trm: "18.2.1" }],
      brief: `
A **bus** is a set of wires shared by several devices. The F28379D has three SPI modules, SPIA, SPIB and SPIC. The robot has two slaves on the bus of **SPIB**:

- the **MPU-9250** (gyro and accelerometer)
- the **DAN28027**, a small second microcontroller that gives the robot extra outputs and inputs

On the F28379D, SPIB uses GPIO63 (SPISIMOB), GPIO64 (SPISOMIB) and GPIO65 (SPICLKB).

Rules for the wiring:

- **Clock and the two data lines are shared**: they go to both slaves.
- An output must go to an input. SIMO is the master's output, so it goes to each slave's data **input**. SOMI is the master's input, so it comes from each slave's data **output**.
- **Each slave needs its own chip select.** The course uses two plain GPIO outputs: GPIO66 for the MPU-9250 and GPIO29 for the DAN28027.

Both slaves' outputs are wired to the same SOMI line. That only works because a slave that is not selected lets go of the line. With both chip selects low at once, both would drive SOMI and the master would read nonsense.

Try it in the figure: pull one chip select low, then both, then neither.

{{figure:spi-bus}}

Place the eight wires.
`,
      nodes: [
        { id: "simo", label: "GPIO63 SIMO", x: 16, y: 8, side: "left" },
        { id: "somi", label: "GPIO64 SOMI", x: 16, y: 18, side: "left" },
        { id: "clk", label: "GPIO65 CLK", x: 16, y: 28, side: "left" },
        { id: "cs66", label: "GPIO66", x: 16, y: 40, side: "left" },
        { id: "cs29", label: "GPIO29", x: 16, y: 50, side: "left" },
        { id: "m_in", label: "MPU data in", x: 56, y: 6, side: "right" },
        { id: "m_out", label: "MPU data out", x: 56, y: 13, side: "right" },
        { id: "m_clk", label: "MPU clock", x: 56, y: 20, side: "right" },
        { id: "m_cs", label: "MPU chip select", x: 56, y: 27, side: "right" },
        { id: "d_in", label: "DAN data in", x: 80, y: 34, side: "right" },
        { id: "d_out", label: "DAN data out", x: 80, y: 41, side: "right" },
        { id: "d_clk", label: "DAN clock", x: 80, y: 48, side: "right" },
        { id: "d_cs", label: "DAN chip select", x: 80, y: 55, side: "right" },
      ],
      wires: [
        ["simo", "m_in"], ["simo", "d_in"],
        ["somi", "m_out"], ["somi", "d_out"],
        ["clk", "m_clk"], ["clk", "d_clk"],
        ["cs66", "m_cs"], ["cs29", "d_cs"],
      ],
      mistakes: [
        { wire: ["simo", "m_out"], why: "SIMO is the master's output and this is the slave's output: two outputs on one wire. SIMO goes to the slave's data input." },
        { wire: ["simo", "d_out"], why: "SIMO is the master's output and this is the slave's output: two outputs on one wire. SIMO goes to the slave's data input." },
        { wire: ["somi", "m_in"], why: "SOMI is the master's input and this is the slave's input: nobody would drive the wire. SOMI comes from the slave's data output." },
        { wire: ["somi", "d_in"], why: "SOMI is the master's input and this is the slave's input: nobody would drive the wire. SOMI comes from the slave's data output." },
        { wire: ["cs66", "d_cs"], why: "The course wires GPIO66 to the MPU-9250 and GPIO29 to the DAN28027." },
        { wire: ["cs29", "m_cs"], why: "The course wires GPIO66 to the MPU-9250 and GPIO29 to the DAN28027." },
        { wire: ["m_cs", "d_cs"], why: "With their chip selects tied together both slaves would answer at once and fight over the SOMI line." },
      ],
      hints: [
        "Three signals are shared, so each of them needs two wires: one to each slave.",
        "SIMO goes to both data inputs, SOMI to both data outputs, CLK to both clocks.",
        "The last two wires: GPIO66 to the MPU chip select, GPIO29 to the DAN chip select.",
      ],
      takeaway: "Three shared wires plus one chip select per slave. Fifteen sensors would need fifteen chip-select pins, which is why I2C, with addresses instead of chip selects, exists.",
    },
    {
      id: "spi-loopback",
      kind: "code",
      mode: "complete",
      title: "Talking to yourself",
      goal: "Finish the SPIB set-up, send three words in loopback and read back the three that arrive.",
      refs: [{ course: "HW3" }, { trm: "18.3.5" }, { trm: "18.4.2" }, { trm: "18.3.7" }, { trm: "18.5.2" }],
      brief: `
This is the course's SPIB set-up with four values left for you. Every other line is **given**: it is the same in every course program, and its comment says what it does. The order never changes:

1. Switch the pins to the SPI (\`GPIO_SetupPinMux(..., 15)\`). Already done.
2. **Hold the SPI in reset**: \`SPISWRESET = 0\`. The manual says to change the configuration only while this bit is 0.
3. Choose master, word length and bit rate. (The two clock mode lines are the course's setting. The next level explains them.)
4. Set up the FIFOs.
5. **Release the reset**: \`SPISWRESET = 1\`. Nothing is sent while it is 0.

## Two numbers
- \`SPICHAR\` is the number of bits per word **minus 1**. It is 4 bits wide, so a word has at most 16 bits.
- **bit rate = LSPCLK / (SPIBRR + 1)**, for SPIBRR from 3 to 127. LSPCLK, the low-speed peripheral clock, is 50 MHz in the course projects. Example: for 1 MHz, 50 MHz / 1 MHz = 50, so SPIBRR = 50 - 1 = 49. This level runs at **500 kHz**.

## The FIFOs
A **FIFO** ("first in, first out") is a queue of 16 words. With the FIFOs enabled:

- every write to \`SpibRegs.SPITXBUF\` adds a word to the transmit queue, and the words leave one after the other
- every word that arrives is added to the receive queue; \`SpibRegs.SPIFFRX.bit.RXFFST\` says how many are waiting
- every read of \`SpibRegs.SPIRXBUF\` takes the oldest word out

Try it in the figure: write three words, clock them out, then read them back in order.

{{figure:spi-fifo}}

## Loopback
\`SPILBK = 1\` joins SIMO to SOMI inside the chip, so the master receives exactly what it sends. It tests a set-up without any device.

## Your part
Fill in TODO 1 to 4 in the set-up. Then:

- TODO 5: send the three words \`0x00A5\`, \`0x1234\` and \`0xBEEF\`
- TODO 6: wait until three words have arrived: \`while (SpibRegs.SPIFFRX.bit.RXFFST != 3);\` The semicolon right after the bracket is an empty loop body: the line does nothing but test again until \`RXFFST\` is 3. Read too early and you get old data.
- TODO 7: read them into \`rx1\`, \`rx2\` and \`rx3\`, in the order they were sent
`,
      kit: "robot",
      durationMs: 2,
      starter: `uint16_t rx1 = 0;
uint16_t rx2 = 0;
uint16_t rx3 = 0;

void main(void)
{
${START}
${PINS}

    SpibRegs.SPICCR.bit.SPISWRESET = 0;       // hold the SPI in reset while it is set up

    SpibRegs.SPICTL.bit.CLK_PHASE = 1;        // with CLKPOLARITY = 0: clock rests low,
    SpibRegs.SPICCR.bit.CLKPOLARITY = 0;      // data is read on the rising edge
    SpibRegs.SPICTL.bit.MASTER_SLAVE = 0;     // TODO 1: make this chip the master
    SpibRegs.SPICCR.bit.SPICHAR = 0;          // TODO 2: 16 bits per word
    SpibRegs.SPICTL.bit.TALK = 1;             // drive the SIMO pin
    SpibRegs.SPIPRI.bit.FREE = 1;             // keep running when the debugger halts
    SpibRegs.SPICTL.bit.SPIINTENA = 0;        // the interrupt used without FIFOs: off
    SpibRegs.SPIBRR.bit.SPI_BIT_RATE = 0;     // TODO 3: 500 kHz from the 50 MHz LSPCLK
    SpibRegs.SPISTS.all = 0x0000;             // status register, as the course code writes it
    SpibRegs.SPICCR.bit.SPILBK = 1;           // loopback: SIMO joined to SOMI inside the chip

    SpibRegs.SPIFFTX.bit.SPIRST = 1;          // FIFOs out of reset
    SpibRegs.SPIFFTX.bit.SPIFFENA = 1;        // use the FIFOs
    SpibRegs.SPIFFTX.bit.TXFIFO = 0;          // empty the transmit FIFO and hold it
    SpibRegs.SPIFFTX.bit.TXFFINTCLR = 1;      // clear old flags: transmit interrupt,
    SpibRegs.SPIFFRX.bit.RXFIFORESET = 0;     // empty the receive FIFO and hold it
    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;      // receive overflow (FIFO was full),
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;      // receive interrupt
    SpibRegs.SPIFFCT.bit.TXDLY = 0;           // no pause between words

    SpibRegs.SPICCR.bit.SPISWRESET = 0;       // TODO 4: set-up done, release the SPI

    SpibRegs.SPIFFTX.bit.TXFIFO = 1;          // release the FIFOs
    SpibRegs.SPIFFRX.bit.RXFIFORESET = 1;

    // TODO 5: send 0x00A5, 0x1234 and 0xBEEF

    // TODO 6: wait until three words have been received

    // TODO 7: read them into rx1, rx2, rx3

    while (1) {
    }
}
`,
      solution: `uint16_t rx1 = 0;
uint16_t rx2 = 0;
uint16_t rx3 = 0;

void main(void)
{
${START}
${PINS}

    SpibRegs.SPICCR.bit.SPISWRESET = 0;       // hold the SPI in reset while it is set up

    SpibRegs.SPICTL.bit.CLK_PHASE = 1;        // with CLKPOLARITY = 0: clock rests low,
    SpibRegs.SPICCR.bit.CLKPOLARITY = 0;      // data is read on the rising edge
    SpibRegs.SPICTL.bit.MASTER_SLAVE = 1;     // this chip is the master
    SpibRegs.SPICCR.bit.SPICHAR = 0xF;        // 16 bits per word
    SpibRegs.SPICTL.bit.TALK = 1;             // drive the SIMO pin
    SpibRegs.SPIPRI.bit.FREE = 1;             // keep running when the debugger halts
    SpibRegs.SPICTL.bit.SPIINTENA = 0;        // the interrupt used without FIFOs: off
    SpibRegs.SPIBRR.bit.SPI_BIT_RATE = 99;    // 50 MHz / (99 + 1) = 500 kHz
    SpibRegs.SPISTS.all = 0x0000;             // status register, as the course code writes it
    SpibRegs.SPICCR.bit.SPILBK = 1;           // loopback: SIMO joined to SOMI inside the chip

    SpibRegs.SPIFFTX.bit.SPIRST = 1;          // FIFOs out of reset
    SpibRegs.SPIFFTX.bit.SPIFFENA = 1;        // use the FIFOs
    SpibRegs.SPIFFTX.bit.TXFIFO = 0;          // empty the transmit FIFO and hold it
    SpibRegs.SPIFFTX.bit.TXFFINTCLR = 1;      // clear old flags: transmit interrupt,
    SpibRegs.SPIFFRX.bit.RXFIFORESET = 0;     // empty the receive FIFO and hold it
    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;      // receive overflow (FIFO was full),
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;      // receive interrupt
    SpibRegs.SPIFFCT.bit.TXDLY = 0;           // no pause between words

    SpibRegs.SPICCR.bit.SPISWRESET = 1;       // set-up done, release the SPI

    SpibRegs.SPIFFTX.bit.TXFIFO = 1;          // release the FIFOs
    SpibRegs.SPIFFRX.bit.RXFIFORESET = 1;

    SpibRegs.SPITXBUF = 0x00A5;
    SpibRegs.SPITXBUF = 0x1234;
    SpibRegs.SPITXBUF = 0xBEEF;

    while (SpibRegs.SPIFFRX.bit.RXFFST != 3);

    rx1 = SpibRegs.SPIRXBUF;
    rx2 = SpibRegs.SPIRXBUF;
    rx3 = SpibRegs.SPIRXBUF;

    while (1) {
    }
}
`,
      checks: [
        { kind: "reg", reg: "SpibRegs.SPICTL", field: "MASTER_SLAVE", equals: 1, label: "SPIB is the master", hint: "MASTER_SLAVE = 1. A slave waits for somebody else's clock and never sends by itself." },
        { kind: "reg", reg: "SpibRegs.SPICCR", field: "SPICHAR", equals: 15, label: "Words are 16 bits long", hint: "SPICHAR is the number of bits minus 1: 0xF." },
        { kind: "reg", reg: "SpibRegs.SPIBRR", field: "SPI_BIT_RATE", equals: 99, label: "The bit rate is 500 kHz", hint: "50 MHz / (SPIBRR + 1) = 500 kHz." },
        { kind: "reg", reg: "SpibRegs.SPICCR", field: "SPISWRESET", equals: 1, label: "The SPI is released from reset", hint: "While SPISWRESET is 0 nothing is sent." },
        { kind: "signal", name: "SPIB_WORDS", equals: 3, label: "Exactly three words were sent", hint: "Each write to SpibRegs.SPITXBUF sends one word." },
        { kind: "var", name: "rx1", equals: 0x00a5, label: "rx1 is 0x00A5", hint: "The first read of SPIRXBUF gives the word that arrived first." },
        { kind: "var", name: "rx2", equals: 0x1234, label: "rx2 is 0x1234" },
        { kind: "var", name: "rx3", equals: 0xbeef, label: "rx3 is 0xBEEF" },
        { kind: "reg", reg: "SpibRegs.SPIFFRX", field: "RXFFST", equals: 0, label: "The receive FIFO is empty at the end", hint: "Read SPIRXBUF once for every word you sent." },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported" },
      ],
      watch: ["rx1", "rx2", "rx3"],
      inspect: ["SpibRegs.SPICCR", "SpibRegs.SPICTL", "SpibRegs.SPIBRR", "SpibRegs.SPIFFTX", "SpibRegs.SPIFFRX"],
      hints: [
        "TODO 1 to 4 each change one number. A master is 1. SPICHAR and SPIBRR follow from the two rules under \"Two numbers\". A reset is released with 1.",
        "SPICHAR = 0xF (16 - 1) and SPI_BIT_RATE = 99 (50 MHz / 100). Sending is three lines of the form `SpibRegs.SPITXBUF = 0x00A5;`.",
        "Wait with `while (SpibRegs.SPIFFRX.bit.RXFFST != 3);`, then `rx1 = SpibRegs.SPIRXBUF;` and the same for rx2 and rx3.",
      ],
      takeaway: "Reset, configure, release. Three writes to SPITXBUF queue three words, and three words come back, which you must read out.",
    },
    {
      id: "spi-modes",
      kind: "brief",
      title: "Clock polarity and phase: two questions",
      goal: "Learn to describe a clock mode with two facts, the rest level and the reading edge, then answer four questions.",
      refs: [{ trm: "18.3.6" }, { trm: "18.5.2" }, { course: "L10" }, { course: "HW2" }],
      brief: `
Master and slave must agree on **when** the data line is read. The clock can rest low or high, and the data can be read on its first or its second edge. That gives four **clock modes**, set by two bits. They are the answers to two separate questions.

## Question 1: where does the clock rest? (polarity)
Look at the clock while the chip select is low but **before the first edge**.

- rests **low**: \`SpibRegs.SPICCR.bit.CLKPOLARITY = 0;\`
- rests **high**: \`SpibRegs.SPICCR.bit.CLKPOLARITY = 1;\`

That is all polarity means. It says nothing about reading.

## Question 2: on which edge is the data read? (phase)
Each bit time has two clock edges: the **first** leaves the rest level, the **second** returns to it. On one of them both chips **read** the data lines. On the other both **change** their data line to the next bit, so the data holds still while it is read.

- read on the **second** edge: \`SpibRegs.SPICTL.bit.CLK_PHASE = 0;\`
- read on the **first** edge: \`SpibRegs.SPICTL.bit.CLK_PHASE = 1;\` The first bit is then on the line half a cycle before the first edge. The manual calls this "with delay".

Switch the two bits in the figure. The data line never moves. Only the clock does.

{{figure:spi-modes}}

## The four modes
\`\`\`c
POLARITY PHASE rests read on        changes on    name in the manual
   0       0   low   falling (2nd)  rising (1st)  rising edge without delay
   0       1   low   rising (1st)   falling (2nd) rising edge with delay
   1       0   high  rising (2nd)   falling (1st) falling edge without delay
   1       1   high  falling (1st)  rising (2nd)  falling edge with delay
\`\`\`

The manual names a mode after the edge on which data is **put out** when there is no delay.

To read a diagram: find the rest level, then see where the data line changes. It is **read on the other edge**.

## The course's setting
Both devices on the robot read on the **rising** edge with a clock that rests **low**: \`CLKPOLARITY = 0\`, \`CLK_PHASE = 1\`. HW3 calls it "Mode 01": polarity 0, phase 1.

## Datasheets count differently
A **datasheet** is the manufacturer's document that describes a chip. Datasheets use bits called CPOL and CPHA and number the modes 0 to 3. CPOL is CLKPOLARITY. But **CPHA is the opposite of CLK_PHASE**: CPHA = 0 means "read on the first edge", which this chip calls CLK_PHASE = 1. So the course's "Mode 01" is datasheet mode 0 (CPOL 0, CPHA 0), and datasheet mode 3 (CPOL 1, CPHA 1) is \`CLKPOLARITY = 1\`, \`CLK_PHASE = 0\`. When in doubt, ignore the names and compare the two facts.
`,
      questions: [
        {
          prompt: "Chip select is low and no clock edge has happened yet. SPICLK is high. What does that tell you?",
          options: [
            "CLKPOLARITY = 1. Nothing about the phase yet",
            "CLK_PHASE = 1. Nothing about the polarity yet",
            "CLKPOLARITY = 0 and CLK_PHASE = 1",
            "Data is read on the falling edge",
          ],
          answer: 0,
          why: "The level before the first edge is the rest level, and the rest level is the polarity. The reading edge is a separate question.",
        },
        {
          prompt: "On a diagram the clock rests low and the data lines change on every **falling** clock edge. On which edge is the data read, and what is CLK_PHASE?",
          options: [
            "Falling edge, CLK_PHASE = 0",
            "Rising edge, the first edge after rest: CLK_PHASE = 1",
            "Rising edge, the second edge after rest: CLK_PHASE = 0",
            "Falling edge, CLK_PHASE = 1",
          ],
          answer: 1,
          why: "Data is read on the edge where it does not change: the rising edge. From a low rest level the rising edge is the first edge, so CLK_PHASE = 1. This is the course's mode.",
        },
        {
          prompt: "What does the manual call CLKPOLARITY = 0, CLK_PHASE = 1?",
          options: ["Rising edge without delay", "Rising edge with delay", "Falling edge without delay", "Falling edge with delay"],
          answer: 1,
          why: "The clock rests low, so its first edge rises. The data is on the line half a cycle before that edge (\"with delay\") and is read on it.",
        },
        {
          prompt: "A sensor's datasheet says \"SPI mode 3 (CPOL = 1, CPHA = 1)\". Which setting matches?",
          options: [
            "CLKPOLARITY = 1, CLK_PHASE = 1",
            "CLKPOLARITY = 1, CLK_PHASE = 0",
            "CLKPOLARITY = 0, CLK_PHASE = 1",
            "CLKPOLARITY = 0, CLK_PHASE = 0",
          ],
          answer: 1,
          why: "CPOL is the rest level: high, CLKPOLARITY = 1. CPHA = 1 means read on the second edge, which is CLK_PHASE = 0. The two phase bits are opposites.",
        },
      ],
      takeaway: "Polarity is where the clock rests. Phase is which edge reads. Find those two facts and the mode is settled, whatever anyone calls it.",
    },
    {
      id: "spi-clock-low",
      kind: "timing",
      title: "Draw the clock: resting low",
      goal: "Draw SPICLK for the byte 0xA5 in the two modes whose clock rests low.",
      refs: [{ trm: "18.3.6" }, { course: "HW2" }, { course: "L10" }],
      brief: `
The master sends **0xA5 = \`1010 0101\`**, top bit first. The chip select is low the whole time and SIMO is already drawn. Before the byte, SIMO still holds an old bit (drawn low). After it, SIMO keeps the last bit.

Each bit time is two cells: **7a** is the first half of bit 7's time, **7b** the second half. A clock edge can only happen where two cells meet.

Draw the clock twice. Both clocks **rest low** (\`CLKPOLARITY = 0\`), so the "rest" cells are low and every bit time contains one high pulse. The question is where in the bit time the pulse sits.

- **Rising edge without delay** (\`CLK_PHASE = 0\`): the data changes on the rising edge and is read on the falling edge. The rising edge must be where SIMO changes: at the **start** of each bit time.
- **Rising edge with delay** (\`CLK_PHASE = 1\`, the course's mode): the data is read on the rising edge. The rising edge must sit in the **middle** of each bit time, where SIMO holds still, and the clock falls back where SIMO changes.

The SIMO row is the same for both. Only the clock moves.
`,
      slots: SLOTS,
      rows: [
        { name: "Chip select", editable: false, initial: LOW, answer: LOW },
        { name: "SIMO (0xA5)", editable: false, initial: dataRow(BYTE), answer: dataRow(BYTE) },
        { name: "SPICLK, CLK_PHASE = 0", editable: true, initial: LOW, answer: clockRow(0, 0) },
        { name: "SPICLK, CLK_PHASE = 1", editable: true, initial: LOW, answer: clockRow(0, 1) },
      ],
      hints: [
        "Both clocks are low in the two rest cells. In every bit time one cell is high and the other low.",
        "Without delay the clock rises at the start of the bit time: the a cells are high. With delay it rises in the middle: the b cells are high.",
        "CLK_PHASE = 0: high in 7a, 6a, 5a, 4a, 3a, 2a, 1a, 0a. CLK_PHASE = 1: high in 7b, 6b, 5b, 4b, 3b, 2b, 1b, 0b.",
      ],
      takeaway: "The two clocks are the same pulses shifted by half a cycle. That half cycle decides whether the rising edge lands where the data changes or where it holds still.",
    },
    {
      id: "spi-identify",
      kind: "quiz",
      title: "Which mode is this?",
      goal: "Work out the clock mode and the two bytes of a logic-analyser picture, as HW2 asks.",
      refs: [{ course: "HW2" }, { trm: "18.3.6" }, { trm: "18.3.4" }],
      brief: `
A **logic analyser** is an instrument that records the highs and lows of several wires over time. HW2 gives you its picture of an SPI transfer and asks for the bytes and the clock mode. Here is one byte of such a picture, with the names most instruments use: SS is the chip select, SCK is SPICLK, MOSI is SIMO and MISO is SOMI. \`--\` is high, \`__\` is low, and each bit time is four characters wide (two cells).

\`\`\`c
bit   : ${HEADER}
SS    : ${wave(LOW)}
SCK   : ${wave(clockRow(1, 0))}
MOSI  : ${wave(dataRow(BYTE, 1))}
MISO  : ${wave(dataRow(0x4e, 1))}
\`\`\`

Use the procedure, in this order:

1. **Rest level.** Look at SCK before its first edge, with SS already low.
2. **Where do the data lines change?** Compare the places where MOSI or MISO change with the SCK edges at the same position. The data is **read on the other edge**.
3. Is that reading edge the first or the second edge after rest?
4. Only now read the bytes: take the level of the data line at each reading edge, top bit first.
`,
      questions: [
        {
          prompt: "Step 1. Where does SCK rest, and what is CLKPOLARITY?",
          options: ["It rests low: CLKPOLARITY = 0", "It rests high: CLKPOLARITY = 1", "It rests low: CLKPOLARITY = 1", "The picture does not show it"],
          answer: 1,
          why: "Before the first edge, with SS low, SCK is high. The rest level is the polarity.",
        },
        {
          prompt: "Step 2. On which SCK edges do MOSI and MISO change?",
          options: ["On rising edges", "On falling edges", "On both edges", "In the middle of the low time"],
          answer: 1,
          why: "Every change of MOSI or MISO lines up with a place where SCK goes from high to low. Between two falling edges the data holds still.",
        },
        {
          prompt: "Step 3. So on which edge is the data read, and what is CLK_PHASE?",
          options: [
            "The falling edge, the first after rest: CLK_PHASE = 1",
            "The rising edge, the first after rest: CLK_PHASE = 1",
            "The rising edge, the second after rest: CLK_PHASE = 0",
            "The falling edge, the second after rest: CLK_PHASE = 0",
          ],
          answer: 2,
          why: "Data is read on the edge where it does not change: the rising edge. From a high rest level the first edge falls, so the rising edge is the second one: CLK_PHASE = 0.",
        },
        {
          prompt: "What does the manual call this mode?",
          options: ["Rising edge without delay", "Rising edge with delay", "Falling edge without delay", "Falling edge with delay"],
          answer: 2,
          why: "CLKPOLARITY = 1, CLK_PHASE = 0: data is put out on the falling edge, with no delay. A datasheet would call it mode 3.",
        },
        {
          prompt: "Step 4. Which byte does the slave send to the master on MISO?",
          options: ["0x4E", "0x72", "0xB1", "0x27"],
          answer: 0,
          why: "Reading MISO at the eight rising edges gives 0, 1, 0, 0, 1, 1, 1, 0 = 0100 1110 = 0x4E. Reading it from right to left (0x72) would be the UART order, not SPI.",
        },
        {
          prompt: "And which byte does the master send on MOSI at the same time?",
          options: ["0x5A", "0xA5", "0x4E", "0x52"],
          answer: 1,
          why: "1, 0, 1, 0, 0, 1, 0, 1 = 1010 0101 = 0xA5. Both bytes travel during the same eight clock cycles: SPI is full duplex.",
        },
      ],
      hints: [
        "The first two characters of the SCK row, under the r, are the rest level.",
        "MISO changes between bit 7 and bit 6. Look straight up at SCK there: is it going down or up?",
        "Read on rising edges, which sit in the middle of each bit time here, so each bit is simply the level in its column.",
      ],
      takeaway: "Rest level first, then find where the data changes: it is read on the other edge. This device reads on the rising edge, like the course's mode, only with the clock resting high.",
    },
    {
      id: "spi-isr",
      kind: "code",
      mode: "write",
      title: "Start it, then come back",
      goal: "Send three words every millisecond from the timer interrupt and collect the three replies in the SPIB receive interrupt.",
      refs: [{ course: "HW3" }, { trm: "18.2.3" }, { trm: "18.3.7" }, { trm: "18.5.2" }],
      brief: `
Three 16-bit words take 96 us at 500 kHz. Waiting for them in an empty loop wastes that time, and waiting inside an interrupt function blocks every other interrupt. The course's programs work in two halves instead (HW3 has you build the same pattern):

- **Timer 0 interrupt, every 1 ms: start the transfer.** Pull the chip select low, say how many words to wait for, write the words to \`SPITXBUF\`, and return at once.
- **SPIB receive interrupt: finish it.** The SPI raises this interrupt when the receive FIFO holds at least \`RXFFIL\` words: when \`RXFFST >= RXFFIL\`. Read the words, raise the chip select, clear the flag.

Try it in the figure: set RXFFIL to 3, write three words and clock them out one at a time. The interrupt appears when the third word arrives.

{{figure:spi-fifo}}

\`SPIB_RX\` is interrupt **INT6.3**: PIE group 6, channel 3. The vector and the enables are already written in \`main()\`.

## Write the two functions
\`cpu_timer0_isr\`:

1. chip select low: \`GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;\`
2. set \`SpibRegs.SPIFFRX.bit.RXFFIL\` so the interrupt comes when the whole answer is there (the set-up leaves it at 16, which three words never reach)
3. send \`0x2C5E\`, \`0x9A01\` and \`0x0F3D\` (no special meaning: easy to recognise on an oscilloscope)
4. acknowledge group 1: \`PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;\`

\`SPIB_isr\`:

1. read the words into \`spivalue1\`, \`spivalue2\` and \`spivalue3\`
2. chip select high: \`GpioDataRegs.GPCSET.bit.GPIO66 = 1;\`
3. count the transfer in \`numTransfers\`
4. \`SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;\` and \`SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;\` to clear the overflow flag (set when a word arrives while the FIFO is full) and the interrupt flag. Without the second line the interrupt comes only once
5. acknowledge group 6: \`PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;\`

The SPI is in loopback here, so the words that come back are the ones sent. The variables are \`int16_t\`: \`0x9A01\` shows as a negative number.
`,
      kit: "robot",
      durationMs: 6,
      starter: `__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);

int16_t spivalue1 = 0;
int16_t spivalue2 = 0;
int16_t spivalue3 = 0;
uint32_t numTransfers = 0;

void main(void)
{
${START}
${PINS}

${spib({ loopback: true })}
${PIE_INIT}

${VECTORS(1000)}

    while (1) {
    }
}

// Every 1 ms: start a three-word transfer
__interrupt void cpu_timer0_isr(void)
{
    // TODO: chip select low, RXFFIL, send 0x2C5E, 0x9A01 and 0x0F3D

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

// When the three words have arrived: finish the transfer
__interrupt void SPIB_isr(void)
{
    // TODO: read the three words, chip select high, count, clear the flags

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}
`,
      solution: `__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);

int16_t spivalue1 = 0;
int16_t spivalue2 = 0;
int16_t spivalue3 = 0;
uint32_t numTransfers = 0;

void main(void)
{
${START}
${PINS}

${spib({ loopback: true })}
${PIE_INIT}

${VECTORS(1000)}

    while (1) {
    }
}

// Every 1 ms: start a three-word transfer
__interrupt void cpu_timer0_isr(void)
{
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPIFFRX.bit.RXFFIL = 3;
    SpibRegs.SPITXBUF = 0x2C5E;
    SpibRegs.SPITXBUF = 0x9A01;
    SpibRegs.SPITXBUF = 0x0F3D;

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

// When the three words have arrived: finish the transfer
__interrupt void SPIB_isr(void)
{
    spivalue1 = SpibRegs.SPIRXBUF;
    spivalue2 = SpibRegs.SPIRXBUF;
    spivalue3 = SpibRegs.SPIRXBUF;
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    numTransfers++;

    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}
`,
      checks: [
        { kind: "isr", fn: "SPIB_isr", min: 5, max: 5, label: "SPIB_isr runs once per transfer (5 times in 6 ms)", hint: "It runs when RXFFST >= RXFFIL. Ran 0 times: RXFFIL is larger than the number of words sent (the set-up leaves it at 16), so set it to 3 in the timer function. Ran once: RXFFINTCLR = 1 or the PIEACK line for group 6 is missing at the end of SPIB_isr. Ran too often: RXFFIL is too small, or not every word is read before the flag is cleared." },
        { kind: "var", name: "spivalue1", equals: 0x2c5e, label: "spivalue1 is 0x2C5E (11358)" },
        { kind: "var", name: "spivalue2", equals: 0x9a01 - 65536, label: "spivalue2 is 0x9A01 (-26111 as an int16_t)" },
        { kind: "var", name: "spivalue3", equals: 0x0f3d, label: "spivalue3 is 0x0F3D (3901)" },
        { kind: "var", name: "numTransfers", equals: 5, label: "numTransfers counts 5 transfers" },
        { kind: "pin", pin: 66, at: 3.055, level: 0, label: "The chip select is low while the words are on the wire", hint: "Clear GPIO66 in the timer interrupt, before writing SPITXBUF." },
        { kind: "pin", pin: 66, at: 3.5, level: 1, label: "The chip select is high again between transfers", hint: "Set GPIO66 in SPIB_isr. If SPIB_isr does not run on every transfer, fix that first: see the first check." },
        { kind: "signal", name: "SPIB_WORDS", equals: 15, label: "Three words are sent per millisecond" },
        { kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 2, label: "The timer interrupt returns within 2 us: it does not wait for the transfer", hint: "No loop that waits for RXFFST in the timer function. The words arrive later, and SPIB_isr collects them." },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported" },
      ],
      watch: ["spivalue1", "spivalue2", "spivalue3", "numTransfers"],
      inspect: ["SpibRegs.SPIFFRX", "SpibRegs.SPIFFTX"],
      hints: [
        "The timer function only starts the transfer: no loop, no waiting. The last word arrives 96 us later, and that is when SPIB_isr must run.",
        "RXFFIL is the number of words in the transfer: 3. In SPIB_isr, read SPIRXBUF exactly three times: the first read gives the first word.",
        "Timer: GPCCLEAR GPIO66, RXFFIL = 3, three SPITXBUF writes. SPIB_isr: three SPIRXBUF reads, GPCSET GPIO66, numTransfers++, RXFFOVFCLR = 1, RXFFINTCLR = 1.",
      ],
      takeaway: "One interrupt starts the transfer, another finishes it. RXFFIL is how you tell the SPI how many words make a complete answer.",
    },
    {
      id: "spi-debug",
      kind: "code",
      mode: "debug",
      title: "One word short",
      goal: "This program loses a word in every transfer and never lets go of the chip select. Find and fix both mistakes.",
      refs: [{ course: "HW3" }, { trm: "18.3.7" }, { trm: "18.5.2" }],
      brief: `
Every millisecond this program sends **four** words in loopback: \`0x1000 + n\`, \`0x2000 + n\`, \`0x3000 + n\` and \`0x4000 + n\`, where \`n\` counts the transfers. \`SPIB_isr\` reads the four replies and counts the transfer as good when they match what was sent.

Run it. \`good\` stays at 0, and the messages under the editor tell you something about the receive FIFO.

Two things are wrong:

- **The interrupt level does not match the transfer.** \`SPIB_isr\` runs as soon as \`RXFFST >= RXFFIL\`. Count the words that are sent and compare with \`RXFFIL\`. If the interrupt comes too early, the last read finds the FIFO empty and returns an **old** word, and the real word arrives later and is still in the FIFO at the next transfer.
- **The chip select is never raised.** A real device sees one endless transfer: it never learns where a message ends and the next begins. The chip select must go high after every transfer.

Try the first mistake in the figure: set RXFFIL to 2, write 3 words and clock them out one at a time.

{{figure:spi-fifo}}

Fix both. Do not change what is sent.
`,
      kit: "robot",
      durationMs: 8,
      starter: `__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);

uint16_t n = 0;
uint16_t rx[4];
uint32_t good = 0;
uint32_t bad = 0;

void main(void)
{
${START}
${PINS}

${spib({ loopback: true })}
${PIE_INIT}

${VECTORS(1000)}

    while (1) {
    }
}

// Every 1 ms: start a four-word transfer
__interrupt void cpu_timer0_isr(void)
{
    n++;
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPIFFRX.bit.RXFFIL = 3;
    SpibRegs.SPITXBUF = 0x1000 + n;
    SpibRegs.SPITXBUF = 0x2000 + n;
    SpibRegs.SPITXBUF = 0x3000 + n;
    SpibRegs.SPITXBUF = 0x4000 + n;

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void SPIB_isr(void)
{
    rx[0] = SpibRegs.SPIRXBUF;
    rx[1] = SpibRegs.SPIRXBUF;
    rx[2] = SpibRegs.SPIRXBUF;
    rx[3] = SpibRegs.SPIRXBUF;

    if (rx[0] == 0x1000 + n && rx[1] == 0x2000 + n && rx[2] == 0x3000 + n && rx[3] == 0x4000 + n) {
        good++;
    } else {
        bad++;
    }

    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}
`,
      solution: `__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);

uint16_t n = 0;
uint16_t rx[4];
uint32_t good = 0;
uint32_t bad = 0;

void main(void)
{
${START}
${PINS}

${spib({ loopback: true })}
${PIE_INIT}

${VECTORS(1000)}

    while (1) {
    }
}

// Every 1 ms: start a four-word transfer
__interrupt void cpu_timer0_isr(void)
{
    n++;
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPIFFRX.bit.RXFFIL = 4;
    SpibRegs.SPITXBUF = 0x1000 + n;
    SpibRegs.SPITXBUF = 0x2000 + n;
    SpibRegs.SPITXBUF = 0x3000 + n;
    SpibRegs.SPITXBUF = 0x4000 + n;

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void SPIB_isr(void)
{
    rx[0] = SpibRegs.SPIRXBUF;
    rx[1] = SpibRegs.SPIRXBUF;
    rx[2] = SpibRegs.SPIRXBUF;
    rx[3] = SpibRegs.SPIRXBUF;
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;

    if (rx[0] == 0x1000 + n && rx[1] == 0x2000 + n && rx[2] == 0x3000 + n && rx[3] == 0x4000 + n) {
        good++;
    } else {
        bad++;
    }

    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}
`,
      checks: [
        { kind: "var", name: "good", equals: 7, label: "All 7 transfers are received correctly", hint: "Four words are sent, so the interrupt must wait for four: RXFFIL = 4." },
        { kind: "var", name: "bad", equals: 0, label: "No transfer is received wrong" },
        { kind: "no-diagnostic", code: "spi-rx-empty", label: "SPIRXBUF is never read while the FIFO is empty", hint: "The interrupt fires after three words, but the function reads four." },
        { kind: "pin", pin: 66, at: 4.5, level: 1, label: "The chip select is high between transfers", hint: "Add GpioDataRegs.GPCSET.bit.GPIO66 = 1; to SPIB_isr, after the reads." },
        { kind: "pin", pin: 66, at: 4.06, level: 0, label: "The chip select is low during a transfer" },
        { kind: "reg", reg: "SpibRegs.SPIFFRX", field: "RXFFST", equals: 0, label: "The receive FIFO is empty at the end" },
      ],
      watch: ["n", "good", "bad"],
      inspect: ["SpibRegs.SPIFFRX"],
      hints: [
        "Count the writes to SPITXBUF in the timer function, then look at the line above them.",
        "RXFFIL must equal the number of words sent: 4.",
        "After the four reads in SPIB_isr add `GpioDataRegs.GPCSET.bit.GPIO66 = 1;`.",
      ],
      takeaway: "RXFFIL, the number of SPITXBUF writes and the number of SPIRXBUF reads are always the same number. And every transfer ends with the chip select going high.",
    },
    {
      id: "spi-checkpoint",
      kind: "code",
      mode: "checkpoint",
      title: "Checkpoint: link test",
      goal: "Build a self-test that exchanges a counter over SPI every millisecond, counts errors and reports four times a second.",
      refs: [{ course: "HW3" }, { course: "HW1" }, { trm: "18.3.7" }, { trm: "18.2.3" }],
      brief: `
A link test sends known data and checks what comes back. Build one for SPIB in loopback. It uses the timer, two interrupts, the serial port and an LED from the earlier chapters.

The set-up in \`main()\` is complete: SPIB (16-bit words, 1 MHz, loopback), timer 0 every 1 ms, the SPIB receive interrupt, the serial port and LED1 (GPIO22).

## What to write
**\`cpu_timer0_isr\`**, every 1 ms: count the call in \`count\`. Start a transfer of **two** words: \`count\` and its bitwise inverse \`~count\`. Remember the chip select (GPIO66), \`RXFFIL\` and the acknowledge for group 1.

**\`SPIB_isr\`**: read the two words into \`word1\` and \`word2\`, raise the chip select. If \`word2\` is the inverse of \`word1\`, add one to \`good\`, otherwise to \`bad\`: \`word2 == (uint16_t)~word1\`. (On this chip an \`int\` has 16 bits and the cast changes nothing. On a 32-bit computer it is needed, so the course writes it.) Every **250th** transfer, toggle LED1 and set \`UARTPrint = 1\`. Clear the two FIFO flags and acknowledge group 6.

**\`while (1)\` loop**: when \`UARTPrint\` is 1, print this line with \`serial_printf(&SerialA, ...)\` and clear the flag (both counters are \`uint32_t\`, so the format code is \`%ld\`):

\`\`\`c
good:250 bad:0
\`\`\`

End the line with \`\\r\\n\`. Never print inside an interrupt function.
`,
      kit: "robot",
      durationMs: 1100,
      starter: `__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);

uint16_t count = 0;
uint16_t word1 = 0;
uint16_t word2 = 0;
uint32_t good = 0;
uint32_t bad = 0;
uint16_t UARTPrint = 0;

void main(void)
{
${START}
    // LED1 on GPIO22, off
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;

${PINS}

${spib({ loopback: true })}
${PIE_INIT}

${VECTORS(1000, "\n    init_serialSCIA(&SerialA, 115200);\n")}

    while (1) {
        // TODO: print "good:... bad:..." when UARTPrint is 1

    }
}

__interrupt void cpu_timer0_isr(void)
{
    // TODO: count, and start a two-word transfer of count and ~count

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void SPIB_isr(void)
{
    // TODO: read, check, count, and every 250th time toggle LED1 and set UARTPrint

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}
`,
      solution: `__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);

uint16_t count = 0;
uint16_t word1 = 0;
uint16_t word2 = 0;
uint32_t good = 0;
uint32_t bad = 0;
uint16_t UARTPrint = 0;

void main(void)
{
${START}
    // LED1 on GPIO22, off
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;

${PINS}

${spib({ loopback: true })}
${PIE_INIT}

${VECTORS(1000, "\n    init_serialSCIA(&SerialA, 115200);\n")}

    while (1) {
        if (UARTPrint == 1) {
            serial_printf(&SerialA, "good:%ld bad:%ld\\r\\n", good, bad);
            UARTPrint = 0;
        }
    }
}

__interrupt void cpu_timer0_isr(void)
{
    count++;
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPIFFRX.bit.RXFFIL = 2;
    SpibRegs.SPITXBUF = count;
    SpibRegs.SPITXBUF = ~count;

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void SPIB_isr(void)
{
    word1 = SpibRegs.SPIRXBUF;
    word2 = SpibRegs.SPIRXBUF;
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;

    if (word2 == (uint16_t)~word1) {
        good++;
    } else {
        bad++;
    }
    if (((good + bad) % 250) == 0) {
        GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
        UARTPrint = 1;
    }

    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}
`,
      checks: [
        { kind: "serial", matches: "^good:250 bad:0\\r\\ngood:500 bad:0\\r\\n", label: "The first lines are good:250 bad:0 and good:500 bad:0", hint: "If bad counts up, check that the second word sent is ~count and that word1 is read first. If nothing is printed, check that SPIB_isr runs and sets UARTPrint." },
        { kind: "serial-period", periodMs: 250, label: "A line is printed every 250 ms" },
        { kind: "blink", led: "LED1", periodMs: 500, label: "LED1 changes every 250 ms" },
        { kind: "var", name: "bad", equals: 0, label: "No transfer failed" },
        { kind: "isr", fn: "SPIB_isr", min: 1095, max: 1100, label: "SPIB_isr runs once per millisecond", hint: "Ran 0 times or a few times too few: set RXFFIL = 2 in the timer function (the set-up leaves it at 16, so the first interrupt waits for 16 words). Ran once: clear RXFFINT with RXFFINTCLR = 1 at the end of SPIB_isr. Ran twice as often: read both words before clearing the flag." },
        { kind: "pin", pin: 66, at: 500.5, level: 1, label: "The chip select is high between transfers" },
        { kind: "no-diagnostic", code: "print-in-isr", label: "Nothing is printed inside an interrupt function" },
        { kind: "no-diagnostic", code: "printf-type", label: "The format codes match the 32-bit counters", hint: "good and bad are uint32_t: use %ld." },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported" },
      ],
      bonus: [{ kind: "isr-time", fn: "SPIB_isr", maxUs: 1, label: "SPIB_isr takes at most 1 us" }],
      watch: ["count", "word1", "word2", "good", "bad"],
      hints: [
        "Start from the two functions of \"Start it, then come back\". Only the words sent and the check are new.",
        "The check is `if (word2 == (uint16_t)~word1) { good++; } else { bad++; }`. Print with %ld: the counters are 32 bits wide.",
        "`if (((good + bad) % 250) == 0)` is true on every 250th transfer.",
      ],
      takeaway: "Start in one interrupt, finish in another, print from the main loop. This is the skeleton of every sensor driver in the course.",
    },

    // ---------------------------------------------------------------- practice
    {
      id: "spi-clock-high",
      kind: "timing",
      tier: "practice",
      title: "Draw the clock: resting high",
      goal: "Draw SPICLK for the same byte, 0xA5, in the two modes whose clock rests high.",
      refs: [{ trm: "18.3.6" }, { trm: "18.5.2" }, { course: "HW2" }],
      brief: `
Same byte, same SIMO line as before: **0xA5 = \`1010 0101\`**. Now \`CLKPOLARITY = 1\`: the clock **rests high**, and every bit time contains one low pulse. The first edge after rest is a **falling** edge.

- **Falling edge without delay** (\`CLK_PHASE = 0\`): the data changes on the falling edge and is read on the rising edge. The falling edge sits where SIMO changes: at the **start** of each bit time.
- **Falling edge with delay** (\`CLK_PHASE = 1\`): the data is read on the falling edge, the first edge. It sits in the **middle** of each bit time, and the clock rises again where SIMO changes.

When you are done, compare the first row with the course's mode from "Draw the clock: resting low" (\`CLKPOLARITY = 0\`, \`CLK_PHASE = 1\`). Inside the byte the two clocks are identical. Both read on the rising edge. They differ only in where the clock rests. That is why some devices, the MPU-9250 among them, work in both.
`,
      slots: SLOTS,
      rows: [
        { name: "Chip select", editable: false, initial: LOW, answer: LOW },
        { name: "SIMO (0xA5)", editable: false, initial: dataRow(BYTE), answer: dataRow(BYTE) },
        { name: "SPICLK, CLK_PHASE = 0", editable: true, initial: LOW, answer: clockRow(1, 0) },
        { name: "SPICLK, CLK_PHASE = 1", editable: true, initial: LOW, answer: clockRow(1, 1) },
      ],
      hints: [
        "Both clocks are high in the two rest cells. In every bit time one cell is low and the other high.",
        "Without delay the clock falls at the start of the bit time: the a cells are low. With delay it falls in the middle: the b cells are low.",
        "CLK_PHASE = 0: rest high, a cells low, b cells high. CLK_PHASE = 1: rest high, a cells high, b cells low.",
      ],
      takeaway: "Four modes, one data line. Two of them read on the rising edge and two on the falling edge. A slave cares most about the reading edge.",
    },
    {
      id: "spi-numbers",
      kind: "calc",
      tier: "practice",
      title: "Bit rate and word length",
      goal: "Work out bit rate register values, transfer times and how to send a 24-bit value.",
      refs: [{ trm: "18.3.5" }, { trm: "18.3.4" }, { trm: "18.5.2" }, { course: "HW3" }],
      brief: `
## Bit rate
The master makes SPICLK by dividing the low-speed peripheral clock **LSPCLK**, 50 MHz in the course projects:

**bit rate = LSPCLK / (SPIBRR + 1)**, for SPIBRR from 3 to 127.

For SPIBRR = 0, 1 or 2 the rate is LSPCLK / 4, the fastest the module goes. SPIBRR is 7 bits wide, so 127 is the largest value. One bit is sent per clock cycle. There are no start or stop bits: a 16-bit word takes exactly 16 clock cycles.

The MPU-9250 accepts at most 1 MHz, so the course's sensor code runs at 1 MHz. The loopback levels of this chapter run at 500 kHz.

## Word length
\`SPICCR.bit.SPICHAR\` sets the number of bits per word, **minus 1**. It is 4 bits wide: the longest word is 16 bits (SPICHAR = 0xF). A longer value is sent as several words while the chip select stays low.

With the FIFO in use you may write several words to \`SPITXBUF\` one after the other. They are queued and sent back to back.
`,
      fields: [
        {
          id: "brr",
          label: "SPIBRR for 500 kHz",
          answer: 99,
          why: "50 MHz / (99 + 1) = 500 kHz. Turned around: SPIBRR = 50 MHz / rate - 1.",
        },
        {
          id: "slow",
          label: "Slowest bit rate the module can make (SPIBRR = 127)",
          unit: "bits/s",
          answer: 390625,
          tolPct: 0.1,
          why: "50 MHz / 128 = 390625 bits per second. SPI cannot be slowed down as far as a UART.",
        },
        {
          id: "word",
          label: "Time to send one 16-bit word at 1 MHz",
          unit: "us",
          answer: 16,
          why: "16 bits x 1 us per bit. No start or stop bits.",
        },
        {
          id: "burst",
          label: "Time for eight 16-bit words back to back at 1 MHz (the course's sensor read)",
          unit: "us",
          answer: 128,
          why: "8 x 16 bits = 128 clock cycles of 1 us. The interrupt that starts the read returns long before the data is there.",
        },
        {
          id: "char",
          label: "SPICHAR for 8-bit words",
          format: "hex",
          answer: 7,
          why: "Bits per word minus 1: 8 - 1 = 7.",
        },
        {
          id: "w24",
          label: "8-bit words needed for a 24-bit value",
          answer: 3,
          why: "The longest word is 16 bits, so 24 bits do not fit in one. Three 8-bit words, sent while the chip select stays low, look like one 24-bit transfer to the device.",
        },
      ],
      hints: [
        "Turn the formula around: SPIBRR = LSPCLK / rate - 1.",
        "Time is bits divided by bit rate. At 1 MHz one bit takes 1 us.",
        "SPICHAR is the word length minus 1, and a word is at most 16 bits.",
      ],
      takeaway: "At 1 MHz a 16-bit word takes 16 us. The CPU runs thousands of instructions in that time, which is why programs start a transfer and come back for the result.",
    },
    {
      id: "spi-24bit",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "Twenty-four bits in three bytes",
      goal: "Send a 24-bit value as three 8-bit words and rebuild it from the three words received.",
      refs: [{ trm: "18.3.4" }, { trm: "18.5.2" }, { course: "L10" }],
      brief: `
Some devices want 24 bits per transfer, more than the 16 bits one word can hold. The answer is three 8-bit words sent while the chip select stays low: on the wire they are 24 clock cycles in a row.

SPIB is set up with \`SPICHAR = 7\` (8-bit words) and in loopback.

## Left-justified out, right-justified in
With words shorter than 16 bits, the SPI sends the **top** bits of what you write to \`SPITXBUF\`. The manual says: transmit data must be **left-justified**. To send the byte \`0xA5\` you must write \`0xA500\`, that is \`0xA5 << 8\`. Write \`0x00A5\` and the eight bits sent are the upper ones: \`0x00\`.

Received data is **right-justified**: the byte is in the lower 8 bits of \`SPIRXBUF\`. The upper 8 bits are not zero in general, they hold what was left in the shift register, so mask them off with \`& 0x00FF\`.

Try it in the figure: with 8-bit words, write 0xA5 "as it is", then "shifted to the top".

{{figure:spi-justify}}

## Write send24()
\`send24(value)\` must:

1. pull the chip select (GPIO66) low
2. send the three bytes of \`value\`, **top byte first**: bits 23..16, then 15..8, then 7..0
3. wait for three words (\`RXFFST\`)
4. raise the chip select
5. read the three words and return them joined into one 24-bit number, first word on top

\`main()\` calls it with \`0xA5C3F0\` and then with \`0x123456\`, and stores what it returns in \`result\` and \`result2\`.
`,
      kit: "robot",
      durationMs: 2,
      starter: `uint32_t result = 0;
uint32_t result2 = 0;

// Sends the lower 24 bits of value as three 8-bit words and returns the 24 bits received
uint32_t send24(uint32_t value)
{
    uint32_t in = 0;

    // TODO

    return in;
}

void main(void)
{
${START}
${PINS}

${spib({ loopback: true, char: "7  " })}
    result = send24(0xA5C3F0);
    result2 = send24(0x123456);

    while (1) {
    }
}
`,
      solution: `uint32_t result = 0;
uint32_t result2 = 0;

// Sends the lower 24 bits of value as three 8-bit words and returns the 24 bits received
uint32_t send24(uint32_t value)
{
    uint32_t in = 0;

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = ((value >> 16) & 0xFF) << 8;
    SpibRegs.SPITXBUF = ((value >> 8) & 0xFF) << 8;
    SpibRegs.SPITXBUF = (value & 0xFF) << 8;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 3);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;

    in = SpibRegs.SPIRXBUF & 0x00FF;
    in = (in << 8) | (SpibRegs.SPIRXBUF & 0x00FF);
    in = (in << 8) | (SpibRegs.SPIRXBUF & 0x00FF);

    return in;
}

void main(void)
{
${START}
${PINS}

${spib({ loopback: true, char: "7  " })}
    result = send24(0xA5C3F0);
    result2 = send24(0x123456);

    while (1) {
    }
}
`,
      checks: [
        { kind: "signal", name: "SPIB_WORDS", equals: 6, label: "Three words are sent per call" },
        { kind: "signal", name: "SPIB_TX", at: 1.5, equals: 0x56, label: "The last byte on the wire is 0x56", hint: "If the wire carries 0x00, the byte was written right-justified. Shift it up by 8 bits before writing SPITXBUF." },
        { kind: "var", name: "result", equals: 0xa5c3f0, label: "result is 0xA5C3F0", hint: "Mask each received word with 0x00FF, and shift the running total left by 8 before adding the next byte." },
        { kind: "var", name: "result2", equals: 0x123456, label: "result2 is 0x123456" },
        { kind: "pin", pin: 66, at: 1.5, level: 1, label: "The chip select is high after the transfer" },
        { kind: "reg", reg: "SpibRegs.SPIFFRX", field: "RXFFST", equals: 0, label: "The receive FIFO is empty at the end" },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported" },
      ],
      watch: ["result", "result2"],
      inspect: ["SpibRegs.SPICCR", "SpibRegs.SPIFFRX"],
      hints: [
        "The top byte of value is `(value >> 16) & 0xFF`. To send it, shift it into the upper half of the word: `<< 8`.",
        "Three SPITXBUF writes, then `while (SpibRegs.SPIFFRX.bit.RXFFST != 3);`.",
        "`in = SpibRegs.SPIRXBUF & 0x00FF;` then twice `in = (in << 8) | (SpibRegs.SPIRXBUF & 0x00FF);`.",
      ],
      takeaway: "Short words go out from the top of SPITXBUF and come in at the bottom of SPIRXBUF. With 16-bit words the two are the same and you never notice.",
    },
    {
      id: "spi-debug-stale",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "Yesterday's answer",
      goal: "Every reply this program reads belongs to an earlier question. Find out why and fix it.",
      refs: [{ course: "HW3" }, { trm: "18.3.7" }, { trm: "18.5.2" }],
      brief: `
\`ask(command)\` sends a two-word message in loopback: first the command, then a word of zeros that gives the other side time to answer. In loopback the "answer" is simply the two words coming back, and the function should return the **first** of them, the command itself.

\`main()\` asks three times, with 0x0111, 0x0222 and 0x0333, and stores the results in \`a1\`, \`a2\` and \`a3\`.

Run it: \`a1\` is right, the others are not. Look at \`RXFFST\` in the register view after the program has run.

Remember the rule from the briefing: every word sent is a word received. The receive FIFO is a queue, and \`SPIRXBUF\` always hands out the **oldest** word in it. A word that is not read out stays there and is first in line next time.

Try it in the figure: write two words, clock them out, read only one, then do the same again.

{{figure:spi-fifo}}

Fix \`ask()\`. Keep sending two words per call.
`,
      kit: "robot",
      durationMs: 2,
      starter: `uint16_t a1 = 0;
uint16_t a2 = 0;
uint16_t a3 = 0;

// Sends a command and a word of zeros, returns the first word received
uint16_t ask(uint16_t command)
{
    uint16_t answer;

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = command;
    SpibRegs.SPITXBUF = 0x0000;
    while (SpibRegs.SPIFFRX.bit.RXFFST < 2);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;

    answer = SpibRegs.SPIRXBUF;

    return answer;
}

void main(void)
{
${START}
${PINS}

${spib({ loopback: true })}
    a1 = ask(0x0111);
    a2 = ask(0x0222);
    a3 = ask(0x0333);

    while (1) {
    }
}
`,
      solution: `uint16_t a1 = 0;
uint16_t a2 = 0;
uint16_t a3 = 0;

// Sends a command and a word of zeros, returns the first word received
uint16_t ask(uint16_t command)
{
    uint16_t answer;
    uint16_t unused;

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = command;
    SpibRegs.SPITXBUF = 0x0000;
    while (SpibRegs.SPIFFRX.bit.RXFFST < 2);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;

    answer = SpibRegs.SPIRXBUF;
    unused = SpibRegs.SPIRXBUF;

    return answer;
}

void main(void)
{
${START}
${PINS}

${spib({ loopback: true })}
    a1 = ask(0x0111);
    a2 = ask(0x0222);
    a3 = ask(0x0333);

    while (1) {
    }
}
`,
      checks: [
        { kind: "var", name: "a1", equals: 0x0111, label: "a1 is 0x0111" },
        { kind: "var", name: "a2", equals: 0x0222, label: "a2 is 0x0222", hint: "a2 got the second word of the first message, which was still in the FIFO." },
        { kind: "var", name: "a3", equals: 0x0333, label: "a3 is 0x0333" },
        { kind: "reg", reg: "SpibRegs.SPIFFRX", field: "RXFFST", equals: 0, label: "The receive FIFO is empty at the end", hint: "Two words are sent per call, so two must be read per call, even if one of them is of no interest." },
        { kind: "signal", name: "SPIB_WORDS", equals: 6, label: "Two words are still sent per call" },
      ],
      watch: ["a1", "a2", "a3"],
      inspect: ["SpibRegs.SPIFFRX"],
      hints: [
        "Each call sends two words. How many does it take out of the receive FIFO?",
        "The word of zeros comes back too. It must be read, even though nobody needs it.",
        "Add a second read after `answer = SpibRegs.SPIRXBUF;`, into a variable you do not use. The course calls such a variable `temp` or `dummyread`.",
      ],
      takeaway: "Read as many words as you send, every time. The course's set-up code is full of reads into a variable called dummyread for exactly this reason.",
    },
    {
      id: "spi-debug-mode",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "Who are you?",
      goal: "The MPU-9250 should answer 0x71 when asked who it is. Fix the two settings that stop it.",
      refs: [{ course: "HW3" }, { trm: "18.3.6" }, { trm: "18.5.2" }],
      brief: `
Time for a real device. The MPU-9250 has a register called WHO_AM_I that always holds **0x71**. Reading it is the classic first test of an SPI link: if 0x71 comes back, wiring, clock mode and word length are all right.

To read it, the master sends the 16-bit word \`0xF500\` with the chip select (GPIO66) low. The upper byte, 0xF5, means "read register 0x75". During the lower byte the MPU-9250 puts the register's value on SOMI, so the word that comes back is \`0x0071\`. The next chapter explains the details.

The MPU-9250 needs:

- **16 clock cycles** per transfer, with the chip select low the whole time
- a clock on which data is **read on the rising edge**: the course's mode, \`CLKPOLARITY = 0\`, \`CLK_PHASE = 1\`

This program gets something else back, and LED1 stays off. Read the messages under the editor, then compare the set-up at the top of \`main()\` with those two requirements. Two values are wrong.
`,
      kit: "robot",
      durationMs: 2,
      starter: `uint16_t whoami = 0;

void main(void)
{
${START}
    // LED1 on GPIO22, off
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;

${PINS}

${spib({ phase: 0, char: "7  " })}
    // Read register 0x75 (WHO_AM_I)
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0xF500;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    whoami = SpibRegs.SPIRXBUF;

    if (whoami == 0x0071) {
        GpioDataRegs.GPASET.bit.GPIO22 = 1;
    }

    while (1) {
    }
}
`,
      solution: `uint16_t whoami = 0;

void main(void)
{
${START}
    // LED1 on GPIO22, off
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;

${PINS}

${spib({ phase: 1, char: "0xF" })}
    // Read register 0x75 (WHO_AM_I)
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0xF500;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    whoami = SpibRegs.SPIRXBUF;

    if (whoami == 0x0071) {
        GpioDataRegs.GPASET.bit.GPIO22 = 1;
    }

    while (1) {
    }
}
`,
      checks: [
        { kind: "var", name: "whoami", equals: 0x71, label: "whoami is 0x0071" },
        { kind: "led", led: "LED1", at: 1.5, on: true, label: "LED1 is on" },
        { kind: "no-diagnostic", code: "spi-mode", label: "The clock mode matches the device", hint: "The MPU-9250 reads on the rising edge. With the clock resting low that is the first edge: CLK_PHASE = 1." },
        { kind: "reg", reg: "SpibRegs.SPICCR", field: "SPICHAR", equals: 15, label: "Words are 16 bits long", hint: "With SPICHAR = 7 only the byte 0xF5 is sent. The device needs 8 more clock cycles to answer." },
      ],
      watch: ["whoami"],
      inspect: ["SpibRegs.SPICCR", "SpibRegs.SPICTL"],
      hints: [
        "The first message names one of the two settings. The other is the word length.",
        "CLK_PHASE must be 1: read on the first edge, the rising one.",
        "SPICHAR must be 0xF: 16 bits, so that the address byte and the answer byte are one transfer.",
      ],
      takeaway: "A wrong clock mode does not stop the transfer. Clock and data still move, and every bit is read half a cycle off. WHO_AM_I is how you notice.",
    },

    // ------------------------------------------------------------------ expert
    {
      id: "spi-setup-own",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "The whole set-up, from an empty function",
      goal: "Write every line of setupSpib(): pins, chip select, clock mode, bit rate, FIFOs, and the path of the receive interrupt.",
      refs: [{ course: "HW3" }, { trm: "18.4.2" }, { trm: "18.3.5" }, { trm: "18.3.6" }, { trm: "18.3.7" }, { trm: "3.4.5" }],
      brief: `
Until now the SPIB set-up was given. Here \`setupSpib()\` is empty and you write it, from this list. The two interrupt functions are given: every millisecond the timer sends one word, \`0xF500\`, that asks the chip on the bus (the MPU-9250, next chapter) for its identity number. If your set-up is right, \`answer\` becomes **0x0071**.

## In setupSpib(), in this order
1. **Chip select.** GPIO66: plain GPIO (\`GPIO_SetupPinMux(66, GPIO_MUX_CPU1, 0)\`), output (\`GPIO_SetupPinOptions(66, GPIO_OUTPUT, GPIO_PUSHPULL)\`), driven **high** with \`GPCSET\`.
2. **Pins.** GPIO63, 64 and 65 to mux position 15: SIMO, SOMI and clock of SPIB.
3. **Pin options**, TI's advice for SPI pins, between \`EALLOW;\` and \`EDIS;\`. Pull-ups on: \`GpioCtrlRegs.GPBPUD.bit.GPIO63 = 0;\`, and \`GPCPUD\` for GPIO64 and GPIO65. No input filter: \`GpioCtrlRegs.GPBQSEL2.bit.GPIO63 = 3;\`, and \`GPCQSEL1\` for GPIO64 and GPIO65.
4. **Hold the SPI in reset:** \`SPICCR.bit.SPISWRESET = 0\`.
5. **Mode:** \`SPICTL.bit.CLK_PHASE = 1\`, \`SPICCR.bit.CLKPOLARITY = 0\`, \`SPICTL.bit.MASTER_SLAVE = 1\`, \`SPICTL.bit.TALK = 1\`, \`SPIPRI.bit.FREE = 1\`, \`SPICTL.bit.SPIINTENA = 0\`.
6. **Numbers:** \`SPICCR.bit.SPICHAR\` for 16-bit words, \`SPIBRR.bit.SPI_BIT_RATE\` for 500 kHz.
7. **FIFOs:** in \`SPIFFTX\`: \`SPIRST = 1\`, \`SPIFFENA = 1\`, \`TXFIFO = 0\`, \`TXFFINTCLR = 1\`. In \`SPIFFRX\`: \`RXFIFORESET = 0\`, \`RXFFOVFCLR = 1\`, \`RXFFINTCLR = 1\`, \`RXFFIENA = 1\`. \`SPIFFCT.bit.TXDLY = 0\`.
8. **Release:** \`SPISWRESET = 1\`, then \`TXFIFO = 1\`, \`RXFIFORESET = 1\`, and \`RXFFIL = 16\`.

Steps 4 to 8 are registers of \`SpibRegs\`.

## In main()
The SPIB receive interrupt is **INT6.3**. Add its vector (\`PieVectTable.SPIB_RX_INT = &SPIB_isr;\`) and its two enables (\`PIEIER6\`, \`IER\`) at the two TODOs.
`,
      kit: "robot",
      durationMs: 6,
      starter: setupOwn({
        body: "    // TODO: steps 1 to 8 of the brief",
        vector: "    // TODO: the vector of the SPIB receive interrupt",
        enable: "    // TODO: enable SPIB receive (INT6.3) in the PIE and in IER",
      }),
      solution: setupOwn({
        body: `${PINS}

${spib({ brr: 99, rxffil: 16 })}`,
        vector: "    PieVectTable.SPIB_RX_INT = &SPIB_isr;",
        enable: `    PieCtrlRegs.PIEIER6.bit.INTx3 = 1;        // SPIB receive is INT6.3
    IER |= M_INT6;`,
      }),
      checks: [
        { kind: "pin", pin: 66, at: 0.5, level: 1, label: "1. The chip select rests high", hint: "Floating: GPIO66 is not an output yet. Low: the chip is selected all the time. Set it with GpioDataRegs.GPCSET.bit.GPIO66 = 1;" },
        { kind: "no-diagnostic", code: "spi-mux", label: "2. GPIO63, 64 and 65 are switched to SPIB", hint: "GPIO_SetupPinMux(63, GPIO_MUX_CPU1, 15); and the same for 64 and 65." },
        { kind: "no-diagnostic", code: "eallow", label: "3. The pin options are written between EALLOW; and EDIS;", hint: "GPxPUD and GPxQSEL are protected. The SpibRegs registers are not." },
        { kind: "reg", reg: "GpioCtrlRegs.GPCQSEL1", field: "GPIO64", equals: 3, label: "3. The SOMI input goes to the SPI unfiltered", hint: "GpioCtrlRegs.GPCQSEL1.bit.GPIO64 = 3; The input filter would delay the data against the clock." },
        { kind: "reg", reg: "SpibRegs.SPICTL", field: "CLK_PHASE", equals: 1, label: "5. Clock phase: data is read on the rising edge", hint: "SPICTL.CLK_PHASE = 1 with CLKPOLARITY = 0 is the course's mode." },
        { kind: "reg", reg: "SpibRegs.SPICCR", field: "CLKPOLARITY", equals: 0, label: "5. Clock polarity: the clock rests low", hint: "SPICCR.CLKPOLARITY = 0." },
        { kind: "reg", reg: "SpibRegs.SPICTL", field: "MASTER_SLAVE", equals: 1, label: "5. SPIB is the master", hint: "A slave waits for somebody else's clock and never sends by itself." },
        { kind: "reg", reg: "SpibRegs.SPICTL", field: "TALK", equals: 1, label: "5. SPIB drives its SIMO pin", hint: "With TALK = 0 the SIMO pin is switched off and the chip receives only 1s." },
        { kind: "reg", reg: "SpibRegs.SPICCR", field: "SPICHAR", equals: 15, label: "6. Words are 16 bits long", hint: "SPICHAR holds the number of bits minus 1. It has 4 bits, so writing 16 leaves 0 in it." },
        { kind: "reg", reg: "SpibRegs.SPIBRR", field: "SPI_BIT_RATE", equals: 99, label: "6. The bit rate is 500 kHz", hint: "bit rate = 50 MHz / (SPIBRR + 1)." },
        { kind: "reg", reg: "SpibRegs.SPIFFTX", field: "SPIFFENA", equals: 1, label: "7. The FIFOs are in use", hint: "SPIFFTX.SPIFFENA = 1. Without it RXFFST and RXFFIL mean nothing." },
        { kind: "reg", reg: "SpibRegs.SPIFFRX", field: "RXFFIENA", equals: 1, label: "7. The receive FIFO may raise an interrupt", hint: "SPIFFRX.RXFFIENA = 1 lets RXFFST >= RXFFIL reach the PIE." },
        { kind: "reg", reg: "SpibRegs.SPICCR", field: "SPISWRESET", equals: 1, label: "8. The SPI is released from reset", hint: "While SPISWRESET is 0 nothing is sent. It is the last line of the configuration." },
        { kind: "reg", reg: "SpibRegs.SPIFFTX", field: "TXFIFO", equals: 1, label: "8. The transmit FIFO is released", hint: "TXFIFO = 0 empties the FIFO and holds it. Words written to SPITXBUF are dropped until it is 1." },
        { kind: "reg", reg: "SpibRegs.SPIFFRX", field: "RXFIFORESET", equals: 1, label: "8. The receive FIFO is released", hint: "RXFIFORESET = 0 holds the receive FIFO empty: no word is ever counted in RXFFST." },
        { kind: "reg", reg: "PieCtrlRegs.PIEIER6", field: "INTx3", equals: 1, label: "main(): SPIB receive is enabled in the PIE", hint: "PieCtrlRegs.PIEIER6.bit.INTx3 = 1; and IER |= M_INT6;" },
        { kind: "isr", fn: "SPIB_isr", min: 5, max: 5, label: "SPIB_isr runs once per transfer (5 times in 6 ms)", hint: "Never, with the checks above green: IER |= M_INT6; is missing." },
        { kind: "var", name: "answer", equals: 0x71, label: "The chip answers 0x0071", hint: "0 or -1 means the chip did not understand the word. Fix the first red check above: each one is a way to garble it." },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported", hint: "The message names the line. A setting changed after SPISWRESET = 1 belongs before it." },
      ],
      watch: ["answer", "numTransfers"],
      inspect: ["SpibRegs.SPICCR", "SpibRegs.SPICTL", "SpibRegs.SPIBRR", "SpibRegs.SPIFFTX", "SpibRegs.SPIFFRX"],
      hints: [
        "Type the list top to bottom and run after each step. The checks carry the step numbers.",
        "SPICHAR = 0xF (16 - 1). SPI_BIT_RATE = 99 (50 MHz / 100 = 500 kHz). The reset bracket is SPISWRESET = 0 before step 5 and SPISWRESET = 1 after step 7.",
        "Open \"Talking to yourself\" next to this level: its set-up is the same block without loopback. In main(): `PieVectTable.SPIB_RX_INT = &SPIB_isr;` `PieCtrlRegs.PIEIER6.bit.INTx3 = 1;` `IER |= M_INT6;`",
      ],
      takeaway: "Chip select high, pins, reset, mode and numbers, FIFOs, release. A chip that answers its identity number proves all of it at once.",
    },
    {
      id: "spi-x-scratch",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "A set-up from its requirements",
      goal: "Set up SPIB for a different clock mode and bit rate from a list of requirements, with nothing given and no list of lines.",
      refs: [{ course: "HW3" }, { trm: "18.3.6" }, { trm: "18.3.5" }, { trm: "18.4.2" }, { trm: "18.3.7" }, { trm: "3.4.5" }],
      brief: `
Same board, same chip on the bus, other settings. This time you get requirements, not lines. The timer part is given: every 2 ms \`cpu_timer0_isr\` pulls the chip select low and sends \`0xF500\`, the question "which chip are you?". The answer is 0x0071.

## Requirements
- SPIB is the **master**, on GPIO63 (SIMO), GPIO64 (SOMI) and GPIO65 (clock). Chip select: GPIO66, low only during a transfer.
- **16-bit** words.
- Bit rate **400 kHz**. LSPCLK is 50 MHz.
- The clock **rests high**. The chip reads the data line on the **rising** edge.
- FIFOs on. The **receive interrupt** (INT6.3) comes as soon as the one-word answer is there, and runs \`SPIB_isr\`.
- \`SPIB_isr\` stores the word in \`answer\`, raises the chip select, counts in \`numTransfers\`, clears its flags and acknowledges.

## What you need to work out
- \`SPIBRR\` from the bit rate.
- The two clock bits. A clock that rests high makes its **first** edge a falling one. The chip reads on the rising edge, the **second**. So should the data go out half a cycle early (\`CLK_PHASE = 1\`) or not? "Clock polarity and phase: two questions" has the table.
- \`RXFFIL\`. The timer function does not set it here, so the set-up must.

Remember the order: chip select and pins, reset held, settings, FIFOs, reset released, FIFOs released. Every setting changed while the SPI is running is reported.
`,
      kit: "robot",
      durationMs: 9,
      starter: scratch({
        spib: "    // SPIB: yours",
        vector: "    // the SPIB receive vector: yours",
        enable: "    // the SPIB receive enables: yours",
        isr: "",
      }),
      solution: scratch({
        spib: SCRATCH_SPIB,
        vector: "    PieVectTable.SPIB_RX_INT = &SPIB_isr;",
        enable: `    PieCtrlRegs.PIEIER6.bit.INTx3 = 1;        // SPIB receive is INT6.3
    IER |= M_INT6;`,
        isr: `    answer = SpibRegs.SPIRXBUF;
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;       // chip select high
    numTransfers++;

    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;`,
      }),
      checks: [
        { kind: "pin", pin: 66, at: 1, level: 1, label: "The chip select rests high", hint: "GPIO66: plain GPIO, output, set high before the first transfer." },
        { kind: "no-diagnostic", code: "spi-mux", label: "GPIO63, 64 and 65 are switched to SPIB", hint: "Mux position 15 for all three." },
        { kind: "no-diagnostic", code: "eallow", label: "Every protected write is between EALLOW; and EDIS;", hint: "The pin option registers and the vector table are protected." },
        { kind: "reg", reg: "SpibRegs.SPICTL", field: "MASTER_SLAVE", equals: 1, label: "SPIB is the master", hint: "SPICTL.MASTER_SLAVE = 1." },
        { kind: "reg", reg: "SpibRegs.SPICTL", field: "TALK", equals: 1, label: "SPIB drives its SIMO pin", hint: "SPICTL.TALK = 1." },
        { kind: "reg", reg: "SpibRegs.SPICCR", field: "SPICHAR", equals: 15, label: "Words are 16 bits long", hint: "SPICHAR is the number of bits minus 1." },
        { kind: "reg", reg: "SpibRegs.SPIBRR", field: "SPI_BIT_RATE", equals: 124, label: "The bit rate is 400 kHz", hint: "50 MHz / (SPIBRR + 1) = 400 kHz, so SPIBRR + 1 = 125." },
        { kind: "reg", reg: "SpibRegs.SPICCR", field: "CLKPOLARITY", equals: 1, label: "The clock rests high", hint: "CLKPOLARITY is the level of the clock between words." },
        { kind: "pin", pin: 65, at: 1, level: 1, label: "GPIO65, the clock pin, is high between transfers", hint: "Floating: the SPI is still in reset, not the master, or GPIO65 is not switched to it." },
        {
          kind: "reg",
          reg: "SpibRegs.SPICTL",
          field: "CLK_PHASE",
          equals: 0,
          label: "Data is read on the rising edge, the second edge of each bit",
          hint: "With CLK_PHASE = 1 the data goes out half a cycle early and is read on the first edge, here the falling one. This chip needs the second: CLK_PHASE = 0.",
        },
        { kind: "reg", reg: "SpibRegs.SPIFFTX", field: "SPIFFENA", equals: 1, label: "The FIFOs are in use", hint: "SPIFFTX.SPIFFENA = 1, with SPIRST = 1." },
        { kind: "reg", reg: "SpibRegs.SPIFFRX", field: "RXFFIENA", equals: 1, label: "The receive FIFO may raise an interrupt", hint: "SPIFFRX.RXFFIENA = 1." },
        { kind: "reg", reg: "SpibRegs.SPIFFRX", field: "RXFFIL", equals: 1, label: "The interrupt comes after one word", hint: "RXFFIL is the number of words that make a complete answer. Its reset value, 31, is never reached." },
        { kind: "reg", reg: "SpibRegs.SPICCR", field: "SPISWRESET", equals: 1, label: "The SPI is released from reset", hint: "SPISWRESET = 1 after the configuration." },
        { kind: "reg", reg: "SpibRegs.SPIFFTX", field: "TXFIFO", equals: 1, label: "The transmit FIFO is released", hint: "SPIFFTX.TXFIFO = 1, or every word written is dropped." },
        { kind: "reg", reg: "SpibRegs.SPIFFRX", field: "RXFIFORESET", equals: 1, label: "The receive FIFO is released", hint: "SPIFFRX.RXFIFORESET = 1, or no word is ever counted." },
        { kind: "reg", reg: "PieCtrlRegs.PIEIER6", field: "INTx3", equals: 1, label: "SPIB receive is enabled in the PIE", hint: "INT6.3: PIEIER6.INTx3, and IER |= M_INT6." },
        { kind: "isr", fn: "SPIB_isr", min: 4, max: 4, label: "SPIB_isr runs once per transfer (4 times in 9 ms)", hint: "Never: the vector or IER |= M_INT6. Once, or hundreds of times: RXFFINTCLR or the group 6 acknowledge is missing, or the word was not read." },
        { kind: "var", name: "answer", equals: 0x71, label: "The chip answers 0x0071", hint: "A garbled answer with the checks above green: read SPIRXBUF once per transfer, and raise the chip select after it." },
        { kind: "pin", pin: 66, at: 5, level: 1, label: "The chip select is high again between transfers", hint: "Raise GPIO66 in SPIB_isr." },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported", hint: "The message names the cause. A setting changed after SPISWRESET = 1 belongs before it." },
      ],
      watch: ["answer", "numTransfers"],
      inspect: ["SpibRegs.SPICCR", "SpibRegs.SPICTL", "SpibRegs.SPIBRR", "SpibRegs.SPIFFTX", "SpibRegs.SPIFFRX"],
      hints: [
        "Write it in the order of the last sentence of the brief and run often. The first red check is the next thing to fix.",
        "SPIBRR = 124. Rests high: CLKPOLARITY = 1. Read on the second edge: CLK_PHASE = 0. RXFFIL = 1.",
        "The block is your setupSpib() from the level before with four numbers changed. SPIB_isr: read SPIRXBUF into answer, GPCSET GPIO66, numTransfers++, RXFFOVFCLR = 1, RXFFINTCLR = 1, PIEACK_GROUP6.",
      ],
      takeaway: "A device's requirements become four decisions: word length, bit rate, where the clock rests, which edge reads. Everything else in the block is the same every time.",
    },
    {
      id: "spi-bitbang",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "SPI by hand",
      goal: "Read registers of the MPU-9250 without the SPI module, by moving the clock and data pins yourself.",
      refs: [{ trm: "18.3.6" }, { trm: "18.3.1" }, { trm: "8.3" }, { course: "L10" }],
      brief: `
An SPI master is a shift register and a clock. You can be both. This is called **bit-banging**, and writing it once shows exactly what a clock mode is.

The pins are plain GPIOs here, already set up in \`main()\`: GPIO63 (SIMO) and GPIO65 (clock) are outputs, GPIO64 (SOMI) is an input, GPIO66 is the chip select. The clock starts at its rest level, low.

The MPU-9250 reads SIMO on every **rising** clock edge and changes SOMI on every **falling** edge. Its first output bit appears as soon as the chip select goes low. It must not be clocked faster than 1 MHz, so each half cycle must last at least 0.5 us: use \`DELAY_US(1);\`.

## Write spi_byte()
\`spi_byte(out)\` exchanges one byte, top bit first, and returns the byte received. For each of the 8 bits:

1. put the bit of \`out\` on SIMO, then wait half a cycle
2. raise the clock: the device reads your bit. Read the device's bit from SOMI now and shift it into the result
3. wait half a cycle, then lower the clock: the device moves on to its next bit

That is the course's mode done by hand: clock rests low, data read on the rising edge, changed on the falling edge.

## Then write mpu_read()
\`mpu_read(reg)\` reads one register of the MPU-9250: chip select low, \`spi_byte(0x80 | reg)\` (bit 7 set means "read"), then \`spi_byte(0x00)\` returns the register's value, chip select high.

\`main()\` uses it to read register 0x75 (WHO_AM_I, always 0x71) once, and then register 0x3F again and again: the upper byte of the Z acceleration. The test tips the board over after 1 ms, so that byte changes from 0x40 (+1 g) to 0xE0 (-0.5 g).

Do not touch \`SpibRegs\`.
`,
      kit: "robot",
      durationMs: 2,
      stimuli: [{ at: 1, set: "IMU_AZ_G", value: -0.5 }],
      starter: `uint16_t whoami = 0;
uint16_t az_high = 0;

// Exchanges one byte with the device, top bit first. Returns the byte received.
uint16_t spi_byte(uint16_t out)
{
    uint16_t in = 0;

    // TODO

    return in;
}

// Reads one register of the MPU-9250
uint16_t mpu_read(uint16_t reg)
{
    uint16_t value = 0;

    // TODO

    return value;
}

void main(void)
{
${START}
    // Chip select: GPIO66, high
    GPIO_SetupPinMux(66, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(66, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    // Data out: GPIO63
    GPIO_SetupPinMux(63, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(63, GPIO_OUTPUT, GPIO_PUSHPULL);
    // Clock: GPIO65, resting low
    GPIO_SetupPinMux(65, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(65, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPCCLEAR.bit.GPIO65 = 1;
    // Data in: GPIO64
    GPIO_SetupPinMux(64, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(64, GPIO_INPUT, GPIO_PULLUP);

    whoami = mpu_read(0x75);

    while (1) {
        az_high = mpu_read(0x3F);
        DELAY_US(100);
    }
}
`,
      solution: `uint16_t whoami = 0;
uint16_t az_high = 0;

// Exchanges one byte with the device, top bit first. Returns the byte received.
uint16_t spi_byte(uint16_t out)
{
    uint16_t in = 0;
    int16_t i;

    for (i = 7; i >= 0; i--) {
        if (out & (1 << i)) {
            GpioDataRegs.GPBSET.bit.GPIO63 = 1;
        } else {
            GpioDataRegs.GPBCLEAR.bit.GPIO63 = 1;
        }
        DELAY_US(1);
        GpioDataRegs.GPCSET.bit.GPIO65 = 1;      // rising edge: both sides read
        DELAY_US(1);
        in = (in << 1) | GpioDataRegs.GPCDAT.bit.GPIO64;
        GpioDataRegs.GPCCLEAR.bit.GPIO65 = 1;    // falling edge: the data changes
    }

    return in;
}

// Reads one register of the MPU-9250
uint16_t mpu_read(uint16_t reg)
{
    uint16_t value = 0;

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    spi_byte(0x80 | reg);
    value = spi_byte(0x00);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;

    return value;
}

void main(void)
{
${START}
    // Chip select: GPIO66, high
    GPIO_SetupPinMux(66, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(66, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    // Data out: GPIO63
    GPIO_SetupPinMux(63, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(63, GPIO_OUTPUT, GPIO_PUSHPULL);
    // Clock: GPIO65, resting low
    GPIO_SetupPinMux(65, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(65, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPCCLEAR.bit.GPIO65 = 1;
    // Data in: GPIO64
    GPIO_SetupPinMux(64, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(64, GPIO_INPUT, GPIO_PULLUP);

    whoami = mpu_read(0x75);

    while (1) {
        az_high = mpu_read(0x3F);
        DELAY_US(100);
    }
}
`,
      checks: [
        { kind: "var", name: "whoami", equals: 0x71, label: "whoami is 0x71", hint: "0xE2 or 0x38 means the bits are read at the wrong moment: read SOMI while the clock is high, before the falling edge." },
        { kind: "var", name: "az_high", at: 0.95, equals: 0x40, label: "Lying flat: the upper byte of the Z acceleration is 0x40", hint: "The chip select must go high after every register read, or the device takes the next byte as more data, not as a new address." },
        { kind: "var", name: "az_high", equals: 0xe0, label: "Tipped over: the byte changes to 0xE0" },
        { kind: "no-diagnostic", code: "mpu", label: "The clock is not faster than 1 MHz", hint: "Wait with DELAY_US(1) before the rising edge and again before the falling edge." },
        { kind: "source", mustNotMatch: "SpibRegs", label: "The SPI module is not used" },
      ],
      watch: ["whoami", "az_high"],
      hints: [
        "Loop i from 7 down to 0. `out & (1 << i)` tells you whether bit i is 1.",
        "Order inside the loop: set SIMO, wait, clock high, wait, read SOMI, clock low. SOMI is `GpioDataRegs.GPCDAT.bit.GPIO64`.",
        "Collect the input with `in = (in << 1) | GpioDataRegs.GPCDAT.bit.GPIO64;`. In mpu_read: GPCCLEAR GPIO66, `spi_byte(0x80 | reg);`, `value = spi_byte(0x00);`, GPCSET GPIO66.",
      ],
      takeaway: "Set the data, clock edge to read, clock edge to change. The SPI module does nothing else, only faster and with a FIFO.",
    },
    {
      id: "spi-nofifo",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "No FIFO, no waiting",
      goal: "Send a six-word message without the FIFOs, one word per interrupt, and collect the six replies.",
      refs: [{ trm: "18.3.2" }, { trm: "18.2.3" }, { trm: "18.5.2" }],
      brief: `
Without the FIFOs the SPI has room for one word in \`SPITXBUF\` and one in \`SPIRXBUF\`. This is how the module works after reset, and how small microcontrollers without FIFOs always work. You have to feed it word by word.

In this mode (manual section 18.3.2 and Table 18-2):

- writing \`SPITXBUF\` while nothing is being sent starts a word at once
- when the word is complete, the received word is in \`SPIRXBUF\` and \`SPISTS.bit.INT_FLAG\` is set
- if \`SPICTL.bit.SPIINTENA\` is 1, that flag raises the **same** interrupt as before: SPIB_RX, INT6.3
- reading \`SPIRXBUF\` clears the flag. If a second word completes before the first was read, the first is lost and \`SPISTS.bit.OVERRUN_FLAG\` is set

SPIB is set up in loopback **without** the FIFOs. \`SPIINTENA\` is still 0.

## Your task
Send the six words of \`message[]\`, in order, and store the replies in \`reply[]\`:

- In \`main()\`: enable the SPI interrupt, pull the chip select (GPIO66) low and send the first word. Nothing else. No loops that wait.
- In \`SPIB_isr\`: store the received word. If words remain, send the next one. After the last one raise the chip select and set \`done = 1\`.

\`checksum\` is filled in for you in the \`while (1)\` loop once \`done\` is 1. It must come out as the sum of the six words.
`,
      kit: "robot",
      durationMs: 2,
      starter: `__interrupt void SPIB_isr(void);

uint16_t message[6] = { 0x00A5, 0x1111, 0x2222, 0x4444, 0x8888, 0xF00D };
uint16_t reply[6];
uint16_t index = 0;
uint16_t done = 0;
uint16_t checksum = 0;

void main(void)
{
    uint16_t i;
${START}
${PINS}

${spib({ loopback: true, fifo: false })}
${PIE_INIT}

    EALLOW;
    PieVectTable.SPIB_RX_INT = &SPIB_isr;
    EDIS;
    PieCtrlRegs.PIEIER6.bit.INTx3 = 1;        // SPIB receive is INT6.3
    IER |= M_INT6;
    EINT;

    // TODO: enable the SPI interrupt, select the device, send the first word

    while (1) {
        if (done == 1 && checksum == 0) {
            for (i = 0; i < 6; i++) {
                checksum += reply[i];
            }
        }
    }
}

__interrupt void SPIB_isr(void)
{
    // TODO

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}
`,
      solution: `__interrupt void SPIB_isr(void);

uint16_t message[6] = { 0x00A5, 0x1111, 0x2222, 0x4444, 0x8888, 0xF00D };
uint16_t reply[6];
uint16_t index = 0;
uint16_t done = 0;
uint16_t checksum = 0;

void main(void)
{
    uint16_t i;
${START}
${PINS}

${spib({ loopback: true, fifo: false })}
${PIE_INIT}

    EALLOW;
    PieVectTable.SPIB_RX_INT = &SPIB_isr;
    EDIS;
    PieCtrlRegs.PIEIER6.bit.INTx3 = 1;        // SPIB receive is INT6.3
    IER |= M_INT6;
    EINT;

    SpibRegs.SPICTL.bit.SPIINTENA = 1;
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = message[0];

    while (1) {
        if (done == 1 && checksum == 0) {
            for (i = 0; i < 6; i++) {
                checksum += reply[i];
            }
        }
    }
}

__interrupt void SPIB_isr(void)
{
    reply[index] = SpibRegs.SPIRXBUF;
    index++;
    if (index < 6) {
        SpibRegs.SPITXBUF = message[index];
    } else {
        GpioDataRegs.GPCSET.bit.GPIO66 = 1;
        done = 1;
    }

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}
`,
      checks: [
        { kind: "signal", name: "SPIB_WORDS", equals: 6, label: "Six words are sent" },
        { kind: "isr", fn: "SPIB_isr", min: 6, max: 6, label: "SPIB_isr runs once per word", hint: "It needs SPICTL.bit.SPIINTENA = 1, and it must read SPIRXBUF each time: that clears INT_FLAG." },
        { kind: "var", name: "checksum", equals: (0x00a5 + 0x1111 + 0x2222 + 0x4444 + 0x8888 + 0xf00d) & 0xffff, label: "The six replies add up to the right checksum" },
        { kind: "var", name: "done", equals: 1, label: "done is 1" },
        { kind: "reg", reg: "SpibRegs.SPISTS", field: "OVERRUN_FLAG", equals: 0, label: "No received word was overwritten" },
        { kind: "reg", reg: "SpibRegs.SPIFFTX", field: "SPIFFENA", equals: 0, label: "The FIFOs are still off" },
        { kind: "pin", pin: 66, at: 0.09, level: 0, label: "The chip select is low during the message", hint: "The six words take 192 us. The chip select must stay low for all of them." },
        { kind: "pin", pin: 66, at: 1.5, level: 1, label: "The chip select is high after the message" },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported", hint: "Writing SPITXBUF twice in a row without the FIFO overwrites the first word. Send the next word only after the previous one has come back." },
      ],
      bonus: [{ kind: "isr-time", fn: "SPIB_isr", maxUs: 1, label: "SPIB_isr takes at most 1 us" }],
      watch: ["index", "done", "checksum"],
      inspect: ["SpibRegs.SPISTS", "SpibRegs.SPICTL"],
      hints: [
        "main() sends only message[0]. Every later word is sent by the interrupt that the previous word causes.",
        "In SPIB_isr: `reply[index] = SpibRegs.SPIRXBUF; index++;` then decide between sending message[index] and finishing.",
        "The chip select goes high and done becomes 1 in the branch where index has reached 6.",
      ],
      takeaway: "Each completed word triggers the next. The FIFO does the same queueing in hardware, which is why the course switches it on.",
    },
  ],
};
