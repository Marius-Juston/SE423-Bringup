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
    for (const id of ["cap-wall", "cap-final", "cap-x-fast", "cap-x-serial", "cap-x-square", "cap-p-slalom", "cap-x-trap", "cap-x-maze"]) {
      const l = byId.get(id)!;
      expect((l.bonus ?? []).some((c) => c.kind === "isr-time" && c.fn === "cpu_timer0_isr" && c.maxUs <= 3.5), id).toBe(true);
    }
  });

  // ---- the terrain levels: two trips through two worlds ----

  /** Replaces exact pieces of a program; every piece must be there. */
  const edit = (source: string, pieces: [string, string][]) => {
    let out = source;
    for (const [from, to] of pieces) {
      expect(out, `piece "${from.slice(0, 40)}"`).toContain(from);
      out = out.split(from).join(to);
    }
    return out;
  };
  /** Runs a wrong program on a level: it compiles, runs, and fails. Returns the failed checks. */
  const wrong = (l: CodeLevel, source: string) => {
    const r = runProgram({ kit: l.kit, source, durationMs: l.durationMs, stimuli: l.stimuli, checks: l.checks });
    expect(r.compileError, JSON.stringify(r.compileError)).toBeUndefined();
    expect(r.runtimeError, JSON.stringify(r.runtimeError)).toBeUndefined();
    expect(r.passed).toBe(false);
    const failed = r.checks.filter((c) => !c.pass);
    return { r, failed, labels: failed.map((c) => c.label).join(" | "), hints: failed.map((c) => c.hint ?? "").join(" | ") };
  };
  const seedsOf = (l: CodeLevel) => l.stimuli!.flatMap((s) => ("set" in s && s.set === "WORLD_SEED" ? [{ at: s.at, seed: s.value }] : []));

  it("runs each terrain level in two different worlds, the second one after the goal has moved back to the start", () => {
    for (const id of ["cap-p-slalom", "cap-x-trap", "cap-x-maze"]) {
      const l = byId.get(id)!;
      expect(l.continues).toBe("cap-final");
      expect(l.tier).toBe(id === "cap-p-slalom" ? "practice" : "expert");
      const seeds = seedsOf(l);
      expect(seeds, id).toHaveLength(2);
      expect(seeds[0].at).toBe(0);
      expect(seeds[1].at).toBeGreaterThan(10000);
      expect(seeds[1].seed).not.toBe(seeds[0].seed);
      // At the same moment the goal becomes the place the robot started from.
      const at = (name: string, t: number) => l.stimuli!.flatMap((s) => ("set" in s && s.set === name && s.at === t ? [s.value] : []))[0];
      expect(at("ROBOT_GOAL_X_FT", seeds[1].at)).toBe(at("ROBOT_START_X_FT", 0));
      expect(at("ROBOT_GOAL_Y_FT", seeds[1].at)).toBe(at("ROBOT_START_Y_FT", 0));
      // About 3 s of wall time at most: 0.1 s per simulated second.
      expect(l.durationMs).toBeLessThanOrEqual(28000);
    }
  });

  it("cap-p-slalom: the checkpoint's speed is too slow, a missing second trip and a short pass are named", () => {
    const l = byId.get("cap-p-slalom")!;
    // PASS at the checkpoint's 1.0 ft/s: still rolling when each trip's time is up.
    const slow = wrong(l, edit(l.solution, [["        vref = 1.5;\n        turn = 0.0;", "        vref = 1.0;\n        turn = 0.0;"]]));
    expect(slow.labels).toMatch(/stands still/);
    expect(slow.hints).toMatch(/vref = 1\.5/);
    expect(slow.r.board.output("ROBOT_CRASHED")).toBe(0);
    // DONE never starts the way back: trip 1 is fine, trip 2 is not.
    const once = wrong(l, edit(l.solution, [["if (trip == 0 && numTimer0calls >= 12500) {", "if (trip == 5) {"]]));
    expect(once.labels).toMatch(/^Trip 2: the robot ends/);
    expect(once.hints).toMatch(/DONE never starts the second trip/);
    // Facing the goal again before the post is behind: the robot touches it.
    const short = wrong(l, edit(l.solution, [["travel - passStart > 2.0", "travel - passStart > 0.8"]]));
    expect(short.labels).toMatch(/never touched anything/);
    expect(short.hints).toMatch(/PASS for 2 ft/);
  });

  it("cap-x-trap: the checkpoint program and Bug 0 stay in the U, and a wrong steering sign is named", () => {
    const l = byId.get("cap-x-trap")!;
    const fin = byId.get("cap-final")!;
    // The checkpoint program with the new start and goal: in, out and in again until the world changes.
    const naive = wrong(l, edit(fin.solution, [["float x = 1.0;", "float x = 1.5;"], ["float y = 2.0;", "float y = 5.0;"], ["float xGoal = 9.0;", "float xGoal = 8.5;"], ["float yGoal = 7.6;", "float yGoal = 5.0;"]]));
    expect(naive.labels).toMatch(/^Trip 1: at 13 s the robot is within/);
    expect(naive.r.board.output("ROBOT_GOAL_DIST_FT", 12990e6)).toBeGreaterThan(2);
    // Bug 0: leaves the wall as soon as the floor towards the goal looks free.
    const bug0 = wrong(l, edit(l.solution, [["dist < dHit - 0.5 && goal_ft > 2.0", "goal_ft > 2.0"]]));
    expect(bug0.labels).toMatch(/^Trip 1: at 13 s the robot is within/);
    expect(bug0.hints).toMatch(/as Bug 0 does.*dist < dHit - 0\.5/);
    // The follower steers away from the wall instead of towards it.
    const sign = wrong(l, edit(l.solution, [["turn = 2.0 * (right_ft - 1.1);", "turn = 2.0 * (1.1 - right_ft);"]]));
    expect(sign.labels).toMatch(/^Trip 1: at 13 s the robot is within/);
    expect(sign.hints).toMatch(/a wall too far away must give a positive turn/);
  });

  it("cap-x-maze: the left wall, an arc too wide for the corridor and a route learnt by heart all fail", () => {
    const l = byId.get("cap-x-maze")!;
    // Hand on the left wall: 18 cells instead of 6 in the first maze.
    const left = wrong(
      l,
      edit(l.solution, [
        ["right_ft = min_ft(52, 56);", "right_ft = min_ft(170, 174);"],
        ["turn = 2.0 * (right_ft - 1.1);", "turn = -2.0 * (right_ft - 1.1);"],
        ["        turn = -1.0;\n        if (front_ft > 2.0) {", "        turn = 1.0;\n        if (front_ft > 2.0) {"],
      ]),
    );
    expect(left.labels).toMatch(/^Trip 1: at 12 s the robot is within/);
    expect(left.hints).toMatch(/is the hand on the right wall/);
    expect(left.r.board.output("ROBOT_CRASHED")).toBe(0);
    // A turn limit of 0.4 at 1.2 ft/s: an arc of 1.8 ft in a 2 ft cell.
    const wide = wrong(l, edit(l.solution, [["if (turn > 0.7) turn = 0.7;", "if (turn > 0.4) turn = 0.4;"]]));
    expect(wide.labels).toMatch(/^Trip 1: at 12 s the robot is within/);
    expect(wide.hints).toMatch(/the arc is too wide for a 2 ft cell/);
    // The route of the first maze as waypoints (the square's program), and the same way back.
    const sq = byId.get("cap-x-square")!;
    const byHeart = wrong(
      l,
      edit(sq.solution, [
        ["float wpX[4] = {4.0, 4.0, 1.0, 1.0};", "float wpX[4] = {5.0, 5.0, 7.0, 7.0};"],
        ["float wpY[4] = {2.0, 5.0, 5.0, 2.0};", "float wpY[4] = {1.0, 7.0, 7.0, 7.0};\nuint16_t trip = 0;"],
        ["float y = 2.0;", "float y = 1.0;"],
        ["float xGoal = 4.0;", "float xGoal = 5.0;"],
        ["float yGoal = 2.0;", "float yGoal = 1.0;"],
        ["                state = 5;", "                state = 2;"],
        [
          "    default:\n        // DONE\n        vref = 0.0;\n        turn = 0.0;\n        break;",
          `    default:
        vref = 0.0;
        turn = 0.0;
        if (trip == 0 && numTimer0calls >= 12000) {
            trip = 1;
            wpX[0] = 5.0; wpY[0] = 7.0;
            wpX[1] = 5.0; wpY[1] = 1.0;
            wpX[2] = 1.0; wpY[2] = 1.0;
            wpX[3] = 1.0; wpY[3] = 1.0;
            corner = 0;
            xGoal = 5.0;
            yGoal = 7.0;
            state = 0;
        }
        break;`,
        ],
      ]),
    );
    // It gets through the maze it was written for, and not through the second one.
    expect(byHeart.labels).toMatch(/^Trip 2: the robot ends within/);
    expect(byHeart.hints).toMatch(/a route learnt in the first one does not fit/);
  });

  it("keeps every solution line within 100 characters", () => {
    for (const l of code) for (const line of l.solution.split("\n")) expect(line.length, `${l.id}: ${line}`).toBeLessThanOrEqual(100);
  });
});
