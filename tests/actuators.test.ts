import { describe, expect, it } from "vitest";
import { runProgram, type Check, type RunResult, type Stimulus } from "../src/sim/runner";
import { MOTOR_DEAD_ZONE, MOTOR_TAU_S, WHEEL_MAX_RADPS, servoAngle, wheelTarget } from "../src/sim/plugins/actuators";
import { KITS } from "../src/sim/world/kits";

import { Board } from "../src/sim/board";
// These tests run bare programs for one peripheral, without the InitSysCtrl() every real program starts with.
Board.expectInitSysCtrl = false;

const run = (source: string, durationMs: number, checks: Check[] = [], kit = "robot", stimuli?: Stimulus[]) => runProgram({ kit, source, durationMs, checks, stimuli });

function ok(r: RunResult): void {
  expect(r.compileError, JSON.stringify(r.compileError)).toBeUndefined();
  expect(r.runtimeError, JSON.stringify(r.runtimeError)).toBeUndefined();
  for (const c of r.checks) expect(c.pass, `${c.label}: ${c.detail}`).toBe(true);
  expect(r.diagnostics.map((d) => `${d.line}: ${d.msg}`)).toEqual([]);
}

// The course library's motor set-up, unchanged (SE423Lib.c). setEPWM1A and setEPWM2A are
// not here: students write them in Lab 3, so the simulator's library provides them
// (src/sim/plugins/actuators.ts) and no file of the game holds their C source.
const SE423LIB_MOTORS = `
void init_EPWM1and2(void) {
    //epwm1A
    EPwm1Regs.TBCTL.bit.CTRMODE = 0; //count up mode
    EPwm1Regs.TBCTL.bit.FREE_SOFT = 3; // free run mode
    EPwm1Regs.TBCTL.bit.CLKDIV = 0; //divide by 1
    EPwm1Regs.TBCTL.bit.PHSEN = 0; //disable the phase loading
    EPwm1Regs.TBCTR = 0; //Start the timers at zero.
    //Set the period (carrier frequency) of the PWM signal to 20KHz which is a period of
    //50 microseconds. Remember the clock source that the TBCTR register is counting is 50MHz.
    EPwm1Regs.TBPRD = 2500;
    EPwm1Regs.CMPA.bit.CMPA = 1250; //start the duty cycle at 50%.
    EPwm1Regs.AQCTLA.bit.CAU = 1; //set it up such that the signal is cleared when CMPA (or CMPB ) is reached.
    EPwm1Regs.AQCTLA.bit.ZRO = 2; //Have the pin be set when the TBCTR register is zero
    EPwm1Regs.AQCTLB.bit.CBU = 1; //set it up such that the signal is cleared when CMPA (or CMPB ) is reached.
    EPwm1Regs.AQCTLB.bit.ZRO = 2; //Have the pin be set when the TBCTR register is zero
    EPwm1Regs.TBPHS.bit.TBPHS = 0;

    //EPWM2A
    EPwm2Regs.TBCTL.bit.CTRMODE = 0; //count up mode
    EPwm2Regs.TBCTL.bit.FREE_SOFT = 3; // free run mode
    EPwm2Regs.TBCTL.bit.CLKDIV = 0; //divide by 1
    EPwm2Regs.TBCTL.bit.PHSEN = 0; //disable the phase loading
    EPwm2Regs.TBCTR = 0; //Start the timers at zero.
    EPwm2Regs.TBPRD = 2500;
    EPwm2Regs.CMPA.bit.CMPA = 1250; //start the duty cycle at 50%.
    EPwm2Regs.AQCTLA.bit.CAU = 1; //set it up such that the signal is cleared when CMPA (or CMPB ) is reached.
    EPwm2Regs.AQCTLA.bit.ZRO = 2; //Have the pin be set when the TBCTR register is zero
    EPwm2Regs.AQCTLB.bit.CBU = 1; //set it up such that the signal is cleared when CMPA (or CMPB ) is reached.
    EPwm2Regs.AQCTLB.bit.ZRO = 2; //Have the pin be set when the TBCTR register is zero
    EPwm2Regs.TBPHS.bit.TBPHS = 0;

    EALLOW; // Below are protected registers
    GpioCtrlRegs.GPAPUD.bit.GPIO0 = 1; // For EPWM1A
    GpioCtrlRegs.GPAPUD.bit.GPIO2 = 1; // For EPWM2A
    EDIS;

    GPIO_SetupPinMux(0, GPIO_MUX_CPU1, 1);  //EPWM1A
    GPIO_SetupPinMux(2, GPIO_MUX_CPU1, 1);  //EPWM2A

}`;

