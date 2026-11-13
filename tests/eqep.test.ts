import { describe, expect, it } from "vitest";
import { runProgram, type Stimulus } from "../src/sim/runner";
import { codes } from "./helpers";

// The course's init_eQEPs() (SE423Lib.c / Lab 3), unchanged.
const INIT_EQEPS = `
void init_eQEPs(void) {

    // setup eQEP1 pins for input
    EALLOW;
    //Disable internal pull-up for the selected output pins for reduced power consumption
    GpioCtrlRegs.GPAPUD.bit.GPIO20 = 1;    // Disable pull-up on GPIO20 (EQEP1A)
    GpioCtrlRegs.GPAPUD.bit.GPIO21 = 1;    // Disable pull-up on GPIO21 (EQEP1B)
    GpioCtrlRegs.GPAQSEL2.bit.GPIO20 = 2;   // Qual every 6 samples
    GpioCtrlRegs.GPAQSEL2.bit.GPIO21 = 2;   // Qual every 6 samples
    EDIS;
    // This specifies which of the possible GPIO pins will be EQEP1 functional pins.
    // Comment out other unwanted lines.
    GPIO_SetupPinMux(20, GPIO_MUX_CPU1, 1);
    GPIO_SetupPinMux(21, GPIO_MUX_CPU1, 1);
    EQep1Regs.QEPCTL.bit.QPEN = 0;    // make sure eqep in reset
    EQep1Regs.QDECCTL.bit.QSRC = 0;   // Quadrature count mode
    EQep1Regs.QPOSCTL.all = 0x0;      // Disable eQep Position Compare
    EQep1Regs.QCAPCTL.all = 0x0;      // Disable eQep Capture
    EQep1Regs.QEINT.all = 0x0;        // Disable all eQep interrupts
    EQep1Regs.QPOSMAX = 0xFFFFFFFF;   // use full range of the 32 bit count
    EQep1Regs.QEPCTL.bit.FREE_SOFT = 2;  // EQep uneffected by emulation suspend in Code Composer
    EQep1Regs.QPOSCNT = 0;
    EQep1Regs.QEPCTL.bit.QPEN = 1;    // Enable EQep

    EALLOW;
    // setup QEP2 pins for input
    //Disable internal pull-up for the selected output pinsfor reduced power consumption
    GpioCtrlRegs.GPBPUD.bit.GPIO54 = 1;    // Disable pull-up on GPIO54 (EQEP2A)
    GpioCtrlRegs.GPBPUD.bit.GPIO55 = 1;    // Disable pull-up on GPIO55 (EQEP2B)
    GpioCtrlRegs.GPBQSEL2.bit.GPIO54 = 2;   // Qual every 6 samples
    GpioCtrlRegs.GPBQSEL2.bit.GPIO55 = 2;   // Qual every 6 samples
    EDIS;
    GPIO_SetupPinMux(54, GPIO_MUX_CPU1, 5); // set GPIO54 and eQep2A
    GPIO_SetupPinMux(55, GPIO_MUX_CPU1, 5); // set GPIO55 and eQep2B
    EQep2Regs.QEPCTL.bit.QPEN = 0;   // make sure qep reset
    EQep2Regs.QDECCTL.bit.QSRC = 0;  // Quadrature count mode
    EQep2Regs.QPOSCTL.all = 0x0;     // Disable eQep Position Compare
    EQep2Regs.QCAPCTL.all = 0x0;     // Disable eQep Capture
    EQep2Regs.QEINT.all = 0x0;       // Disable all eQep interrupts
    EQep2Regs.QPOSMAX = 0xFFFFFFFF;  // use full range of the 32 bit count.
    EQep2Regs.QEPCTL.bit.FREE_SOFT = 2;  // EQep uneffected by emulation suspend
    EQep2Regs.QPOSCNT = 0;
    EQep2Regs.QEPCTL.bit.QPEN = 1;   // Enable EQep

    EALLOW;
    // setup QEP3 pins for input
    //Disable internal pull-up for the selected output pins for reduced power consumption
    GpioCtrlRegs.GPAPUD.bit.GPIO6 = 1;    // Disable pull-up on GPIO54 (EQEP3A)
    GpioCtrlRegs.GPAPUD.bit.GPIO7 = 1;    // Disable pull-up on GPIO55 (EQEP3B)
    GpioCtrlRegs.GPAQSEL1.bit.GPIO6 = 2;   // Qual every 6 samples
    GpioCtrlRegs.GPAQSEL1.bit.GPIO7 = 2;   // Qual every 6 samples
    EDIS;
    GPIO_SetupPinMux(6, GPIO_MUX_CPU1, 5); // set GPIO6 and eQep2A
    GPIO_SetupPinMux(7, GPIO_MUX_CPU1, 5); // set GPIO7 and eQep2B
    EQep3Regs.QEPCTL.bit.QPEN = 0;   // make sure qep reset
    EQep3Regs.QDECCTL.bit.QSRC = 0;  // Quadrature count mode
    EQep3Regs.QPOSCTL.all = 0x0;     // Disable eQep Position Compare
    EQep3Regs.QCAPCTL.all = 0x0;     // Disable eQep Capture
    EQep3Regs.QEINT.all = 0x0;       // Disable all eQep interrupts
    EQep3Regs.QPOSMAX = 0xFFFFFFFF;  // use full range of the 32 bit count.
    EQep3Regs.QEPCTL.bit.FREE_SOFT = 2;  // EQep uneffected by emulation suspend
    EQep3Regs.QPOSCNT = 0;
    EQep3Regs.QEPCTL.bit.QPEN = 1;   // Enable EQep

}

float readEncLeft(void) {
    int32_t raw = 0;
    uint32_t QEP_maxvalue = 0xFFFFFFFFU;  //4294967295U

    raw = EQep1Regs.QPOSCNT;
    if (raw >= QEP_maxvalue/2) raw -= QEP_maxvalue;  // I don't think this is needed and never true

    return (raw*(-2*PI/(2000.0*20.0)));
}

float readEncRight(void) {

    int32_t raw = 0;
    uint32_t QEP_maxvalue = 0xFFFFFFFFU;  //4294967295U  -1 32bit signed int

    raw = EQep2Regs.QPOSCNT;
    if (raw >= QEP_maxvalue/2) raw -= QEP_maxvalue;  // I don't think this is needed and never true

    return (raw*(2*PI/(2000.0*20.0)));
}

float readEncWheel(void) {

    int32_t raw = 0;
    uint32_t QEP_maxvalue = 0xFFFFFFFFU;  //4294967295U  -1 32bit signed int

    raw = EQep3Regs.QPOSCNT;
    if (raw >= QEP_maxvalue/2) raw -= QEP_maxvalue;  // I don't think this is needed and never true

    return (raw*(2*PI/4000.0));
}
`;

