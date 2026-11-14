import { describe, expect, it } from "vitest";
import { runProgram, type RunResult } from "../src/sim/runner";
import type { Stimulus } from "../src/sim/runner";
import { TempSensor, type I2cState } from "../src/sim/plugins/i2c";
import { codes } from "./helpers";

import { Board } from "../src/sim/board";
// These tests run bare programs for one peripheral, without the InitSysCtrl() every real program starts with.
Board.expectInitSysCtrl = false;

const PINS = `
    GPIO_SetupPinMux(40, GPIO_MUX_CPU1, 6);
    GPIO_SetupPinOptions(40, GPIO_INPUT, GPIO_PULLUP);
    GPIO_SetupPinMux(41, GPIO_MUX_CPU1, 6);
    GPIO_SetupPinOptions(41, GPIO_INPUT, GPIO_PULLUP);`;

/** 10 MHz module clock, 100 kHz SCL: (45 + 5) + (45 + 5) = 100 module clocks. */
const init = (psc = 19, low = 45, high = 45) => `${PINS}
    I2cbRegs.I2CMDR.bit.IRS = 0;
    I2cbRegs.I2CPSC.all = ${psc};
    I2cbRegs.I2CCLKL = ${low};
    I2cbRegs.I2CCLKH = ${high};
    I2cbRegs.I2CMDR.bit.IRS = 1;`;

const READ2 = `
int16_t raw = 0;
uint16_t nack = 0;
uint16_t done = 0;
void read2(uint16_t address)
{
    uint16_t msb;
    while (I2cbRegs.I2CMDR.bit.STP == 1) {}
    I2cbRegs.I2CSAR.all = address;
    I2cbRegs.I2CCNT = 2;
    I2cbRegs.I2CMDR.all = 0x2C20;
    while (I2cbRegs.I2CSTR.bit.RRDY == 0) {
        if (I2cbRegs.I2CSTR.bit.NACK == 1) {
            I2cbRegs.I2CMDR.bit.STP = 1;
            I2cbRegs.I2CSTR.all = 0x0002;
            nack++;
            return;
        }
    }
    msb = I2cbRegs.I2CDRR.all;
    while (I2cbRegs.I2CSTR.bit.RRDY == 0) {}
    raw = (msb << 8) | I2cbRegs.I2CDRR.all;
    while (I2cbRegs.I2CMDR.bit.STP == 1) {}
    done++;
}`;

function run(source: string, durationMs = 5, stimuli: Stimulus[] = []): RunResult {
  const r = runProgram({ kit: "robot", durationMs, source, stimuli });
  expect(r.compileError, JSON.stringify(r.compileError)).toBeUndefined();
  expect(r.runtimeError, JSON.stringify(r.runtimeError)).toBeUndefined();
  return r;
}
const state = (r: RunResult) => r.board.plugins.get("i2c") as I2cState;

