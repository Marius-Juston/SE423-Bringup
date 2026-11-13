import type { Chapter } from "../types";

// ---- C building blocks (setupSpib() in SE423Lib.c, HW3 exercises 4 and 5) ---
const START = `    InitSysCtrl();
    InitGpio();
`;

const LED1 = `    // LED1 on GPIO22, off
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
`;

/** Pins and registers of SPIB as the course sets them: 16-bit words, 1 MHz, read on the rising edge. */
const SPIB = `    // Chip selects, both high: GPIO66 for the MPU-9250, GPIO29 for the DAN28027
    GPIO_SetupPinMux(66, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(66, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    GPIO_SetupPinMux(29, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(29, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPASET.bit.GPIO29 = 1;

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

    SpibRegs.SPICCR.bit.SPISWRESET = 0;
    SpibRegs.SPICTL.bit.CLK_PHASE = 1;        // clock rests low,
    SpibRegs.SPICCR.bit.CLKPOLARITY = 0;      // data read on the rising edge
    SpibRegs.SPICTL.bit.MASTER_SLAVE = 1;
    SpibRegs.SPICCR.bit.SPICHAR = 0xF;        // 16-bit words
    SpibRegs.SPICTL.bit.TALK = 1;
    SpibRegs.SPIPRI.bit.FREE = 1;
    SpibRegs.SPICTL.bit.SPIINTENA = 0;
    SpibRegs.SPIBRR.bit.SPI_BIT_RATE = 49;    // 1 MHz
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
    SpibRegs.SPICCR.bit.SPISWRESET = 1;
    SpibRegs.SPIFFTX.bit.TXFIFO = 1;
    SpibRegs.SPIFFRX.bit.RXFIFORESET = 1;
    SpibRegs.SPIFFRX.bit.RXFFIL = 16;         // changed before each transfer
`;

const PIE_INIT = `    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();`;

/** Timer 0 every millisecond and the SPIB receive interrupt (INT6.3), then interrupts on. */
const VECTORS = (extra = "") => `    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    PieVectTable.SPIB_RX_INT = &SPIB_isr;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, 1000);    // every 1 ms
    CpuTimer0Regs.TCR.all = 0x4000;
${extra}
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;        // timer 0 is INT1.7
    PieCtrlRegs.PIEIER6.bit.INTx3 = 1;        // SPIB receive is INT6.3
    IER |= M_INT1;
    IER |= M_INT6;
    EINT;`;

const MPU_WRITE = `// Writes one register of the MPU-9250 and waits until it is done
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

const MPU_READ = `// Reads one register of the MPU-9250
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
      refs: [{ course: "L12" }, { course: "HW3" }, { trm: "18.3.1" }],
      brief: `
The **MPU-9250** on the robot is an **IMU** (inertial measurement unit): a 3-axis gyroscope, which measures how fast the board turns, and a 3-axis accelerometer, which measures acceleration including gravity. The robot uses the gyro's Z axis to know how far it has turned.

SPI only moves bits. What the bits **mean** is decided by each device and written in its datasheet. The MPU-9250's rule is the most common one there is: the device is a list of 8-bit **registers**, each with a 7-bit address, just like the peripherals inside the F28379D.

## One transfer
A transfer starts when the chip select (GPIO66) goes low and ends when it goes high.

- The **first byte** the master sends is the address byte: bit 7 is **1 to read, 0 to write**, bits 6 to 0 are the register address.
- Every **following byte** is data. When writing, the master sends the value. When reading, the master sends anything (zeros) and the device answers with the register's value at the same time.
- After each data byte the device **adds one to the address** by itself. So one transfer can read or write a whole run of registers. This is a **burst**.

## With 16-bit words
The course sends 16-bit words, so each word is two of those bytes:

- **Write** 0x08 to register 0x1C: send \`0x1C08\`. Upper byte: address with bit 7 = 0. Lower byte: the value.
- **Read** register 0x75: send \`0x8000 | 0x7500\` = \`0xF500\`. The upper byte of the word that comes back means nothing, because the device was still listening to the address. The **lower byte is the register's value**.
- A second word in the same transfer covers the **next two** registers, and so on.

Build the words in the figure: choose read or write and a register, then add words to see a burst.

{{figure:imu-word}}

## Registers you will use
- **0x75 WHO_AM_I**: always reads 0x71. Used to test the link.
- **0x1B GYRO_CONFIG**, **0x1C ACCEL_CONFIG**: the measuring ranges. The course selects +-250 degrees per second and +-4 g.
- **0x3B to 0x48**: the measurements. Each is a signed 16-bit number split over two registers, **high byte first**: accelerometer X, Y, Z (0x3B to 0x40), then the chip's **temperature** (0x41, 0x42), then gyro X, Y, Z (0x43 to 0x48).

## From raw numbers to units
A raw reading runs from -32768 to 32767 and full scale is the selected range. The course converts with:

- gyro: \`raw * 250.0 / 32767.0\` degrees per second
- accelerometer: \`raw * 4.0 / 32767.0\` g

(The exact divisor is 32768. The course's 32767 differs by 0.003 %, far below the sensor's noise.)

Move the raw count in the figure to see the value it stands for, at both ends of the range.

{{figure:imu-scaling}}

## Limits
The MPU-9250 accepts a clock of at most 1 MHz, reads data on the rising clock edge, and wants a short pause between transfers. The course waits 10 us.
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
      refs: [{ course: "HW3" }, { course: "L12" }, { trm: "18.3.4" }],
      brief: `
Before writing code, build the numbers by hand. Each 16-bit word is two bytes: the first word of a transfer is **address byte, then one data byte**; every later word is **two data bytes**.

