import { describe, expect, it } from "vitest";
import { runProgram, type Check, type Stimulus } from "../src/sim/runner";
import { COULOMB, GAIN, TAU, WHEEL_BASE, stepWheel } from "../src/sim/plugins/plant";

const run = (source: string, durationMs: number, checks: Check[] = [], stimuli: Stimulus[] = []) => {
  const r = runProgram({ kit: "robot", source, durationMs, checks, stimuli });
  expect(r.compileError, JSON.stringify(r.compileError)).toBeUndefined();
  expect(r.runtimeError, JSON.stringify(r.runtimeError)).toBeUndefined();
  expect(r.diagnostics).toEqual([]);
  for (const c of r.checks) expect(c.pass, `${c.label}: ${c.detail}`).toBe(true);
  return r;
};
const sig = (name: string, equals: number, tol: number, at?: number): Check => ({ kind: "signal", name, equals, tol, at, label: `${name} = ${equals}` });

// A 1 ms timer interrupt, as every course controller uses.
const timer = (isr: string, globals = "", setup = "") => `${globals}
__interrupt void cpu_timer0_isr(void);
void main(void)
{
    InitSysCtrl();
    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();
    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    EDIS;
    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, 1000);
    CpuTimer0Regs.TCR.all = 0x4000;
    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    ${setup}
    EINT;
    while (1) {}
}
__interrupt void cpu_timer0_isr(void)
{
${isr}
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}`;

