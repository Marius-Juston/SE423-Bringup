import { describe, expect, it } from "vitest";
import { runProgram, type Stimulus } from "../src/sim/runner";
import type { SpiDevicesState } from "../src/sim/plugins/spi_devices";
import { codes } from "./helpers";

// setupSpib() exactly as in the course's SE423Lib.c (final project starter).
const SETUP_SPIB = `uint16_t dummyread = 0;
void setupSpib(void)        //for mpu9250
{

    GPIO_SetupPinMux(63, GPIO_MUX_CPU1, 15); //Set GPIO63 pin to SPISIMOB
    GPIO_SetupPinMux(64, GPIO_MUX_CPU1, 15); //Set GPIO64 pin to SPISOMIB
    GPIO_SetupPinMux(65, GPIO_MUX_CPU1, 15); //Set GPIO65 pin to SPICLKB
    EALLOW;
    GpioCtrlRegs.GPBPUD.bit.GPIO63 = 0; // Enable Pull-ups on SPI PINs Recommended by TI for SPI Pins
    GpioCtrlRegs.GPCPUD.bit.GPIO64 = 0;
    GpioCtrlRegs.GPCPUD.bit.GPIO65 = 0;
    GpioCtrlRegs.GPBQSEL2.bit.GPIO63 = 3; // Set I/O pin to asynchronous mode recommended for SPI
    GpioCtrlRegs.GPCQSEL1.bit.GPIO64 = 3; // Set I/O pin to asynchronous mode recommended for SPI
    GpioCtrlRegs.GPCQSEL1.bit.GPIO65 = 3; // Set I/O pin to asynchronous mode recommended for SPI
    EDIS;
    SpibRegs.SPICCR.bit.SPISWRESET   = 0;    // Put SPI in Reset

    SpibRegs.SPICTL.bit.CLK_PHASE    = 1;
    SpibRegs.SPICCR.bit.CLKPOLARITY  = 0;

    SpibRegs.SPICTL.bit.MASTER_SLAVE = 1;    // SPI master
    SpibRegs.SPICCR.bit.SPICHAR      = 0xF;  // Set to transmit 16 bits
    SpibRegs.SPICTL.bit.TALK         = 1;    // Enables transmission for the 4-pin option
    SpibRegs.SPIPRI.bit.FREE         = 1;    // Free run, continue SPI operation
    SpibRegs.SPICTL.bit.SPIINTENA    = 0;    // Disables the SPI interrupt

    SpibRegs.SPIBRR.bit.SPI_BIT_RATE = 49;   // 50MHz/(49+1) = 1MHz

    SpibRegs.SPISTS.all              = 0x0000;

    SpibRegs.SPIFFTX.bit.SPIRST      = 1;    // SPI FIFO can resume transmit or receive.
    SpibRegs.SPIFFTX.bit.SPIFFENA    = 1;    // SPI FIFO enhancements are enabled
    SpibRegs.SPIFFTX.bit.TXFIFO      = 0;    // Write 0 to reset the FIFO pointer to zero, and hold in reset
    SpibRegs.SPIFFTX.bit.TXFFINTCLR  = 1;    // Write 1 to clear SPIFFTX[TXFFINT] flag

    SpibRegs.SPIFFRX.bit.RXFIFORESET = 0;    // Write 0 to reset the FIFO pointer to zero, and hold in reset
    SpibRegs.SPIFFRX.bit.RXFFOVFCLR  = 1;    // Write 1 to clear SPIFFRX[RXFFOVF]
    SpibRegs.SPIFFRX.bit.RXFFINTCLR  = 1;    // Write 1 to clear SPIFFRX[RXFFINT] flag
    SpibRegs.SPIFFRX.bit.RXFFIENA    = 1;    // RX FIFO interrupt based on RXFFIL match

    SpibRegs.SPIFFCT.bit.TXDLY       = 0; // The next word in the TX FIFO buffer is transferred to SPITXBUF immediately upon completion of transmission of the previous word.

    SpibRegs.SPICCR.bit.SPISWRESET   = 1;    // Pull the SPI out of reset

    SpibRegs.SPIFFTX.bit.TXFIFO      = 1;    // Release transmit FIFO from reset.
    SpibRegs.SPIFFRX.bit.RXFIFORESET = 1;    // Re-enable receive FIFO operation
    SpibRegs.SPICTL.bit.SPIINTENA    = 1;    // Enables the SPI interrupt.
    SpibRegs.SPIFFRX.bit.RXFFIL      = 16;    // A RX FIFO interrupt request is generated when there are 1 or more words in the RX buffer.

    //-----------------------------------------------------------------------------------------------------------------

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x1300 | 0x0000); // 0x1300 (0x0000)
    SpibRegs.SPITXBUF = (0x0000 | 0x0000); // 0x1400 (0x0000),       0x1500 (0x0000)
    SpibRegs.SPITXBUF = (0x0000 | 0x0000); // 0x1600 (0x0000),       0x1700 (0x0000)
    SpibRegs.SPITXBUF = (0x0000 | 0x0013); // 0x1800 (0x0000),       0x1900 (0x0013)
    SpibRegs.SPITXBUF = (0x0200 | 0x0000); // 0x1A00 (0x0002),       0x1B00 (0x0000), 250 dps
    SpibRegs.SPITXBUF = (0x0800 | 0x0006); // 0x1C00 (0x0008), +-4g, 0x1D00 (0x0006), 5Hz
    SpibRegs.SPITXBUF = (0x0000 | 0x0000); // 0x1E00 (0x0000),       0x1F00 (0x0000)
    while(SpibRegs.SPIFFRX.bit.RXFFST !=7);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    dummyread = SpibRegs.SPIRXBUF;
    dummyread = SpibRegs.SPIRXBUF;
    dummyread = SpibRegs.SPIRXBUF;
    dummyread = SpibRegs.SPIRXBUF;
    dummyread = SpibRegs.SPIRXBUF;
    dummyread = SpibRegs.SPIRXBUF;
    dummyread = SpibRegs.SPIRXBUF;

    DELAY_US(10);

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x2300 | 0x0000); // 0x2300 (0x0000)
    SpibRegs.SPITXBUF = (0x4000 | 0x008C); // 0x2400 (0x0040),       0x2500 (0x008C)
    SpibRegs.SPITXBUF = (0x0200 | 0x0088); // 0x2600 (0x0002),       0x2700 (0x0088)
    SpibRegs.SPITXBUF = (0x0C00 | 0x000A); // 0x2800 (0x000C),       0x2900 (0x000A)
    while(SpibRegs.SPIFFRX.bit.RXFFST !=4);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    dummyread = SpibRegs.SPIRXBUF;
    dummyread = SpibRegs.SPIRXBUF;
    dummyread = SpibRegs.SPIRXBUF;
    dummyread = SpibRegs.SPIRXBUF;

    DELAY_US(10);

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x2A00 | 0x0081);  // 0x2A00 (0x0081)
    while(SpibRegs.SPIFFRX.bit.RXFFST !=1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    dummyread = SpibRegs.SPIRXBUF;

    DELAY_US(10);

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x3800 | 0x0001);  // 0x3800
    while(SpibRegs.SPIFFRX.bit.RXFFST !=1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    dummyread = SpibRegs.SPIRXBUF;

    DELAY_US(10);

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x3A00 | 0x0001);  // 0x3A00
    while(SpibRegs.SPIFFRX.bit.RXFFST !=1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    dummyread = SpibRegs.SPIRXBUF;

    DELAY_US(10);

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x6400 | 0x0001);  // 0x6400
    while(SpibRegs.SPIFFRX.bit.RXFFST !=1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    dummyread = SpibRegs.SPIRXBUF;

    DELAY_US(10);

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x6700 | 0x0003); // 0x6700
    while(SpibRegs.SPIFFRX.bit.RXFFST !=1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    dummyread = SpibRegs.SPIRXBUF;

    DELAY_US(10);

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x6A00 | 0x0020);  // 0x6A00
    while(SpibRegs.SPIFFRX.bit.RXFFST !=1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    dummyread = SpibRegs.SPIRXBUF;

    DELAY_US(10);

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x6B00 | 0x0001); // 0x6B00
    while(SpibRegs.SPIFFRX.bit.RXFFST !=1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    dummyread = SpibRegs.SPIRXBUF;

    DELAY_US(10);

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x7500 | 0x0071);  // 0x7500
    while(SpibRegs.SPIFFRX.bit.RXFFST !=1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    dummyread = SpibRegs.SPIRXBUF;

    DELAY_US(10);

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x7700 | 0x00EB); // 0x7700
    while(SpibRegs.SPIFFRX.bit.RXFFST !=1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    dummyread = SpibRegs.SPIRXBUF;

    DELAY_US(10);

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x7800 | 0x0012); // 0x7800
    while(SpibRegs.SPIFFRX.bit.RXFFST !=1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    dummyread = SpibRegs.SPIRXBUF;

    DELAY_US(10);

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x7A00 | 0x0010); // 0x7A00
    while(SpibRegs.SPIFFRX.bit.RXFFST !=1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    dummyread = SpibRegs.SPIRXBUF;

    DELAY_US(10);

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x7B00 | 0x00FA); // 0x7B00
    while(SpibRegs.SPIFFRX.bit.RXFFST !=1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    dummyread = SpibRegs.SPIRXBUF;

    DELAY_US(10);

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x7D00 | 0x0021); // 0x7D00
    while(SpibRegs.SPIFFRX.bit.RXFFST !=1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    dummyread = SpibRegs.SPIRXBUF;

    DELAY_US(10);

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x7E00 | 0x0050); // 0x7E00
    while(SpibRegs.SPIFFRX.bit.RXFFST !=1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    dummyread = SpibRegs.SPIRXBUF;


    DELAY_US(10);

    while(SpibRegs.SPIFFRX.bit.RXFFST !=0) {
        dummyread = SpibRegs.SPIRXBUF;
    }

}
`;