// The robot's servo set-up, unchanged (SE423Lib.c), reduced to EPWM3. The functions that
// turn an angle into a compare value are a graded exercise (HW4): the test writes counts.
const SE423LIB_SERVO = `
void init_RCServoPWM_3AB(void) {
    EPwm3Regs.TBCTL.bit.CTRMODE = 0; //count up mode
    EPwm3Regs.TBCTL.bit.FREE_SOFT = 3; // free run mode
    EPwm3Regs.TBCTL.bit.CLKDIV = 4; //divide by 16
    EPwm3Regs.TBCTL.bit.PHSEN = 0; //disable the phase loading
    EPwm3Regs.TBCTR = 0; //Start the timers at zero.
    EPwm3Regs.TBPRD = 62500;
    EPwm3Regs.CMPA.bit.CMPA = 5000; //start the duty cycle at 8%.
    EPwm3Regs.CMPB.bit.CMPB = 5000;
    EPwm3Regs.AQCTLA.bit.CAU = 1; //set it up such that the signal is cleared when CMPA is reached.
    EPwm3Regs.AQCTLA.bit.ZRO = 2; //Have the pin be set when the TBCTR register is zero
    EPwm3Regs.AQCTLB.bit.CBU = 1; //set it up such that the signal is cleared when CMPB is reached.
    EPwm3Regs.AQCTLB.bit.ZRO = 2; //Have the pin be set when the TBCTR register is zero
    EPwm3Regs.TBPHS.bit.TBPHS = 0;

    EALLOW; // Below are protected registers
    GpioCtrlRegs.GPAPUD.bit.GPIO4 = 1; // For EPWM3A
    GpioCtrlRegs.GPAPUD.bit.GPIO5 = 1; // For EPWM3B
    EDIS;

    GPIO_SetupPinMux(4, GPIO_MUX_CPU1, 1);  //EPWM3A
    GPIO_SetupPinMux(5, GPIO_MUX_CPU1, 1);  //EPWM3B
}`;

describe("DC motors through the H-bridge", () => {
  it("maps duty to speed: 50 % stopped, dead zone, full scale", () => {
    expect(wheelTarget(0.5)).toBe(0);
    expect(wheelTarget(0.5 + MOTOR_DEAD_ZONE / 2 - 0.001)).toBe(0);
    expect(wheelTarget(1)).toBeCloseTo(WHEEL_MAX_RADPS, 9);
    expect(wheelTarget(0)).toBeCloseTo(-WHEEL_MAX_RADPS, 9);
    expect(wheelTarget(0.75)).toBeGreaterThan(0);
    expect(wheelTarget(0.25)).toBeCloseTo(-wheelTarget(0.75), 9);
  });

  it("stays stopped at the course's 50 % start-up duty", () => {
    const r = run(`${SE423LIB_MOTORS}\nvoid main(void) { init_EPWM1and2(); while (1) {} }`, 100, [
      { kind: "duty", pin: 0, pct: 50, tolPct: 0.1, from: 1, label: "EPWM1A at 50 %" },
      { kind: "signal", name: "LEFT_WHEEL_RADPS", at: 100, equals: 0, label: "left stopped" },
      { kind: "signal", name: "RIGHT_WHEEL_RADPS", at: 100, equals: 0, label: "right stopped" },
    ]);
    ok(r);
  });

  it("follows setEPWM1A / setEPWM2A as a first-order system, the right wheel mirrored", () => {
    const u = 5; // 75 % duty
    const steady = wheelTarget((u + 10) / 20);
    const r = run(`${SE423LIB_MOTORS}\nvoid main(void) { init_EPWM1and2(); setEPWM1A(5.0); setEPWM2A(-5.0); while (1) {} }`, 400, [
      { kind: "signal", name: "LEFT_WHEEL_RADPS", at: 400, equals: steady, tol: 0.05, label: "left steady state" },
      { kind: "signal", name: "RIGHT_WHEEL_RADPS", at: 400, equals: steady, tol: 0.05, label: "right forward with a negative command" },
      // One time constant after the step: 63 % of the way.
      { kind: "signal", name: "LEFT_WHEEL_RADPS", at: MOTOR_TAU_S * 1000 + 1, equals: steady * (1 - Math.exp(-1)), tol: 0.4, label: "63 % after one time constant" },
    ]);
    ok(r);
    expect(r.board.input("LEFT_WHEEL_RADPS")).toBeCloseTo(steady, 1);
    expect(r.board.input("RIGHT_WHEEL_RADPS")).toBeCloseTo(steady, 1);
  });

  it("runs backwards below 50 % and saturates the command", () => {
    const r = run(`${SE423LIB_MOTORS}\nvoid main(void) { init_EPWM1and2(); setEPWM1A(-25.0); setEPWM2A(0.2); while (1) {} }`, 400, [
      { kind: "duty", pin: 0, pct: 0, tolPct: 0.1, from: 5, label: "saturated at 0 %" },
      { kind: "signal", name: "LEFT_WHEEL_RADPS", at: 400, equals: -WHEEL_MAX_RADPS, tol: 0.05, label: "full reverse" },
      { kind: "signal", name: "RIGHT_WHEEL_RADPS", at: 400, equals: 0, label: "inside the friction dead zone" },
    ]);
    ok(r);
  });

  it("coasts to a stop when the PWM pin is released", () => {
    const r = run(
      `${SE423LIB_MOTORS}\nvoid main(void) { init_EPWM1and2(); setEPWM1A(10.0); DELAY_US(300000);
    GPIO_SetupPinMux(0, GPIO_MUX_CPU1, 0); while (1) {} }`,
      700,
      [
        { kind: "signal", name: "LEFT_WHEEL_RADPS", at: 299, min: WHEEL_MAX_RADPS * 0.98, label: "full speed" },
        { kind: "signal", name: "LEFT_WHEEL_RADPS", at: 700, min: -0.05, max: 0.05, label: "stopped" },
      ],
    );
    ok(r);
  });

  it("does nothing while the pins are untouched", () => {
    const r = run(`void main(void) { while (1) {} }`, 50);
    ok(r);
    expect(r.board.outputs.get("LEFT_WHEEL_RADPS")).toEqual([{ t: 0, v: 0 }]);
  });
});

