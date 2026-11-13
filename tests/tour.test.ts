import { describe, expect, it } from "vitest";
import { LiveSession } from "../src/sim/live";
import { TOUR_HOLD_MS, TOUR_MOVE_MS, between, replayAt, tourAt, waypoints } from "../src/sim/tour";
import { CHAPTERS, findLevel } from "../src/levels";
import type { CodeLevel } from "../src/levels/types";

const sets = [
  { at: 0, set: "LIDAR_ROOM", value: 1 },
  { at: 0, set: "LIDAR_X_FT", value: 2 },
  { at: 0, set: "LIDAR_THETA_RAD", value: 3 },
  { at: 150, set: "LIDAR_X_FT", value: 10 },
  { at: 250, set: "LIDAR_THETA_RAD", value: -3 },
];

describe("the path a test moves the robot along", () => {
  it("is empty when the test never moves the robot", () => {
    expect(waypoints(sets.slice(0, 3))).toEqual([]);
    expect(waypoints([{ at: 5, set: "ADC_A0", value: 1 }])).toEqual([]);
  });
  it("keeps every input at each pose", () => {
    const w = waypoints(sets);
    expect(w.map((x) => x.at)).toEqual([0, 150, 250]);
    expect(w[2].values.get("LIDAR_X_FT")).toBe(10);
    expect(w[2].values.get("LIDAR_ROOM")).toBe(1);
  });
  it("replays the jumps exactly, with a move just before each", () => {
    const w = waypoints(sets);
    expect(replayAt(w, 100, 40).get("LIDAR_X_FT")).toBe(2);
    expect(replayAt(w, 150, 40).get("LIDAR_X_FT")).toBe(10);
    expect(replayAt(w, 9999, 40).get("LIDAR_THETA_RAD")).toBe(-3);
    const mid = replayAt(w, 130, 40).get("LIDAR_X_FT")!;
    expect(mid).toBeGreaterThan(2);
    expect(mid).toBeLessThan(10);
  });
  it("tours round the poses for ever", () => {
    const w = waypoints(sets);
    const leg = TOUR_HOLD_MS + TOUR_MOVE_MS;
    expect(tourAt(w, 0).get("LIDAR_X_FT")).toBe(2);
    expect(tourAt(w, leg).get("LIDAR_X_FT")).toBe(10);
    expect(tourAt(w, 3 * leg).get("LIDAR_X_FT")).toBe(2);
  });
  it("never moves the robot in a way its wheels cannot, in any level", () => {
    let legs = 0;
    for (const c of CHAPTERS) {
      for (const l of c.levels) {
        if (l.kind !== "code") continue;
        const w = waypoints((l.stimuli ?? []).filter((s): s is { at: number; set: string; value: number } => "set" in s));
        for (let i = 0; i < w.length; i++) {
          const a = w[i];
          const b = w[(i + 1) % w.length];
          let prev = a.values;
          let moved = false;
          for (let k = 1; k <= 2000; k++) {
            const now = between(a, b, k / 2000);
            const dx = now.get("LIDAR_X_FT")! - prev.get("LIDAR_X_FT")!;
            const dy = now.get("LIDAR_Y_FT")! - prev.get("LIDAR_Y_FT")!;
            const step = Math.hypot(dx, dy);
            // A jump (the robot is picked up) happens only at the very end.
            if (k < 2000 && step > 1e-6) {
              moved = true;
              const th = prev.get("LIDAR_THETA_RAD") ?? 0;
              // No sideways motion: the step is along the heading, forwards or backwards...
              expect(Math.abs(-dx * Math.sin(th) + dy * Math.cos(th)), `${l.id} leg ${i} sideways`).toBeLessThan(1e-6 + 1e-3 * step);
              // ...and the heading does not change while the robot is properly under way
              // (a sample may hold the last of a turn and the first, slow instant of the drive).
              const far = Math.hypot(b.values.get("LIDAR_X_FT")! - a.values.get("LIDAR_X_FT")!, b.values.get("LIDAR_Y_FT")! - a.values.get("LIDAR_Y_FT")!);
              if (step > (0.2 * far) / 2000) expect(Math.abs((now.get("LIDAR_THETA_RAD") ?? 0) - th), `${l.id} leg ${i} turns while driving`).toBeLessThan(2e-4);
            }
            prev = now;
          }
          if (moved) legs++;
        }
      }
    }
    expect(legs).toBeGreaterThan(4);
  });
  it("moves the robot of a live run, until it is placed by hand", () => {
    const level = findLevel("sens-corridor")!.level as CodeLevel;
    const script = (level.stimuli ?? []).filter((s): s is { at: number; set: string; value: number } => "set" in s);
    const live = new LiveSession(level.kit, level.solution, script.filter((s) => s.at === 0), script);
    expect(live.hasTour).toBe(true);
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      live.step(16, 1000);
      seen.add(live.board.inputs.get("LIDAR_X_FT")!);
    }
    expect(live.error).toBeNull();
    expect(seen.size).toBeGreaterThan(20);
    expect(live.board.readVar("numScans")).toBeGreaterThan(50);
    live.placeRobot(5, 1.5, 0, "scan");
    live.step(500, 5000);
    expect(live.board.inputs.get("LIDAR_X_FT")).toBe(5);
  });
});