describe("test bench robot (plant plugin)", () => {
  it("advances a wheel with the exact first-order solution, whatever the step", () => {
    const one = { v: 0 };
    const d1 = stepWheel(one, 5, 0.1);
    const many = { v: 0 };
    let dn = 0;
    for (let i = 0; i < 1000; i++) dn += stepWheel(many, 5, 0.0001);
    const vss = GAIN * (5 - COULOMB);
    expect(one.v).toBeCloseTo(vss * (1 - Math.exp(-0.1 / TAU)), 12);
    expect(many.v).toBeCloseTo(one.v, 10);
    expect(dn).toBeCloseTo(d1, 10);
    expect(d1).toBeCloseTo(vss * 0.1 - vss * TAU * (1 - Math.exp(-0.1 / TAU)), 12);
  });

  it("stops a coasting wheel at zero instead of letting friction push it backwards", () => {
    const w = { v: 1 };
    const d = stepWheel(w, 0, 1);
    expect(w.v).toBe(0);
    // v(t) = -0.2 + 1.2 exp(-t/TAU) reaches zero at TAU ln 6.
    const tc = TAU * Math.log(6);
    expect(d).toBeCloseTo(-0.2 * tc + 1.2 * TAU * (1 - Math.exp(-tc / TAU)), 12);
    // Inside the dead zone a wheel at rest stays at rest; just outside it moves.
    expect(stepWheel({ v: 0 }, 0.8, 1)).toBe(0);
    expect(stepWheel({ v: 0 }, -0.79, 1)).toBe(0);
    expect(stepWheel({ v: 0 }, 0.9, 1)).toBeGreaterThan(0);
    expect(stepWheel({ v: 0 }, -0.9, 1)).toBeLessThan(0);
  });

  it("holds the effort between calls: time constant 60 ms, 0.25 ft/s per unit, dead zone 0.8", () => {
    const vss = GAIN * (4 - COULOMB);
    run(`void main(void) { tb_set_effort(4.0, 4.0); while (1) {} }`, 600, [
      sig("TB_VLEFT", vss * (1 - Math.exp(-1)), 2e-4, 60),
      sig("TB_VRIGHT", vss * (1 - Math.exp(-2)), 2e-4, 120),
      sig("TB_VLEFT", vss, 1e-3),
      sig("TB_VLEFT_PEAK", vss, 1e-3),
      sig("TB_THETA_RAD", 0, 1e-12),
      sig("TB_Y_FT", 0, 1e-12),
      // Distance: vss (t - TAU (1 - exp(-t/TAU))).
      sig("TB_X_FT", vss * (0.6 - TAU * (1 - Math.exp(-10))), 1e-4),
    ]);
    run(`void main(void) { tb_set_effort(0.7, -0.7); while (1) {} }`, 300, [sig("TB_VLEFT", 0, 0), sig("TB_VRIGHT", 0, 0)]);
    run(`void main(void) { tb_set_effort(-4.0, 50.0); while (1) {} }`, 600, [
      sig("TB_VLEFT", -vss, 1e-3),
      sig("TB_VRIGHT", GAIN * (10 - COULOMB), 1e-3),
      sig("TB_URIGHT", 10, 0),
    ]);
  });

  it("gives the same speed whether it is read every 1 ms or once", () => {
    const polled = run(timer(`    v = tb_left_speed();`, `float v = 0;`, `tb_set_effort(6.0, 6.0);`), 100.5);
    const once = run(`float v = 0;\nvoid main(void) { tb_set_effort(6.0, 6.0); DELAY_US(100000); v = tb_left_speed(); while (1) {} }`, 101);
    const expected = GAIN * (6 - COULOMB) * (1 - Math.exp(-0.1 / TAU));
    expect(polled.board.readVar("v")).toBeCloseTo(expected, 3);
    expect(once.board.readVar("v")).toBeCloseTo(expected, 3);
  });

  it("subtracts a load from the effort", () => {
    run(`void main(void) { tb_set_effort(5.0, 5.0); while (1) {} }`, 1000, [
      sig("TB_VLEFT", GAIN * (5 - COULOMB), 1e-3, 499),
      sig("TB_VLEFT", GAIN * (5 - 2 - COULOMB), 1e-3),
      sig("TB_VRIGHT", GAIN * (5 - COULOMB), 1e-3),
    ], [{ at: 500, set: "TB_LOAD_LEFT", value: 2 }]);
  });

  it("integrates the pose of a differential drive", () => {
    // Left 0.5 ft/s, right 1.0 ft/s: omega = 0.5 / b, radius = V / omega.
    const r = run(`void main(void) { tb_set_effort(2.8, 4.8); while (1) {} }`, 3000);
    const b = r.board;
    const theta = b.output("TB_THETA_RAD")!;
    const vL = 0.5;
    const vR = 1.0;
    // Heading = (dR - dL) / b exactly; each distance lags its ramp by v TAU.
    expect(theta).toBeCloseTo(((vR - vL) * (3 - TAU)) / WHEEL_BASE, 4);
    // Once both wheels are at speed the robot is on a circle of radius V / omega.
    const radius = ((vL + vR) / 2 / (vR - vL)) * WHEEL_BASE;
    const at = (name: string, ms: number) => b.output(name, ms * 1e6)!;
    const centre = (ms: number) => [at("TB_X_FT", ms) - radius * Math.sin(at("TB_THETA_RAD", ms)), at("TB_Y_FT", ms) + radius * Math.cos(at("TB_THETA_RAD", ms))];
    const [cx1, cy1] = centre(1000);
    const [cx2, cy2] = centre(2900);
    expect(cx2).toBeCloseTo(cx1, 4);
    expect(cy2).toBeCloseTo(cy1, 4);
    // Spinning in place does not move the robot.
    run(`void main(void) { tb_set_effort(-3.0, 3.0); while (1) {} }`, 1000, [sig("TB_X_FT", 0, 1e-9), sig("TB_Y_FT", 0, 1e-9)]);
  });

  it("wraps the heading to (-pi, pi] and can be placed by stimuli", () => {
    const r = run(`void main(void) { tb_set_effort(-6.0, 6.0); while (1) {} }`, 2000, [], [
      { at: 0, set: "TB_SET_X_FT", value: 3 },
      { at: 0, set: "TB_SET_THETA_RAD", value: 1 },
    ]);
    const unwrapped = 1 + ((2 * GAIN * (6 - COULOMB)) / WHEEL_BASE) * (2 - TAU);
    expect(unwrapped).toBeGreaterThan(Math.PI);
    expect(r.board.output("TB_THETA_RAD")!).toBeCloseTo(unwrapped - 2 * Math.PI, 3);
    expect(r.board.output("TB_X_FT")!).toBeCloseTo(3, 9);
  });

  it("gyro = true rate + bias + repeatable noise", () => {
    const src = timer(
      `    g = tb_gyro_z();\n    sum += g;\n    n++;`,
      `float g = 0; float sum = 0; long n = 0;`,
      `tb_set_effort(-3.0, 3.0);`,
    );
    const stim: Stimulus[] = [{ at: 0, set: "TB_GYRO_BIAS", value: 0.05 }];
    const omega = (2 * GAIN * (3 - COULOMB)) / WHEEL_BASE;
    const clean = run(src, 500.5, [], stim);
    expect(clean.board.readVar("g")).toBeCloseTo(omega + 0.05, 3);
    const noisy = [0, 1].map(() => run(src, 500.5, [], [...stim, { at: 0, set: "TB_GYRO_NOISE", value: 0.02 }]));
    const g = noisy.map((r) => r.board.readVar("g")!);
    expect(g[0]).toBe(g[1]); // deterministic
    expect(g[0]).not.toBeCloseTo(omega + 0.05, 4);
    expect(Math.abs(g[0] - omega - 0.05)).toBeLessThan(0.1);
    // The noise has zero mean: both runs integrate to nearly the same angle.
    expect(noisy[0].board.readVar("sum")! / 500).toBeCloseTo(clean.board.readVar("sum")! / 500, 2);
  });

  it("position fixes arrive at 100 Hz with the requested noise", () => {
    const src = timer(
      `    if (tb_gps_new()) {\n        fixes++;\n        gx = tb_gps_x();\n        gy = tb_gps_y();\n    }`,
      `long fixes = 0; float gx = 0; float gy = 0;`,
      `tb_set_effort(4.8, 4.8);`,
    );
    const exact = run(src, 1000.5);
    // Fixes at 0, 10, ..., 1000 ms.
    expect(exact.board.readVar("fixes")).toBe(101);
    expect(exact.board.readVar("gx")).toBeCloseTo(exact.board.output("TB_X_FT", 1000e6)!, 5);
    expect(exact.board.output("TB_GPS_RMS_FT")).toBe(0);
    const noisy = run(src, 1000.5, [], [{ at: 0, set: "TB_GPS_NOISE", value: 0.2 }]);
    // RMS of the 2-D error is noise * sqrt(2).
    const rms = noisy.board.output("TB_GPS_RMS_FT")!;
    expect(rms).toBeGreaterThan(0.2);
    expect(rms).toBeLessThan(0.36);
    expect(noisy.board.readVar("gy")).not.toBe(0);
  });

  it("encoder reading noise is rough but does not add up", () => {
    const src = timer(`    v = tb_left_speed();\n    dist += v * 0.001;`, `float v = 0; float dist = 0;`, `tb_set_effort(4.8, 4.8);`);
    const r = run(src, 2000.5, [], [{ at: 0, set: "TB_ENC_NOISE", value: 0.1 }]);
    expect(Math.abs(r.board.readVar("v")! - 1)).toBeGreaterThan(1e-4);
    expect(r.board.readVar("dist")!).toBeCloseTo(r.board.output("TB_X_FT", 2000e6)!, 2);
  });

  it("reports how far a pose estimate is from the truth", () => {
    run(`void main(void) { tb_report_pose(3.0, 4.0, 7.0); while (1) {} }`, 2, [
      sig("TB_EST_ERR_FT", 5, 1e-6),
      sig("TB_EST_ERR_RAD", 7 - 2 * Math.PI, 1e-6),
      sig("TB_EST_RMS_FT", 5, 1e-6),
    ]);
  });

  it("costs nothing in programs that do not use it", () => {
    const r = runProgram({ kit: "robot", source: `void main(void) { while (1) {} }`, durationMs: 50 });
    expect(r.board.outputs.get("TB_X_FT")!.length).toBe(1);
    expect(r.board.steps).toBeLessThan(20);
  });
});
