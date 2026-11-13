import { describe, expect, it } from "vitest";
import { ch21 } from "../src/levels/chapters/ch21_capstone";
import { runProgram } from "../src/sim/runner";
import type { CodeLevel } from "../src/levels/types";

// The capstone is one program that grows: each code level continues an
// earlier one. These tests guard the chain. tests/levels.test.ts checks the
// rest (solutions pass, starters compile and fail).

const code = ch21.levels.filter((l): l is CodeLevel => l.kind === "code");
const byId = new Map(code.map((l) => [l.id, l]));
const withoutTodos = (src: string) =>
  src
    .split("\n")
    .filter((line) => !line.trim().startsWith("// TODO"))
    .join("\n");

describe("capstone chain", () => {
  it("has one root and every other code level continues an earlier one", () => {
    expect(code.filter((l) => !l.continues).map((l) => l.id)).toEqual(["cap-open"]);
    for (const l of code.slice(1)) {
      const prev = byId.get(l.continues!);
      expect(prev, `${l.id} continues ${l.continues}`).toBeDefined();
      expect(code.indexOf(prev!)).toBeLessThan(code.indexOf(l));
    }
  });

  for (const l of code.filter((x) => x.continues)) {
    const prev = byId.get(l.continues!)!;
    describe(`${l.id} continues ${prev.id}`, () => {
      it("starts from the earlier level's reference solution plus TODO comments", () => {
        expect(l.starter).not.toBe(prev.solution);
        expect(withoutTodos(l.starter)).toBe(prev.solution);
      });
      it("is not already passed by the earlier level's solution", () => {
        const r = runProgram({ kit: l.kit, source: prev.solution, durationMs: l.durationMs, stimuli: l.stimuli, checks: l.checks });
        expect(r.compileError).toBeUndefined();
        expect(r.runtimeError).toBeUndefined();
        expect(r.passed).toBe(false);
      });
    });
  }

  it("runs every code level with unequal motors", () => {
    for (const l of code) expect(l.stimuli, l.id).toContainEqual({ at: 0, set: "MOTOR_RIGHT_GAIN", value: 0.88 });
  });

  it("gives the straight-line star of cap-steer only to a program with the steering coupling", () => {
    const l = byId.get("cap-steer")!;
    // Two separate PI loops: no Kturn * eSteer term in the wheel errors.
    const uncoupled = l.solution
      .replace("eLeft = vref - vLeft + Kturn * eSteer;", "eLeft = vref + 0.5 * turn - vLeft;")
      .replace("eRight = vref - vRight - Kturn * eSteer;", "eRight = vref - 0.5 * turn - vRight;");
    expect(uncoupled).not.toBe(l.solution);
    const r = runProgram({ kit: l.kit, source: uncoupled, durationMs: l.durationMs, stimuli: l.stimuli, checks: l.checks, bonus: l.bonus });
    expect(r.passed).toBe(true);
    const star = r.bonus.find((b) => b.label.includes("steering coupling"))!;
    expect(star.pass).toBe(false);
  });

  it("fails cap-speed when the right wheel's P term uses the left wheel's error", () => {
    const l = byId.get("cap-speed")!;
    const wrong = l.solution.replace("uRight = Kp * eRight + Ki * INew;", "uRight = Kp * eLeft + Ki * INew;");
    expect(wrong).not.toBe(l.solution);
    const r = runProgram({ kit: l.kit, source: wrong, durationMs: l.durationMs, stimuli: l.stimuli, checks: l.checks });
    expect(r.runtimeError).toBeUndefined();
    expect(r.passed).toBe(false);
    // Caught by the disturbance on the right motor, not by the steady state.
    expect(r.checks.filter((c) => !c.pass).map((c) => c.label).join(" ")).toMatch(/right motor gets weaker/);
  });

  // The 1 ms interrupt keeps only what must run every millisecond: from
  // cap-lean on, cos, sin, atan2 and sqrt run in the main loop behind navFlag.
  const inInterrupt = (src: string) => {
    const out = src
      .replace("    navFlag = 1;", "    navigate();")
      .replace("        if (navFlag == 1) {\n            navFlag = 0;\n            navigate();\n        }\n", "");
    expect(out.match(/navigate\(\);/g)!.length).toBe(2);
    return out;
  };
  const timing = (l: CodeLevel, source: string) => {
    const r = runProgram({ kit: l.kit, source, durationMs: l.durationMs, stimuli: l.stimuli, checks: l.checks, bonus: l.bonus });
    const all = [...r.checks, ...r.bonus].filter((c) => c.label.includes("cpu_timer0_isr takes"));
    expect(all.length).toBe(1);
    return { r, budget: all[0] };
  };

  it("fails cap-lean while slow maths is left in the 1 ms interrupt", () => {
    const l = byId.get("cap-lean")!;
    expect(timing(l, l.solution).budget.value).toBeLessThan(3);
    // navigate() called from the interrupt: the same maths, the same time.
    const called = timing(l, inInterrupt(l.solution));
    expect(called.r.passed).toBe(false);
    expect(called.budget.value).toBeGreaterThan(5);
    // Only x and y moved: sqrt and atan2 still run in the mission.
    const geometry = l.solution.slice(l.solution.indexOf("    // Where is the goal from here"), l.solution.indexOf("    while (eTheta < -PI)"));
    const half = l.solution.replace(geometry, "").replace("    switch (state) {", `${geometry}    switch (state) {`);
    expect(half).not.toBe(l.solution);
    const r = timing(l, half);
    expect(r.r.compileError).toBeUndefined();
    expect(r.budget.pass).toBe(false);
    // Forgetting the first navigate() before EINT lets FACE act on eTheta = 0.
    const noFirst = l.solution.replace("    navigate();\n    EINT;", "    EINT;");
    expect(noFirst).not.toBe(l.solution);
    expect(timing(l, noFirst).r.passed).toBe(false);
  });

  it("gives the timing star of cap-wall only to a short 1 ms interrupt", () => {
    const l = byId.get("cap-wall")!;
    expect(timing(l, l.solution).budget.pass).toBe(true);
    const maths = timing(l, inInterrupt(l.solution));
    expect(maths.r.passed).toBe(true);
    expect(maths.budget.pass).toBe(false);
    const lidar = timing(l, l.solution.replace("    // ---- Decide: the mission ----", "    front_ft = min_ft(94, 132);\n    // ---- Decide: the mission ----"));
    expect(lidar.r.passed).toBe(true);
    expect(lidar.budget.pass).toBe(false);
  });

  it("keeps every level with a LIDAR on the timing budget", () => {
    for (const id of ["cap-wall", "cap-final", "cap-x-fast", "cap-x-serial", "cap-x-square"]) {
      const l = byId.get(id)!;
      expect((l.bonus ?? []).some((c) => c.kind === "isr-time" && c.fn === "cpu_timer0_isr" && c.maxUs <= 3.5), id).toBe(true);
    }
  });

  it("keeps every solution line within 100 characters", () => {
    for (const l of code) for (const line of l.solution.split("\n")) expect(line.length, `${l.id}: ${line}`).toBeLessThanOrEqual(100);
  });
});