describe("a live run of a level whose test changes the world", () => {
  const level = findLevel("cap-x-maze")!.level as CodeLevel;
  const script = (level.stimuli ?? []).filter((s): s is { at: number; set: string; value: number } => "set" in s);
  const swap = script.find((s) => s.at > 1 && s.set === "WORLD_SEED")!;
  const run = (hands: boolean) => {
    const live = new LiveSession(level.kit, "void main(void) { while (1) {} }", script.filter((s) => s.at <= 0.02), script);
    if (hands) live.setInput("WORLD_SEED", 77);
    expect(live.worldChangeMs).toBe(hands ? undefined : swap.at);
    live.speed = 100;
    for (let i = 0; i < 400 && live.timeMs <= swap.at + 50; i++) live.step(16, 1000);
    expect(live.timeMs).toBeGreaterThan(swap.at);
    return live.board.inputs.get("WORLD_SEED");
  };
  it("changes it at the same moment as the test", () => expect(run(false)).toBe(swap.value));
  it("leaves it alone once the student has changed the world", () => expect(run(true)).toBe(77));
});

describe("the student's world carries over to the next run", () => {
  const level = findLevel("cap-x-maze")!.level as CodeLevel;
  const script = (level.stimuli ?? []).filter((s): s is { at: number; set: string; value: number } => "set" in s);
  const setup = script.filter((s) => s.at <= 0.02);
  const idle = "void main(void) { while (1) {} }";
  it("keeps the terrain, the goal, placed objects and where the robot was put down", () => {
    const a = new LiveSession(level.kit, idle, setup, script);
    a.step(50, 1000);
    a.setInput("WORLD_SEED", 77);
    a.setInput("ROBOT_GOAL_X_FT", 3);
    a.setObjects([{ kind: "post", x: 2, y: 2, r: 0.2 }]);
    a.placeRobot(1, 1.5, 0.5, "world");
    const b = new LiveSession(level.kit, idle, setup, script, a.worldState);
    b.step(50, 1000);
    expect(b.board.inputs.get("WORLD_SEED")).toBe(77);
    expect(b.board.inputs.get("ROBOT_GOAL_X_FT")).toBe(3);
    expect(b.board.outputs.get("ROBOT_X_FT")!.at(-1)!.v).toBeCloseTo(1);
    expect(b.board.outputs.get("ROBOT_Y_FT")!.at(-1)!.v).toBeCloseTo(1.5);
    expect(b.worldState.objects).toHaveLength(1);
    expect(b.worldChangeMs).toBeUndefined();
    // "Reset world" forgets all of it.
    b.resetWorld("world");
    expect(b.worldState).toEqual({ inputs: [], objects: [] });
    const c = new LiveSession(level.kit, idle, setup, script, b.worldState);
    c.step(50, 1000);
    expect(c.board.inputs.get("WORLD_SEED")).toBe(setup.find((s) => s.set === "WORLD_SEED")!.value);
    expect(c.worldChangeMs).toBeDefined();
  });
});