describe("the course library's setEPWM1A and setEPWM2A", () => {
  // Reads CMPA of both motors after each call into arrays the test can look at.
  const table = (efforts: number[], tbprd: number, defs = "") => {
    const n = efforts.length;
    const r = run(
      `${defs}
float u[${n}] = {${efforts.map((e) => (Number.isInteger(e) ? e.toFixed(1) : `${e}`)).join(", ")}};
uint16_t a[${n}];
uint16_t b[${n}];
void main(void) {
    int16_t i;
    EPwm1Regs.TBPRD = ${tbprd};
    EPwm2Regs.TBPRD = ${tbprd};
    for (i = 0; i < ${n}; i++) {
        setEPWM1A(u[i]);
        setEPWM2A(-u[i]);
        a[i] = EPwm1Regs.CMPA.bit.CMPA;
        b[i] = EPwm2Regs.CMPA.bit.CMPA;
    }
    while (1) {}
}`,
      5,
    );
    ok(r);
    const read = (name: string) => {
      const g = r.board.compiler.globals.get(name)!;
      return efforts.map((_, i) => r.board.mem.peek(g.addr + i, 1));
    };
    return { a: read("a"), b: read("b") };
  };

  it("need no definition in the student's file: -10 is 0, 0 is half and 10 is all of TBPRD", () => {
    const { a, b } = table([-10, -5, 0, 4, 10], 2500);
    expect(a).toEqual([0, 625, 1250, 1750, 2500]);
    expect(b).toEqual([2500, 1875, 1250, 750, 0]);
  });

  it("saturate at -10 and 10, cut the fraction off, and read the period from TBPRD", () => {
    // (0.33 + 10) x 2500 / 20 = 1291.25, and (-0.33 + 10) x 2500 / 20 = 1208.75.
    expect(table([12, -12, 1e6, 0.33], 2500)).toEqual({ a: [2500, 0, 2500, 1291], b: [0, 2500, 0, 1208] });
    expect(table([0, 10, 4, -7], 2000)).toEqual({ a: [1000, 2000, 1400, 300], b: [1000, 0, 600, 1700] });
    expect(table([0, 10, 3], 65535)).toEqual({ a: [32767, 65535, 42597], b: [32767, 0, 22937] });
  });

  it("write only the compare value: the high-resolution half of CMPA is kept", () => {
    const r = run(
      `void main(void) {
    EPwm1Regs.TBPRD = 2500;
    EPwm1Regs.CMPA.bit.CMPAHR = 0x1200;
    setEPWM1A(2.0);
    while (1) {}
}`,
      1,
    );
    expect(r.compileError).toBeUndefined();
    expect(r.board.dev.get("EPwm1Regs.CMPA", "CMPA")).toBe(1500);
    expect(r.board.dev.get("EPwm1Regs.CMPA", "CMPAHR")).toBe(0x1200);
  });

  it("report a compare value above the period on the line of the call", () => {
    const r = run(
      `void main(void) {
    EPwm1Regs.TBCTL.bit.CTRMODE = 0;
    EPwm1Regs.TBPRD = 2500;
    EPwm1Regs.AQCTLA.bit.CAU = 1;
    EPwm1Regs.AQCTLA.bit.ZRO = 2;
    setEPWM1A(10.0);
    EPwm1Regs.TBPRD = 2000;
    while (1) {}
}`,
      1,
    );
    expect(r.diagnostics.map((d) => `${d.line} ${d.code}`)).toEqual(["7 cmp-over-period"]);
  });

  it("drive the wheels like a function written in the file would", () => {
    const steady = wheelTarget(0.7);
    const r = run(`${SE423LIB_MOTORS}\nvoid main(void) { init_EPWM1and2(); setEPWM1A(4.0); setEPWM2A(-4.0); while (1) {} }`, 400, [
      { kind: "duty", pin: 0, pct: 70, tolPct: 0.1, from: 5, label: "EPWM1A at 70 %" },
      { kind: "duty", pin: 2, pct: 30, tolPct: 0.1, from: 5, label: "EPWM2A at 30 %" },
      { kind: "signal", name: "LEFT_WHEEL_RADPS", at: 400, equals: steady, tol: 0.05, label: "left" },
      { kind: "signal", name: "RIGHT_WHEEL_RADPS", at: 400, equals: steady, tol: 0.05, label: "right" },
    ]);
    ok(r);
  });

  it("give way to a definition in the student's file (programs saved before the library had them)", () => {
    // A recognisably different function: the test can tell which one ran.
    const own = `
void setEPWM1A(float controleffort);
void setEPWM2A(float controleffort);
void setEPWM1A(float controleffort) { EPwm1Regs.CMPA.bit.CMPA = 111; }
void setEPWM2A(float controleffort) { EPwm2Regs.CMPA.bit.CMPA = 222 + controleffort; }`;
    expect(table([0, 5, -5], 2500, own)).toEqual({ a: [111, 111, 111], b: [222, 217, 227] });
    // The definition may also come after its first use.
    const r = run(
      `void main(void) { EPwm1Regs.TBPRD = 2500; setEPWM1A(3.0); while (1) {} }
void setEPWM1A(float controleffort) { EPwm1Regs.CMPA.bit.CMPA = 77; }`,
      1,
    );
    ok(r);
    expect(r.board.dev.get("EPwm1Regs.CMPA", "CMPA")).toBe(77);
  });

  it("accept a repeated prototype, and still refuse a second definition of other library functions", () => {
    const r = run(`void setEPWM1A(float controleffort);\nvoid main(void) { EPwm1Regs.TBPRD = 100; setEPWM1A(0.0); while (1) {} }`, 1);
    ok(r);
    expect(r.board.dev.get("EPwm1Regs.CMPA", "CMPA")).toBe(50);
    const twice = run(`void setEPWM1A(float u) { }\nvoid setEPWM1A(float u) { }\nvoid main(void) { while (1) {} }`, 1);
    expect(twice.compileError?.msg).toMatch(/defined twice/);
    const lib = run(`void InitCpuTimers(void) { }\nvoid main(void) { while (1) {} }`, 1);
    expect(lib.compileError?.msg).toMatch(/already provided by the course library/);
  });
});