// The chip selects, as HW3 sets them up before calling setupSpib().
const CS = `
    GPIO_SetupPinMux(66, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(66, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    GPIO_SetupPinMux(29, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(29, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPASET.bit.GPIO29 = 1;
`;

const run = (source: string, durationMs = 3, stimuli: Stimulus[] = []) => {
  const r = runProgram({ kit: "robot", source, durationMs, stimuli });
  expect(r.compileError, JSON.stringify(r.compileError)).toBeUndefined();
  expect(r.runtimeError, JSON.stringify(r.runtimeError)).toBeUndefined();
  return r;
};
const v = (r: ReturnType<typeof run>, name: string) => r.board.readVar(name);
const state = (r: ReturnType<typeof run>) => r.board.plugins.get("spi_devices") as SpiDevicesState;

describe("MPU-9250 on SPIB (chip select GPIO66)", () => {
  it("runs the course's setupSpib() unchanged and stores every register it writes", () => {
    const r = run(`void setupSpib(void);
void main(void) {
${CS}
    setupSpib();
    while (1) {}
}
${SETUP_SPIB}`);
    expect(r.diagnostics.map((d) => `${d.line}: ${d.msg}`)).toEqual([]);
    const regs = state(r).mpuRegs;
    expect([regs[0x19], regs[0x1a], regs[0x1b], regs[0x1c], regs[0x1d]]).toEqual([0x13, 0x02, 0x00, 0x08, 0x06]);
    expect([regs[0x23], regs[0x24], regs[0x25], regs[0x26], regs[0x27], regs[0x28], regs[0x29], regs[0x2a]]).toEqual([0x00, 0x40, 0x8c, 0x02, 0x88, 0x0c, 0x0a, 0x81]);
    expect([regs[0x38], regs[0x64], regs[0x67], regs[0x6a], regs[0x6b]]).toEqual([0x01, 0x01, 0x03, 0x20, 0x01]);
    // 13 registers in the first burst, 7 in the second, then single writes.
    expect(state(r).mpuWrites.length).toBe(13 + 7 + 14);
    // WHO_AM_I is read-only: the course's write of 0x71 to it changes nothing.
    expect(regs[0x75]).toBe(0x71);
    expect(r.board.dev.get("SpibRegs.SPIFFRX", "RXFFST")).toBe(0);
    expect(r.board.dev.get("SpibRegs.SPIFFRX", "RXFFIL")).toBe(16);
  });

  it("answers WHO_AM_I with 0x71 and reads back what was written", () => {
    const r = run(`void setupSpib(void);
uint16_t who, cfg, pwr;
uint16_t xfer(uint16_t w) {
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = w;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    DELAY_US(10);
    return SpibRegs.SPIRXBUF;
}
void main(void) {
${CS}
    setupSpib();
    who = xfer(0x8000 | 0x7500);
    xfer(0x1B00 | 0x0018);
    cfg = xfer(0x8000 | 0x1B00);
    pwr = xfer(0x8000 | 0x6B00);
    while (1) {}
}
${SETUP_SPIB}`);
    expect(r.diagnostics).toEqual([]);
    expect(v(r, "who")).toBe(0x0071);
    expect(v(r, "cfg")).toBe(0x0018);
    expect(v(r, "pwr")).toBe(0x0001);
  });

  it("burst-reads accel, temperature and gyro from 0x3A as the course does, in the selected ranges", () => {
    const r = run(`void setupSpib(void);
int16_t readdata[8];
float accelx, accely, accelz, gyrox, gyroy, gyroz;
void main(void) {
    int i;
${CS}
    setupSpib();
    DELAY_US(1000);
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = ((0x8000) | (0x3A00));
    for (i = 0; i < 7; i++) SpibRegs.SPITXBUF = 0;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 8);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    for (i = 0; i < 8; i++) readdata[i] = SpibRegs.SPIRXBUF;
    accelx = (((float)(readdata[1])) * 4.0 / 32767.0);
    accely = (((float)(readdata[2])) * 4.0 / 32767.0);
    accelz = (((float)(readdata[3])) * 4.0 / 32767.0);
    gyrox = (((float)(readdata[5])) * 250.0 / 32767.0);
    gyroy = (((float)(readdata[6])) * 250.0 / 32767.0);
    gyroz = (((float)(readdata[7])) * 250.0 / 32767.0);
    while (1) {}
}
${SETUP_SPIB}`, 3, [
      { at: 0.5, set: "IMU_AX_G", value: 0.5 },
      { at: 0.5, set: "IMU_AY_G", value: -0.25 },
      { at: 0.5, set: "IMU_GX_DPS", value: 10 },
      { at: 0.5, set: "IMU_GY_DPS", value: -20 },
      { at: 0.5, set: "IMU_GZ_DPS", value: 100 },
    ]);
    expect(r.diagnostics).toEqual([]);
    expect(v(r, "accelx")).toBeCloseTo(0.5, 3);
    expect(v(r, "accely")).toBeCloseTo(-0.25, 3);
    expect(v(r, "accelz")).toBeCloseTo(1, 3);
    expect(v(r, "gyrox")).toBeCloseTo(10, 2);
    expect(v(r, "gyroy")).toBeCloseTo(-20, 2);
    expect(v(r, "gyroz")).toBeCloseTo(100, 2);
    // The word between accel Z and gyro X is the temperature: (25 - 21) * 333.87.
    const words = new Int16Array(8);
    for (let i = 0; i < 8; i++) words[i] = r.board.mem.peek(r.board.compiler.globals.get("readdata")!.addr + i, 1);
    expect(words[4]).toBe(1335);
    // +-4 g: 1 g is 8192 counts.
    expect(words[3]).toBe(8192);
  });

  it("gives the gyro Z reading in the second word of HW3's two-word read, at the power-on range", () => {
    const r = run(`int16_t spivalue1, spivalue2;
void setupSpib(void);
void main(void) {
${CS}
    setupSpib();
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x1B00 | 0x0000);       // back to +-250 deg/s (already is)
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    spivalue1 = SpibRegs.SPIRXBUF;
    DELAY_US(10);
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x8000 | 0x4600);
    SpibRegs.SPITXBUF = 0x0000;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 2);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    spivalue1 = SpibRegs.SPIRXBUF;
    spivalue2 = SpibRegs.SPIRXBUF;
    while (1) {}
}
${SETUP_SPIB}`, 3, [{ at: 0.1, set: "IMU_GZ_DPS", value: -125 }, { at: 0.1, set: "IMU_GY_DPS", value: 1 }]);
    expect(v(r, "spivalue2")).toBe(-16384);
    // First word: nothing during the address byte, then GYRO_YOUT_L (1 deg/s = 131 = 0x0083).
    expect(v(r, "spivalue1")).toBe(0x0083);
  });

  it("warns above 1 MHz and reports a wrong clock mode", () => {
    const fast = run(`void setupSpib(void);
void main(void) {
${CS}
    setupSpib();
    SpibRegs.SPICCR.bit.SPISWRESET = 0;
    SpibRegs.SPIBRR.bit.SPI_BIT_RATE = 9;
    SpibRegs.SPICCR.bit.SPISWRESET = 1;
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x8000 | 0x7500);
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    while (1) {}
}
${SETUP_SPIB}`);
    expect(codes(fast)).toEqual(["mpu-too-fast"]);
    const mode = (pol: number, phase: number) => run(`void setupSpib(void);
uint16_t who;
void main(void) {
${CS}
    setupSpib();
    SpibRegs.SPICCR.bit.SPISWRESET = 0;
    SpibRegs.SPICCR.bit.CLKPOLARITY = ${pol};
    SpibRegs.SPICTL.bit.CLK_PHASE = ${phase};
    SpibRegs.SPICCR.bit.SPISWRESET = 1;
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (0x8000 | 0x7500);
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    who = SpibRegs.SPIRXBUF;
    while (1) {}
}
${SETUP_SPIB}`);
    // Latches on the rising edge: the course's mode, and the same with the clock idling high.
    expect(v(mode(1, 0), "who")).toBe(0x71);
    expect(codes(mode(1, 0))).toEqual([]);
    for (const [pol, phase] of [[0, 0], [1, 1]]) {
      const r = mode(pol, phase);
      expect(codes(r)).toEqual(["spi-mode-b"]);
      expect(v(r, "who")).not.toBe(0x71);
    }
  });

  it("can be read by bit-banging the pins as plain GPIO", () => {
    const r = run(`uint16_t who;
uint16_t spi_byte(uint16_t out) {
    uint16_t in = 0;
    int i;
    for (i = 7; i >= 0; i--) {
        if (out & (1 << i)) GpioDataRegs.GPBSET.bit.GPIO63 = 1;
        else GpioDataRegs.GPBCLEAR.bit.GPIO63 = 1;
        DELAY_US(1);
        GpioDataRegs.GPCSET.bit.GPIO65 = 1;          // rising edge: both sides latch
        in = (in << 1) | GpioDataRegs.GPCDAT.bit.GPIO64;
        DELAY_US(1);
        GpioDataRegs.GPCCLEAR.bit.GPIO65 = 1;        // falling edge: data changes
    }
    return in;
}
void main(void) {
${CS}
    GPIO_SetupPinMux(63, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(63, GPIO_OUTPUT, GPIO_PUSHPULL);
    GPIO_SetupPinMux(65, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(65, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPCCLEAR.bit.GPIO65 = 1;
    GPIO_SetupPinMux(64, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(64, GPIO_INPUT, GPIO_PULLUP);
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    spi_byte(0x80 | 0x75);
    who = spi_byte(0x00);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    while (1) {}
}`);
    expect(r.diagnostics).toEqual([]);
    expect(v(r, "who")).toBe(0x71);
  });
});