## The alignment trick (HW3 exercise 4)
Gyro Z is in registers **0x47** (high byte) and **0x48** (low byte). You want both in **one** received word, so that the word is the reading.

If the read started at 0x47, the first word would hold [address, 0x47] and the second [0x48, 0x49]: the reading would be split over two words. So start **one register earlier**, at 0x46 (the low byte of gyro Y). Then the first word is [address, 0x46], which you throw away, and the second word is [0x47, 0x48]: exactly gyro Z.

The same reasoning tells you where to start a burst that reads everything.

## Counting words
A burst that touches N registers needs N + 1 bytes: the address byte plus N data bytes. Divide by 2 for the number of 16-bit words. If N + 1 is odd, start one register earlier or write one register more.
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
          label: "Word that writes 0x08 to ACCEL_CONFIG (0x1C)",
          format: "hex",
          answer: 0x1c08,
          why: "Bit 7 of the address byte is 0 for a write: 0x1C in the upper byte, the value 0x08 in the lower byte.",
        },
        {
          id: "gz",
          label: "First word of the two-word read that puts gyro Z in the second word",
          format: "hex",
          answer: 0xc600,
          why: "Start at 0x46, one before GYRO_ZOUT_H: 0x8000 | 0x4600 = 0xC600. This is the line in HW3 exercise 4.",
        },
        {
          id: "n",
          label: "16-bit words in a burst that reads registers 0x3A to 0x48",
          answer: 8,
          why: "0x3A to 0x48 is 15 registers, plus the address byte: 16 bytes = 8 words. The course reads from 0x3A (a status register it ignores) so that every measurement lands in one word.",
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
        "Count the registers from 0x3A to 0x48 inclusive, add the address byte, divide by two.",
        "Full scale, 250 degrees per second, is 32768 counts (32767 in the course's formula).",
      ],
      takeaway: "Start a 16-bit read one register before the value you want, and every 16-bit measurement arrives as one whole word.",
    },
    {
      id: "imu-order",
      kind: "order",
      title: "One transfer, step by step",
      goal: "Put the steps of reading one MPU-9250 register in order.",
      refs: [{ course: "HW3" }, { trm: "18.3.7" }, { trm: "18.3.2" }],
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
      refs: [{ course: "HW3" }, { course: "L12" }, { trm: "18.3.7" }],
      brief: `
SPIB is set up as in the SPI chapter: 16-bit words, 1 MHz, clock resting low, data read on the rising edge. GPIO66 is the MPU-9250's chip select.

Complete \`mpu_read(reg)\`. It reads one register and returns its 8-bit value:

1. chip select low
2. send one word: read bit (\`0x8000\`), the register address in the upper byte (\`reg << 8\`), zeros in the lower byte
3. wait until one word has arrived
4. chip select high
5. read the word from \`SPIRXBUF\` and keep its lower byte (\`& 0x00FF\`)

\`main()\` then reads two registers whose values are known:

- **0x75 WHO_AM_I** must be 0x71
- **0x6B PWR_MGMT_1** is 0x01 after power-up

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
        { kind: "var", name: "whoami", equals: 0x71, label: "whoami is 0x71", hint: "0xFFFF or 0xFF means no device answered: is the chip select low while the word is sent? 0 means the read bit 0x8000 is missing." },
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
      id: "imu-config",
      kind: "code",
      mode: "write",
      title: "Choosing the range",
      goal: "Write the function that writes an MPU-9250 register, set the course's ranges and filter, and read them back.",
      refs: [{ course: "HW3" }, { course: "L12" }, { trm: "18.3.7" }],
      brief: `
After power-up the accelerometer measures +-2 g. The course changes that and switches on the chip's low-pass filters with these register values (from HW3 exercise 5):

- **0x1A CONFIG** = 0x02: gyro low-pass filter
- **0x1C ACCEL_CONFIG** = 0x08: range **+-4 g**
- **0x1D ACCEL_CONFIG2** = 0x06: accelerometer low-pass filter

## Write mpu_write()
\`mpu_write(reg, value)\` writes one register. It is \`mpu_read\` with a different word: the address in the upper byte **without** the read bit, the value in the lower byte. A word still comes back while you send, and it must be read out of the FIFO and thrown away. End with \`DELAY_US(10);\`.

## Then in main()
1. Write the three registers.
2. Read them back with the given \`mpu_read\` into \`cfg1a\`, \`cfg1c\` and \`cfg1d\`. Reading back what you wrote is the standard check that a device was configured.

\`main()\` then calls the given \`read_accel_z()\`. The board lies flat, so the Z axis feels 1 g. With the +-2 g range that reads 16384. With +-4 g the same 1 g is only a quarter of full scale: **8192**.

See it in the figure: choose an accelerometer range, then press "1 g".

{{figure:imu-scaling}}
`,
      kit: "robot",
      durationMs: 2,
      starter: `uint16_t mpu_read(uint16_t reg);
int16_t read_accel_z(void);

uint16_t cfg1a = 0;
uint16_t cfg1c = 0;
uint16_t cfg1d = 0;
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
    // TODO: write 0x02 to 0x1A, 0x08 to 0x1C and 0x06 to 0x1D

    // TODO: read the three registers back into cfg1a, cfg1c, cfg1d

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
      solution: `uint16_t mpu_read(uint16_t reg);
int16_t read_accel_z(void);

uint16_t cfg1a = 0;
uint16_t cfg1c = 0;
uint16_t cfg1d = 0;
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
    mpu_write(0x1A, 0x02);
    mpu_write(0x1C, 0x08);
    mpu_write(0x1D, 0x06);

    cfg1a = mpu_read(0x1A);
    cfg1c = mpu_read(0x1C);
    cfg1d = mpu_read(0x1D);

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
        { kind: "var", name: "cfg1a", equals: 0x02, label: "Register 0x1A reads back 0x02" },
        { kind: "var", name: "cfg1c", equals: 0x08, label: "Register 0x1C reads back 0x08", hint: "If it reads 0, the write did not reach the device: check the chip select and that the word is (reg << 8) | value, without 0x8000." },
        { kind: "var", name: "cfg1d", equals: 0x06, label: "Register 0x1D reads back 0x06" },
        { kind: "var", name: "az_raw", equals: 8192, label: "1 g on the Z axis now reads 8192: the range is +-4 g", hint: "16384 means the accelerometer is still at +-2 g." },
        { kind: "reg", reg: "SpibRegs.SPIFFRX", field: "RXFFST", equals: 0, label: "The receive FIFO is empty at the end", hint: "A write receives a word too. Read it out in mpu_write." },
        { kind: "pin", pin: 66, at: 1.5, level: 1, label: "The chip select is high after the transfers" },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported" },
      ],
      watch: ["cfg1a", "cfg1c", "cfg1d", "az_raw"],
      hints: [
        "Copy the body of mpu_read. Only the word changes, and the received word is not used.",
        "The word is `(reg << 8) | value`. Read SPIRXBUF into a local variable after the transfer so the FIFO is empty again.",
        "`mpu_write(0x1A, 0x02); mpu_write(0x1C, 0x08); mpu_write(0x1D, 0x06);` then `cfg1a = mpu_read(0x1A);` and so on.",
      ],
      takeaway: "The range decides what a raw number means. Whenever you change a range register, the scale factor in your code changes with it.",
    },
    {
      id: "imu-gyroz",
      kind: "code",
      mode: "write",
      title: "How fast are we turning?",
      goal: "Read the gyro's Z axis every millisecond with interrupts, as in HW3 exercise 4, and convert it to degrees per second.",
      refs: [{ course: "HW3" }, { course: "L12" }, { trm: "18.2.3" }, { trm: "18.3.7" }],
      brief: `
The robot reads its gyro 1000 times a second. Waiting in a loop for each reading is out of the question, so the read is split over two interrupts, the pattern from the SPI chapter:

- **\`cpu_timer0_isr\`, every 1 ms: start the read.** Chip select low, \`RXFFIL = 2\`, then the two words of HW3 exercise 4:

\`\`\`c
SpibRegs.SPITXBUF = (0x8000 | 0x4600);  // read, starting at 0x46
SpibRegs.SPITXBUF = 0x0000;             // 16 more clocks: registers 0x47 and 0x48
\`\`\`

- **\`SPIB_isr\`, 32 us later: take the result.** Read both words. The first is of no use. The second is the gyro Z reading: store it in \`gyroz_raw\` (an \`int16_t\`, so negative rates come out negative). Raise the chip select, clear the two FIFO flags, acknowledge group 6.

Then convert in \`SPIB_isr\`:

\`\`\`c
gyroz = gyroz_raw * 250.0 / 32767.0;   // degrees per second
\`\`\`

The gyro range is +-250 degrees per second, set in \`main()\`. The test turns the board at -90 degrees per second after 5.5 ms (the "Turn rate about Z" knob does the same by hand).
`,
      kit: "robot",
      durationMs: 12,
      stimuli: [{ at: 5.5, set: "IMU_GZ_DPS", value: -90 }],
      starter: `__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);
void mpu_write(uint16_t reg, uint16_t value);

int16_t spivalue1 = 0;
int16_t gyroz_raw = 0;
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

// Every 1 ms: start reading gyro Z
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
int16_t gyroz_raw = 0;
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

// Every 1 ms: start reading gyro Z
__interrupt void cpu_timer0_isr(void)
{
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPIFFRX.bit.RXFFIL = 2;
    SpibRegs.SPITXBUF = (0x8000 | 0x4600);
    SpibRegs.SPITXBUF = 0x0000;

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

// When the two words have arrived
__interrupt void SPIB_isr(void)
{
    spivalue1 = SpibRegs.SPIRXBUF;
    gyroz_raw = SpibRegs.SPIRXBUF;
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;

    gyroz = gyroz_raw * 250.0 / 32767.0;

    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}

${MPU_WRITE}`,
      checks: [
        { kind: "isr", fn: "SPIB_isr", min: 11, max: 11, label: "SPIB_isr runs once per millisecond", hint: "It runs when RXFFST >= RXFFIL: two words sent, RXFFIL = 2, and both words read before the flag is cleared." },
        { kind: "var", name: "gyroz", at: 5.2, min: -0.01, max: 0.01, label: "gyroz is 0 while the board is still" },
        { kind: "var", name: "gyroz_raw", equals: -11796, label: "gyroz_raw is -11796 while turning at -90 degrees per second", hint: "Any other number comes from another register: the read must start at 0x46 and the reading is the second word received." },
        { kind: "var", name: "gyroz", min: -90.05, max: -89.95, label: "gyroz is -90 degrees per second", hint: "A large positive number instead of -90 means gyroz_raw is unsigned: it must be an int16_t." },
        { kind: "pin", pin: 66, at: 7.5, level: 1, label: "The chip select is high between reads" },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported" },
      ],
      bonus: [{ kind: "isr-time", fn: "cpu_timer0_isr", maxUs: 2, label: "The timer interrupt returns within 2 us" }],
      watch: ["gyroz_raw", "gyroz"],
      hints: [
        "The timer function is four lines: chip select low, RXFFIL = 2, two writes to SPITXBUF.",
        "In SPIB_isr the first read of SPIRXBUF goes to spivalue1, the second to gyroz_raw.",
        "`gyroz = gyroz_raw * 250.0 / 32767.0;` and do not forget `GpioDataRegs.GPCSET.bit.GPIO66 = 1;` and the two flag clears.",
      ],
      takeaway: "Start at 0x46, throw the first word away, and the second word is gyro Z. One millisecond later, do it again.",
    },
    {
      id: "imu-debug",
      kind: "code",
      mode: "debug",
      title: "The word in the middle",
      goal: "This program reads all six axes in one burst, but most of the values are wrong. Find the two indexing mistakes.",
      refs: [{ course: "HW3" }, { course: "L12" }, { trm: "18.3.7" }],
      brief: `
This is the course's full read: every millisecond one burst of **eight** words, starting at register 0x3A. \`SPIB_isr\` copies the eight received words into \`readdata[]\` and converts them.

Work out what each word holds. The first word is the address byte plus register 0x3A. Each later word is the next two registers:

\`\`\`c
readdata[0]   address byte, 0x3A   (nothing useful)
readdata[1]   0x3B, 0x3C           ?
readdata[2]   0x3D, 0x3E           ?
...
\`\`\`

Continue the list up to \`readdata[7]\`, using the register list from the briefing: accelerometer X, Y, Z from 0x3B, then the temperature at 0x41, then gyro X, Y, Z from 0x43.

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

int16_t readdata[8];
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

// Every 1 ms: start a burst read of registers 0x3A to 0x48
__interrupt void cpu_timer0_isr(void)
{
    uint16_t i;

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPIFFRX.bit.RXFFIL = 8;
    SpibRegs.SPITXBUF = (0x8000 | 0x3A00);
    for (i = 0; i < 7; i++) {
        SpibRegs.SPITXBUF = 0x0000;
    }

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void SPIB_isr(void)
{
    uint16_t i;

    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    for (i = 0; i < 8; i++) {
        readdata[i] = SpibRegs.SPIRXBUF;
    }

    accelx = readdata[0] * 4.0 / 32767.0;
    accely = readdata[1] * 4.0 / 32767.0;
    accelz = readdata[2] * 4.0 / 32767.0;
    gyrox = readdata[4] * 250.0 / 32767.0;
    gyroy = readdata[5] * 250.0 / 32767.0;
    gyroz = readdata[6] * 250.0 / 32767.0;

    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}

${MPU_WRITE}`,
      solution: `__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);
void mpu_write(uint16_t reg, uint16_t value);

int16_t readdata[8];
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

// Every 1 ms: start a burst read of registers 0x3A to 0x48
__interrupt void cpu_timer0_isr(void)
{
    uint16_t i;

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPIFFRX.bit.RXFFIL = 8;
    SpibRegs.SPITXBUF = (0x8000 | 0x3A00);
    for (i = 0; i < 7; i++) {
        SpibRegs.SPITXBUF = 0x0000;
    }

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void SPIB_isr(void)
{
    uint16_t i;

    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    for (i = 0; i < 8; i++) {
        readdata[i] = SpibRegs.SPIRXBUF;
    }

    // readdata[0] is the address byte and 0x3A, readdata[4] is the temperature
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
      checks: [
        { kind: "var", name: "accelx", min: 0.499, max: 0.501, label: "accelx is 0.5 g", hint: "readdata[0] holds the address byte and register 0x3A, not a measurement." },
        { kind: "var", name: "accely", min: -0.251, max: -0.249, label: "accely is -0.25 g" },
        { kind: "var", name: "accelz", min: 0.999, max: 1.001, label: "accelz is 1 g" },
        { kind: "var", name: "gyrox", min: 59.95, max: 60.05, label: "gyrox is 60 degrees per second", hint: "The word after accelerometer Z is the temperature. The gyro starts one word later." },
        { kind: "var", name: "gyroy", min: -20.05, max: -19.95, label: "gyroy is -20 degrees per second" },
        { kind: "var", name: "gyroz", min: 29.95, max: 30.05, label: "gyroz is 30 degrees per second" },
        { kind: "signal", name: "SPIB_TX", at: 3.5, equals: 0, label: "The transfer is unchanged: eight words from 0x3A" },
        { kind: "isr", fn: "SPIB_isr", min: 7, max: 7, label: "SPIB_isr still runs once per millisecond" },
      ],
      watch: ["accelx", "accely", "accelz", "gyrox", "gyroy", "gyroz"],
      hints: [
        "accelz shows -0.25, which is the Y value. Everything in the accelerometer is one place too early.",
        "gyrox shows about 10.2, though no axis turns at that rate: it is the temperature word, readdata[4]. The gyro values are one place late.",
        "Accelerometer: readdata[1], [2], [3]. Gyro: readdata[5], [6], [7].",
      ],
      takeaway: "A burst gives you everything between the first and the last register, wanted or not. Write the list of what each word holds before you index into it.",
    },
    {
      id: "dan-xfer",
      kind: "code",
      mode: "complete",
      title: "The other chip on the bus",
      goal: "Complete the three-word exchange with the DAN28027: send it two PWM values and receive its two ADC readings.",
      refs: [{ course: "L12" }, { course: "Lab 4" }, { trm: "18.3.7" }, { trm: "18.3.3" }],
      brief: `
The second device on SPIB is the **DAN28027**, a small TI microcontroller on the robot board. It makes two extra PWM outputs and measures two analog inputs. Its chip select is **GPIO29**. Note the port: GPIO29 is in port **A**, GPIO66 was in port C.

Its protocol is not a register list. It is a fixed message of three 16-bit words, defined by the program running on it:

\`\`\`c
master sends      DAN28027 answers
0x00DA            (nothing useful)
PWM value 1       ADC reading 1    (0 to 4095)
PWM value 2       ADC reading 2    (0 to 4095)
\`\`\`

\`0x00DA\` is a start code: it tells the DAN28027 that a new message begins. The PWM values are compare values from 0 to 3000 (1500 is half).

## It needs time to think
The DAN28027 is a slave built from a program, not from logic gates. After each word it runs an interrupt function that prepares the next reply. With the words back to back it would not be ready in time. So the course inserts a pause between the words of a message:

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

The test puts 1.65 V and 1.0 V on the DAN28027's two analog inputs. Its ADC is 12 bits over 0 to 3.3 V.
`,
      kit: "robot",
      durationMs: 6,
      stimuli: [
        { at: 0.1, set: "DAN_ADC1", value: 1.65 },
        { at: 0.1, set: "DAN_ADC2", value: 1.0 },
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
        { kind: "var", name: "dan_adc1", equals: 2048, label: "dan_adc1 is 2048 (1.65 V)", hint: "The first word received is not a reading. The ADC values are the second and third." },
        { kind: "var", name: "dan_adc2", equals: 1241, label: "dan_adc2 is 1241 (1.0 V)" },
        { kind: "var", name: "volts1", min: 1.649, max: 1.651, label: "volts1 is 1.65 V" },
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
      refs: [{ course: "HW3" }, { course: "Lab 4" }, { course: "HW1" }, { trm: "18.3.7" }],
      brief: `
Put the chapter together: a burst read driven by two interrupts, scaling, an LED and the serial port.

\`main()\` is complete: SPIB, the MPU-9250 ranges (+-250 degrees per second, +-4 g), LED1, timer 0 every 1 ms, the SPIB receive interrupt and the serial port.

## What to write
**\`cpu_timer0_isr\`**: start the course's burst read: eight words from register 0x3A (\`0x8000 | 0x3A00\`, then seven words of zeros), with the chip select low and the right \`RXFFIL\`.

**\`SPIB_isr\`**:

1. Raise the chip select and read the eight words into \`readdata[]\`.
2. Convert the two values this program needs: \`accelz\` in g (\`* 4.0 / 32767.0\`) and \`gyroz\` in degrees per second (\`* 250.0 / 32767.0\`). Use the list of the previous level to find their words.
3. LED1 (GPIO22) is on while the board turns faster than 20 degrees per second in either direction (\`fabs(gyroz) > 20.0\`), off otherwise.
4. Count the reads in \`numReads\`. Every 250th read set \`UARTPrint = 1\`.
5. Clear the two FIFO flags and acknowledge group 6.

**\`while (1)\` loop**: when \`UARTPrint\` is 1, print and clear the flag. One digit after the point for the rate, two for the acceleration:

\`\`\`c
gz:45.0 az:1.00
\`\`\`

End the line with \`\\r\\n\`. The test turns the board at 45 degrees per second between 300 ms and 600 ms.
`,
      kit: "robot",
      durationMs: 1100,
      stimuli: [
        { at: 300, set: "IMU_GZ_DPS", value: 45 },
        { at: 600, set: "IMU_GZ_DPS", value: 0 },
      ],
      starter: `__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);
void mpu_write(uint16_t reg, uint16_t value);

int16_t readdata[8];
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
    // TODO: start the eight-word burst read from 0x3A

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

int16_t readdata[8];
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
    SpibRegs.SPIFFRX.bit.RXFFIL = 8;
    SpibRegs.SPITXBUF = (0x8000 | 0x3A00);
    for (i = 0; i < 7; i++) {
        SpibRegs.SPITXBUF = 0x0000;
    }

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void SPIB_isr(void)
{
    uint16_t i;

    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    for (i = 0; i < 8; i++) {
        readdata[i] = SpibRegs.SPIRXBUF;
    }

    accelz = readdata[3] * 4.0 / 32767.0;
    gyroz = readdata[7] * 250.0 / 32767.0;

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
        { kind: "serial", matches: "^gz:0\\.0 az:1\\.00\\r\\ngz:45\\.0 az:1\\.00\\r\\ngz:0\\.0 az:1\\.00\\r\\n", label: "The lines are gz:0.0 az:1.00, then gz:45.0 az:1.00, then gz:0.0 az:1.00", hint: "gyro Z is readdata[7] and accelerometer Z is readdata[3]. Use %.1f and %.2f." },
        { kind: "serial-period", periodMs: 250, label: "A line is printed every 250 ms" },
        { kind: "led", led: "LED1", at: 200, on: false, label: "LED1 is off while the board is still" },
        { kind: "led", led: "LED1", at: 450, on: true, label: "LED1 is on while the board turns at 45 degrees per second" },
        { kind: "led", led: "LED1", at: 800, on: false, label: "LED1 goes off again when the turn ends" },
        { kind: "latency", led: "LED1", after: 300, withinUs: 1300, label: "LED1 reacts within 1.3 ms of the turn starting" },
        { kind: "isr", fn: "SPIB_isr", min: 1095, max: 1100, label: "The sensor is read once per millisecond" },
        { kind: "no-diagnostic", code: "print-in-isr", label: "Nothing is printed inside an interrupt function" },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported" },
        { kind: "no-diagnostic", code: "mpu", label: "The MPU-9250 is used within its limits" },
      ],
      bonus: [{ kind: "isr-time", fn: "SPIB_isr", maxUs: 4, label: "SPIB_isr takes at most 4 us" }],
      watch: ["gyroz", "accelz", "numReads"],
      hints: [
        "Both interrupt functions are close to those of \"The word in the middle\". Start from there.",
        "Eight words: RXFFIL = 8, one write of 0x8000 | 0x3A00 and seven of 0, eight reads of SPIRXBUF.",
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
      title: "Thirteen registers, one transfer",
      goal: "Write the MPU-9250's registers 0x13 to 0x1F in a single burst, as step 2 of HW3's setupSpib() asks.",
      refs: [{ course: "HW3" }, { course: "L12" }, { trm: "18.3.7" }],
      brief: `
The course's \`setupSpib()\` configures the MPU-9250 by writing 13 registers in a row, 0x13 to 0x1F, with **one** chip-select pulse. Most get 0x00. These four do not:

\`\`\`c
0x19 = 0x13     0x1A = 0x02     0x1C = 0x08     0x1D = 0x06
\`\`\`

A burst write is one address byte followed by the data bytes, and the device counts the address up by itself. In 16-bit words:

\`\`\`c
word 1:  address 0x13 (write), value for 0x13
word 2:  value for 0x14, value for 0x15
word 3:  value for 0x16, value for 0x17
...
\`\`\`

13 registers plus the address byte are 14 bytes: **7 words**. Each word after the first holds two values: the upper byte is the lower-numbered register.

## Your part
The first word is given. Add the other six, then fix the number of words the loop waits for and the number of words read out afterwards (the course calls these reads "dummy reads": the words mean nothing, but they must leave the FIFO).

\`main()\` reads four of the registers back to check your burst.
`,
      kit: "robot",
      durationMs: 2,
      starter: `uint16_t mpu_read(uint16_t reg);

uint16_t r19 = 0;
uint16_t r1a = 0;
uint16_t r1c = 0;
uint16_t r1d = 0;

void main(void)
{
    uint16_t temp;
    uint16_t i;
${START}
${SPIB}
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x1300 | 0x0000);    // address 0x13, value for 0x13
    // TODO: six more words, for registers 0x14 to 0x1F

    while (SpibRegs.SPIFFRX.bit.RXFFST != 1); // TODO: wait for all the words
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    for (i = 0; i < 1; i++) {                 // TODO: read all of them out
        temp = SpibRegs.SPIRXBUF;
    }
    DELAY_US(10);

    r19 = mpu_read(0x19);
    r1a = mpu_read(0x1A);
    r1c = mpu_read(0x1C);
    r1d = mpu_read(0x1D);

    while (1) {
    }
}

${MPU_READ}`,
      solution: `uint16_t mpu_read(uint16_t reg);

uint16_t r19 = 0;
uint16_t r1a = 0;
uint16_t r1c = 0;
uint16_t r1d = 0;

void main(void)
{
    uint16_t temp;
    uint16_t i;
${START}
${SPIB}
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x1300 | 0x0000);    // address 0x13, value for 0x13
    SpibRegs.SPITXBUF = (0x0000 | 0x0000);    // 0x14, 0x15
    SpibRegs.SPITXBUF = (0x0000 | 0x0000);    // 0x16, 0x17
    SpibRegs.SPITXBUF = (0x0000 | 0x0013);    // 0x18, 0x19
    SpibRegs.SPITXBUF = (0x0200 | 0x0000);    // 0x1A, 0x1B
    SpibRegs.SPITXBUF = (0x0800 | 0x0006);    // 0x1C, 0x1D
    SpibRegs.SPITXBUF = (0x0000 | 0x0000);    // 0x1E, 0x1F

    while (SpibRegs.SPIFFRX.bit.RXFFST != 7);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    for (i = 0; i < 7; i++) {
        temp = SpibRegs.SPIRXBUF;
    }
    DELAY_US(10);

    r19 = mpu_read(0x19);
    r1a = mpu_read(0x1A);
    r1c = mpu_read(0x1C);
    r1d = mpu_read(0x1D);

    while (1) {
    }
}

${MPU_READ}`,
      checks: [
        { kind: "var", name: "r19", equals: 0x13, label: "Register 0x19 holds 0x13", hint: "0x19 is the lower byte of the word that covers 0x18 and 0x19." },
        { kind: "var", name: "r1a", equals: 0x02, label: "Register 0x1A holds 0x02", hint: "0x1A is the upper byte of its word: 0x0200." },
        { kind: "var", name: "r1c", equals: 0x08, label: "Register 0x1C holds 0x08" },
        { kind: "var", name: "r1d", equals: 0x06, label: "Register 0x1D holds 0x06" },
        { kind: "signal", name: "SPIB_WORDS", equals: 11, label: "The burst is 7 words (plus 4 for reading back)", hint: "Write all 13 registers in one transfer: 7 words between one chip select low and one high." },
        { kind: "reg", reg: "SpibRegs.SPIFFRX", field: "RXFFST", equals: 0, label: "The receive FIFO is empty at the end" },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported" },
      ],
      watch: ["r19", "r1a", "r1c", "r1d"],
      hints: [
        "Write down the pairs: (0x14, 0x15), (0x16, 0x17), (0x18, 0x19), (0x1A, 0x1B), (0x1C, 0x1D), (0x1E, 0x1F).",
        "The four special values land in 0x0013, 0x0200 and 0x0806.",
        "Seven words are sent: wait for RXFFST != 7 and read SPIRXBUF seven times.",
      ],
      takeaway: "One address byte, then as many data bytes as you like. Seven words sent, seven dummy reads.",
    },
    {
      id: "dan-debug",
      kind: "code",
      mode: "debug",
      tier: "practice",
      title: "Two chips answering",
      goal: "The DAN28027 exchange returns nonsense. Fix the chip select mistake and the missing pause between words.",
      refs: [{ course: "L12" }, { course: "Lab 4" }, { trm: "18.3.7" }, { trm: "18.3.3" }],
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
      refs: [{ course: "L12" }, { course: "Lab 4" }, { course: "HW3" }, { trm: "18.3.7" }],
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
      bonus: [{ kind: "isr-time", fn: "SPIB_isr", maxUs: 3, label: "SPIB_isr takes at most 3 us" }],
      watch: ["gyroz", "bias", "heading", "numReads"],
      hints: [
        "You need two more globals: a running sum for the calibration and the previous rate for the trapezoid.",
        "Count the readings. While the count is at most 500, only add to the sum. On the 500th, divide.",
        "After calibration: `gyroz = rate - bias; heading = heading + (gyroz + gyroz_old) * 0.0005; gyroz_old = gyroz;`",
      ],
      takeaway: "Integration adds up every error, so a bias must be removed before integrating. Even then the heading drifts slowly, which is why the robot later corrects it with other sensors.",
    },
    {
      id: "imu-tilt",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Which way is down?",
      goal: "Read the three accelerometer axes in one burst and compute the board's roll and pitch angles with atan2.",
      refs: [{ course: "L12" }, { course: "HW3" }, { trm: "18.3.7" }],
      brief: `
At rest the accelerometer measures only gravity: a vector of length 1 g that always points down. How that vector is split over the board's X, Y and Z axes tells you how the board is tilted.

Lying flat, the reading is (0, 0, 1 g). Define the two tilt angles as:

\`\`\`c
roll  = atan2(ay, az)                          // tipping sideways, about the X axis
pitch = atan2(-ax, sqrt(ay * ay + az * az))    // nose up or down, about the Y axis
\`\`\`

\`atan2(y, x)\` returns the angle of the point (x, y) in **radians**, in the right quadrant for any signs. Multiply by 180 / PI for degrees.

Notice that only **ratios** of the readings appear. The scale factor cancels, so the raw numbers can be used as they are, converted to \`float\`.

## Your task
Nothing is given but the set-up. Write both interrupt functions:

- \`cpu_timer0_isr\`, every 1 ms: start a burst read that returns the three accelerometer readings, each as one whole word. Decide where the read must start and how many words it needs.
- \`SPIB_isr\`: take the words, store the readings in \`ax_raw\`, \`ay_raw\`, \`az_raw\`, and compute \`roll\` and \`pitch\` in **degrees**.

The test holds the board flat, then rolls it by 30 degrees, then pitches it up by 20 degrees.
`,
      kit: "robot",
      durationMs: 16,
      stimuli: [
        { at: 5.5, set: "IMU_AY_G", value: 0.5 },
        { at: 5.5, set: "IMU_AZ_G", value: 0.8660254 },
        { at: 10.5, set: "IMU_AX_G", value: -0.3420201 },
        { at: 10.5, set: "IMU_AY_G", value: 0 },
        { at: 10.5, set: "IMU_AZ_G", value: 0.9396926 },
      ],
      starter: `#define PI 3.1415926535897932384626433832795

__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);
void mpu_write(uint16_t reg, uint16_t value);

int16_t ax_raw = 0;
int16_t ay_raw = 0;
int16_t az_raw = 0;
float roll = 0;        // degrees
float pitch = 0;       // degrees

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

int16_t ax_raw = 0;
int16_t ay_raw = 0;
int16_t az_raw = 0;
float roll = 0;        // degrees
float pitch = 0;       // degrees

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
    // Start at 0x3A: [address, 0x3A] [0x3B, 0x3C] [0x3D, 0x3E] [0x3F, 0x40]
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPIFFRX.bit.RXFFIL = 4;
    SpibRegs.SPITXBUF = (0x8000 | 0x3A00);
    SpibRegs.SPITXBUF = 0x0000;
    SpibRegs.SPITXBUF = 0x0000;
    SpibRegs.SPITXBUF = 0x0000;

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void SPIB_isr(void)
{
    int16_t temp;
    float ax;
    float ay;
    float az;

    temp = SpibRegs.SPIRXBUF;
    ax_raw = SpibRegs.SPIRXBUF;
    ay_raw = SpibRegs.SPIRXBUF;
    az_raw = SpibRegs.SPIRXBUF;
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;

    ax = ax_raw;
    ay = ay_raw;
    az = az_raw;
    roll = atan2(ay, az) * 180.0 / PI;
    pitch = atan2(-ax, sqrt(ay * ay + az * az)) * 180.0 / PI;

    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}

${MPU_WRITE}`,
      checks: [
        { kind: "var", name: "az_raw", at: 4.5, equals: 8192, label: "Flat: az_raw is 8192 (1 g at +-4 g)", hint: "The accelerometer starts at 0x3B. Start the read one register earlier so each axis is one whole word." },
        { kind: "var", name: "roll", at: 4.5, min: -0.1, max: 0.1, label: "Flat: roll is 0 degrees" },
        { kind: "var", name: "pitch", at: 4.5, min: -0.1, max: 0.1, label: "Flat: pitch is 0 degrees" },
        { kind: "var", name: "roll", at: 9.5, min: 29.9, max: 30.1, label: "Rolled: roll is 30 degrees", hint: "0.52 would be radians: multiply by 180 / PI." },
        { kind: "var", name: "pitch", at: 9.5, min: -0.1, max: 0.1, label: "Rolled: pitch is still 0 degrees" },
        { kind: "var", name: "pitch", min: 19.9, max: 20.1, label: "Pitched: pitch is 20 degrees" },
        { kind: "var", name: "roll", min: -0.1, max: 0.1, label: "Pitched: roll is back at 0 degrees" },
        { kind: "isr", fn: "SPIB_isr", min: 15, max: 15, label: "The sensor is read once per millisecond" },
        { kind: "no-diagnostic", code: "spi", label: "No SPI problem reported" },
      ],
      bonus: [
        { kind: "signal", name: "SPIB_WORDS", equals: 62, label: "Only four words per read: nothing more than the accelerometer" },
      ],
      watch: ["ax_raw", "ay_raw", "az_raw", "roll", "pitch"],
      hints: [
        "Accelerometer X is 0x3B and 0x3C. To get it as one word, the word before must end with 0x3A.",
        "Four words from 0x3A: one to throw away, then X, Y, Z. RXFFIL = 4.",
        "Copy the raw values into float variables first, then `roll = atan2(ay, az) * 180.0 / PI;`.",
      ],
      takeaway: "At rest an accelerometer is a tilt sensor. It stops being one as soon as the robot accelerates, which is why tilt is usually estimated from the accelerometer and the gyro together.",
    },
    {
      id: "spi-both",
      kind: "code",
      mode: "write",
      tier: "expert",
      title: "Two devices, one interrupt",
      goal: "Serve the MPU-9250 and the DAN28027 from one receive interrupt: read the gyro, then send the DAN28027 a command computed from it.",
      refs: [{ course: "L12" }, { course: "Lab 4" }, { course: "HW3" }, { trm: "18.3.7" }],
      brief: `
Both devices share SPIB and its one receive interrupt. The interrupt function must know **which transfer just ended**. The course's final project keeps that in a variable, \`CurrentChip\`, and you will build the same state machine.

Every millisecond:

1. **\`cpu_timer0_isr\`** starts the MPU-9250 burst: \`CurrentChip = MPU9250\`, \`TXDLY = 0\`, \`RXFFIL = 8\`, chip select GPIO66 low, eight words from 0x3A.
2. **\`SPIB_isr\`, MPU-9250 done**: raise GPIO66, read the eight words, compute \`gyroz\` in degrees per second. Then compute the command and start the DAN28027 message at once: \`CurrentChip = DAN28027\`, \`TXDLY = 16\`, \`RXFFIL = 3\`, chip select GPIO29 low, \`0x00DA\`, \`pwm1\`, \`pwm2\`.
3. **\`SPIB_isr\`, DAN28027 done**: raise GPIO29, read the three words into \`dan_first\`, \`dan_adc1\`, \`dan_adc2\`, and set \`TXDLY\` back to 0.

The command is a simple steering law: the faster the robot turns, the more the two PWM values move apart from the middle, 1500.

\`\`\`c
pwm1 = 1500 + 10 * gyroz;
pwm2 = 1500 - 10 * gyroz;
\`\`\`

Rules that keep the bus healthy: never have both chip selects low, read exactly as many words as were sent before clearing the interrupt flag, and give each device its \`TXDLY\`.

The test turns the board at 50 degrees per second after 5.5 ms and puts 1.65 V on the DAN28027's first analog input.
`,
      kit: "robot",
      durationMs: 12,
      stimuli: [
        { at: 0.1, set: "DAN_ADC1", value: 1.65 },
        { at: 5.5, set: "IMU_GZ_DPS", value: 50 },
      ],
      starter: `#define MPU9250 1
#define DAN28027 2

__interrupt void cpu_timer0_isr(void);
__interrupt void SPIB_isr(void);
void mpu_write(uint16_t reg, uint16_t value);

uint16_t CurrentChip = MPU9250;
int16_t readdata[8];
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
int16_t readdata[8];
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
    SpibRegs.SPIFFRX.bit.RXFFIL = 8;
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x8000 | 0x3A00);
    for (i = 0; i < 7; i++) {
        SpibRegs.SPITXBUF = 0x0000;
    }

    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}

__interrupt void SPIB_isr(void)
{
    uint16_t i;

    if (CurrentChip == MPU9250) {
        GpioDataRegs.GPCSET.bit.GPIO66 = 1;
        for (i = 0; i < 8; i++) {
            readdata[i] = SpibRegs.SPIRXBUF;
        }
        gyroz = readdata[7] * 250.0 / 32767.0;
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
        { kind: "var", name: "gyroz", min: 49.9, max: 50.1, label: "gyroz is 50 degrees per second while turning" },
        { kind: "signal", name: "DAN_PWM1", equals: 2000, tol: 1.5, label: "Turning: PWM value 1 is 2000" },
        { kind: "signal", name: "DAN_PWM2", equals: 1000, tol: 1.5, label: "Turning: PWM value 2 is 1000" },
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
        { kind: "isr-time", fn: "SPIB_isr", maxUs: 4, label: "SPIB_isr takes at most 4 us" },
        { kind: "reg", reg: "SpibRegs.SPIFFCT", field: "TXDLY", at: 8.7, equals: 0, label: "TXDLY is back at 0 between transfers" },
      ],
      watch: ["CurrentChip", "gyroz", "pwm1", "pwm2", "dan_adc1"],
      inspect: ["SpibRegs.SPIFFCT", "SpibRegs.SPIFFRX"],
      hints: [
        "SPIB_isr is one `if (CurrentChip == MPU9250) { ... } else { ... }`. The flag clears and the acknowledge come after it, for both cases.",
        "In the MPU-9250 branch, read all eight words first. Only then change RXFFIL to 3 and write the DAN28027's three words.",
        "In the DAN28027 branch: GPIO29 high, three reads, CurrentChip = MPU9250, TXDLY = 0.",
      ],
      takeaway: "One port, one interrupt, a variable that remembers whose turn it is. Each device brings its own chip select, word count and timing.",
    },
  ],
};