describe("RC servos", () => {
  it("uses the course's pulse widths", () => {
    expect(servoAngle(0.8)).toBeCloseTo(-90, 9);
    expect(servoAngle(1.6)).toBeCloseTo(0, 9);
    expect(servoAngle(2.4)).toBeCloseTo(90, 9);
    expect(servoAngle(5)).toBe(90);
  });

  it("reads the angle from SE423Lib's 50 Hz set-up (CLKDIV /16, TBPRD 62500)", () => {
    const r = run(`${SE423LIB_SERVO}\nvoid main(void) { init_RCServoPWM_3AB();
    EPwm3Regs.CMPA.bit.CMPA = 6250;   // 10 % of 62500
    EPwm3Regs.CMPB.bit.CMPB = 1500;   // 2.4 %: narrower than the pulse for -90 degrees
    while (1) {} }`, 90, [
      { kind: "blink", pin: 4, periodMs: 20, tolPct: 100, label: "edges" },
      { kind: "duty", pin: 4, pct: 10, tolPct: 0.1, from: 25, to: 85.00136, label: "45 degrees is 10 %" },
      { kind: "signal", name: "SERVO3A_DEG", equals: 45, tol: 0.05, label: "servo A at 45" },
      { kind: "signal", name: "SERVO3B_DEG", equals: -90, tol: 0.05, label: "servo B at its stop, -90" },
    ]);
    ok(r);
    const rises = r.traces.get(4)!.filter((x) => x.level === 1);
    // (62500 + 1) counts of 320 ns.
    expect(rises[2].t - rises[1].t).toBe(62501 * 320);
  });

  it("ignores pulses that do not repeat at an RC rate", () => {
    // CLKDIV left at /1: the period is 1.25 ms, 800 Hz.
    const r = run(
      `void main(void) {
    EPwm8Regs.TBCTL.bit.CTRMODE = 0;
    EPwm8Regs.TBPRD = 62500;
    EPwm8Regs.CMPA.bit.CMPA = 5000;
    EPwm8Regs.AQCTLA.bit.CAU = 1;
    EPwm8Regs.AQCTLA.bit.ZRO = 2;
    GPIO_SetupPinMux(14, GPIO_MUX_CPU1, 1);
    while (1) {} }`,
      60,
      [],
      "redboard",
    );
    ok(r);
    expect(r.board.output("SERVO1_DEG")).toBeUndefined();
  });
});

