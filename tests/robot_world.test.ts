import { describe, expect, it } from "vitest";
import { runProgram } from "../src/sim/runner";
import { setWorldObjects } from "../src/sim/plugins/lidar";
import type { RobotWorld } from "../src/sim/plugins/robot_world";

// Left motor on EPWM1A (GPIO0), right on EPWM2A (GPIO2); 50 % duty is stopped.
const drive = (cmpL: number, cmpR: number) => `
void pwm(volatile struct EPWM_REGS *r, Uint16 cmpa) {
  r->TBCTL.bit.CTRMODE = 0; r->TBCTL.bit.FREE_SOFT = 2; r->TBCTL.bit.CLKDIV = 0;
  r->TBPRD = 2500; r->CMPA.bit.CMPA = cmpa;
  r->AQCTLA.bit.CAU = 1; r->AQCTLA.bit.ZRO = 2;
}
void main(void) {
  InitSysCtrl(); InitGpio();
  GPIO_SetupPinMux(0, GPIO_MUX_CPU1, 1); GPIO_SetupPinMux(2, GPIO_MUX_CPU1, 1);
  pwm(&EPwm1Regs, ${cmpL}); pwm(&EPwm2Regs, ${cmpR});
  while (1) {}
}`;

const world = [
  { at: 0, set: "LIDAR_ROOM", value: 0 },
  { at: 0, set: "ROBOT_START_X_FT", value: 2 },
  { at: 0, set: "ROBOT_START_Y_FT", value: 5 },
  { at: 0, set: "ROBOT_START_THETA_RAD", value: 0 },
  { at: 0.01, set: "ROBOT_WORLD", value: 1 },
];

describe("robot world", () => {
  it("drives straight when both motors get the same forward command", () => {
    // The right motor is mirrored: its "forward" is a duty below 50 %.
    const r = runProgram({ kit: "robot", durationMs: 1000, source: drive(1750, 750), stimuli: world });
    expect(r.runtimeError).toBeUndefined();
    const x = r.board.output("ROBOT_X_FT")!;
    expect(x).toBeGreaterThan(2.5);
    expect(Math.abs(r.board.output("ROBOT_Y_FT")! - 5)).toBeLessThan(0.05);
    expect(Math.abs(r.board.output("ROBOT_THETA_RAD")!)).toBeLessThan(0.05);
    // The LIDAR sees the robot where the world put it.
    expect(r.board.inputs.get("LIDAR_X_FT")).toBeCloseTo(x, 2);
  });
  it("stays put at 50 % duty and turns when the wheels differ", () => {
    const still = runProgram({ kit: "robot", durationMs: 500, source: drive(1250, 1250), stimuli: world });
    expect(still.board.output("ROBOT_ODOMETER_FT")).toBe(0);
    const turn = runProgram({ kit: "robot", durationMs: 500, source: drive(1250, 750), stimuli: world });
    expect(turn.board.output("ROBOT_THETA_RAD")!).toBeGreaterThan(0.2);
  });
  it("is off unless a level switches it on", () => {
    const r = runProgram({ kit: "robot", durationMs: 200, source: drive(1750, 750) });
    expect(r.board.output("ROBOT_X_FT")).toBeUndefined();
  });
});

describe("robot world: where the robot starts and what it touches", () => {
  const idle = "void main(void) { while (1) {} }";
  it("takes a start pose given at the instant of switching on, whichever stimulus comes first", () => {
    const start = [
      { at: 0, set: "ROBOT_START_X_FT", value: 2 },
      { at: 0, set: "ROBOT_START_Y_FT", value: 3 },
      { at: 0, set: "ROBOT_START_THETA_RAD", value: 1 },
    ];
    const on = { at: 0, set: "ROBOT_WORLD", value: 1 };
    for (const stimuli of [[...start, on], [on, ...start]]) {
      const b = runProgram({ kit: "robot", durationMs: 20, source: idle, stimuli }).board;
      expect([b.output("ROBOT_X_FT"), b.output("ROBOT_Y_FT"), b.output("ROBOT_THETA_RAD")]).toEqual([2, 3, 1]);
    }
    // Later it is only the pose for the next start: the robot stays where it is.
    const later = runProgram({ kit: "robot", durationMs: 20, source: idle, stimuli: [...world, { at: 5, set: "ROBOT_START_X_FT", value: 8 }] });
    expect(later.board.output("ROBOT_X_FT")).toBe(2);
  });
  it("brings a start heading of several turns into -pi .. pi at once", () => {
    const r = runProgram({ kit: "robot", durationMs: 2, source: idle, stimuli: [{ at: 0, set: "ROBOT_START_THETA_RAD", value: 1 + 6 * Math.PI }, { at: 0.01, set: "ROBOT_WORLD", value: 1 }] });
    expect(r.board.outputs.get("ROBOT_THETA_RAD")!.map((e) => e.v)).toEqual([1]);
  });
  it("has crashed inside a box, also far from the box's sides", () => {
    const b = runProgram({ kit: "robot", durationMs: 5, source: idle, stimuli: world }).board;
    const rw = b.plugins.get("robot-world") as RobotWorld;
    // A 2 ft box: its middle is 1 ft from every side, more than the robot's radius.
    setWorldObjects(b, [{ kind: "box", x0: 6, y0: 6, x1: 8, y1: 8 }]);
    rw.place(7, 7, 0);
    const gen = b.run();
    b.runUntil(gen, b.now + 3e6);
    expect(b.output("ROBOT_CRASHED")).toBe(1);
    rw.place(4, 4, 0);
    b.runUntil(gen, b.now + 3e6);
    expect(b.output("ROBOT_CRASHED")).toBe(0);
  });
});