describe("DAN28027 on SPIB (chip select GPIO29)", () => {
  const dan = (txdly: number, second = false) => `void setupSpib(void);
int16_t garbage, adc1, adc2, garbage2, adc1b, adc2b;
void main(void) {
${CS}
    setupSpib();
    SpibRegs.SPIFFCT.bit.TXDLY = ${txdly};
    GpioDataRegs.GPACLEAR.bit.GPIO29 = 1;
    SpibRegs.SPITXBUF = 0x00DA;
    SpibRegs.SPITXBUF = 1500;
    SpibRegs.SPITXBUF = 4000;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 3);
    GpioDataRegs.GPASET.bit.GPIO29 = 1;
    garbage = SpibRegs.SPIRXBUF;
    adc1 = SpibRegs.SPIRXBUF;
    adc2 = SpibRegs.SPIRXBUF;
    ${second ? `DELAY_US(100);
    GpioDataRegs.GPACLEAR.bit.GPIO29 = 1;
    SpibRegs.SPITXBUF = 0x00DA;
    SpibRegs.SPITXBUF = -5;
    SpibRegs.SPITXBUF = 3000;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 3);
    GpioDataRegs.GPASET.bit.GPIO29 = 1;
    garbage2 = SpibRegs.SPIRXBUF;
    adc1b = SpibRegs.SPIRXBUF;
    adc2b = SpibRegs.SPIRXBUF;` : ""}
    while (1) {}
}
${SETUP_SPIB}`;
  const inputs: Stimulus[] = [{ at: 0.1, set: "DAN_ADC1", value: 1.65 }, { at: 0.1, set: "DAN_ADC2", value: 3.3 }];

  it("takes 0x00DA and two PWM values, and answers with its two ADC readings one word late", () => {
    const r = run(dan(16, true), 3, inputs);
    expect(r.diagnostics).toEqual([]);
    expect([v(r, "garbage"), v(r, "adc1"), v(r, "adc2")]).toEqual([0, 2048, 4095]);
    expect([v(r, "garbage2"), v(r, "adc1b"), v(r, "adc2b")]).toEqual([0, 2048, 4095]);
    // The firmware limits the compare values to 0..3000.
    expect(r.board.outputs.get("DAN_PWM1")!.map((x) => x.v)).toEqual([1500, 0]);
    expect(r.board.outputs.get("DAN_PWM2")!.map((x) => x.v)).toEqual([3000]);
    expect(r.board.output("DAN_COMMANDS")).toBe(2);
  });

  it("answers a word late without the TXDLY gap the course sets", () => {
    const r = run(dan(0), 3, inputs);
    expect(codes(r)).toEqual(["dan-too-fast"]);
    expect([v(r, "garbage"), v(r, "adc1"), v(r, "adc2")]).toEqual([0, 0x00da, 2048]);
    // It still received the command.
    expect(r.board.output("DAN_PWM1")).toBe(1500);
  });

  it("reports a bus conflict when both chip selects are low", () => {
    const r = run(`void setupSpib(void);
void main(void) {
${CS}
    setupSpib();
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    GpioDataRegs.GPACLEAR.bit.GPIO29 = 1;
    SpibRegs.SPITXBUF = (0x8000 | 0x7500);
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    while (1) {}
}
${SETUP_SPIB}`);
    expect(codes(r)).toContain("spi-bus-conflict-b");
    expect(r.diagnostics.find((d) => d.code === "spi-bus-conflict-b")!.severity).toBe("error");
  });
});
