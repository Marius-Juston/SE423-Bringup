import { describe, expect, it } from "vitest";
import { LiveSession } from "../src/sim/live";
import { worldOf } from "../src/sim/plugins/lidar";
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
  it("starts where the simulator has the robot when the test sets no pose at power-up", () => {
    // Room 0 puts the robot at (5, 5); the test only turns it, then moves it along x.
    const w = waypoints([{ at: 0, set: "LIDAR_THETA_RAD", value: 0 }, { at: 100, set: "LIDAR_THETA_RAD", value: 1 }, { at: 200, set: "LIDAR_X_FT", value: 7 }]);
    expect([w[0].values.get("LIDAR_X_FT"), w[0].values.get("LIDAR_Y_FT")]).toEqual([5, 5]);
    const turning = between(w[0], w[1], 0.5);
    expect([turning.get("LIDAR_X_FT"), turning.get("LIDAR_Y_FT")]).toEqual([5, 5]);
    const driving = between(w[1], w[2], 0.5);
    expect(driving.get("LIDAR_X_FT")).toBeGreaterThan(5);
    expect(driving.get("LIDAR_Y_FT")).toBe(5);
    // A test that sets nothing at 0 ms still has a first pose: the robot is not yet at the place of the first jump.
    const late = waypoints([{ at: 150, set: "LIDAR_X_FT", value: 8 }]);
    expect(late.map((x) => x.at)).toEqual([0, 150]);
    expect(replayAt(late, 50, 40).get("LIDAR_X_FT")).toBe(5);
    expect(replayAt(late, 150, 40).get("LIDAR_X_FT")).toBe(8);
  });
  it("comes round to the first pose in the first world, and never arms the sensor's one-shot fault", () => {
    const path = [
      { at: 0, set: "LIDAR_X_FT", value: 2 },
      { at: 0, set: "LIDAR_Y_FT", value: 2 },
      { at: 0, set: "LIDAR_THETA_RAD", value: 0 },
      { at: 100, set: "LIDAR_ROOM", value: 3 },
      { at: 100, set: "LIDAR_X_FT", value: 4 },
      { at: 120, set: "LIDAR_DROP_CHAR", value: 7 },
    ];
    const w = waypoints(path);
    expect(w.map((x) => x.at)).toEqual([0, 100]);
    expect(w.every((x) => !x.values.has("LIDAR_DROP_CHAR"))).toBe(true);
    const leg = TOUR_HOLD_MS + TOUR_MOVE_MS;
    expect(tourAt(w, leg).get("LIDAR_ROOM")).toBe(3);
    expect(tourAt(w, 2 * leg).get("LIDAR_ROOM")).toBe(0);
    const live = new LiveSession("robot", "void main(void) { while (1) {} }", path.filter((s) => s.at === 0), path);
    live.speed = 10;
    const rooms: (number | undefined)[] = [];
    for (let i = 0; i < 65; i++) {
      live.step(10, 1000);
      rooms.push(live.board.inputs.get("LIDAR_ROOM"));
    }
    // 6.5 s: the first pose, the second (room 3), and the first again.
    expect(rooms.at(-1)).toBe(0);
    expect(rooms).toContain(3);
    expect(live.board.inputs.get("LIDAR_DROP_CHAR") ?? 0).toBe(0);
  });
  it("turns the short way across +-pi", () => {
    const w = waypoints([{ at: 0, set: "LIDAR_X_FT", value: 5 }, { at: 0, set: "LIDAR_Y_FT", value: 5 }, { at: 0, set: "LIDAR_THETA_RAD", value: 3 }, { at: 100, set: "LIDAR_THETA_RAD", value: -3 }]);
    for (const u of [0.1, 0.5, 0.9]) {
      const th = between(w[0], w[1], u).get("LIDAR_THETA_RAD")!;
      expect(th).toBeGreaterThan(3);
      expect(th).toBeLessThan(2 * Math.PI - 3);
    }
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

describe("Reset world and the world handed to the next run", () => {
  const idle = "void main(void) { while (1) {} }";
  it("goes back to the level's own maze when the level leaves the seed and the size to the simulator", () => {
    const s = new LiveSession("robot", idle, [{ set: "WORLD_KIND", value: 5 }, { set: "ROBOT_WORLD", value: 1 }]);
    s.step(20, 1000);
    const own = worldOf(s.board);
    s.setInput("WORLD_SEED", 9);
    s.setInput("WORLD_SIZE", 6);
    expect(worldOf(s.board).name).toBe("maze 6x6 seed 9");
    s.resetWorld("world");
    expect(worldOf(s.board).name).toBe(own.name);
    expect(s.board.inputs.has("WORLD_SEED")).toBe(false);
    expect([s.board.output("ROBOT_X_FT"), s.board.output("ROBOT_Y_FT")]).toEqual([own.start[0], own.start[1]]);
  });
  it("does not carry over an object that lies where the next run's robot starts", () => {
    const setup = [{ set: "LIDAR_ROOM", value: 0 }, { set: "ROBOT_START_X_FT", value: 2 }, { set: "ROBOT_START_Y_FT", value: 5 }, { set: "ROBOT_WORLD", value: 1 }];
    // The robot had driven away when these were placed; the next run starts at (2, 5) again.
    const left = { inputs: [] as [string, number][], objects: [{ kind: "box" as const, x0: 1.5, y0: 4.5, x1: 2.5, y1: 5.5 }, { kind: "post" as const, x: 7, y: 7, r: 0.25 }] };
    const b = new LiveSession("robot", idle, setup, [], left);
    b.step(20, 1000);
    expect(b.board.output("ROBOT_CRASHED")).toBe(0);
    expect(b.worldState.objects).toEqual([left.objects[1]]);
    expect(worldOf(b.board).posts).toHaveLength(1);
    // A program that does not compile still stands in the student's world.
    const broken = new LiveSession("robot", "void main(void) { x = ; }", setup, [], left);
    expect(broken.error?.kind).toBe("compile");
    expect(worldOf(broken.board).posts).toHaveLength(1);
  });
  it("stops the test's later changes once the robot was put down by hand, in this run as in the next", () => {
    const level = findLevel("cap-x-maze")!.level as CodeLevel;
    const script = (level.stimuli ?? []).filter((s): s is { at: number; set: string; value: number } => "set" in s);
    const live = new LiveSession(level.kit, idle, script.filter((s) => s.at <= 0.02), script);
    expect(live.worldChangeMs).toBeDefined();
    live.step(20, 1000);
    live.placeRobot(1, 1, 0, "world");
    expect(live.worldChangeMs).toBeUndefined();
    expect(new LiveSession(level.kit, idle, script.filter((s) => s.at <= 0.02), script, live.worldState).worldChangeMs).toBeUndefined();
  });
});