describe("buzzer", () => {
  it("plays HW3's notes: toggle on zero with CLKDIV /2 gives 12.5 MHz / TBPRD", () => {
    const r = run(
      `#define A4NOTE ((uint16_t)(((50000000/2)/2)/440.00))
#define C5NOTE ((uint16_t)(((50000000/2)/2)/523.25))
#define OFFNOTE 0
void main(void) {
    EPwm9Regs.TBCTL.bit.CTRMODE = 0;
    EPwm9Regs.TBCTL.bit.FREE_SOFT = 2;
    EPwm9Regs.TBCTL.bit.PHSEN = 0;
    EPwm9Regs.TBCTL.bit.CLKDIV = 1;
    EPwm9Regs.TBCTR = 0;
    EPwm9Regs.TBPRD = A4NOTE;
    EPwm9Regs.AQCTLA.bit.CAU = 0;
    EPwm9Regs.AQCTLA.bit.ZRO = 3;
    EPwm9Regs.TBPHS.bit.TBPHS = 0;
    GPIO_SetupPinMux(16, GPIO_MUX_CPU1, 5);
    DELAY_US(50000);
    EPwm9Regs.TBPRD = C5NOTE;
    DELAY_US(50000);
    EPwm9Regs.TBPRD = OFFNOTE;
    while (1) {} }`,
      150,
      [
        { kind: "signal", name: "BUZZER_HZ", at: 45, equals: 440, tol: 0.1, label: "A4" },
        { kind: "duty", pin: 16, pct: 50, tolPct: 1, from: 5, to: 45, label: "square wave" },
        { kind: "signal", name: "BUZZER_HZ", at: 95, equals: 523.25, tol: 0.1, label: "C5" },
        { kind: "signal", name: "BUZZER_HZ", at: 150, equals: 0, label: "silent" },
      ],
      "redboard",
    );
    ok(r);
  });
});

describe("kit parts", () => {
  it("adds meters for the wheels, servos and buzzer", () => {
    const outputs = (kit: string) => KITS[kit].parts.filter((p) => p.kind === "meter").map((p) => (p.kind === "meter" ? p.output : ""));
    expect(outputs("robot")).toEqual(expect.arrayContaining(["LEFT_WHEEL_RADPS", "RIGHT_WHEEL_RADPS", "SERVO1_DEG", "SERVO2_DEG", "BUZZER_HZ"]));
    expect(outputs("redboard")).toEqual(expect.arrayContaining(["SERVO1_DEG", "SERVO2_DEG", "BUZZER_HZ"]));
  });
});