describe("I2C plugin (TRM chapter 20)", () => {
  it("reads the temperature sensor: address 0x48, two bytes, NACK on the last, STOP", () => {
    const r = run(`${READ2}
void main(void) {${init()}
    read2(0x48);
    while (1) {}
}`);
    expect(r.diagnostics).toEqual([]);
    expect(r.board.readVar("done")).toBe(1);
    expect(r.board.readVar("raw")).toBe(TempSensor.raw(25));
    expect(TempSensor.raw(25)).toBe(0x1900);
    const [x] = state(r).bus.log;
    expect(x).toMatchObject({ address: 0x48, read: true, acked: true, data: [0x19, 0x00], stopped: true });
    // Status after the STOP: bus free, STOP detected, master mode left.
    expect(r.board.dev.get("I2cbRegs.I2CSTR", "BB")).toBe(0);
    expect(r.board.dev.get("I2cbRegs.I2CSTR", "SCD")).toBe(1);
    expect(r.board.dev.get("I2cbRegs.I2CMDR", "MST")).toBe(0);
    expect(r.board.dev.get("I2cbRegs.I2CMDR", "STP")).toBe(0);
  });

  it("follows the knob, including negative temperatures", () => {
    const r = run(
      `${READ2}
int16_t first = 0;
void main(void) {${init()}
    read2(0x48);
    first = raw;
    DELAY_US(2000);
    read2(0x48);
    while (1) {}
}`,
      6,
      [{ at: 1.5, set: "TEMP_C", value: -10.5 }],
    );
    expect(r.board.readVar("first")).toBe(25 * 256);
    expect(r.board.readVar("raw")).toBe(-10.5 * 256);
  });

  it("makes SCL from the TRM formula: module clock / ((ICCL + d) + (ICCH + d))", () => {
    // IPSC = 19 -> 10 MHz, d = 5: (10 + 5) + (5 + 5) = 25 -> 400 kHz, low 1.5 us, high 1 us.
    const r = run(`${READ2}
void main(void) {${init(19, 10, 5)}
    read2(0x48);
    while (1) {}
}`);
    expect(r.diagnostics).toEqual([]);
    expect(r.board.output("I2C_SCL_HZ")).toBe(400000);
    const scl = r.traces.get(41)!;
    const falls = scl.filter((c) => c.level === 0).map((c) => c.t);
    const rises = scl.filter((c) => c.level === 1).map((c) => c.t);
    expect(falls[2] - falls[1]).toBeCloseTo(2500, 6);
    expect(rises.find((t) => t > falls[1])! - falls[1]).toBeCloseTo(1500, 6);
    // SCL falls once after the START, then after each of 3 x 9 clocks.
    expect(falls.length).toBe(28);

    // IPSC = 0 gives d = 7, IPSC = 1 gives d = 6 (Table 20-1); both module clocks are out of range.
    for (const [psc, hz] of [[0, 200e6 / (10 + 7 + 5 + 7)], [1, 100e6 / (10 + 6 + 5 + 6)]]) {
      const x = run(`${READ2}\nvoid main(void) {${init(psc, 10, 5)}\n read2(0x48);\n while (1) {} }`);
      expect(x.board.output("I2C_SCL_HZ")).toBe(Math.round(hz));
      expect(codes(x)).toContain("i2c-module-clock");
    }
  });

  it("reports a module clock outside 7 to 12 MHz, and SCL above 400 kHz", () => {
    const slow = run(`void main(void) {${init(39)}\n while (1) {} }`);
    expect(codes(slow)).toEqual(["i2c-module-clock"]);
    expect(slow.passed).toBe(false);
    // TI's example values (I2CPSC = 16, I2CCLKL = 10, I2CCLKH = 5): 11.76 MHz, 470.6 kHz.
    const ti = run(`${READ2}\nvoid main(void) {${init(16, 10, 5)}\n read2(0x48);\n while (1) {} }`);
    expect(codes(ti)).toEqual(["i2c-too-fast"]);
    expect(ti.board.output("I2C_SCL_HZ")).toBe(470588);
    expect(ti.board.readVar("done")).toBe(1);
  });

  it("puts START, the address byte, the ACK and STOP on the pins", () => {
    const r = run(`void main(void) {${init()}
    I2cbRegs.I2CSAR.all = 0x48;
    I2cbRegs.I2CCNT = 1;
    I2cbRegs.I2CDXR.all = 0x01;
    I2cbRegs.I2CMDR.all = 0x6E20;
    while (1) {}
}`);
    expect(r.diagnostics).toEqual([]);
    const sda = r.traces.get(40)!;
    const scl = r.traces.get(41)!;
    const level = (tr: typeof sda, t: number) => tr.filter((c) => c.t <= t).pop()!.level;
    // START: SDA falls while SCL is high.
    const start = sda.find((c) => c.level === 0)!;
    expect(level(scl, start.t)).toBe(1);
    // Sample SDA at every rising edge of SCL: 0x90 (0x48 << 1, write), ACK, 0x01, ACK.
    const bits = scl.filter((c) => c.level === 1 && c.t > start.t).map((c) => level(sda, c.t));
    expect(bits.slice(0, 18).join("")).toBe("100100000" + "000000010");
    // STOP: SDA rises while SCL is high, at the very end.
    const stop = sda[sda.length - 1];
    expect(stop.level).toBe(1);
    expect(level(scl, stop.t)).toBe(1);
    expect(state(r).bus.log[0]).toMatchObject({ address: 0x48, read: false, data: [1], stopped: true });
    expect(r.board.output("TMP_POINTER")).toBe(1);
  });

  it("sets NACK and ARDY when no device answers, and keeps the bus until STP is written", () => {
    const r = run(`${READ2}
uint16_t bbAfterNack = 0;
uint16_t bbHeld = 0;
void main(void) {${init()}
    I2cbRegs.I2CSAR.all = 0x33;
    I2cbRegs.I2CCNT = 2;
    I2cbRegs.I2CMDR.all = 0x2C20;
    while (I2cbRegs.I2CSTR.bit.ARDY == 0) {}
    bbAfterNack = I2cbRegs.I2CSTR.bit.NACK;
    DELAY_US(500);
    bbHeld = I2cbRegs.I2CSTR.bit.BB;
    I2cbRegs.I2CMDR.bit.STP = 1;
    I2cbRegs.I2CSTR.all = 0x0002;
    while (I2cbRegs.I2CMDR.bit.STP == 1) {}
    read2(0x29);
    read2(0x48);
    while (1) {}
}`);
    expect(r.diagnostics).toEqual([]);
    expect(r.board.readVar("bbAfterNack")).toBe(1);
    expect(r.board.readVar("bbHeld")).toBe(1);
    expect(r.board.readVar("nack")).toBe(1);
    expect(r.board.readVar("done")).toBe(1);
    expect(state(r).bus.log.map((x) => [x.address, x.acked, x.stopped])).toEqual([[0x33, false, true], [0x29, false, true], [0x48, true, true]]);
    expect(r.board.output("I2C_ADDR_NACKS")).toBe(2);
    expect(r.board.dev.get("I2cbRegs.I2CSTR", "NACK")).toBe(0);
  });

  it("writes a register pointer, then reads with a repeated START", () => {
    // Pointer 3 (high limit, 80 degC = 0x5000 after power-up), no STOP in between.
    const r = run(`
uint16_t hi = 0;
uint16_t ardy = 0;
void main(void) {${init()}
    I2cbRegs.I2CSAR.all = 0x48;
    I2cbRegs.I2CCNT = 1;
    I2cbRegs.I2CDXR.all = 3;
    I2cbRegs.I2CMDR.all = 0x2620;              // START, master, transmit, no STOP
    while (I2cbRegs.I2CSTR.bit.ARDY == 0) {}
    ardy = I2cbRegs.I2CSTR.bit.BB;
    I2cbRegs.I2CCNT = 2;
    I2cbRegs.I2CMDR.all = 0x2C20;              // repeated START, receive, STOP
    while (I2cbRegs.I2CSTR.bit.RRDY == 0) {}
    hi = I2cbRegs.I2CDRR.all << 8;
    while (I2cbRegs.I2CSTR.bit.RRDY == 0) {}
    hi |= I2cbRegs.I2CDRR.all;
    while (1) {}
}`);
    expect(r.diagnostics).toEqual([]);
    expect(r.board.readVar("ardy")).toBe(1);
    expect(r.board.readVar("hi")).toBe(0x5000);
    expect(r.board.output("I2C_STARTS")).toBe(2);
    expect(r.board.output("I2C_STOPS")).toBe(1);
  });

  it("writes the sensor's limit register, and reads the clock at 0x68", () => {
    const r = run(`
uint16_t sec = 0;
uint16_t min = 0;
void main(void) {${init()}
    I2cbRegs.I2CSAR.all = 0x48;
    I2cbRegs.I2CCNT = 3;
    I2cbRegs.I2CDXR.all = 3;
    I2cbRegs.I2CMDR.all = 0x6E20;
    while (I2cbRegs.I2CSTR.bit.XRDY == 0) {}
    I2cbRegs.I2CDXR.all = 0x1E;                // 30 degC
    while (I2cbRegs.I2CSTR.bit.XRDY == 0) {}
    I2cbRegs.I2CDXR.all = 0x80;                // + 0.5 degC
    while (I2cbRegs.I2CMDR.bit.STP == 1) {}

    I2cbRegs.I2CSAR.all = 0x68;
    I2cbRegs.I2CCNT = 1;
    I2cbRegs.I2CDXR.all = 0;
    I2cbRegs.I2CMDR.all = 0x6E20;
    while (I2cbRegs.I2CMDR.bit.STP == 1) {}
    I2cbRegs.I2CCNT = 2;
    I2cbRegs.I2CMDR.all = 0x2C20;
    while (I2cbRegs.I2CSTR.bit.RRDY == 0) {}
    sec = I2cbRegs.I2CDRR.all;
    while (I2cbRegs.I2CSTR.bit.RRDY == 0) {}
    min = I2cbRegs.I2CDRR.all;
    while (1) {}
}`);
    expect(r.diagnostics).toEqual([]);
    expect(r.board.output("TMP_THIGH_C")).toBe(30.5);
    expect(r.board.readVar("sec")).toBe(0x56);
    expect(r.board.readVar("min")).toBe(0x34);
  });

  it("holds SCL low while I2CDRR is not read (RSFULL), and while I2CDXR is empty (XSMT)", () => {
    const r = run(`
uint16_t rsfull = 0;
uint16_t xsmt = 1;
uint16_t a = 0;
uint16_t b2 = 0;
void main(void) {${init()}
    I2cbRegs.I2CSAR.all = 0x48;
    I2cbRegs.I2CCNT = 2;
    I2cbRegs.I2CMDR.all = 0x2C20;
    DELAY_US(1000);                            // far longer than the transfer
    rsfull = I2cbRegs.I2CSTR.bit.RSFULL;
    a = I2cbRegs.I2CDRR.all;
    while (I2cbRegs.I2CSTR.bit.RRDY == 0) {}
    b2 = I2cbRegs.I2CDRR.all;
    while (I2cbRegs.I2CMDR.bit.STP == 1) {}

    I2cbRegs.I2CCNT = 1;
    I2cbRegs.I2CMDR.all = 0x6E20;              // nothing in I2CDXR yet
    DELAY_US(500);
    xsmt = I2cbRegs.I2CSTR.bit.XSMT;
    I2cbRegs.I2CDXR.all = 2;
    while (I2cbRegs.I2CMDR.bit.STP == 1) {}
    while (1) {}
}`);
    expect(r.diagnostics).toEqual([]);
    expect(r.board.readVar("rsfull")).toBe(1);
    expect([r.board.readVar("a"), r.board.readVar("b2")]).toEqual([0x19, 0x00]);
    expect(r.board.readVar("xsmt")).toBe(0);
    expect(r.board.output("TMP_POINTER")).toBe(2);
  });

  it("reports a START while the previous transfer is still on the bus", () => {
    const r = run(`${READ2}
void main(void) {${init()}
    I2cbRegs.I2CSAR.all = 0x48;
    I2cbRegs.I2CCNT = 2;
    I2cbRegs.I2CMDR.all = 0x2C20;
    I2cbRegs.I2CMDR.all = 0x2C20;
    while (1) {}
}`);
    expect(codes(r)).toEqual(["i2c-busy"]);
    expect(r.passed).toBe(false);
    expect(state(r).bus.log.length).toBe(1);
  });

  it("needs the pin mux and pull-ups, and I2CCLKL / I2CCLKH not 0", () => {
    const body = `
    I2cbRegs.I2CPSC.all = 19;
    I2cbRegs.I2CCLKL = 45;
    I2cbRegs.I2CCLKH = 45;
    I2cbRegs.I2CMDR.all = 0x0020;
    I2cbRegs.I2CSAR.all = 0x48;
    I2cbRegs.I2CCNT = 2;
    I2cbRegs.I2CMDR.all = 0x2C20;
    while (1) {}`;
    expect(codes(run(`void main(void) {${body}\n}`))).toEqual(["i2c-mux"]);
    const noPull = run(`void main(void) {
    GPIO_SetupPinMux(40, GPIO_MUX_CPU1, 6);
    GPIO_SetupPinMux(41, GPIO_MUX_CPU1, 6);${body}\n}`);
    expect(codes(noPull)).toEqual(["i2c-pullup"]);
    expect(state(noPull).bus.log.length).toBe(0);
    const zero = run(`void main(void) {${PINS}${body.replace("I2CCLKH = 45", "I2CCLKH = 0")}\n}`);
    expect(codes(zero)).toEqual(["i2c-clk-zero"]);
    const a = run(`void main(void) {\n I2caRegs.I2CMDR.all = 0x0020;\n while (1) {} }`);
    expect(codes(a)).toEqual(["i2c-a"]);
  });

  it("clears status flags by writing 1, and resets them with IRS = 0", () => {
    const r = run(`${READ2}
uint16_t before = 0;
uint16_t after = 0;
uint16_t reset = 0;
void main(void) {${init()}
    read2(0x48);
    before = I2cbRegs.I2CSTR.all;
    I2cbRegs.I2CSTR.all = 0x0020;              // SCD
    after = I2cbRegs.I2CSTR.all;
    I2cbRegs.I2CMDR.bit.IRS = 0;
    reset = I2cbRegs.I2CSTR.all;
    while (1) {}
}`);
    expect(r.board.readVar("before")).toBe(0x0430);
    expect(r.board.readVar("after")).toBe(0x0410);
    expect(r.board.readVar("reset")).toBe(0x0410);
  });

  it("works in FIFO mode as in the lecture's code (I2CFFTX = 0x6000, I2CFFRX = 0x2040)", () => {
    const r = run(`
uint16_t n = 0;
uint16_t hi = 0;
void main(void) {${PINS}
    I2cbRegs.I2CPSC.all = 19;
    I2cbRegs.I2CCLKL = 10;
    I2cbRegs.I2CCLKH = 5;
    I2cbRegs.I2CMDR.all = 0x0020;
    I2cbRegs.I2CFFTX.all = 0x6000;
    I2cbRegs.I2CFFRX.all = 0x2040;
    if (I2cbRegs.I2CMDR.bit.STP == 0 && I2cbRegs.I2CSTR.bit.BB == 0) {
        I2cbRegs.I2CSAR.all = 0x48;
        I2cbRegs.I2CCNT = 3;
        I2cbRegs.I2CDXR.all = 2;
        I2cbRegs.I2CDXR.all = 0x0A;
        I2cbRegs.I2CDXR.all = 0x00;
        I2cbRegs.I2CMDR.all = 0x6E20;
    }
    while (I2cbRegs.I2CMDR.bit.STP == 1) {}
    I2cbRegs.I2CCNT = 2;
    I2cbRegs.I2CMDR.all = 0x2C20;
    while (I2cbRegs.I2CFFRX.bit.RXFFST < 2) {}
    n = I2cbRegs.I2CFFRX.bit.RXFFST;
    hi = I2cbRegs.I2CDRR.all << 8;
    hi |= I2cbRegs.I2CDRR.all;
    while (1) {}
}`);
    expect(r.diagnostics).toEqual([]);
    expect(r.board.output("TMP_TLOW_C")).toBe(10);
    expect(r.board.readVar("n")).toBe(2);
    expect(r.board.readVar("hi")).toBe(0x0a00);
    expect(r.board.dev.get("I2cbRegs.I2CFFRX", "RXFFST")).toBe(0);
  });

  it("raises I2CB_INT (PIE 8.3) for enabled flags and reports the cause in I2CISRC", () => {
    const r = run(`
uint16_t causes[4];
uint16_t n = 0;
uint16_t value = 0;
__interrupt void i2c_isr(void)
{
    uint16_t code = I2cbRegs.I2CISRC.all;
    if (n < 4) causes[n] = code;
    n++;
    if (code == 4) value = (value << 8) | I2cbRegs.I2CDRR.all;   // RRDY
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP8;
}
void main(void) {
    DINT;
    InitPieCtrl();
    IER = 0;
    IFR = 0;
    InitPieVectTable();
    EALLOW;
    PieVectTable.I2CB_INT = &i2c_isr;
    EDIS;${init()}
    I2cbRegs.I2CIER.all = 0x0028;              // SCD and RRDY
    PieCtrlRegs.PIEIER8.bit.INTx3 = 1;
    IER |= M_INT8;
    EINT;
    I2cbRegs.I2CSAR.all = 0x48;
    I2cbRegs.I2CCNT = 2;
    I2cbRegs.I2CMDR.all = 0x2C20;
    while (1) {}
}`);
    expect(r.diagnostics).toEqual([]);
    expect(r.board.readVar("n")).toBe(3);
    expect(r.board.readVar("value")).toBe(0x1900);
    const c = r.board.compiler.globals.get("causes")!.addr;
    expect([0, 1, 2].map((i) => r.board.mem.peek(c + i, 1))).toEqual([4, 4, 6]);
    expect(r.board.dev.get("I2cbRegs.I2CSTR", "SCD")).toBe(0);
  });

  it("answers a master bit-banged on GPIO40 / GPIO41 as open-drain outputs", () => {
    const src = (options: string) => `
uint16_t acks = 0;
void sda(uint16_t v) { if (v) GpioDataRegs.GPBSET.bit.GPIO40 = 1; else GpioDataRegs.GPBCLEAR.bit.GPIO40 = 1; }
void scl(uint16_t v) { if (v) GpioDataRegs.GPBSET.bit.GPIO41 = 1; else GpioDataRegs.GPBCLEAR.bit.GPIO41 = 1; }
void send(uint16_t byte)
{
    int16_t i;
    for (i = 7; i >= 0; i--) {
        sda((byte >> i) & 1);
        DELAY_US(5);
        scl(1);
        DELAY_US(5);
        scl(0);
    }
    sda(1);
    DELAY_US(5);
    scl(1);
    DELAY_US(5);
    if (GpioDataRegs.GPBDAT.bit.GPIO40 == 0) acks++;
    scl(0);
}
void main(void) {
    GpioDataRegs.GPBSET.bit.GPIO40 = 1;
    GpioDataRegs.GPBSET.bit.GPIO41 = 1;
    GPIO_SetupPinMux(40, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(40, GPIO_OUTPUT, ${options});
    GPIO_SetupPinMux(41, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(41, GPIO_OUTPUT, ${options});
    DELAY_US(10);
    sda(0); DELAY_US(5); scl(0);               // START
    send(0x90);
    send(0x03);
    send(0x19);
    send(0x00);
    sda(0); DELAY_US(5); scl(1); DELAY_US(5); sda(1);   // STOP
    while (1) {}
}`;
    const r = run(src("GPIO_OPENDRAIN | GPIO_PULLUP"));
    expect(r.diagnostics).toEqual([]);
    expect(r.board.readVar("acks")).toBe(4);
    expect(r.board.output("TMP_THIGH_C")).toBe(25);
    expect(state(r).bus.log[0]).toMatchObject({ address: 0x48, read: false, data: [3, 0x19, 0], stopped: true });
    // Push-pull outputs fight the device's ACK: that is a short circuit.
    expect(codes(run(src("GPIO_PUSHPULL")))).toContain("short-40");
  });
});
