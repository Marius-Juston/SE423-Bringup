import type { Chapter } from "../types";

// ---- C building blocks --------------------------------------------------------
// SPIB is set up by the course library: setupSpib() and enableSpibInterrupt()
// (src/sim/plugins/spi.ts). Writing that set-up is graded work in HW3, so no
// level prints it. The library sets up the port only: the MPU-9250 keeps its
// power-on settings until a level writes its registers.
const START = `    InitSysCtrl();
    InitGpio();
`;

const LED1 = `    // LED1 on GPIO22, off
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
`;

/** SPIB for both chips: the DAN28027's chip select held high, then the library's set-up. */
const SPIB = `    // GPIO29 is the chip select of the DAN28027, the other chip on this bus: held high
    GPIO_SetupPinMux(29, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(29, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPASET.bit.GPIO29 = 1;

    // Course library: SPIB with 16-bit words at 1 MHz, clock resting low, data read on
    // the rising edge, FIFOs on. GPIO66, the MPU-9250's chip select, is set high.
    setupSpib();
`;

const PIE_INIT = `    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();`;

/** Timer 0 every millisecond and the SPIB receive interrupt, then interrupts on. */
const VECTORS = (extra = "") => `    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    PieVectTable.SPIB_RX_INT = &SPIB_isr;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, 1000);    // every 1 ms
    CpuTimer0Regs.TCR.all = 0x4000;
${extra}
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;        // timer 0 is INT1.7
    IER |= M_INT1;
    enableSpibInterrupt();                    // course library: SPIB receive, in the PIE and in IER
    EINT;`;

const MPU_WRITE = `// Given (you wrote it in "Choosing the range"): writes one register of the MPU-9250
void mpu_write(uint16_t reg, uint16_t value)
{
    uint16_t temp;

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (reg << 8) | value;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    temp = SpibRegs.SPIRXBUF;
    DELAY_US(10);
}
`;

const MPU_READ = `// Given (you wrote it in "First contact"): reads one register of the MPU-9250
uint16_t mpu_read(uint16_t reg)
{
    uint16_t value;

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0x8000 | (reg << 8);
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    value = SpibRegs.SPIRXBUF & 0x00FF;
    DELAY_US(10);

    return value;
}
`;

/** The ranges the course selects: gyro +-250 deg/s, accelerometer +-4 g. */
const MPU_RANGES = `    mpu_write(0x1B, 0x00);                    // GYRO_CONFIG: +-250 deg/s
    mpu_write(0x1C, 0x08);                    // ACCEL_CONFIG: +-4 g
`;

// ---- imu-setup: the student configures the MPU-9250 from its register map ----
const imuSetup = (o: { gyro: string; accel: string; body: string }) => `// Given functions, written out below main(). These three lines only announce them.
void mpu_write(uint16_t reg, uint16_t value);
uint16_t mpu_read(uint16_t reg);
void measure(void);

float gyro_range = ${o.gyro}
float accel_range = ${o.accel}

uint16_t cfg19 = 0;
uint16_t cfg1a = 0;
uint16_t cfg1b = 0;
uint16_t cfg1c = 0;
float gyroz = 0;              // degrees per second
float accelz = 0;             // g

// Configures the MPU-9250 for this robot
void setup_mpu(void)
{
${o.body}
}

void main(void)
{
${START}
${SPIB}
    setup_mpu();

    cfg19 = mpu_read(0x19);
    cfg1a = mpu_read(0x1A);
    cfg1b = mpu_read(0x1B);
    cfg1c = mpu_read(0x1C);

    while (1) {
        measure();
        DELAY_US(200);
    }
}

${MPU_WRITE}
${MPU_READ}
// Given: reads the Z turn rate and the Z acceleration and converts them with the two ranges
void measure(void)
{
    int16_t temp;
    int16_t raw;

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0x8000 | 0x4600;      // 0x46, then 0x47 and 0x48: gyro Z
    SpibRegs.SPITXBUF = 0x0000;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 2);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    temp = SpibRegs.SPIRXBUF;
    raw = SpibRegs.SPIRXBUF;
    gyroz = raw * gyro_range / 32767.0;
    DELAY_US(10);

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0x8000 | 0x3E00;      // 0x3E, then 0x3F and 0x40: acceleration Z
    SpibRegs.SPITXBUF = 0x0000;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 2);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    temp = SpibRegs.SPIRXBUF;
    raw = SpibRegs.SPIRXBUF;
    accelz = raw * accel_range / 32767.0;
    DELAY_US(10);
}
`;

// ---- imu-configure: the configuration block in one transfer, as the addendum writes it ----
const imuConfigure = (body: string) => `// Given functions, written out below main(). These three lines only announce them.
void mpu_write(uint16_t reg, uint16_t value);
uint16_t mpu_read(uint16_t reg);
void measure(void);

uint16_t r19 = 0;
uint16_t r1a = 0;
uint16_t r1b = 0;
uint16_t r1c = 0;
uint16_t r1d = 0;
float gyroz = 0;              // degrees per second
float accelz = 0;             // g

// Configures the MPU-9250: registers 0x19 to 0x1D in one transfer
void setup_mpu(void)
{
    uint16_t temp;

${body}
}

void main(void)
{
${START}
${SPIB}
    setup_mpu();
    mpu_write(0x6B, 0x01);                    // PWR_MGMT_1: awake, best clock (its power-up value)

    r19 = mpu_read(0x19);
    r1a = mpu_read(0x1A);
    r1b = mpu_read(0x1B);
    r1c = mpu_read(0x1C);
    r1d = mpu_read(0x1D);

    while (1) {
        measure();
        DELAY_US(200);
    }
}

${MPU_WRITE}
${MPU_READ}
// Given: reads the Z turn rate and the Z acceleration for the ranges +-2000 deg/s and +-8 g
void measure(void)
{
    int16_t temp;
    int16_t raw;

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0x8000 | 0x4600;      // 0x46, then 0x47 and 0x48: gyro Z
    SpibRegs.SPITXBUF = 0x0000;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 2);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    temp = SpibRegs.SPIRXBUF;
    raw = SpibRegs.SPIRXBUF;
    gyroz = raw * 2000.0 / 32767.0;
    DELAY_US(10);

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0x8000 | 0x3E00;      // 0x3E, then 0x3F and 0x40: acceleration Z
    SpibRegs.SPITXBUF = 0x0000;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 2);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    temp = SpibRegs.SPIRXBUF;
    raw = SpibRegs.SPIRXBUF;
    accelz = raw * 8.0 / 32767.0;
    DELAY_US(10);
}
`;

// ---- imu-noise: a real part, with an offset and noise ----
const imuNoise = (body: string) => `// Given function, written out below main(). This line only announces it.
float read_gz(void);

float offset = 0;             // degrees per second: what this gyro reads at rest
float gyroz = 0;              // degrees per second, with the offset taken out

// Measures the gyro's offset while the robot stands still
void calibrate(void)
{
${body}
}

void main(void)
{
${START}
${SPIB}
    calibrate();

    while (1) {
        gyroz = read_gz() - offset;
        DELAY_US(1000);
    }
}

// Given: one reading of gyro Z in degrees per second (range +-250)
float read_gz(void)
{
    int16_t temp;
    int16_t raw;

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0x8000 | 0x4600;      // 0x46, then 0x47 and 0x48: gyro Z
    SpibRegs.SPITXBUF = 0x0000;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 2);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    temp = SpibRegs.SPIRXBUF;
    raw = SpibRegs.SPIRXBUF;
    DELAY_US(10);

    return raw * 250.0 / 32767.0;
}
`;