const PI_DEF = `#define PI          3.1415926535897932384626433832795\n`;

/** Runs `body` after the course's init, then idles; globals are read at the end. */
function run(body: string, stimuli: Stimulus[], durationMs: number, globals = "", init = "init_eQEPs();") {
  const r = runProgram({
    kit: "robot",
    durationMs,
    stimuli,
    source: `${PI_DEF}${globals}\n${INIT_EQEPS}\nvoid main(void) {\n  InitSysCtrl();\n  InitGpio();\n  ${init}\n${body}\n  while (1) {}\n}\n`,
  });
  expect(r.compileError, JSON.stringify(r.compileError)).toBeUndefined();
  expect(r.runtimeError, JSON.stringify(r.runtimeError)).toBeUndefined();
  return r;
}

const G = `float left = 0; float right = 0; float hand = 0; int32_t c1 = 0; int32_t c2 = 0; int32_t c3 = 0; uint32_t u = 0; uint16_t dir = 0;\n`;

describe("eQEP plugin", () => {
  it("runs the course's init_eQEPs and read functions unchanged: 40000 counts per wheel turn, left wheel negative", () => {
    // One wheel turn per second for 500 ms, read after 600 ms.
    const r = run(
      `  DELAY_US(600000);
  c1 = EQep1Regs.QPOSCNT; c2 = EQep2Regs.QPOSCNT; c3 = EQep3Regs.QPOSCNT;
  left = readEncLeft(); right = readEncRight(); hand = readEncWheel();`,
      [
        { at: 100, set: "LEFT_WHEEL_RADPS", value: 2 * Math.PI },
        { at: 100, set: "RIGHT_WHEEL_RADPS", value: 2 * Math.PI },
        { at: 100, set: "HANDWHEEL_RADPS", value: -Math.PI },
        { at: 600, set: "LEFT_WHEEL_RADPS", value: 0 },
        { at: 600, set: "RIGHT_WHEEL_RADPS", value: 0 },
        { at: 600, set: "HANDWHEEL_RADPS", value: 0 },
      ],
      700,
      G,
    );
    expect(r.diagnostics).toEqual([]);
    const b = r.board;
    // Half a wheel turn: 20000 counts, down on the left (mirrored motor), up on the right.
    expect(Math.abs(b.readVar("c2")! - 20000)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.readVar("c1")! + 20000)).toBeLessThanOrEqual(1);
    // Hand wheel: a quarter turn backwards = -1000 counts of 4000.
    expect(Math.abs(b.readVar("c3")! + 1000)).toBeLessThanOrEqual(1);
    // Both wheels read +pi rad with the course's scale factors.
    expect(b.readVar("left")!).toBeCloseTo(Math.PI, 3);
    expect(b.readVar("right")!).toBeCloseTo(Math.PI, 3);
    expect(b.readVar("hand")!).toBeCloseTo(-Math.PI / 2, 2);
    // The stored copy (inspector, reg checks) and the angle meters follow.
    expect(Math.abs(b.dev.get("EQep2Regs.QPOSCNT") - 20000)).toBeLessThanOrEqual(1);
    expect(b.output("LEFT_WHEEL_RAD")!).toBeCloseTo(Math.PI, 6);
    expect(b.output("RIGHT_WHEEL_RAD", 350e6)!).toBeCloseTo(Math.PI / 2, 1);
  });

  it("integrates a speed that changes, and reports the direction in QEPSTS.QDF", () => {
    const r = run(
      `  DELAY_US(250000);
  dir = EQep2Regs.QEPSTS.bit.QDF;
  DELAY_US(250000);
  c2 = EQep2Regs.QPOSCNT;
  dir = dir * 2 + EQep2Regs.QEPSTS.bit.QDF;`,
      [
        { at: 1, set: "RIGHT_WHEEL_RADPS", value: 10 },
        { at: 201, set: "RIGHT_WHEEL_RADPS", value: -4 },
        { at: 301, set: "RIGHT_WHEEL_RADPS", value: 1 },
      ],
      520,
      G,
    );
    // 10 * 0.2 - 4 * 0.1 + 1 * 0.199 = 1.799 rad (read at 500 ms)
    const want = (1.799 * 40000) / (2 * Math.PI);
    expect(Math.abs(r.board.readVar("c2")! - want)).toBeLessThanOrEqual(2);
    // Read at 250 ms while turning backwards (0), at 500 ms forwards (1).
    expect(r.board.readVar("dir")).toBe(1);
  });

  it("does not count with QPEN = 0, with the wrong mux, or with QPOSMAX left at 0, and says why", () => {
    const stim: Stimulus[] = [{ at: 0, set: "RIGHT_WHEEL_RADPS", value: 5 }];
    const body = `  DELAY_US(100000);\n  c2 = EQep2Regs.QPOSCNT;`;
    const off = run(body, stim, 120, G, "init_eQEPs(); EQep2Regs.QEPCTL.bit.QPEN = 0;");
    expect(off.board.readVar("c2")).toBe(0);
    expect(codes(off)).toContain("eqep-disabled-2");

    const mux = run(body, stim, 120, G, "init_eQEPs(); GPIO_SetupPinMux(55, GPIO_MUX_CPU1, 0);");
    expect(mux.board.readVar("c2")).toBe(0);
    expect(codes(mux)).toContain("eqep-mux-2");
    expect(mux.diagnostics.find((d) => d.code === "eqep-mux-2")!.msg).toContain("GPIO_SetupPinMux(55, GPIO_MUX_CPU1, 5)");

    const max = run(body, stim, 120, G, "init_eQEPs(); EQep2Regs.QPOSMAX = 0;");
    expect(max.board.readVar("c2")).toBe(0);
    expect(codes(max)).toContain("eqep-posmax-2");
  });

  it("keeps the count while disabled and continues from it when enabled again", () => {
    const r = run(
      `  DELAY_US(100000);
  EQep2Regs.QEPCTL.bit.QPEN = 0;
  DELAY_US(100000);
  EQep2Regs.QEPCTL.bit.QPEN = 1;
  c1 = EQep2Regs.QPOSCNT;
  DELAY_US(100000);
  c2 = EQep2Regs.QPOSCNT;`,
      [{ at: 0, set: "RIGHT_WHEEL_RADPS", value: 1 }],
      320,
      G,
    );
    const per100ms = (0.1 * 40000) / (2 * Math.PI);
    expect(Math.abs(r.board.readVar("c1")! - per100ms)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.board.readVar("c2")! - 2 * per100ms)).toBeLessThanOrEqual(2);
  });

  it("wraps to QPOSMAX below 0 and to 0 above QPOSMAX (TRM 17.5.1), and SWI loads QPOSINIT (17.5.3)", () => {
    // Hand wheel, 3999 = one turn: the count is the angle within the turn.
    const r = run(
      `  EQep3Regs.QPOSMAX = 3999;
  DELAY_US(100000);
  c1 = EQep3Regs.QPOSCNT;
  DELAY_US(300000);
  c2 = EQep3Regs.QPOSCNT;
  EQep3Regs.QPOSINIT = 1234;
  EQep3Regs.QEPCTL.bit.SWI = 1;
  c3 = EQep3Regs.QPOSCNT;
  EQep1Regs.QPOSCNT = 5;
  u = EQep1Regs.QPOSCNT;`,
      [
        // 0.1 turn backwards in 100 ms, then 1.2 turns forwards in 300 ms.
        { at: 0, set: "HANDWHEEL_RADPS", value: -2 * Math.PI },
        { at: 100, set: "HANDWHEEL_RADPS", value: 8 * Math.PI },
        { at: 400, set: "HANDWHEEL_RADPS", value: 0 },
        { at: 400, set: "LEFT_WHEEL_RADPS", value: 0.5 },
      ],
      420,
      G,
    );
    const b = r.board;
    expect(Math.abs(b.readVar("c1")! - 3600)).toBeLessThanOrEqual(2); // -400 wrapped
    expect(Math.abs(b.readVar("c2")! - 400)).toBeLessThanOrEqual(2); // -400 + 4800 = 4400, wrapped
    expect(b.readVar("c3")).toBe(1234);
    expect(b.readVar("u")).toBe(5);
    // With the full 32-bit range a negative position reads as a large unsigned number.
    const neg = run(`  DELAY_US(100000);\n  u = EQep2Regs.QPOSCNT; c2 = EQep2Regs.QPOSCNT;`, [{ at: 0, set: "RIGHT_WHEEL_RADPS", value: -1 }], 120, G);
    expect(neg.board.readVar("c2")!).toBeLessThan(-600);
    expect(neg.board.readVar("u")!).toBeGreaterThan(4294960000);
  });

  it("implements the count sources of QDECCTL.QSRC, with XCR and SWAP (TRM 17.4.1)", () => {
    // 800 counts of quadrature = 200 periods of channel A.
    const stim = (v: number): Stimulus[] => [{ at: 0, set: "HANDWHEEL_RADPS", value: v }, { at: 100, set: "HANDWHEEL_RADPS", value: 0 }];
    const rate = (800 / 4000) * 2 * Math.PI * 10;
    const count = (cfg: string, v = rate) =>
      run(`  ${cfg}\n  DELAY_US(150000);\n  c3 = EQep3Regs.QPOSCNT;`, stim(v), 160, G).board.readVar("c3")!;
    const near = (got: number, want: number) => expect(Math.abs(got - want), `${got} vs ${want}`).toBeLessThanOrEqual(2);
    near(count(""), 800);
    near(count("EQep3Regs.QDECCTL.bit.SWAP = 1;"), -800);
    near(count("EQep3Regs.QDECCTL.bit.QBP = 1;"), -800);
    // Up count: both edges of A (XCR = 0) or rising edges only (XCR = 1), in either direction.
    near(count("EQep3Regs.QDECCTL.bit.QSRC = 2;"), 400);
    near(count("EQep3Regs.QDECCTL.bit.QSRC = 2;", -rate), 400);
    near(count("EQep3Regs.QDECCTL.bit.QSRC = 2; EQep3Regs.QDECCTL.bit.XCR = 1;"), 200);
    near(count("EQep3Regs.QDECCTL.bit.QSRC = 3; EQep3Regs.QDECCTL.bit.XCR = 1;"), -200);
    // Direction count with a quadrature encoder: B is low at A's rising edge going forward.
    near(count("EQep3Regs.QDECCTL.bit.QSRC = 1; EQep3Regs.QDECCTL.bit.XCR = 1;"), -200);
    near(count("EQep3Regs.QDECCTL.bit.QSRC = 1; EQep3Regs.QDECCTL.bit.XCR = 1;", -rate), 200);
    // Both edges: B is low at one edge and high at the other, so the count goes nowhere.
    near(count("EQep3Regs.QDECCTL.bit.QSRC = 1;"), 0);
  });

  it("drives the A and B waveforms on the pins at low speed, A leading B when the count goes up", () => {
    // Hand wheel at 100 counts/s for 200 ms, then back at the same speed.
    const v = (100 / 4000) * 2 * Math.PI;
    const r = run(
      ``,
      [{ at: 0, set: "HANDWHEEL_RADPS", value: v }, { at: 200, set: "HANDWHEEL_RADPS", value: -v }, { at: 400, set: "HANDWHEEL_RADPS", value: 0 }],
      420,
      G,
      "",
    );
    const g = r.board.gpio;
    const a = g.trace.get(6)!;
    const bb = g.trace.get(7)!;
    // 20 counts each way: 10 edges per channel each way (plus the initial level).
    expect(a.filter((x) => x.t > 0 && x.t < 200e6).length).toBe(10);
    expect(bb.filter((x) => x.t > 0 && x.t < 200e6).length).toBe(10);
    const state = (ms: number) => `${g.levelAt(6, ms * 1e6)}${g.levelAt(7, ms * 1e6)}`;
    // Counts happen at 5, 15, 25, 35 ms: 00 -> 10 -> 11 -> 01 -> 00 (Figure 17-6).
    expect([1, 10, 20, 30, 40].map(state)).toEqual(["00", "10", "11", "01", "00"]);
    // Reversed, the same states come back in the opposite order and end where they began.
    expect([401, 391, 381, 371].map(state)).toEqual(["00", "10", "11", "01"]);
    // Only one channel changes at a time (Gray code).
    const times = new Set(a.map((x) => x.t));
    for (const x of bb) if (x.t > 0) expect(times.has(x.t)).toBe(false);
  });

  it("leaves the encoder pins alone until a shaft turns, and at motor speed makes no pin events", () => {
    const still = run(``, [], 5, G, "");
    expect(still.board.gpio.trace.get(20)).toBeUndefined();
    const fast = run(`  DELAY_US(900000);\n  c2 = EQep2Regs.QPOSCNT;`, [{ at: 0, set: "RIGHT_WHEEL_RADPS", value: 20 }], 1000, G);
    expect((fast.board.gpio.trace.get(54) ?? []).length).toBeLessThanOrEqual(1);
    expect(Math.abs(fast.board.readVar("c2")! - (18 * 40000) / (2 * Math.PI))).toBeLessThanOrEqual(3);
  });
});