export const ch13: Chapter = {
  id: "spi-devices",
  number: 13,
  title: "SPI devices",
  blurb: "Ask the MPU-9250 for its gyro and accelerometer, and share the port with the DAN28027.",
  requires: ["spi"],
  course: ["L12", "HW3", "Lab 4"],
  levels: [
    {
      id: "imu-brief",
      kind: "brief",
      title: "Registers behind a serial port",
      goal: "Learn how the MPU-9250's registers are read and written over SPI, then answer three questions.",
      refs: [
        { course: "L12", slide: [31, 36, 30] },
        { course: "HW3" },
        { course: "MPU-9250 addendum", note: "product specification 7.5 and 9.1: the SPI rules and the axes; then the timing diagrams" },
        { trm: "18.3.1" },
      ],
      brief: `
The **MPU-9250** on the robot is an **IMU** (inertial measurement unit). Its gyroscope measures how fast the board turns, in degrees per second. Its accelerometer measures acceleration in **g**: 1 g is the pull of gravity, so a board lying still reads 1 g. Each measures along three **axes**: directions at right angles, called X, Y and Z. In this game the chip lies flat: X to the robot's nose, Y to its left, Z up. A turn to the left is a positive rate about Z, the axis the robot uses to know how far it has turned.

SPI only moves bits. What they **mean** is in each device's datasheet. Seen from the bus, the MPU-9250 is a list of 8-bit **registers**, each with a 7-bit address.

## One transfer
A transfer starts when the chip select (GPIO66) goes low and ends when it goes high.

- The **first byte** the master sends is the address byte: bit 7 is **1 to read, 0 to write**, bits 6 to 0 are the register address.
- Every **following byte** is data. Writing: the master sends the value. Reading: the master sends zeros and the device answers with the register's value.
- After each data byte the device **adds one to the address**. So one transfer can read or write a run of registers: a **burst**.

## With 16-bit words
The course sends 16-bit words, so each word is two of those bytes:

- **Write** 0x10 to register 0x1C: send \`0x1C10\`.
- **Read** register 0x75: send \`0x8000 | 0x7500\` = \`0xF500\`. The upper byte of the word that comes back means nothing. The **lower byte is the register's value**.
- A second word in the same transfer covers the **next two** registers.

Build the words in the figure, then add words to see a burst.

{{figure:imu-word}}

## Registers you will use
- **0x75 WHO_AM_I**: always reads 0x71.
- **0x1B GYRO_CONFIG**, **0x1C ACCEL_CONFIG**: the measuring ranges. The course selects +-250 degrees per second and +-4 g.
- **0x3B to 0x48**: the measurements, each a signed 16-bit number (an \`int16_t\`) in two registers, **high byte first**: accelerometer X, Y, Z (0x3B to 0x40), the chip's **temperature** (0x41, 0x42), gyro X, Y, Z (0x43 to 0x48).

## From raw numbers to units
The chip reports a **raw** number: a count from -32768 to 32767, not yet in any unit. The largest count, 32767, stands for the selected range (**full scale**). The course converts with \`raw * 250.0 / 32767.0\` (degrees per second) and \`raw * 4.0 / 32767.0\` (g).
`,
      questions: [
        {
          prompt: "Which 16-bit word **reads** register 0x3B?",
          options: ["`0x3B00`", "`0xBB00`", "`0x003B`", "`0x3B80`"],
          answer: 1,
          why: "The address goes in the upper byte with bit 7 set for a read: 0x80 | 0x3B = 0xBB, so the word is 0xBB00. 0x3B00 would write 0 to the register.",
        },
        {
          prompt: "The master sends `0xF500`, then `0x0000`, with the chip select low the whole time. What is in the second word received?",
          options: [
            "Register 0x75 again, twice",
            "Registers 0x76 and 0x77",
            "Registers 0x75 and 0x76",
            "Nothing useful: a transfer is one word",
          ],
          answer: 1,
          why: "The first word holds the address byte and register 0x75. The address counts up after every data byte, so the next two bytes are registers 0x76 and 0x77.",
        },
        {
          prompt: "Which measurement sits between accelerometer Z and gyro X in the register list?",
          options: ["Nothing, gyro X follows directly", "The magnetometer", "The temperature", "The status register"],
          answer: 2,
          why: "0x41 and 0x42 hold the temperature. A burst read that runs from the accelerometer to the gyro passes over it, and the program must skip that word.",
        },
      ],
      takeaway: "Address byte first, bit 7 set to read, then data bytes with the address counting up. Sixteen-bit words carry two bytes each.",
    },
    {
      id: "imu-words",
      kind: "calc",
      title: "Building the words",
      goal: "Work out the words to send, the number of words in a burst, and what the raw numbers mean.",
      refs: [{ course: "L12", slide: [31, 39, 30] }, { course: "HW3" }, { trm: "18.3.4" }],
      brief: `
Before writing code, build the numbers by hand. Each 16-bit word is two bytes: the first word of a transfer is **address byte, then one data byte**; every later word is **two data bytes**.

## The alignment trick
HW3 reads gyro Z this way. Gyro Z is in registers **0x47** (high byte) and **0x48** (low byte). You want both in **one** received word, so that the word is the reading.

If the read started at 0x47, the first word would hold [address, 0x47] and the second [0x48, 0x49]: the reading would be split over two words. So start **one register earlier**, at 0x46 (the low byte of gyro Y). Then the first word is [address, 0x46], which you throw away, and the second word is [0x47, 0x48]: exactly gyro Z.

The same reasoning tells you where to start a burst that reads everything.

## Counting words
A burst that touches N registers needs N + 1 bytes: the address byte plus N data bytes. Divide by 2 for the number of 16-bit words. If N + 1 is odd, start one register earlier or write one register more.

Example: the gyro Z read above touches 0x46, 0x47 and 0x48. That is 3 registers (count both ends: 0x48 - 0x46 + 1), so 4 bytes, so 2 words.

## Raw number and unit
value = raw * range / 32767, and turned around, raw = value * 32767 / range. Example with the +-250 range: 25 degrees per second is 25 * 32767 / 250 = 3277 counts.
`,
      fields: [
        {
          id: "who",
          label: "Word that reads WHO_AM_I (0x75)",
          format: "hex",
          answer: 0xf500,
          why: "0x8000 | 0x7500: read bit set, address 0x75 in the upper byte, zeros below while the device answers.",
        },
        {
          id: "wr",
          label: "Word that writes 0x10 to ACCEL_CONFIG (0x1C)",
          format: "hex",
          answer: 0x1c10,
          why: "Bit 7 of the address byte is 0 for a write: 0x1C in the upper byte, the value 0x10 in the lower byte.",
        },
        {
          id: "gz",
          label: "First word of the two-word read that puts gyro X (0x43, 0x44) in the second word",
          format: "hex",
          answer: 0xc200,
          why: "Start at 0x42, one before the high byte of gyro X: 0x8000 | 0x4200 = 0xC200. The first word received holds nothing you need (the low byte of the temperature): throw it away.",
        },
        {
          id: "n",
          label: "16-bit words in a burst that reads registers 0x3E to 0x48",
          answer: 6,
          why: "0x3E to 0x48 is 11 registers, plus the address byte: 12 bytes = 6 words. Starting at 0x3E, an even address, puts accelerometer Z, the temperature and the three gyro axes each in one word.",
        },
        {
          id: "raw",
          label: "Raw gyro reading for +100 degrees per second (range +-250)",
          answer: 13107,
          tolPct: 0.05,
          why: "100 / 250 of full scale: 0.4 x 32768 = 13107.",
        },
        {
          id: "dps",
          label: "Turn rate for a raw gyro reading of -16384 (range +-250)",
          unit: "deg/s",
          answer: -125,
          tolPct: 0.05,
          why: "-16384 is half of negative full scale: -125 degrees per second. In code: -16384 * 250.0 / 32767.0.",
        },
      ],
      hints: [
        "Read: 0x8000 | (address << 8). Write: (address << 8) | value.",
        "Count the registers from 0x3E to 0x48 inclusive (0x48 - 0x3E = 10, plus 1), add the address byte, divide by two.",
        "Full scale, 250 degrees per second, is 32768 counts (32767 in the course's formula).",
      ],
      takeaway: "Start a 16-bit read one register before the value you want, and every 16-bit measurement arrives as one whole word.",
    },
    {
      id: "imu-order",
      kind: "order",
      title: "One transfer, step by step",
      goal: "Put the steps of reading one MPU-9250 register in order.",
      refs: [{ course: "L12", slide: 34 }, { course: "HW3" }, { trm: "18.3.7" }, { trm: "18.3.2" }],
      brief: `
The course's set-up code talks to the MPU-9250 by **polling**: it starts a transfer and waits in an empty loop until the reply is there. That is fine before the interrupts are switched on, and it shows every step of a transfer.

Order the steps of reading the WHO_AM_I register (0x75). Think about what the device needs: it only listens while its chip select is low, the transfer takes 16 us after you start it, and the chip select must stay low until the last bit has been shifted.
`,
      steps: [
        "GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;  (chip select low: the MPU-9250 starts listening)",
        "SpibRegs.SPITXBUF = 0x8000 | 0x7500;  (queue the word: the SPI starts shifting it out)",
        "while (SpibRegs.SPIFFRX.bit.RXFFST != 1);  (wait until the 16 clock cycles are over and one word has arrived)",
        "GpioDataRegs.GPCSET.bit.GPIO66 = 1;  (chip select high: the transfer is over)",
        "whoami = SpibRegs.SPIRXBUF & 0x00FF;  (take the word out of the FIFO, keep the data byte)",
        "DELAY_US(10);  (give the device a moment before the next transfer)",
      ],
      hints: [
        "The chip select frames the transfer: it goes low first of all the SPI steps and high once the word is complete.",
        "Writing SPITXBUF only starts the transfer. The program must wait before it raises the chip select.",
        "Chip select low, write SPITXBUF, wait for RXFFST, chip select high, read SPIRXBUF, pause.",
      ],
      takeaway: "Writing SPITXBUF returns at once, 16 us before the word is done. Raising the chip select right after it cuts the transfer off.",
    },
    {
      id: "imu-whoami",
      kind: "code",
      mode: "complete",
      title: "First contact",
      goal: "Complete the function that reads one MPU-9250 register, and use it to check the chip's identity.",
      refs: [{ course: "L12", slide: [31, 34] }, { course: "HW3" }, { trm: "18.3.7" }],
      brief: `
SPIB is set up by the course library's \`setupSpib()\`, as in the SPI chapter: 16-bit words, 1 MHz, clock resting low, data read on the rising edge. Writing that set-up yourself is part of HW3. GPIO66 is the MPU-9250's chip select.

Complete \`mpu_read(reg)\`. It reads one register and returns its 8-bit value:

1. chip select low
2. send one word: read bit (\`0x8000\`), the register address in the upper byte (\`reg << 8\`), zeros in the lower byte
3. wait until one word has arrived
4. chip select high
5. read the word from \`SPIRXBUF\` and keep its lower byte (\`& 0x00FF\`)

\`main()\` then reads two registers whose values are known:

- **0x75 WHO_AM_I** must be 0x71
- **0x6B PWR_MGMT_1** is 0x01 after power-up: the chip is awake and uses its best clock

and switches LED1 on if the identity is right.
`,
      kit: "robot",
      durationMs: 2,
      starter: `uint16_t whoami = 0;
uint16_t pwr = 0;

// Reads one register of the MPU-9250
uint16_t mpu_read(uint16_t reg)
{
    uint16_t value = 0;

    // TODO 1: chip select (GPIO66) low

    // TODO 2: send the word that reads register reg

    // TODO 3: wait until one word has been received

    // TODO 4: chip select high

    // TODO 5: read the word, keep the lower byte in value

    DELAY_US(10);

    return value;
}

void main(void)
{
${START}
${LED1}
${SPIB}
    whoami = mpu_read(0x75);
    pwr = mpu_read(0x6B);

    if (whoami == 0x71) {
        GpioDataRegs.GPASET.bit.GPIO22 = 1;
    }

    while (1) {
    }
}
`,
      solution: `uint16_t whoami = 0;
uint16_t pwr = 0;

// Reads one register of the MPU-9250
uint16_t mpu_read(uint16_t reg)
{
    uint16_t value = 0;

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;

    SpibRegs.SPITXBUF = 0x8000 | (reg << 8);

    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);

    GpioDataRegs.GPCSET.bit.GPIO66 = 1;

    value = SpibRegs.SPIRXBUF & 0x00FF;

    DELAY_US(10);

    return value;
}

void main(void)
{
${START}
${LED1}
${SPIB}
    whoami = mpu_read(0x75);
    pwr = mpu_read(0x6B);

    if (whoami == 0x71) {
        GpioDataRegs.GPASET.bit.GPIO22 = 1;
    }

    while (1) {
    }
}
`,
      checks: [
        { kind: "var", name: "whoami", equals: 0x71, label: "whoami is 0x71", hint: "0xFFFF or 0xFF (255) means no device answered: pull the chip select low before the word is sent and keep it low until the word has arrived. 0 means the device did not understand a read: the read bit 0x8000 is missing, the address is not in the upper byte (reg << 8), or SPIRXBUF was read before the word arrived." },
        { kind: "var", name: "pwr", equals: 0x01, label: "pwr (register 0x6B) is 0x01" },
        { kind: "led", led: "LED1", at: 1.5, on: true, label: "LED1 is on" },
        { kind: "pin", pin: 66, at: 1.5, level: 1, label: "The chip select is high after the transfers" },
        { kind: "signal", name: "SPIB_WORDS", equals: 2, label: "One word is sent per register read" },
        { kind: "reg", reg: "SpibRegs.SPIFFRX", field: "RXFFST", equals: 0, label: "The receive FIFO is empty at the end" },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported", hint: "The chip select must stay low until the word has been received." },
      ],
      watch: ["whoami", "pwr"],
      inspect: ["SpibRegs.SPIFFRX"],
      hints: [
        "The five steps are the ones you ordered in the previous level.",
        "The word is `0x8000 | (reg << 8)`. For reg = 0x75 that is 0xF500.",
        "`GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;` `SpibRegs.SPITXBUF = 0x8000 | (reg << 8);` `while (SpibRegs.SPIFFRX.bit.RXFFST != 1);` `GpioDataRegs.GPCSET.bit.GPIO66 = 1;` `value = SpibRegs.SPIRXBUF & 0x00FF;`",
      ],
      takeaway: "If WHO_AM_I reads 0x71, the wiring, the clock mode, the word length and the chip select are all right. Always read it first.",
    },
    {
      id: "imu-regmap",
      kind: "calc",
      title: "Reading the register map",
      goal: "Look up addresses, bit fields and reset values in the MPU-9250's register map, and turn a setting into the byte to write.",
      refs: [
        { course: "L12", slide: [32, 29], note: "the register map table: address, read or write, high and low bytes" },
        { course: "MPU-9250 register map", note: "section 3 (the table of all registers), sections 4.4 to 4.8 and 4.34" },
        { course: "HW3" },
      ],
      brief: `
Every number you send to the MPU-9250 comes from one document: its **register map**, the list of all its registers and what each bit does. HW3 asks you to explain register values from it, so learn to read a page before you need one.

## How it is laid out
Section 3 is one table of all registers: address, name, whether you can write it, and its eight bits. Section 4 has a page per register. The page titles count in **decimal**: "4.6 Register 27" is address 0x1B, because 27 = 16 + 11.

## A worked look-up: GYRO_CONFIG
\`\`\`c
4.6 Register 27 - Gyroscope Configuration
    R/W        Reset value: 0x00
bits 7..5  self-test, one bit per axis
bits 4..3  GYRO_FS_SEL
           00 = +-250     01 = +-500
           10 = +-1000    11 = +-2000 dps
bit  2     reserved
bits 1..0  Fchoice_b: leave at 00, then
           the filter in CONFIG is used
\`\`\`

Four facts are on that page:

- **Address**: 27, so 0x1B.
- **R/W**: it can be written and read back.
- **Reset value** 0x00: what it holds after power-up. Every field is 0, so the range is +-250 dps until you change it.
- **Fields**: GYRO_FS_SEL sits in bits 4 and 3. For +-2000 the field is binary 11 = 3. Its lowest bit is bit 3, so the byte is \`3 << 3\` = 0x18. All other fields stay 0.

## The pages for this level
\`\`\`c
Register 25   SMPLRT_DIV      reset 0x00
  samples per second =
  1000 / (1 + SMPLRT_DIV)
  (while a filter code 1 to 6 is set)
Register 26   CONFIG          reset 0x00
  bits 2..0   DLPF_CFG, the gyro's filter
  1 = 184 Hz   2 = 92 Hz   3 = 41 Hz
  4 = 20 Hz    5 = 10 Hz   6 = 5 Hz
Register 28   ACCEL_CONFIG    reset 0x00
  bits 4..3   ACCEL_FS_SEL
  00 = +-2 g   01 = +-4 g
  10 = +-8 g   11 = +-16 g
Register 29   ACCEL_CONFIG2   reset 0x00
  bits 2..0   A_DLPFCFG, its filter:
  same codes as DLPF_CFG
Register 107  PWR_MGMT_1      reset 0x01
  bit 6       SLEEP
  bits 2..0   CLKSEL (1 = best clock)
\`\`\`

A **filter** here smooths the readings: a lower frequency gives a calmer number that follows a change later.
`,
      fields: [
        {
          id: "a29",
          label: "Address of ACCEL_CONFIG2 (register 29), in hex",
          format: "hex",
          answer: 0x1d,
          why: "29 = 16 + 13, and 13 is the hex digit D: 0x1D. It follows ACCEL_CONFIG at 0x1C.",
        },
        {
          id: "a107",
          label: "Address of PWR_MGMT_1 (register 107), in hex",
          format: "hex",
          answer: 0x6b,
          why: "107 = 6 x 16 + 11, and 11 is the hex digit B: 0x6B.",
        },
        {
          id: "gfs",
          label: "Byte to write to GYRO_CONFIG for +-1000 dps",
          format: "hex",
          answer: 0x10,
          why: "The field value is binary 10 = 2. The field starts at bit 3: 2 << 3 = 0x10.",
        },
        {
          id: "afs",
          label: "Byte to write to ACCEL_CONFIG for +-16 g",
          format: "hex",
          answer: 0x18,
          why: "Field value binary 11 = 3, shifted to bit 3: 3 << 3 = 0x18.",
        },
        {
          id: "lpf",
          label: "Byte to write to ACCEL_CONFIG2 for a 10 Hz filter",
          format: "hex",
          answer: 0x05,
          why: "The code in front of 10 Hz is 5. The field starts at bit 0, so the code is the byte. The byte is the code, not the frequency.",
        },
        {
          id: "div",
          label: "SMPLRT_DIV for 250 samples per second",
          answer: 3,
          why: "1000 / (1 + SMPLRT_DIV) = 250, so 1 + SMPLRT_DIV = 4.",
        },
        {
          id: "clk",
          label: "CLKSEL after power-up (PWR_MGMT_1 holds its reset value)",
          answer: 1,
          why: "The reset value 0x01 is binary 0000 0001: SLEEP (bit 6) is 0, so the chip is awake, and CLKSEL (bits 2..0) is 1, the best clock.",
        },
      ],
      hints: [
        "Two steps for an address: how many 16s fit in the decimal number, and what is left over. Left-overs of 10 to 15 are the digits A to F.",
        "For a byte: find the field's code in the table, then shift it up to the field's lowest bit. A field at bits 4..3 is shifted by 3, a field at bits 2..0 not at all.",
        "0x1D, 0x6B, 2 << 3 = 0x10, 3 << 3 = 0x18, code 5 = 0x05, 1000 / 250 - 1 = 3, and 0x01 has CLKSEL = 1.",
      ],
      takeaway: "A register page gives you four things: the address, whether you can write it, the reset value, and where each field sits. The byte you write is every field's code shifted to its place.",
    },
    {
      id: "imu-config",
      kind: "code",
      mode: "write",
      title: "Choosing the range",
      goal: "Write the function that writes an MPU-9250 register, select two measuring ranges, and read them back.",
      refs: [{ course: "L12", slide: [34, 29] }, { course: "HW3" }, { trm: "18.3.7" }],
      brief: `
After power-up the MPU-9250 measures +-250 degrees per second and +-2 g. Bits 4 and 3 of two registers choose other ranges:

\`\`\`c
value   0x1B GYRO_CONFIG    0x1C ACCEL_CONFIG
0x00    +-250 deg/s         +-2 g
0x08    +-500 deg/s         +-4 g
0x10    +-1000 deg/s        +-8 g
0x18    +-2000 deg/s        +-16 g
\`\`\`

The robot uses +-250 degrees per second and +-4 g. For practice, this level selects **+-500 degrees per second and +-8 g**.

## Write mpu_write()
\`mpu_write(reg, value)\` writes one register. It is \`mpu_read\` with a different word: the address in the upper byte **without** the read bit, the value in the lower byte. A word still comes back while you send, and it must be read out of the FIFO and thrown away. End with \`DELAY_US(10);\`.

## Then in main()
1. Write the two registers.
2. Read them back with the given \`mpu_read\` into \`cfg1b\` and \`cfg1c\`. Reading back what you wrote is the standard check that a device was configured.

\`main()\` then calls the given \`read_accel_z()\`. The board lies flat, so the Z axis feels 1 g. With the +-2 g range that reads 16384, half of full scale. With +-8 g the same 1 g is only an eighth of full scale: **4096**.

The figure shows how a raw count and a range make a value.

{{figure:imu-scaling}}
`,
      kit: "robot",
      durationMs: 2,
      starter: `// Given functions, written out below main(). These two lines only announce them.
uint16_t mpu_read(uint16_t reg);
int16_t read_accel_z(void);

uint16_t cfg1b = 0;
uint16_t cfg1c = 0;
int16_t az_raw = 0;

// Writes one register of the MPU-9250
void mpu_write(uint16_t reg, uint16_t value)
{
    // TODO

}

void main(void)
{
${START}
${SPIB}
    // TODO: select +-500 degrees per second (0x1B) and +-8 g (0x1C)

    // TODO: read the two registers back into cfg1b and cfg1c

    az_raw = read_accel_z();

    while (1) {
    }
}

${MPU_READ}
// Reads the Z acceleration: starts at 0x3E so that 0x3F and 0x40 arrive as one word
int16_t read_accel_z(void)
{
    int16_t temp;
    int16_t z;

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0x8000 | 0x3E00;
    SpibRegs.SPITXBUF = 0x0000;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 2);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    temp = SpibRegs.SPIRXBUF;
    z = SpibRegs.SPIRXBUF;
    DELAY_US(10);

    return z;
}
`,
      solution: `// Given functions, written out below main(). These two lines only announce them.
uint16_t mpu_read(uint16_t reg);
int16_t read_accel_z(void);

uint16_t cfg1b = 0;
uint16_t cfg1c = 0;
int16_t az_raw = 0;

// Writes one register of the MPU-9250
void mpu_write(uint16_t reg, uint16_t value)
{
    uint16_t temp;

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (reg << 8) | value;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    temp = SpibRegs.SPIRXBUF;
    DELAY_US(10);
}

void main(void)
{
${START}
${SPIB}
    mpu_write(0x1B, 0x08);
    mpu_write(0x1C, 0x10);

    cfg1b = mpu_read(0x1B);
    cfg1c = mpu_read(0x1C);

    az_raw = read_accel_z();

    while (1) {
    }
}

${MPU_READ}
// Reads the Z acceleration: starts at 0x3E so that 0x3F and 0x40 arrive as one word
int16_t read_accel_z(void)
{
    int16_t temp;
    int16_t z;

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0x8000 | 0x3E00;
    SpibRegs.SPITXBUF = 0x0000;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 2);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    temp = SpibRegs.SPIRXBUF;
    z = SpibRegs.SPIRXBUF;
    DELAY_US(10);

    return z;
}
`,
      checks: [
        { kind: "var", name: "cfg1b", equals: 0x08, label: "Register 0x1B reads back 0x08 (+-500 degrees per second)", hint: "The value to write is the code in the first column of the table (0x08), not the range itself. If it reads 0, see the next check." },
        { kind: "var", name: "cfg1c", equals: 0x10, label: "Register 0x1C reads back 0x10 (+-8 g)", hint: "If it reads 0, the write did not reach the device: check the chip select and that the word is (reg << 8) | value, without 0x8000." },
        { kind: "var", name: "az_raw", equals: 4096, label: "1 g on the Z axis now reads 4096: the range is +-8 g", hint: "16384 means the accelerometer is still at +-2 g, 8192 means +-4 g." },
        { kind: "reg", reg: "SpibRegs.SPIFFRX", field: "RXFFST", equals: 0, label: "The receive FIFO is empty at the end", hint: "A write receives a word too. Read it out in mpu_write." },
        { kind: "pin", pin: 66, at: 1.5, level: 1, label: "The chip select is high after the transfers" },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported" },
      ],
      watch: ["cfg1b", "cfg1c", "az_raw"],
      hints: [
        "Copy the body of mpu_read. Only the word changes, and the received word is not used.",
        "The word is `(reg << 8) | value`. Read SPIRXBUF into a local variable after the transfer so the FIFO is empty again.",
        "`mpu_write(0x1B, 0x08); mpu_write(0x1C, 0x10);` then `cfg1b = mpu_read(0x1B); cfg1c = mpu_read(0x1C);`.",
      ],
      takeaway: "The range decides what a raw number means. Whenever you change a range register, the scale factor in your code changes with it.",
    },
    {
      id: "imu-configure",
      kind: "code",
      mode: "write",
      title: "Configure the chip in one transfer",
      goal: "Write the MPU-9250's five configuration registers in one transfer, the way the course's addendum does, with values you take from the register map.",
      refs: [
        { course: "L12", slide: [35, 34], note: "writing several registers at once" },
        { course: "MPU-9250 addendum", note: "pages 2 and 3: writing three, five or seven registers" },
        { course: "MPU-9250 register map", note: "sections 4.4 to 4.8" },
        { course: "MPU-9250 specification", note: "section 7.5: the SPI rules; Tables 1 and 2: filter range" },
        { course: "HW3" },
      ],
      brief: `
The course's set-up writes the chip's settings the way the instructor's **addendum** shows (pages 2 and 3): registers that are neighbours go out in **one** transfer. HW3 has you do that for a longer run. Here you do it for registers 0x19 to 0x1D, with your own values.

## The addendum's steps
1. Chip select low.
2. First word: the first register's address in the upper byte, its value in the lower byte.
3. Each further word: the values of the next two registers, the lower-numbered one in the upper byte.
4. Wait until as many words have come back as you sent (\`RXFFST\`).
5. Chip select high.
6. Read that many words from \`SPIRXBUF\` and throw them away.
7. \`DELAY_US(10);\` before the next transfer.

Example, three registers: 0x1B = 0x18, 0x1C = 0x08, 0x1D = 0x02 are the words \`0x1B18\` and \`0x0802\`. Wait for 2 words, read 2. With 16-bit words a transfer always writes an odd number of registers.

## What this robot needs
Look the values up as in "Reading the register map".

- 0x19: **500** samples a second
- 0x1A: gyro filter **41 Hz**, which takes the jitter out of the readings and still follows a turn within about 20 ms
- 0x1B: gyro range **+-2000** degrees per second
- 0x1C: accelerometer range **+-8 g**
- 0x1D: accelerometer filter **20 Hz**

With 500 samples a second, a program that reads every millisecond gets each sample twice. Reading more often than the chip measures gains nothing.

## Your part
Write \`setup_mpu()\`: the seven steps, one transfer. \`main()\` then writes PWR_MGMT_1 (given), reads the five registers back and measures again and again. The test turns the robot at 1500 degrees per second, then at -300.
`,
      kit: "robot",
      durationMs: 200,
      stimuli: [
        { at: 0, set: "IMU_GZ_DPS", value: 1500 },
        { at: 100, set: "IMU_GZ_DPS", value: -300 },
      ],
      starter: imuConfigure("    // TODO: the seven steps for registers 0x19 to 0x1D"),
      solution: imuConfigure(`    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x1900 | 0x0001);    // address 0x19; 0x19 = 1: 500 samples a second
    SpibRegs.SPITXBUF = (0x0300 | 0x0018);    // 0x1A = 3: 41 Hz; 0x1B = 0x18: +-2000 deg/s
    SpibRegs.SPITXBUF = (0x1000 | 0x0004);    // 0x1C = 0x10: +-8 g; 0x1D = 4: 20 Hz
    while (SpibRegs.SPIFFRX.bit.RXFFST != 3);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    temp = SpibRegs.SPIRXBUF;
    temp = SpibRegs.SPIRXBUF;
    temp = SpibRegs.SPIRXBUF;
    DELAY_US(10);`),
      checks: [
        { kind: "var", name: "r19", equals: 0x01, label: "Register 0x19 holds 0x01: 500 samples a second", hint: "1000 / (1 + SMPLRT_DIV) = 500. Still 0: the transfer did not reach the chip, or the first word does not start with the address 0x19. If the program then hangs in mpu_write(), the three words that came back during your transfer are still in the FIFO: read them out." },
        { kind: "var", name: "r1a", equals: 0x03, label: "Register 0x1A holds 0x03: the gyro filter is at 41 Hz", hint: "0x1A is the upper byte of the second word. The value is the code in front of 41 Hz." },
        { kind: "var", name: "r1b", equals: 0x18, label: "Register 0x1B holds 0x18: +-2000 degrees per second", hint: "0x1B is the lower byte of the second word. The field value 3 goes to bits 4..3: 3 << 3." },
        { kind: "var", name: "r1c", equals: 0x10, label: "Register 0x1C holds 0x10: +-8 g", hint: "0x1C is the upper byte of the third word. Field value 2 at bits 4..3." },
        { kind: "var", name: "r1d", equals: 0x04, label: "Register 0x1D holds 0x04: the accelerometer filter is at 20 Hz", hint: "0x1D is the lower byte of the third word." },
        { kind: "signal", name: "MPU_WRITE_FRAMES", equals: 2, label: "The five registers were written in one transfer", hint: "Count the chip-select pulses that write: one for your burst and one for PWR_MGMT_1 in main(). Five calls of mpu_write are five transfers." },
        { kind: "signal", name: "IMU_RATE_HZ", equals: 500, label: "The chip makes 500 samples a second", hint: "No value: registers 0x19 to 0x1D were never written. 8000 or 32000: no filter code from 1 to 6 is in register 0x1A, so the divider in 0x19 is not used." },
        { kind: "var", name: "gyroz", at: 60, min: 1495, max: 1505, label: "Turning at 1500 degrees per second: gyroz is 1500", hint: "A reading stuck near 250, 500 or 1000 means the range in register 0x1B is too small. measure() scales for +-2000." },
        { kind: "var", name: "accelz", at: 60, min: 0.98, max: 1.02, label: "Lying still: accelz is 1 g", hint: "measure() scales for +-8 g: register 0x1C must select that range." },
        { kind: "var", name: "gyroz", at: 104.9, min: 250, max: 450, label: "4 ms after the turn changes, the 41 Hz filter is two thirds of the way", hint: "Already at -300: no filter is selected in register 0x1A. Hardly moved: the filter is slower than 41 Hz." },
        { kind: "var", name: "gyroz", min: -303, max: -297, label: "Turning at -300 degrees per second: gyroz is -300" },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported", hint: "Wait for all the words before you raise the chip select, and read every one of them out of the FIFO." },
        { kind: "no-diagnostic", code: "mpu", label: "The MPU-9250 has nothing to remark", hint: "The message names the step of the addendum that was left out." },
      ],
      watch: ["r19", "r1a", "r1b", "r1c", "r1d", "gyroz", "accelz"],
      inspect: ["SpibRegs.SPIFFRX"],
      hints: [
        "Five registers and the address byte are six bytes: three words. Write down which two registers each of the last two words holds.",
        "The values: 0x19 = 1, 0x1A = 3, 0x1B = 0x18, 0x1C = 0x10, 0x1D = 4. Wait for RXFFST to reach 3 and read SPIRXBUF three times into temp.",
        "`SpibRegs.SPITXBUF = (0x1900 | 0x0001);` `SpibRegs.SPITXBUF = (0x0300 | 0x0018);` `SpibRegs.SPITXBUF = (0x1000 | 0x0004);` between the chip select going low and `while (SpibRegs.SPIFFRX.bit.RXFFST != 3);`, then chip select high, three reads, `DELAY_US(10);`.",
      ],
      takeaway: "One chip select, one address, then the values in register order. What you configure is what you get: the range, how often a new sample appears, and how calm and how late it is.",
    },
    {
      id: "imu-gyroz",
      kind: "code",
      mode: "write",
      title: "How fast are we rolling?",
      goal: "Read the gyro's X axis every millisecond with interrupts and convert it to degrees per second.",
      refs: [{ course: "L12", slide: [38, 39, 30] }, { course: "HW3" }, { trm: "18.2.3" }, { trm: "18.3.7" }],
      brief: `
The robot reads its gyro 1000 times a second. Waiting in a loop for each reading is out of the question, so the read is split over two interrupts, the pattern from the SPI chapter. HW3 has you read gyro Z this way. Here you read **gyro X**: registers 0x43 (high byte) and 0x44 (low byte).

- **\`cpu_timer0_isr\`, every 1 ms: start the read.** Chip select low, \`RXFFIL = 2\`, then two words: the read command, and a word of zeros that gives the device 16 more clocks to answer. Choose the start register so that 0x43 and 0x44 arrive together in the **second** word.
- **\`SPIB_isr\`, 32 us later: take the result.** Read both words. The first is of no use. The second is the gyro X reading: store it in \`gyrox_raw\` (an \`int16_t\`, so negative rates come out negative). Raise the chip select, clear the two FIFO flags, acknowledge group 6.

Then convert in \`SPIB_isr\`:

\`\`\`c
gyrox = gyrox_raw * 250.0 / 32767.0;   // degrees per second
\`\`\`

The gyro range is +-250 degrees per second, set in \`main()\`. The test rolls the board at -90 degrees per second after 5.5 ms, and the other way at 40 degrees per second after 9.5 ms.
`,
      kit: "robot",
      durationMs: 12,
      stimuli: [
        { at: 5.5, set: "IMU_GX_DPS", value: -90 },
        { at: 9.5, set: "IMU_GX_DPS", value: 40 },
      ],
      starter: `__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);
void mpu_write(uint16_t reg, uint16_t value);

int16_t spivalue1 = 0;
int16_t gyrox_raw = 0;
float gyrox = 0;

void main(void)
{
${START}
${SPIB}
${MPU_RANGES}
${PIE_INIT}

${VECTORS()}

    while (1) {
    }
}

// Every 1 ms: start reading gyro X
__interrupt void cpu_timer0_isr(void)
{
    // TODO

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

// When the two words have arrived
__interrupt void SPIB_isr(void)
{
    // TODO

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}

${MPU_WRITE}`,
      solution: `__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);
void mpu_write(uint16_t reg, uint16_t value);

int16_t spivalue1 = 0;
int16_t gyrox_raw = 0;
float gyrox = 0;

void main(void)
{
${START}
${SPIB}
${MPU_RANGES}
${PIE_INIT}

${VECTORS()}

    while (1) {
    }
}

// Every 1 ms: start reading gyro X
__interrupt void cpu_timer0_isr(void)
{
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPIFFRX.bit.RXFFIL = 2;
    SpibRegs.SPITXBUF = (0x8000 | 0x4200);    // from 0x42: 0x43 and 0x44 are the second word
    SpibRegs.SPITXBUF = 0x0000;

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

// When the two words have arrived
__interrupt void SPIB_isr(void)
{
    spivalue1 = SpibRegs.SPIRXBUF;
    gyrox_raw = SpibRegs.SPIRXBUF;
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;

    gyrox = gyrox_raw * 250.0 / 32767.0;

    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}

${MPU_WRITE}`,
      checks: [
        { kind: "isr", fn: "SPIB_isr", min: 11, max: 11, label: "SPIB_isr runs once per millisecond", hint: "It runs when RXFFST >= RXFFIL: two words sent, RXFFIL = 2, and both words read before the flag is cleared." },
        { kind: "var", name: "gyrox", at: 5.2, min: -0.01, max: 0.01, label: "gyrox is 0 while the board is still" },
        { kind: "var", name: "gyrox_raw", at: 9.2, equals: -11796, label: "gyrox_raw is -11796 while rolling at -90 degrees per second", hint: "-1 (0xFFFF) means no device answered: pull GPIO66 low before writing SPITXBUF. Any other number comes from another register: the read must start one register before 0x43 (0x8000 | 0x4200), and the reading is the second word received." },
        { kind: "var", name: "gyrox", at: 9.2, min: -90.05, max: -89.95, label: "gyrox is -90 degrees per second", hint: "0 means the sum was done in whole numbers and overflowed: write 250.0 and 32767.0, with the decimal point. A large positive number means gyrox_raw is unsigned: it must be an int16_t." },
        { kind: "var", name: "gyrox", min: 39.95, max: 40.05, label: "gyrox ends at 40 degrees per second" },
        { kind: "pin", pin: 66, at: 7.5, level: 1, label: "The chip select is high between reads" },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported" },
      ],
      bonus: [{ kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 2, label: "The timer interrupt returns within 2 us" }],
      watch: ["gyrox_raw", "gyrox"],
      hints: [
        "The timer function is four lines: chip select low, RXFFIL = 2, two writes to SPITXBUF. The first word is 0x8000 | (start register << 8).",
        "Start one register before 0x43: `SpibRegs.SPITXBUF = (0x8000 | 0x4200);` then `SpibRegs.SPITXBUF = 0x0000;`. In SPIB_isr the first read of SPIRXBUF goes to spivalue1, the second to gyrox_raw.",
        "`gyrox = gyrox_raw * 250.0 / 32767.0;` and do not forget `GpioDataRegs.GPCSET.bit.GPIO66 = 1;` and the two flag clears.",
      ],
      takeaway: "Start one register before the value you want, throw the first word away, and the second word is the reading. One millisecond later, do it again.",
    },
    {
      id: "imu-debug",
      kind: "code",
      mode: "debug",
      title: "The word in the middle",
      goal: "This program reads all six axes in one burst, but the values are in the wrong variables. Find out why and fix the indexes.",
      refs: [{ course: "L12", slide: [37, 39] }, { course: "HW3" }, { trm: "18.3.7" }],
      brief: `
Every millisecond this program reads one burst of **nine** words, starting at register 0x38. \`SPIB_isr\` copies the nine received words into \`readdata[]\` and converts them. The indexes were copied from a program whose burst started somewhere else.

Work out what each word holds. The first word is the address byte plus register 0x38. Each later word is the next two registers:

\`\`\`c
readdata[0]   address byte, 0x38   (nothing useful)
readdata[1]   0x39, 0x3A           (nothing useful)
readdata[2]   0x3B, 0x3C           ?
...
\`\`\`

Continue the list up to \`readdata[8]\`, using the register list from the briefing: accelerometer X, Y, Z from 0x3B, then the temperature at 0x41, then gyro X, Y, Z from 0x43.

The test tilts and turns the board so that every axis has a different value:

- acceleration: X = 0.5 g, Y = -0.25 g, Z = 1 g
- turn rate: X = 60, Y = -20, Z = 30 degrees per second

Run the program and compare the six variables with those numbers. Then fix the indexes in \`SPIB_isr\`. The transfer itself is right: do not change what is sent.
`,
      kit: "robot",
      durationMs: 8,
      stimuli: [
        { at: 0.5, set: "IMU_AX_G", value: 0.5 },
        { at: 0.5, set: "IMU_AY_G", value: -0.25 },
        { at: 0.5, set: "IMU_GX_DPS", value: 60 },
        { at: 0.5, set: "IMU_GY_DPS", value: -20 },
        { at: 0.5, set: "IMU_GZ_DPS", value: 30 },
      ],
      starter: `__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);
void mpu_write(uint16_t reg, uint16_t value);

int16_t readdata[9];
float accelx = 0;
float accely = 0;
float accelz = 0;
float gyrox = 0;
float gyroy = 0;
float gyroz = 0;

void main(void)
{
${START}
${SPIB}
${MPU_RANGES}
${PIE_INIT}

${VECTORS()}

    while (1) {
    }
}

// Every 1 ms: start a burst read of registers 0x38 to 0x48
__interrupt void cpu_timer0_isr(void)
{
    uint16_t i;

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPIFFRX.bit.RXFFIL = 9;
    SpibRegs.SPITXBUF = (0x8000 | 0x3800);
    for (i = 0; i < 8; i++) {
        SpibRegs.SPITXBUF = 0x0000;
    }

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void SPIB_isr(void)
{
    uint16_t i;

    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    for (i = 0; i < 9; i++) {
        readdata[i] = SpibRegs.SPIRXBUF;
    }

    accelx = readdata[1] * 4.0 / 32767.0;
    accely = readdata[2] * 4.0 / 32767.0;
    accelz = readdata[3] * 4.0 / 32767.0;
    gyrox = readdata[5] * 250.0 / 32767.0;
    gyroy = readdata[6] * 250.0 / 32767.0;
    gyroz = readdata[7] * 250.0 / 32767.0;

    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}

${MPU_WRITE}`,
      solution: `__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);
void mpu_write(uint16_t reg, uint16_t value);

int16_t readdata[9];
float accelx = 0;
float accely = 0;
float accelz = 0;
float gyrox = 0;
float gyroy = 0;
float gyroz = 0;

void main(void)
{
${START}
${SPIB}
${MPU_RANGES}
${PIE_INIT}

${VECTORS()}

    while (1) {
    }
}

// Every 1 ms: start a burst read of registers 0x38 to 0x48
__interrupt void cpu_timer0_isr(void)
{
    uint16_t i;

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPIFFRX.bit.RXFFIL = 9;
    SpibRegs.SPITXBUF = (0x8000 | 0x3800);
    for (i = 0; i < 8; i++) {
        SpibRegs.SPITXBUF = 0x0000;
    }

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void SPIB_isr(void)
{
    uint16_t i;

    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    for (i = 0; i < 9; i++) {
        readdata[i] = SpibRegs.SPIRXBUF;
    }

    // readdata[0] and [1] hold 0x38 to 0x3A, readdata[5] is the temperature
    accelx = readdata[2] * 4.0 / 32767.0;
    accely = readdata[3] * 4.0 / 32767.0;
    accelz = readdata[4] * 4.0 / 32767.0;
    gyrox = readdata[6] * 250.0 / 32767.0;
    gyroy = readdata[7] * 250.0 / 32767.0;
    gyroz = readdata[8] * 250.0 / 32767.0;

    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}

${MPU_WRITE}`,
      checks: [
        { kind: "var", name: "accelx", min: 0.499, max: 0.501, label: "accelx is 0.5 g", hint: "readdata[0] and readdata[1] hold registers 0x38 to 0x3A, not measurements. Accelerometer X is the word after them." },
        { kind: "var", name: "accely", min: -0.251, max: -0.249, label: "accely is -0.25 g" },
        { kind: "var", name: "accelz", min: 0.999, max: 1.001, label: "accelz is 1 g" },
        { kind: "var", name: "gyrox", min: 59.95, max: 60.05, label: "gyrox is 60 degrees per second", hint: "The word after accelerometer Z is the temperature. Gyro X is the word after that." },
        { kind: "var", name: "gyroy", min: -20.05, max: -19.95, label: "gyroy is -20 degrees per second" },
        { kind: "var", name: "gyroz", min: 29.95, max: 30.05, label: "gyroz is 30 degrees per second" },
        { kind: "signal", name: "SPIB_TX", at: 3.5, equals: 0, label: "The transfer is unchanged: nine words from 0x38" },
        { kind: "isr", fn: "SPIB_isr", min: 7, max: 7, label: "SPIB_isr still runs once per millisecond" },
      ],
      watch: ["accelx", "accely", "accelz", "gyrox", "gyroy", "gyroz"],
      hints: [
        "accely shows 0.5, which is the X value, and gyroy shows 60, the X rate. Everything is read one word too early.",
        "gyrox shows about 10.2, though no axis turns at that rate: it is the temperature word. Write the list of all nine words before you pick the indexes.",
        "Accelerometer: readdata[2], [3], [4]. Temperature: [5]. Gyro: readdata[6], [7], [8].",
      ],
      takeaway: "A burst gives you everything between the first and the last register, wanted or not. Write the list of what each word holds before you index into it.",
    },
    {
      id: "dan-xfer",
      kind: "code",
      mode: "complete",
      title: "The other chip on the bus",
      goal: "Complete the three-word exchange with the DAN28027: send it two PWM values and receive its two ADC readings.",
      refs: [{ course: "Lab 4" }, { trm: "18.3.7" }, { trm: "18.3.3" }],
      brief: `
The second device on SPIB is the **DAN28027**, a small TI microcontroller on the robot board. It does two jobs for the F28379D:

- two **PWM** outputs (pulse width modulation): pins switched on and off very fast. You send a number from 0 to 3000 that sets the share of the time the pin is on: 0 is never, 3000 always, 1500 half.
- two **ADC** readings (analog-to-digital converter): it measures the voltage on a pin and reports it as a number, 0 for 0 V up to 4095 for 3.3 V. So volts = reading * 3.3 / 4096.

Its chip select is **GPIO29**. Note the port: GPIO29 is in port **A**, GPIO66 was in port C.

A **protocol** is the agreed meaning of the words on a bus. The DAN28027's is not a register list but a fixed message of three 16-bit words:

\`\`\`c
master sends    DAN28027 answers
0x00DA          (nothing useful)
PWM value 1     ADC reading 1
PWM value 2     ADC reading 2
\`\`\`

\`0x00DA\` is a start code: it tells the DAN28027 that a new message begins.

## It needs time to think
After each word the DAN28027 runs an interrupt function that prepares the next reply. With the words back to back it would not be ready in time. So the course inserts a pause between the words of a message:

\`\`\`c
SpibRegs.SPIFFCT.bit.TXDLY = 16;   // wait 16 clock cycles between words
\`\`\`

The MPU-9250 needs no pause, so its transfers use \`TXDLY = 0\`. This program only talks to the DAN28027 and sets 16 once, in \`main()\`.

## Your part
The timer interrupt starts the message every millisecond and \`SPIB_isr\` collects the replies. Fill in:

- TODO 1: pull the DAN28027's chip select low
- TODO 2: the interrupt level for a three-word message
- TODO 3: send the start code, then \`pwm1\`, then \`pwm2\`
- TODO 4: read the three words into \`dan_first\`, \`dan_adc1\`, \`dan_adc2\`, in that order
- TODO 5: raise the chip select

The test puts 1.65 V and 1.0 V on the DAN28027's two measuring pins. After 3.5 ms it changes them to 0.825 V and 2.5 V.
`,
      kit: "robot",
      durationMs: 6,
      stimuli: [
        { at: 0.1, set: "DAN_ADC1", value: 1.65 },
        { at: 0.1, set: "DAN_ADC2", value: 1.0 },
        { at: 3.5, set: "DAN_ADC1", value: 0.825 },
        { at: 3.5, set: "DAN_ADC2", value: 2.5 },
      ],
      starter: `__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);

int16_t pwm1 = 1500;
int16_t pwm2 = 2250;
int16_t dan_first = 0;
int16_t dan_adc1 = 0;
int16_t dan_adc2 = 0;
float volts1 = 0;

void main(void)
{
${START}
${SPIB}
    SpibRegs.SPIFFCT.bit.TXDLY = 16;          // the DAN28027 needs a pause between words

${PIE_INIT}

${VECTORS()}

    while (1) {
    }
}

// Every 1 ms: start a message to the DAN28027
__interrupt void cpu_timer0_isr(void)
{
    // TODO 1: chip select of the DAN28027 (GPIO29) low

    // TODO 2: interrupt after three words
    SpibRegs.SPIFFRX.bit.RXFFIL = 16;

    // TODO 3: send the start code 0x00DA, then pwm1, then pwm2

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void SPIB_isr(void)
{
    // TODO 4: read the three words into dan_first, dan_adc1, dan_adc2

    // TODO 5: chip select high

    volts1 = dan_adc1 * 3.3 / 4096.0;

    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}
`,
      solution: `__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);

int16_t pwm1 = 1500;
int16_t pwm2 = 2250;
int16_t dan_first = 0;
int16_t dan_adc1 = 0;
int16_t dan_adc2 = 0;
float volts1 = 0;

void main(void)
{
${START}
${SPIB}
    SpibRegs.SPIFFCT.bit.TXDLY = 16;          // the DAN28027 needs a pause between words

${PIE_INIT}

${VECTORS()}

    while (1) {
    }
}

// Every 1 ms: start a message to the DAN28027
__interrupt void cpu_timer0_isr(void)
{
    GpioDataRegs.GPACLEAR.bit.GPIO29 = 1;

    SpibRegs.SPIFFRX.bit.RXFFIL = 3;

    SpibRegs.SPITXBUF = 0x00DA;
    SpibRegs.SPITXBUF = pwm1;
    SpibRegs.SPITXBUF = pwm2;

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void SPIB_isr(void)
{
    dan_first = SpibRegs.SPIRXBUF;
    dan_adc1 = SpibRegs.SPIRXBUF;
    dan_adc2 = SpibRegs.SPIRXBUF;

    GpioDataRegs.GPASET.bit.GPIO29 = 1;

    volts1 = dan_adc1 * 3.3 / 4096.0;

    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}
`,
      checks: [
        { kind: "signal", name: "DAN_PWM1", equals: 1500, label: "The DAN28027 received PWM value 1 = 1500", hint: "It only accepts a message that starts with 0x00DA, sent while GPIO29 is low." },
        { kind: "signal", name: "DAN_PWM2", equals: 2250, label: "The DAN28027 received PWM value 2 = 2250" },
        { kind: "var", name: "dan_adc1", at: 3.4, equals: 2048, label: "dan_adc1 is 2048 (1.65 V) at first", hint: "The first word received is not a reading. The ADC values are the second and third." },
        { kind: "var", name: "dan_adc2", at: 3.4, equals: 1241, label: "dan_adc2 is 1241 (1.0 V) at first" },
        { kind: "var", name: "volts1", at: 3.4, min: 1.649, max: 1.651, label: "volts1 is 1.65 V at first" },
        { kind: "var", name: "dan_adc1", equals: 1024, label: "dan_adc1 ends at 1024 (0.825 V)" },
        { kind: "var", name: "dan_adc2", equals: 3103, label: "dan_adc2 ends at 3103 (2.5 V)" },
        { kind: "var", name: "volts1", min: 0.824, max: 0.826, label: "volts1 ends at 0.825 V" },
        { kind: "isr", fn: "SPIB_isr", min: 5, max: 5, label: "SPIB_isr runs once per message" },
        { kind: "pin", pin: 29, at: 3.5, level: 1, label: "The DAN28027's chip select is high between messages" },
        { kind: "pin", pin: 66, at: 3.06, level: 1, label: "The MPU-9250's chip select stays high" },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported" },
        { kind: "no-diagnostic", code: "dan", label: "The DAN28027 had time to prepare its replies" },
      ],
      watch: ["dan_first", "dan_adc1", "dan_adc2", "volts1"],
      hints: [
        "GPIO29 is in port A: GpioDataRegs.GPACLEAR.bit.GPIO29 and GpioDataRegs.GPASET.bit.GPIO29.",
        "Three words are sent, so RXFFIL = 3 and SPIRXBUF is read three times.",
        "`SpibRegs.SPITXBUF = 0x00DA; SpibRegs.SPITXBUF = pwm1; SpibRegs.SPITXBUF = pwm2;`",
      ],
      takeaway: "Same wires, same clock mode, a different chip select and a different protocol. The answer to each word arrives one word later, because the slave needs the first word to know what is asked.",
    },
    {
      id: "imu-checkpoint",
      kind: "code",
      mode: "checkpoint",
      title: "Checkpoint: turn indicator",
      goal: "Read the MPU-9250 every millisecond, light LED1 while the robot turns, and print turn rate and Z acceleration four times a second.",
      refs: [{ course: "L12", slide: [38, 30] }, { course: "HW3" }, { course: "Lab 4" }, { course: "HW1" }, { trm: "18.3.7" }],
      brief: `
Put the chapter together: a burst read driven by two interrupts, scaling, an LED and the serial port.

\`main()\` is complete: SPIB, the MPU-9250 ranges (+-250 degrees per second, +-4 g), LED1, timer 0 every 1 ms, the SPIB receive interrupt and the serial port.

## What to write
**\`cpu_timer0_isr\`**: start a burst read of **six** words from register 0x3E (\`0x8000 | 0x3E00\`, then five words of zeros), with the chip select low and the right \`RXFFIL\`. It covers everything from accelerometer Z (0x3F, 0x40) to gyro Z (0x47, 0x48).

**\`SPIB_isr\`**:

1. Raise the chip select and read the six words into \`readdata[]\`.
2. Convert the two values this program needs: \`accelz\` in g (\`* 4.0 / 32767.0\`) and \`gyroz\` in degrees per second (\`* 250.0 / 32767.0\`). Write the list of what each word holds to find them.
3. LED1 (GPIO22) is on while the board turns faster than 20 degrees per second in either direction (\`fabs(gyroz) > 20.0\`: \`fabs(x)\` is x without its sign, so \`fabs(-30.0)\` is 30.0), off otherwise.
4. Count the reads in \`numReads\`. Every 250th read set \`UARTPrint = 1\`.
5. Clear the two FIFO flags and acknowledge group 6.

**\`while (1)\` loop**: when \`UARTPrint\` is 1, print and clear the flag. One digit after the point for the rate (\`%.1f\`), two for the acceleration (\`%.2f\`):

\`\`\`c
gz:45.0 az:1.00
\`\`\`

End the line with \`\\r\\n\`. The test turns the board at 45 degrees per second between 300 ms and 600 ms, and the other way at -25 degrees per second between 700 ms and 900 ms. From 920 ms on it turns slowly, at 10 degrees per second: too slow for the LED.
`,
      kit: "robot",
      durationMs: 1100,
      stimuli: [
        { at: 300, set: "IMU_GZ_DPS", value: 45 },
        { at: 600, set: "IMU_GZ_DPS", value: 0 },
        { at: 700, set: "IMU_GZ_DPS", value: -25 },
        { at: 900, set: "IMU_GZ_DPS", value: 0 },
        { at: 920, set: "IMU_GZ_DPS", value: 10 },
      ],
      starter: `__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);
void mpu_write(uint16_t reg, uint16_t value);

int16_t readdata[6];
float accelz = 0;
float gyroz = 0;
uint32_t numReads = 0;
uint16_t UARTPrint = 0;

void main(void)
{
${START}
${LED1}
${SPIB}
${MPU_RANGES}
${PIE_INIT}

${VECTORS("\n    init_serialSCIA(&SerialA, 115200);\n")}

    while (1) {
        // TODO: print "gz:... az:..." when UARTPrint is 1

    }
}

__interrupt void cpu_timer0_isr(void)
{
    // TODO: start the six-word burst read from 0x3E

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void SPIB_isr(void)
{
    // TODO

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}

${MPU_WRITE}`,
      solution: `__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);
void mpu_write(uint16_t reg, uint16_t value);

int16_t readdata[6];
float accelz = 0;
float gyroz = 0;
uint32_t numReads = 0;
uint16_t UARTPrint = 0;

void main(void)
{
${START}
${LED1}
${SPIB}
${MPU_RANGES}
${PIE_INIT}

${VECTORS("\n    init_serialSCIA(&SerialA, 115200);\n")}

    while (1) {
        if (UARTPrint == 1) {
            serial_printf(&SerialA, "gz:%.1f az:%.2f\\r\\n", gyroz, accelz);
            UARTPrint = 0;
        }
    }
}

__interrupt void cpu_timer0_isr(void)
{
    uint16_t i;

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPIFFRX.bit.RXFFIL = 6;
    SpibRegs.SPITXBUF = (0x8000 | 0x3E00);
    for (i = 0; i < 5; i++) {
        SpibRegs.SPITXBUF = 0x0000;
    }

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void SPIB_isr(void)
{
    uint16_t i;

    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    for (i = 0; i < 6; i++) {
        readdata[i] = SpibRegs.SPIRXBUF;
    }

    // [0] address, 0x3E  [1] accel Z  [2] temperature  [3] gyro X  [4] gyro Y  [5] gyro Z
    accelz = readdata[1] * 4.0 / 32767.0;
    gyroz = readdata[5] * 250.0 / 32767.0;

    if (fabs(gyroz) > 20.0) {
        GpioDataRegs.GPASET.bit.GPIO22 = 1;
    } else {
        GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
    }

    numReads++;
    if ((numReads % 250) == 0) {
        UARTPrint = 1;
    }

    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}

${MPU_WRITE}`,
      checks: [
        { kind: "serial", matches: "^gz:0\\.0 az:1\\.00\\r\\ngz:45\\.0 az:1\\.00\\r\\ngz:-25\\.0 az:1\\.00\\r\\ngz:10\\.0 az:1\\.00\\r\\n", label: "The lines are gz:0.0 az:1.00, gz:45.0 az:1.00, gz:-25.0 az:1.00, gz:10.0 az:1.00", hint: "The first word received holds the address byte and register 0x3E. Accelerometer Z is the word after it, gyro Z the last one. Use %.1f and %.2f." },
        { kind: "serial-period", periodMs: 250, label: "A line is printed every 250 ms" },
        { kind: "led", led: "LED1", at: 200, on: false, label: "LED1 is off while the board is still" },
        { kind: "led", led: "LED1", at: 450, on: true, label: "LED1 is on while the board turns at 45 degrees per second" },
        { kind: "led", led: "LED1", at: 650, on: false, label: "LED1 goes off again when the turn ends" },
        { kind: "led", led: "LED1", at: 800, on: true, label: "LED1 is on while the board turns the other way, at -25 degrees per second", hint: "Either direction counts: compare fabs(gyroz) with 20.0." },
        { kind: "led", led: "LED1", at: 910, on: false, label: "LED1 goes off again when the second turn ends" },
        { kind: "led", led: "LED1", at: 1050, on: false, label: "LED1 stays off during the slow turn at 10 degrees per second", hint: "The limit is 20 degrees per second: compare fabs(gyroz) with 20.0." },
        { kind: "latency", led: "LED1", after: 300, withinUs: 1300, label: "LED1 reacts within 1.3 ms of the turn starting" },
        { kind: "isr", fn: "SPIB_isr", min: 1095, max: 1100, label: "The sensor is read once per millisecond" },
        { kind: "no-diagnostic", code: "print-in-isr", label: "Nothing is printed inside an interrupt function" },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported" },
        { kind: "no-diagnostic", code: "mpu", label: "The MPU-9250 is used within its limits" },
      ],
      bonus: [{ kind: "isr-time", fn: "SPIB_isr", maxUs: 2.5, label: "SPIB_isr takes at most 2.5 us" }],
      watch: ["gyroz", "accelz", "numReads"],
      hints: [
        "Both interrupt functions are close to those of \"The word in the middle\". Only the start register and the number of words differ.",
        "Six words: RXFFIL = 6, one write of 0x8000 | 0x3E00 and five of 0, six reads of SPIRXBUF. Accelerometer Z is readdata[1], gyro Z is readdata[5].",
        "`if (fabs(gyroz) > 20.0)` set GPIO22 with GPASET, else clear it with GPACLEAR. Print with `serial_printf(&SerialA, \"gz:%.1f az:%.2f\\r\\n\", gyroz, accelz);`.",
      ],
      takeaway: "This is the robot's gyro driver: a timer starts the burst, the SPI interrupt scales it, and the main loop only prints.",
    },

    // ---------------------------------------------------------------- practice
    {
      id: "imu-init-burst",
      kind: "code",
      mode: "complete",
      tier: "practice",
      title: "Five registers, one transfer",
      goal: "Write five neighbouring MPU-9250 registers in a single burst, the way the course's set-up code configures the chip.",
      refs: [{ course: "L12", slide: 35 }, { course: "HW3" }, { trm: "18.3.7" }],
      brief: `
In the course projects, \`setupSpib()\` goes on to configure the MPU-9250 by writing a run of registers with **one** chip-select pulse. (In this game it sets up the port only.) HW3 has you work out that burst. This level practises the same thing on a shorter run with other values: registers 0x19 to 0x1D.

\`\`\`c
0x19 = 0x09     0x1A = 0x03     0x1B = 0x08     0x1C = 0x10     0x1D = 0x05
\`\`\`

A burst write is one address byte followed by the data bytes, and the device counts the address up by itself. In 16-bit words:

\`\`\`c
word 1:  address 0x19 (write), value for 0x19
word 2:  value for 0x1A, value for 0x1B
...
\`\`\`

Count the bytes: the address byte plus one per register. Two bytes make a word. In each word after the first, the upper byte is the lower-numbered register.

## Your part
The first word is given. Add the others, then fix the number of words the loop waits for and the number of words read out afterwards (the course calls these reads "dummy reads": the words mean nothing, but they must leave the FIFO).

\`main()\` reads the five registers back to check your burst.
`,
      kit: "robot",
      durationMs: 2,
      starter: `uint16_t mpu_read(uint16_t reg);

uint16_t r19 = 0;
uint16_t r1a = 0;
uint16_t r1b = 0;
uint16_t r1c = 0;
uint16_t r1d = 0;

void main(void)
{
    uint16_t temp;
    uint16_t i;
${START}
${SPIB}
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x1900 | 0x0009);    // address 0x19, value for 0x19
    // TODO: the words for registers 0x1A to 0x1D

    while (SpibRegs.SPIFFRX.bit.RXFFST != 1); // TODO: wait for all the words
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    for (i = 0; i < 1; i++) {                 // TODO: read all of them out
        temp = SpibRegs.SPIRXBUF;
    }
    DELAY_US(10);

    r19 = mpu_read(0x19);
    r1a = mpu_read(0x1A);
    r1b = mpu_read(0x1B);
    r1c = mpu_read(0x1C);
    r1d = mpu_read(0x1D);

    while (1) {
    }
}

${MPU_READ}`,
      solution: `uint16_t mpu_read(uint16_t reg);

uint16_t r19 = 0;
uint16_t r1a = 0;
uint16_t r1b = 0;
uint16_t r1c = 0;
uint16_t r1d = 0;

void main(void)
{
    uint16_t temp;
    uint16_t i;
${START}
${SPIB}
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x1900 | 0x0009);    // address 0x19, value for 0x19
    SpibRegs.SPITXBUF = (0x0300 | 0x0008);    // 0x1A, 0x1B
    SpibRegs.SPITXBUF = (0x1000 | 0x0005);    // 0x1C, 0x1D

    while (SpibRegs.SPIFFRX.bit.RXFFST != 3);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    for (i = 0; i < 3; i++) {
        temp = SpibRegs.SPIRXBUF;
    }
    DELAY_US(10);

    r19 = mpu_read(0x19);
    r1a = mpu_read(0x1A);
    r1b = mpu_read(0x1B);
    r1c = mpu_read(0x1C);
    r1d = mpu_read(0x1D);

    while (1) {
    }
}

${MPU_READ}`,
      checks: [
        { kind: "var", name: "r19", equals: 0x09, label: "Register 0x19 holds 0x09" },
        { kind: "var", name: "r1a", equals: 0x03, label: "Register 0x1A holds 0x03", hint: "0x1A is the upper byte of its word: 0x0300." },
        { kind: "var", name: "r1b", equals: 0x08, label: "Register 0x1B holds 0x08", hint: "0x1B is the lower byte of the word that covers 0x1A and 0x1B." },
        { kind: "var", name: "r1c", equals: 0x10, label: "Register 0x1C holds 0x10" },
        { kind: "var", name: "r1d", equals: 0x05, label: "Register 0x1D holds 0x05" },
        { kind: "signal", name: "SPIB_WORDS", equals: 8, label: "The burst is 3 words (plus 5 for reading back)", hint: "Write all five registers in one transfer: 3 words between one chip select low and one high." },
        { kind: "reg", reg: "SpibRegs.SPIFFRX", field: "RXFFST", equals: 0, label: "The receive FIFO is empty at the end" },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported" },
      ],
      watch: ["r19", "r1a", "r1b", "r1c", "r1d"],
      hints: [
        "Five registers plus the address byte are six bytes: three words. Write down the pairs: (0x1A, 0x1B) and (0x1C, 0x1D).",
        "The two missing words are 0x0308 and 0x1005.",
        "Three words are sent: wait for RXFFST != 3 and read SPIRXBUF three times.",
      ],
      takeaway: "One address byte, then as many data bytes as you like. As many dummy reads as words sent.",
    },
    {
      id: "imu-setup",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "Read the data sheet, set up the chip",
      goal: "Work out four MPU-9250 register values from its register map and what the robot needs, and write them.",
      refs: [{ course: "L12", slide: [29, 34] }, { course: "HW3" }, { trm: "18.3.7" }],
      brief: `
The library's \`setupSpib()\` sets up the port. How the **chip** should measure is your decision, and no library knows it. The answer is in the chip's **register map**: the part of its data sheet that lists every register and what its bits do. This is what it says about four registers:

\`\`\`c
0x19 SMPLRT_DIV    measurements per second = 1000 / (1 + SMPLRT_DIV), with filter code 1 to 6
0x1A CONFIG        bits 2..0, DLPF_CFG: low-pass filter
                   1 = 184 Hz   2 = 92 Hz   3 = 41 Hz   4 = 20 Hz   5 = 10 Hz
0x1B GYRO_CONFIG   bits 4..3, GYRO_FS_SEL: range in degrees per second
                   0 = +-250    1 = +-500   2 = +-1000  3 = +-2000
0x1C ACCEL_CONFIG  bits 4..3, ACCEL_FS_SEL: range in g
                   0 = +-2      1 = +-4     2 = +-8     3 = +-16
\`\`\`

## From a field to a byte
A register map gives the value of a **field**, a group of bits inside the register. You write the whole byte, so you must move the field value to its place. A field whose lowest bit is bit 3 is shifted up by 3: field value 1 becomes \`1 << 3\` = 0x08. "Choosing the range" handed you those bytes ready made. A data sheet does not.

## What this robot needs
- It can spin at up to **800 degrees per second**. Choose the smallest gyro range that holds that.
- It feels bumps of up to **12 g**. Choose the smallest accelerometer range that holds that.
- A new measurement **125 times a second**.
- The low-pass filter at **20 Hz**.

## Your part
1. In \`setup_mpu()\`, write the four registers with the given \`mpu_write(reg, value)\`.
2. Set \`gyro_range\` and \`accel_range\` at the top to the ranges you chose. The given \`measure()\` uses them to turn raw counts into \`gyroz\` (degrees per second) and \`accelz\` (g).

\`main()\` reads the four registers back, then measures again and again. The test turns the robot at 600 and then at -900 degrees per second, and bumps it with 10 g. It waits a tenth of a second before each look: a 20 Hz filter needs about 50 ms to settle on a new value.
`,
      kit: "robot",
      // The 20 Hz filter needs about 50 ms to settle on a new value: the test leaves it 100.
      durationMs: 200,
      stimuli: [
        { at: 0, set: "IMU_GZ_DPS", value: 600 },
        { at: 100, set: "IMU_GZ_DPS", value: -900 },
        { at: 100, set: "IMU_AZ_G", value: 10 },
      ],
      starter: imuSetup({
        gyro: "250.0;     // TODO: the gyro range you chose, in degrees per second",
        accel: "2.0;      // TODO: the accelerometer range you chose, in g",
        body: "    // TODO: write registers 0x19, 0x1A, 0x1B and 0x1C",
      }),
      solution: imuSetup({
        gyro: "1000.0;    // degrees per second",
        accel: "16.0;     // g",
        body: `    mpu_write(0x19, 7);                       // 1000 / (1 + 7) = 125 measurements a second
    mpu_write(0x1A, 4);                       // DLPF_CFG = 4: 20 Hz
    mpu_write(0x1B, 2 << 3);                  // GYRO_FS_SEL = 2: +-1000 degrees per second
    mpu_write(0x1C, 3 << 3);                  // ACCEL_FS_SEL = 3: +-16 g`,
      }),
      checks: [
        { kind: "var", name: "cfg19", equals: 7, label: "Register 0x19 holds 7: 125 measurements a second", hint: "1000 / (1 + SMPLRT_DIV) = 125, so 1 + SMPLRT_DIV = 8. Still 0: the write did not happen." },
        { kind: "var", name: "cfg1a", equals: 4, label: "Register 0x1A holds 0x04: the filter is at 20 Hz", hint: "DLPF_CFG starts at bit 0, so the field value is the byte. The value is the code in front of 20 Hz, not 20." },
        { kind: "var", name: "cfg1b", equals: 0x10, label: "Register 0x1B holds 0x10: +-1000 degrees per second", hint: "+-500 is too small for 800 degrees per second, +-2000 wastes resolution. The field starts at bit 3: write the field value shifted up by 3, not the field value itself." },
        { kind: "var", name: "cfg1c", equals: 0x18, label: "Register 0x1C holds 0x18: +-16 g", hint: "+-8 g is too small for 12 g. The field value is 3, at bits 4..3: 3 << 3." },
        { kind: "var", name: "gyroz", at: 95, min: 598, max: 602, label: "Turning at 600 degrees per second: gyroz is 600", hint: "About 250 or 500: the chip's range is too small and the reading is stuck at full scale. Another wrong number: gyro_range does not match the range in register 0x1B." },
        { kind: "var", name: "gyroz", min: -902, max: -898, label: "Turning at -900 degrees per second: gyroz is -900" },
        { kind: "var", name: "accelz", at: 95, min: 0.98, max: 1.02, label: "Lying still: accelz is 1 g", hint: "accel_range must be the range you selected in register 0x1C, in g." },
        { kind: "var", name: "accelz", min: 9.9, max: 10.1, label: "A bump of 10 g: accelz is 10" },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported" },
      ],
      watch: ["cfg19", "cfg1a", "cfg1b", "cfg1c", "gyroz", "accelz"],
      hints: [
        "Four decisions, four calls of mpu_write. For each range, pick the first entry of the table that is large enough.",
        "+-1000 degrees per second is field value 2, +-16 g is field value 3, both at bits 4..3. 125 a second needs 1 + SMPLRT_DIV = 8. The 20 Hz filter is code 4.",
        "`mpu_write(0x19, 7); mpu_write(0x1A, 4); mpu_write(0x1B, 2 << 3); mpu_write(0x1C, 3 << 3);` and at the top `gyro_range = 1000.0`, `accel_range = 16.0`.",
      ],
      takeaway: "A register map gives field values. You shift each to its place in the byte, and the scale factors in your code must follow the ranges you chose.",
    },
    {
      id: "dan-debug",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "Two chips answering",
      goal: "The DAN28027 exchange returns nonsense. Fix the chip select mistake and the missing pause between words.",
      refs: [{ course: "L10", slide: 41, note: "one chip select per slave" }, { course: "Lab 4" }, { trm: "18.3.7" }, { trm: "18.3.3" }],
      brief: `
This program was made by copying an MPU-9250 read and changing the words. It should send \`0x00DA\`, 1000 and 2000 to the DAN28027 once and store the two ADC readings. The inputs are at 1.65 V and 1.0 V, so the readings should be 2048 and 1241.

Run it and read the messages under the editor. There are two separate mistakes:

- **Bus conflict.** Look at which chip selects are low during the transfer. Two slaves that are selected together both drive the SOMI line.
- **No pause between the words.** The DAN28027 prepares each reply in software and needs the gap that \`SPIFFCT.bit.TXDLY = 16\` gives. Without it, its replies come one word late.

Fix both. After the exchange set \`TXDLY\` back to 0, as the course does, so that a later MPU-9250 read runs at full speed.
`,
      kit: "robot",
      durationMs: 2,
      stimuli: [
        { at: 0.01, set: "DAN_ADC1", value: 1.65 },
        { at: 0.01, set: "DAN_ADC2", value: 1.0 },
      ],
      starter: `int16_t dan_first = 0;
int16_t dan_adc1 = 0;
int16_t dan_adc2 = 0;

void main(void)
{
${START}
${SPIB}
    DELAY_US(100);

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    GpioDataRegs.GPACLEAR.bit.GPIO29 = 1;
    SpibRegs.SPITXBUF = 0x00DA;
    SpibRegs.SPITXBUF = 1000;
    SpibRegs.SPITXBUF = 2000;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 3);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    GpioDataRegs.GPASET.bit.GPIO29 = 1;

    dan_first = SpibRegs.SPIRXBUF;
    dan_adc1 = SpibRegs.SPIRXBUF;
    dan_adc2 = SpibRegs.SPIRXBUF;

    while (1) {
    }
}
`,
      solution: `int16_t dan_first = 0;
int16_t dan_adc1 = 0;
int16_t dan_adc2 = 0;

void main(void)
{
${START}
${SPIB}
    DELAY_US(100);

    SpibRegs.SPIFFCT.bit.TXDLY = 16;
    GpioDataRegs.GPACLEAR.bit.GPIO29 = 1;
    SpibRegs.SPITXBUF = 0x00DA;
    SpibRegs.SPITXBUF = 1000;
    SpibRegs.SPITXBUF = 2000;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 3);
    GpioDataRegs.GPASET.bit.GPIO29 = 1;
    SpibRegs.SPIFFCT.bit.TXDLY = 0;

    dan_first = SpibRegs.SPIRXBUF;
    dan_adc1 = SpibRegs.SPIRXBUF;
    dan_adc2 = SpibRegs.SPIRXBUF;

    while (1) {
    }
}
`,
      checks: [
        { kind: "var", name: "dan_adc1", equals: 2048, label: "dan_adc1 is 2048 (1.65 V)", hint: "0 while two devices fight over the SOMI line. 218 is 0x00DA: the DAN28027 sent your own start code back because it had no time to load its reply." },
        { kind: "var", name: "dan_adc2", equals: 1241, label: "dan_adc2 is 1241 (1.0 V)" },
        { kind: "signal", name: "DAN_PWM1", equals: 1000, label: "The DAN28027 received 1000" },
        { kind: "signal", name: "DAN_PWM2", equals: 2000, label: "The DAN28027 received 2000" },
        { kind: "no-diagnostic", code: "spi-bus-conflict", label: "Only one chip select is low at a time", hint: "This message is for the DAN28027 only: GPIO66 must stay high." },
        { kind: "no-diagnostic", code: "dan", label: "The DAN28027 had time to prepare its replies", hint: "Set SpibRegs.SPIFFCT.bit.TXDLY = 16; before the first word is written." },
        { kind: "reg", reg: "SpibRegs.SPIFFCT", field: "TXDLY", equals: 0, label: "TXDLY is back at 0 afterwards" },
        { kind: "pin", pin: 66, at: 0.2, level: 1, label: "The MPU-9250's chip select is high during the exchange" },
      ],
      watch: ["dan_first", "dan_adc1", "dan_adc2"],
      inspect: ["SpibRegs.SPIFFCT", "SpibRegs.SPIFFRX"],
      hints: [
        "Remove both lines that touch GPIO66.",
        "Add `SpibRegs.SPIFFCT.bit.TXDLY = 16;` before the chip select goes low.",
        "Add `SpibRegs.SPIFFCT.bit.TXDLY = 0;` once the three words have been received.",
      ],
      takeaway: "One chip select low at a time, and each device gets the timing it needs: TXDLY = 16 for the DAN28027, 0 for the MPU-9250.",
    },

    // ------------------------------------------------------------------ expert
    {
      id: "imu-heading",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "From turn rate to heading",
      goal: "Measure the gyro's bias at start-up, then integrate gyro Z with the trapezoidal rule to get the heading in degrees.",
      refs: [{ course: "L15", slide: [33, 27, 28] }, { course: "Lab 4" }, { course: "HW3" }, { trm: "18.3.7" }],
      brief: `
A gyro measures turn **rate**. The robot wants its **heading**, the angle it has turned through. Angle is the integral of rate, and the course's final project computes it exactly like this.

## Bias
A gyro at rest does not read exactly zero. It reads a small constant, the **bias**. Integrate a bias of 1.5 degrees per second for a minute and the heading is wrong by 90 degrees. So the robot stands still at start-up, averages the gyro for a while, and subtracts that average from every later reading.

## Trapezoidal rule
With a sample every T = 0.001 s, the area under the rate curve between two samples is the average of the two rates times T:

\`\`\`c
heading = heading + (gyroz + gyroz_old) * 0.0005;
gyroz_old = gyroz;
\`\`\`

## Your task
The timer interrupt already starts a two-word gyro Z read every millisecond. Write \`SPIB_isr\`:

1. Read the two words, raise the chip select, convert the second word to degrees per second (\`* 250.0 / 32767.0\`).
2. **Calibration**, the first **500** readings: add the rate to a sum. After the 500th, \`bias = sum / 500\`. The heading stays 0 during this time.
3. **After that**: subtract \`bias\` from the rate to get \`gyroz\`, and integrate it into \`heading\` with the trapezoidal rule.
4. Clear the flags and acknowledge, as always.

The test: the gyro has a bias of 1.5 degrees per second. The board stands still for 700 ms, turns at 90 degrees per second for exactly one second, and stops. The heading must end at 90 degrees.
`,
      kit: "robot",
      durationMs: 2000,
      stimuli: [
        { at: 0.01, set: "IMU_GZ_DPS", value: 1.5 },
        { at: 700, set: "IMU_GZ_DPS", value: 91.5 },
        { at: 1700, set: "IMU_GZ_DPS", value: 1.5 },
      ],
      starter: `__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);
void mpu_write(uint16_t reg, uint16_t value);

int16_t gyroz_raw = 0;
float gyroz = 0;       // turn rate with the bias removed, degrees per second
float bias = 0;        // degrees per second
float heading = 0;     // degrees
uint32_t numReads = 0;

void main(void)
{
${START}
${SPIB}
${MPU_RANGES}
${PIE_INIT}

${VECTORS()}

    while (1) {
    }
}

// Every 1 ms: start reading gyro Z
__interrupt void cpu_timer0_isr(void)
{
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPIFFRX.bit.RXFFIL = 2;
    SpibRegs.SPITXBUF = (0x8000 | 0x4600);
    SpibRegs.SPITXBUF = 0x0000;

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void SPIB_isr(void)
{
    // TODO

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}

${MPU_WRITE}`,
      solution: `__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);
void mpu_write(uint16_t reg, uint16_t value);

int16_t gyroz_raw = 0;
float gyroz = 0;       // turn rate with the bias removed, degrees per second
float bias = 0;        // degrees per second
float heading = 0;     // degrees
uint32_t numReads = 0;
float sum = 0;
float gyroz_old = 0;

void main(void)
{
${START}
${SPIB}
${MPU_RANGES}
${PIE_INIT}

${VECTORS()}

    while (1) {
    }
}

// Every 1 ms: start reading gyro Z
__interrupt void cpu_timer0_isr(void)
{
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPIFFRX.bit.RXFFIL = 2;
    SpibRegs.SPITXBUF = (0x8000 | 0x4600);
    SpibRegs.SPITXBUF = 0x0000;

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void SPIB_isr(void)
{
    int16_t temp;
    float rate;

    temp = SpibRegs.SPIRXBUF;
    gyroz_raw = SpibRegs.SPIRXBUF;
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;

    rate = gyroz_raw * 250.0 / 32767.0;
    numReads++;

    if (numReads <= 500) {
        sum += rate;
        if (numReads == 500) {
            bias = sum / 500.0;
        }
    } else {
        gyroz = rate - bias;
        heading = heading + (gyroz + gyroz_old) * 0.0005;
        gyroz_old = gyroz;
    }

    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}

${MPU_WRITE}`,
      checks: [
        { kind: "var", name: "bias", min: 1.49, max: 1.51, label: "The measured bias is 1.5 degrees per second", hint: "Average the first 500 converted readings." },
        { kind: "var", name: "heading", at: 690, min: -0.05, max: 0.05, label: "The heading stays at 0 while the board stands still", hint: "If it creeps upward, the bias is not subtracted, or integration starts before the calibration is over." },
        { kind: "var", name: "gyroz", at: 1200, min: 89.9, max: 90.1, label: "gyroz is 90 degrees per second during the turn, bias removed" },
        { kind: "var", name: "heading", at: 1200, min: 44, max: 46, label: "Half-way through the turn the heading is about 45 degrees" },
        { kind: "var", name: "heading", min: 89.8, max: 90.2, label: "The heading ends at 90 degrees", hint: "T is 0.001 s: (gyroz + gyroz_old) * 0.0005 is the average rate times T." },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported" },
      ],
      bonus: [{ kind: "isr-time", fn: "SPIB_isr", maxUs: 1.5, label: "SPIB_isr takes at most 1.5 us" }],
      watch: ["gyroz", "bias", "heading", "numReads"],
      hints: [
        "You need two more globals: a running sum for the calibration and the previous rate for the trapezoid.",
        "Count the readings. While the count is at most 500, only add to the sum. On the 500th, divide.",
        "After calibration: `gyroz = rate - bias; heading = heading + (gyroz + gyroz_old) * 0.0005; gyroz_old = gyroz;`",
      ],
      takeaway: "Integration adds up every error, so a bias must be removed before integrating. Even then the heading drifts slowly, which is why the robot later corrects it with other sensors.",
    },
    {
      id: "imu-noise",
      kind: "code",
      mode: "write",
      tier: "practice",
      title: "Nothing reads zero",
      goal: "Measure the offset of a real gyro at rest by averaging many readings, and take it out of every later reading.",
      refs: [
        { course: "L12", slide: [29, 21], note: "why the IMU is read fast; what a gyro measures" },
        { course: "MPU-9250 specification", note: "Table 1: initial ZRO tolerance, rate noise spectral density, total RMS noise" },
        { course: "HW3" },
      ],
      brief: `
So far the chip in this game was ideal: at rest its gyro read exactly 0. A real one does not. Its product specification (Table 1) names two faults:

- **Offset** (the data sheet calls it zero-rate output): at rest the gyro reads a constant that is not 0, anywhere within +-5 degrees per second, different for every chip. The expert level "From turn rate to heading" calls it the bias.
- **Noise**: every reading jumps a little around the true value, here by about 0.16 degrees per second. No two readings are alike.

In this level the chip is a real part. Its offset is somewhere within +-5 degrees per second.

## Why one reading is not enough
You find the offset by reading the gyro while the robot stands still. But one reading is the offset **plus** a jump of noise. Take four readings at rest:

\`\`\`c
0.8   1.1   0.9   1.2
average = 4.0 / 4 = 1.0
\`\`\`

The jumps go up as often as down, so in an **average** they cancel. The more readings, the better: 100 readings make the jumps 10 times smaller, 400 make them 20 times smaller (the square root of the count).

## Your part
\`read_gz()\` is given: one reading of gyro Z in degrees per second. Write \`calibrate()\`:

1. Add up at least **100** readings, with \`DELAY_US(1000);\` between them so that each is a new sample.
2. Store the average in \`offset\`.

A loop that runs 400 times, with a counter \`i\`:

\`\`\`c
for (i = 0; i < 400; i++) {
    // one reading
}
\`\`\`

\`main()\` calls \`calibrate()\` first, then subtracts \`offset\` from every reading. The robot stands still for 700 ms, then turns at 20 degrees per second.
`,
      kit: "robot",
      durationMs: 1000,
      stimuli: [
        { at: 0, set: "IMU_REAL", value: 1 },
        { at: 0, set: "IMU_BIAS_GZ_DPS", value: -3.4 },
        { at: 700, set: "IMU_GZ_DPS", value: 20 },
      ],
      starter: imuNoise("    // TODO: average at least 100 readings into offset"),
      solution: imuNoise(`    float sum = 0;
    int16_t i;

    for (i = 0; i < 400; i++) {
        sum = sum + read_gz();
        DELAY_US(1000);
    }
    offset = sum / 400;`),
      checks: [
        { kind: "var", name: "offset", min: -3.46, max: -3.34, label: "offset is this gyro's offset, to within 0.06 degrees per second", hint: "0: calibrate() stored nothing. Off by a tenth or more: too few readings, so the noise is still in it. Far off: the sum was divided by the wrong count." },
        { kind: "var", name: "gyroz", at: 650, min: -0.7, max: 0.7, label: "At rest gyroz is 0, give or take the noise", hint: "About -3.4: the offset is not subtracted, because offset is still 0." },
        { kind: "var", name: "gyroz", at: 950, min: 19.3, max: 20.7, label: "Turning at 20 degrees per second: gyroz is 20, give or take the noise" },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported" },
      ],
      bonus: [{ kind: "var", name: "offset", min: -3.415, max: -3.385, label: "offset is right to within 0.015 degrees per second", hint: "Average more readings: 400 are enough." }],
      watch: ["offset", "gyroz"],
      hints: [
        "You need a float for the sum and an integer for the counter, both declared at the top of calibrate().",
        "Inside the loop: add `read_gz()` to the sum, then `DELAY_US(1000);`. After the loop: divide the sum by the number of readings.",
        "`float sum = 0; int16_t i; for (i = 0; i < 400; i++) { sum = sum + read_gz(); DELAY_US(1000); } offset = sum / 400;`",
      ],
      takeaway: "A real sensor has an offset and noise. Measure the offset at rest as an average of many readings, and never trust a single reading to be exact. The robot must stand still while it calibrates.",
    },
    {
      id: "imu-tilt",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Which way is down?",
      goal: "Read two accelerometer axes and one gyro axis in one burst, and compute the board's roll angle with atan2 and its roll rate.",
      refs: [{ course: "L12", slide: [38, 30], note: "accelerometer burst read" }, { course: "HW3" }, { trm: "18.3.7" }],
      brief: `
At rest the accelerometer measures only gravity: a vector of length 1 g that always points down. How that vector is split over the board's axes tells you how the board is tilted. This level measures **roll**: tipping sideways, about the X axis.

Lying flat, the reading is (0, 0, 1 g). When the board rolls, gravity moves from the Z axis to the Y axis:

\`\`\`c
roll = atan2(ay, az)      // in radians
\`\`\`

\`atan2(y, x)\` returns the angle of the point (x, y) in **radians**, in the right quadrant for any signs. Multiply by 180 / PI for degrees.

Notice that only a **ratio** of the readings appears. The scale factor cancels, so the raw numbers can be used as they are, converted to \`float\`.

The accelerometer says how far the board is tipped. The gyro says how fast it is tipping: gyro X is the turn rate about the X axis, the **roll rate**. That one needs its scale factor: \`raw * 250.0 / 32767.0\` is degrees per second.

## Your task
Nothing is given but the set-up. Write both interrupt functions:

- \`cpu_timer0_isr\`, every 1 ms: start **one** burst read that returns accelerometer Y, accelerometer Z and gyro X, each as one whole word. Decide where the read must start and how many words it needs. The register list is in the chapter's briefing.
- \`SPIB_isr\`: take the words, store the readings in \`ay_raw\`, \`az_raw\` and \`gx_raw\`, and compute \`roll\` in **degrees** and \`rollrate\` in **degrees per second**.

The test holds the board flat and still. Then it rolls it to 30 degrees while it turns at 60 degrees per second, then to -45 degrees while it turns the other way at -40.
`,
      kit: "robot",
      durationMs: 16,
      stimuli: [
        { at: 5.5, set: "IMU_AY_G", value: 0.5 },
        { at: 5.5, set: "IMU_AZ_G", value: 0.8660254 },
        { at: 5.5, set: "IMU_GX_DPS", value: 60 },
        { at: 10.5, set: "IMU_AY_G", value: -0.7071068 },
        { at: 10.5, set: "IMU_AZ_G", value: 0.7071068 },
        { at: 10.5, set: "IMU_GX_DPS", value: -40 },
      ],
      starter: `#define PI 3.1415926535897932384626433832795

__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);
void mpu_write(uint16_t reg, uint16_t value);

int16_t ay_raw = 0;
int16_t az_raw = 0;
int16_t gx_raw = 0;
float roll = 0;        // degrees
float rollrate = 0;    // degrees per second

void main(void)
{
${START}
${SPIB}
${MPU_RANGES}
${PIE_INIT}

${VECTORS()}

    while (1) {
    }
}
__interrupt void cpu_timer0_isr(void)
{
    // TODO

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void SPIB_isr(void)
{
    // TODO

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}

${MPU_WRITE}`,
      solution: `#define PI 3.1415926535897932384626433832795

__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);
void mpu_write(uint16_t reg, uint16_t value);

int16_t ay_raw = 0;
int16_t az_raw = 0;
int16_t gx_raw = 0;
float roll = 0;        // degrees
float rollrate = 0;    // degrees per second

void main(void)
{
${START}
${SPIB}
${MPU_RANGES}
${PIE_INIT}

${VECTORS()}

    while (1) {
    }
}
__interrupt void cpu_timer0_isr(void)
{
    // Start at 0x3C: [address, 0x3C] [0x3D, 0x3E] [0x3F, 0x40] [0x41, 0x42] [0x43, 0x44]
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPIFFRX.bit.RXFFIL = 5;
    SpibRegs.SPITXBUF = (0x8000 | 0x3C00);
    SpibRegs.SPITXBUF = 0x0000;
    SpibRegs.SPITXBUF = 0x0000;
    SpibRegs.SPITXBUF = 0x0000;
    SpibRegs.SPITXBUF = 0x0000;

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void SPIB_isr(void)
{
    int16_t temp;
    float ay;
    float az;

    temp = SpibRegs.SPIRXBUF;       // address byte and 0x3C: nothing useful
    ay_raw = SpibRegs.SPIRXBUF;
    az_raw = SpibRegs.SPIRXBUF;
    temp = SpibRegs.SPIRXBUF;       // the temperature
    gx_raw = SpibRegs.SPIRXBUF;
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;

    ay = ay_raw;
    az = az_raw;
    roll = atan2(ay, az) * 180.0 / PI;
    rollrate = gx_raw * 250.0 / 32767.0;

    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}

${MPU_WRITE}`,
      checks: [
        { kind: "var", name: "az_raw", at: 4.5, equals: 8192, label: "Flat: az_raw is 8192 (1 g at +-4 g)", hint: "Accelerometer Y is 0x3D and 0x3E. Start the read one register earlier so each reading is one whole word. Accelerometer Z is the word after Y." },
        { kind: "var", name: "roll", at: 4.5, min: -0.1, max: 0.1, label: "Flat: roll is 0 degrees" },
        { kind: "var", name: "rollrate", at: 4.5, min: -0.1, max: 0.1, label: "Still: rollrate is 0 degrees per second" },
        { kind: "var", name: "roll", at: 9.5, min: 29.9, max: 30.1, label: "Rolled: roll is 30 degrees", hint: "0.52 would be radians: multiply by 180 / PI. 60 would be atan2(az, ay): the Y reading comes first." },
        { kind: "var", name: "rollrate", at: 9.5, min: 59.9, max: 60.1, label: "Rolling at 60 degrees per second: rollrate is 60", hint: "Still 0: that word is the temperature, which sits between accelerometer Z and gyro X. About 7864: that is the raw count, scale it with * 250.0 / 32767.0." },
        { kind: "var", name: "roll", min: -45.1, max: -44.9, label: "Rolled the other way: roll is -45 degrees" },
        { kind: "var", name: "rollrate", min: -40.1, max: -39.9, label: "Rolling the other way: rollrate is -40", hint: "A large positive number: gx_raw must stay an int16_t, so that a negative count keeps its sign." },
        { kind: "isr", fn: "SPIB_isr", min: 15, max: 15, label: "The sensor is read once per millisecond" },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported" },
      ],
      bonus: [
        { kind: "signal", name: "SPIB_WORDS", equals: 77, label: "Only five words per read: no register before accelerometer Y or after gyro X" },
      ],
      watch: ["ay_raw", "az_raw", "gx_raw", "roll", "rollrate"],
      hints: [
        "Accelerometer Y is 0x3D and 0x3E. To get it as one word, the word before must end with 0x3C. Then write down what each later word holds, until you reach gyro X (0x43 and 0x44).",
        "Five words from 0x3C: one to throw away, accelerometer Y, accelerometer Z, the temperature (throw it away too), gyro X. RXFFIL = 5.",
        "Copy the two accelerometer counts into float variables first, then `roll = atan2(ay, az) * 180.0 / PI;` and `rollrate = gx_raw * 250.0 / 32767.0;`.",
      ],
      takeaway: "At rest an accelerometer is a tilt sensor. It stops being one as soon as the robot accelerates, which is why tilt is usually estimated from the accelerometer and the gyro together. One burst fetches both.",
    },
    {
      id: "spi-both",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Two devices, one interrupt",
      goal: "Serve the MPU-9250 and the DAN28027 from one receive interrupt: read the gyro, then send the DAN28027 a command computed from it.",
      refs: [{ course: "L10", slide: 41 }, { course: "L12", slide: 38 }, { course: "Lab 4" }, { course: "HW3" }, { trm: "18.3.7" }],
      brief: `
Both devices share SPIB and its one receive interrupt. The interrupt function must know **which transfer just ended**. The course's final project keeps that in a variable, \`CurrentChip\`, and you will build the same state machine.

Every millisecond:

1. **\`cpu_timer0_isr\`** starts the MPU-9250 burst: \`CurrentChip = MPU9250\`, \`TXDLY = 0\`, \`RXFFIL = 6\`, chip select GPIO66 low, six words from 0x3E (gyro Z is the last one).
2. **\`SPIB_isr\`, MPU-9250 done**: raise GPIO66, read the six words, compute \`gyroz\` in degrees per second. Then compute the command and start the DAN28027 message at once: \`CurrentChip = DAN28027\`, \`TXDLY = 16\`, \`RXFFIL = 3\`, chip select GPIO29 low, \`0x00DA\`, \`pwm1\`, \`pwm2\`.
3. **\`SPIB_isr\`, DAN28027 done**: raise GPIO29, read the three words into \`dan_first\`, \`dan_adc1\`, \`dan_adc2\`, and set \`TXDLY\` back to 0.

The command is a simple steering law: the faster the robot turns, the more the two PWM values move apart from the middle, 1500.

\`\`\`c
pwm1 = 1500 + 10 * gyroz;
pwm2 = 1500 - 10 * gyroz;
\`\`\`

Rules that keep the bus healthy: never have both chip selects low, read exactly as many words as were sent before clearing the interrupt flag, and give each device its \`TXDLY\`.

The test turns the board at 50 degrees per second after 5.5 ms and the other way at -20 degrees per second after 9.5 ms. It puts 1.65 V on the DAN28027's first analog input.
`,
      kit: "robot",
      durationMs: 12,
      stimuli: [
        { at: 0.1, set: "DAN_ADC1", value: 1.65 },
        { at: 5.5, set: "IMU_GZ_DPS", value: 50 },
        { at: 9.5, set: "IMU_GZ_DPS", value: -20 },
      ],
      starter: `#define MPU9250 1
#define DAN28027 2

__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);
void mpu_write(uint16_t reg, uint16_t value);

uint16_t CurrentChip = MPU9250;
int16_t readdata[6];
float gyroz = 0;
int16_t pwm1 = 1500;
int16_t pwm2 = 1500;
int16_t dan_first = 0;
int16_t dan_adc1 = 0;
int16_t dan_adc2 = 0;

void main(void)
{
${START}
${SPIB}
${MPU_RANGES}
${PIE_INIT}

${VECTORS()}

    while (1) {
    }
}

__interrupt void cpu_timer0_isr(void)
{
    // TODO: start the MPU-9250 burst

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void SPIB_isr(void)
{
    // TODO: finish whichever transfer just ended; after the MPU-9250, start the DAN28027

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}

${MPU_WRITE}`,
      solution: `#define MPU9250 1
#define DAN28027 2

__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);
void mpu_write(uint16_t reg, uint16_t value);

uint16_t CurrentChip = MPU9250;
int16_t readdata[6];
float gyroz = 0;
int16_t pwm1 = 1500;
int16_t pwm2 = 1500;
int16_t dan_first = 0;
int16_t dan_adc1 = 0;
int16_t dan_adc2 = 0;

void main(void)
{
${START}
${SPIB}
${MPU_RANGES}
${PIE_INIT}

${VECTORS()}

    while (1) {
    }
}

__interrupt void cpu_timer0_isr(void)
{
    uint16_t i;

    CurrentChip = MPU9250;
    SpibRegs.SPIFFCT.bit.TXDLY = 0;
    SpibRegs.SPIFFRX.bit.RXFFIL = 6;
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x8000 | 0x3E00);
    for (i = 0; i < 5; i++) {
        SpibRegs.SPITXBUF = 0x0000;
    }

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void SPIB_isr(void)
{
    uint16_t i;

    if (CurrentChip == MPU9250) {
        GpioDataRegs.GPCSET.bit.GPIO66 = 1;
        for (i = 0; i < 6; i++) {
            readdata[i] = SpibRegs.SPIRXBUF;
        }
        gyroz = readdata[5] * 250.0 / 32767.0;
        pwm1 = 1500 + 10 * gyroz;
        pwm2 = 1500 - 10 * gyroz;

        CurrentChip = DAN28027;
        SpibRegs.SPIFFCT.bit.TXDLY = 16;
        SpibRegs.SPIFFRX.bit.RXFFIL = 3;
        GpioDataRegs.GPACLEAR.bit.GPIO29 = 1;
        SpibRegs.SPITXBUF = 0x00DA;
        SpibRegs.SPITXBUF = pwm1;
        SpibRegs.SPITXBUF = pwm2;
    } else {
        GpioDataRegs.GPASET.bit.GPIO29 = 1;
        dan_first = SpibRegs.SPIRXBUF;
        dan_adc1 = SpibRegs.SPIRXBUF;
        dan_adc2 = SpibRegs.SPIRXBUF;
        CurrentChip = MPU9250;
        SpibRegs.SPIFFCT.bit.TXDLY = 0;
    }

    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}

${MPU_WRITE}`,
      checks: [
        { kind: "signal", name: "DAN_PWM1", at: 5.4, equals: 1500, label: "Standing still: the DAN28027 receives 1500", hint: "The DAN28027 only accepts a message that starts with 0x00DA, sent while GPIO29 is low and GPIO66 is high." },
        { kind: "var", name: "gyroz", at: 9.4, min: 49.9, max: 50.1, label: "gyroz is 50 degrees per second while turning" },
        { kind: "signal", name: "DAN_PWM1", at: 9.4, equals: 2000, tol: 1.5, label: "Turning at 50: PWM value 1 is 2000" },
        { kind: "signal", name: "DAN_PWM2", at: 9.4, equals: 1000, tol: 1.5, label: "Turning at 50: PWM value 2 is 1000" },
        { kind: "signal", name: "DAN_PWM1", equals: 1300, tol: 1.5, label: "Turning at -20: PWM value 1 is 1300" },
        { kind: "signal", name: "DAN_PWM2", equals: 1700, tol: 1.5, label: "Turning at -20: PWM value 2 is 1700" },
        { kind: "var", name: "dan_adc1", equals: 2048, label: "dan_adc1 is 2048 (1.65 V)" },
        { kind: "isr", fn: "SPIB_isr", min: 22, max: 22, label: "SPIB_isr runs twice per millisecond: once per device" },
        { kind: "signal", name: "DAN_COMMANDS", equals: 11, label: "The DAN28027 receives one complete command per millisecond" },
        { kind: "pin", pin: 66, at: 8.7, level: 1, label: "Both chip selects are high between transfers (GPIO66)" },
        { kind: "pin", pin: 29, at: 8.7, level: 1, label: "Both chip selects are high between transfers (GPIO29)" },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported", hint: "A bus conflict means both chip selects were low together." },
        { kind: "no-diagnostic", code: "dan", label: "The DAN28027 had time to prepare its replies", hint: "TXDLY must be 16 before the DAN28027's words are written." },
        { kind: "no-diagnostic", code: "mpu", label: "The MPU-9250 is used within its limits" },
      ],
      bonus: [
        { kind: "isr-time", fn: "SPIB_isr", maxUs: 3, label: "SPIB_isr takes at most 3 us" },
        { kind: "reg", reg: "SpibRegs.SPIFFCT", field: "TXDLY", at: 8.7, equals: 0, label: "TXDLY is back at 0 between transfers" },
      ],
      watch: ["CurrentChip", "gyroz", "pwm1", "pwm2", "dan_adc1"],
      inspect: ["SpibRegs.SPIFFCT", "SpibRegs.SPIFFRX"],
      hints: [
        "SPIB_isr is one `if (CurrentChip == MPU9250) { ... } else { ... }`. The flag clears and the acknowledge come after it, for both cases.",
        "In the MPU-9250 branch, read all six words first. Only then change RXFFIL to 3 and write the DAN28027's three words.",
        "In the DAN28027 branch: GPIO29 high, three reads, CurrentChip = MPU9250, TXDLY = 0.",
      ],
      takeaway: "One port, one interrupt, a variable that remembers whose turn it is. Each device brings its own chip select, word count and timing.",
    },
  ],
};
