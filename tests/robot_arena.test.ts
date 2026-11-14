import { describe, expect, it } from "vitest";
import { ROOMS, castRay, scan, worldOf, setWorldObjects } from "../src/sim/plugins/lidar";
import { ROBOT_RADIUS_FT, type RobotWorld } from "../src/sim/plugins/robot_world";
import { Board } from "../src/sim/board";
import { LiveSession } from "../src/sim/live";
import { CHAPTERS } from "../src/levels/index";
import {
  advanceReplay,
  describe as describeScene,
  fitView,
  firstTimeOf,
  goalTolerance,
  gridStep,
  inputAt,
  isStateName,
  markRows,
  pushTrail,
  replayMarks,
  replayStep,
  sampleAt,
  sceneAt,
  sceneKind,
  sceneOfSetup,
  setStimuli,
  thinTrail,
  trailTimes,
  worldFor,
  worldSetup,
  type Pt,
  type SceneSource,
  type Trace,
} from "../src/ui/views/robot-arena-model";
import { runProgram } from "../src/sim/runner";
import {
  KIND_MAZE,
  MAZE_CELL_FT,
  TERRAINS,
  cellCentre,
  clearance,
  makeMaze,
  mazePath,
  mazeWallFollow,
  mazeWorld,
  mulberry32,
  narrowGap,
  objectTouches,
  slalom,
  terrain,
  tidyObject,
  twoRooms,
  uTrap,
  withObstacles,
} from "../src/sim/world/terrain";

// ---------- the rooms 0 to 4 are what they always were ----------

// The room tables and the ray caster exactly as they were before worlds got
// obstacles (lidar.ts at version 0.2.0), kept here as the reference.
type Seg = [number, number, number, number];
const oldBox = (x0: number, y0: number, x1: number, y1: number): Seg[] => [
  [x0, y0, x1, y0],
  [x1, y0, x1, y1],
  [x1, y1, x0, y1],
  [x0, y1, x0, y0],
];
const OLD_ROOMS: { walls: Seg[]; start: [number, number, number] }[] = [
  { walls: oldBox(0, 0, 10, 10), start: [5, 5, 0] },
  { walls: oldBox(-2, -1.5, 30, 1.5), start: [0, 0, 0] },
  { walls: [[-100, -2, 100, -2]], start: [0, 0, 0] },
  { walls: [...oldBox(0, 0, 10, 10), ...oldBox(7, 6, 8, 7)], start: [5, 5, 0] },
  {
    walls: [
      [0, 0, 10, 0],
      [10, 0, 10, 6],
      [10, 8.5, 10, 10],
      [10, 10, 0, 10],
      [0, 10, 0, 0],
    ],
    start: [5, 5, 0],
  },
];
function oldCastRay(room: { walls: Seg[] }, x: number, y: number, angle: number): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best = Infinity;
  for (const [x1, y1, x2, y2] of room.walls) {
    const ex = x2 - x1;
    const ey = y2 - y1;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((x1 - x) * ey - (y1 - y) * ex) / den;
    const u = ((x1 - x) * dy - (y1 - y) * dx) / den;
    if (t >= 0 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best;
}
/** The crash test as it was: eight rays from the centre. */
const oldCrash = (room: { walls: Seg[] }, x: number, y: number) => {
  for (let k = 0; k < 8; k++) if (oldCastRay(room, x, y, (k * Math.PI) / 4) < ROBOT_RADIUS_FT) return true;
  return false;
};

describe("rooms 0 to 4 after the world model was generalised", () => {
  it("have the same walls in the same order, and no posts", () => {
    expect(ROOMS).toHaveLength(5);
    ROOMS.forEach((r, i) => {
      expect(r.walls, `room ${i}`).toEqual(OLD_ROOMS[i].walls);
      expect(r.start).toEqual(OLD_ROOMS[i].start);
      expect(r.posts).toEqual([]);
    });
  });

  it("cast every ray to exactly the same distance (bit for bit) on a grid of poses and angles", () => {
    let n = 0;
    for (let r = 0; r < 5; r++) {
      const [x0, x1, y0, y1] = r === 1 ? [-1.9, 29.9, -1.4, 1.4] : r === 2 ? [-6, 12, -1.9, 6] : [0.1, 11.9, 0.1, 9.9];
      for (let ix = 0; ix <= 24; ix++)
        for (let iy = 0; iy <= 12; iy++) {
          const x = x0 + ((x1 - x0) * ix) / 24;
          const y = y0 + ((y1 - y0) * iy) / 12;
          for (let k = 0; k < 97; k++) {
            const a = -Math.PI + (2 * Math.PI * k) / 97 + 0.0123 * ix;
            // Object.is: the same bits, and Infinity where nothing is hit.
            if (!Object.is(castRay(ROOMS[r], x, y, a), oldCastRay(OLD_ROOMS[r], x, y, a))) throw new Error(`room ${r} at (${x}, ${y}) angle ${a}`);
            n++;
          }
        }
    }
    expect(n).toBe(5 * 25 * 13 * 97);
  });

  it("give the same scans, with and without the world passed along", () => {
    const b = new Board("robot");
    for (let r = 0; r < 5; r++) {
      b.setInput("LIDAR_ROOM", r);
      const w = worldOf(b);
      expect(w).toBe(ROOMS[r]);
      for (const [x, y, th] of [[5, 5, 0], [1.3, 2.2, 1], [8.8, 0.9, -2.5], [0.2, 0.3, 3]] as const) {
        const want = Array.from({ length: 228 }, (_, i) => {
          const d = oldCastRay(OLD_ROOMS[r], x, y, th + (((44 + 3 * i - 384) * 360) / 1024) * (Math.PI / 180));
          const mm = Math.round(d * 304.8);
          return !(mm <= 4095) ? 0 : mm < 20 ? 6 : mm;
        });
        expect(scan({ room: r, x, y, theta: th })).toEqual(want);
        expect(scan({ room: r, world: w, x, y, theta: th })).toEqual(want);
      }
    }
  });

  it("the exact crash test agrees with the old eight rays, except at corners the rays missed", () => {
    let same = 0;
    const onlyExact: string[] = [];
    for (let r = 0; r < 5; r++)
      for (let ix = 0; ix <= (r === 4 ? 120 : 99); ix++)
        for (let iy = 0; iy <= (r === 2 ? 60 : 99); iy++) {
          const x = 0.05 + ix * 0.1;
          const y = (r === 1 || r === 2 ? -1.95 : 0.05) + iy * (r === 1 ? 0.039 : 0.1);
          const exact = clearance(ROOMS[r], x, y) < ROBOT_RADIUS_FT;
          const old = oldCrash(OLD_ROOMS[r], x, y);
          if (exact === old) same++;
          else if (exact) onlyExact.push(`${r}:${x.toFixed(2)},${y.toFixed(2)}`);
          else throw new Error(`room ${r} at (${x}, ${y}): the old test saw a crash the exact one does not`);
        }
    // Never fewer crashes; the extra ones are all next to the block of room 3 or the door posts of room 4.
    expect(same).toBeGreaterThan(45000);
    expect(onlyExact.length).toBeGreaterThan(0);
    for (const p of onlyExact) expect(p).toMatch(/^[34]:/);
  });
});

// ---------- worlds with obstacles ----------

describe("worlds", () => {
  it("sees a round post from every side at its surface", () => {
    const w = withObstacles(ROOMS[0], [{ kind: "post", x: 5, y: 5, r: 0.5 }]);
    expect(castRay(w, 2, 5, 0)).toBeCloseTo(2.5, 9);
    expect(castRay(w, 5, 9, -Math.PI / 2)).toBeCloseTo(3.5, 9);
    // A ray that passes beside the post goes on to the wall.
    expect(castRay(w, 2, 5.6, 0)).toBeCloseTo(8, 9);
    expect(clearance(w, 5, 6)).toBeCloseTo(0.5, 9);
    expect(clearance(w, 5, 5)).toBeLessThan(0);
  });

  it("measures the free distance to walls and corners exactly", () => {
    // Beside the block of room 3, and diagonally off its corner.
    expect(clearance(ROOMS[3], 6.5, 6.5)).toBeCloseTo(0.5, 9);
    expect(clearance(ROOMS[3], 6.7, 5.6)).toBeCloseTo(0.5, 9);
    // The old test missed that corner: its eight rays pass on either side of it.
    expect(oldCrash(OLD_ROOMS[3], 6.9, 5.7)).toBe(false);
    expect(clearance(ROOMS[3], 6.9, 5.7)).toBeLessThan(ROBOT_RADIUS_FT);
  });

  it("builds every terrain of the menu with its start and goal in free space", () => {
    for (const t of TERRAINS) {
      const w = t.spec.kind === 0 ? ROOMS[t.spec.room!] : terrain(t.spec)!;
      expect(w, t.id).toBeDefined();
      expect(clearance(w, w.start[0], w.start[1]), `${t.id} start`).toBeGreaterThan(ROBOT_RADIUS_FT);
      if (w.goal) expect(clearance(w, w.goal[0], w.goal[1]), `${t.id} goal`).toBeGreaterThan(ROBOT_RADIUS_FT);
      expect(w.walls.length).toBeLessThan(80);
    }
  });

  it("blocks the straight line in the slalom, the U and the gap, differently in each layout", () => {
    const blocked = (w: ReturnType<typeof slalom>) => {
      const [gx, gy] = w.goal!;
      const d = Math.hypot(gx - w.start[0], gy - w.start[1]);
      return castRay(w, w.start[0], w.start[1], Math.atan2(gy - w.start[1], gx - w.start[0])) < d;
    };
    for (const w of [slalom(0), slalom(1), slalom(7), uTrap(0), uTrap(1), uTrap(2), uTrap(3), narrowGap(), twoRooms()]) expect(blocked(w), w.name).toBe(true);
    expect(slalom(0).posts).not.toEqual(slalom(1).posts);
    expect(slalom(1)).toEqual(slalom(1));
    // The robot that crossed U layout 0 stands at the start of layout 1, in free space.
    expect(uTrap(1).start.slice(0, 2)).toEqual(uTrap(0).goal);
    expect(uTrap(0).start.slice(0, 2)).toEqual(uTrap(1).goal);
    expect(uTrap(0).walls).not.toEqual(uTrap(1).walls);
  });

  it("keeps placed objects on the grid, in bounds of size, and off the robot", () => {
    expect(tidyObject({ kind: "box", x0: 1.1, y0: 2.07, x1: 1.15, y1: 3.4 })).toEqual({ kind: "box", x0: 1, y0: 2, x1: 1.25, y1: 3.5 });
    expect(tidyObject({ kind: "post", x: 3.13, y: 0.9, r: 5 })).toEqual({ kind: "post", x: 3.25, y: 1, r: 1 });
    expect(objectTouches({ kind: "box", x0: 1, y0: 1, x1: 2, y1: 2 }, 1.5, 1.5, 0.35)).toBe(true);
    expect(objectTouches({ kind: "box", x0: 1, y0: 1, x1: 2, y1: 2 }, 2.3, 1.5, 0.35)).toBe(true);
    expect(objectTouches({ kind: "box", x0: 1, y0: 1, x1: 2, y1: 2 }, 2.4, 1.5, 0.35)).toBe(false);
    expect(objectTouches({ kind: "post", x: 0, y: 0, r: 0.25 }, 0.5, 0, 0.35)).toBe(true);
    expect(objectTouches({ kind: "post", x: 0, y: 0, r: 0.25 }, 0.7, 0, 0.35)).toBe(false);
  });
});

describe("random mazes", () => {
  it("is the same maze for the same seed, and another for another", () => {
    expect(makeMaze(5, 1234)).toEqual(makeMaze(5, 1234));
    expect(makeMaze(5, 1234).east).not.toEqual(makeMaze(5, 1235).east);
    // The generator itself is fixed: these numbers are the same on every machine.
    const r = mulberry32(42);
    expect([r(), r(), r()].map((v) => Math.floor(v * 1e6))).toEqual([601103, 448290, 852465]);
    expect(mazeWorld(makeMaze(4, 7)).name).toBe("maze 4x4 seed 7");
  });

  it("is always solvable; a perfect maze has exactly one way and a wall follower finds it", () => {
    for (const n of [3, 4, 5, 6, 8])
      for (let seed = 0; seed < 40; seed++) {
        const m = makeMaze(n, seed);
        // A spanning tree: n * n - 1 openings.
        const openings = m.east.flat().filter((w) => !w).length + m.north.flat().filter((w) => !w).length;
        expect(openings).toBe(n * n - 1);
        const path = mazePath(m)!;
        expect(path, `${n} seed ${seed}`).not.toBeNull();
        expect(path[0]).toEqual([0, 0]);
        expect(path[path.length - 1]).toEqual([n - 1, n - 1]);
        for (const hand of ["right", "left"] as const) {
          const walk = mazeWallFollow(m, hand)!;
          expect(walk, `${hand} hand, ${n} seed ${seed}`).not.toBeNull();
          expect(walk.length).toBeGreaterThanOrEqual(path.length);
        }
        const loops = makeMaze(n, seed, true);
        expect(mazePath(loops)!.length).toBeLessThanOrEqual(path.length);
        expect(loops.east.flat().filter((w) => !w).length + loops.north.flat().filter((w) => !w).length).toBeGreaterThan(openings);
      }
  });

  it("has corridors the robot fits through, and walls where the cells say", () => {
    const m = makeMaze(6, 99);
    const w = mazeWorld(m);
    expect(w.bounds).toEqual([0, 0, 12, 12]);
    for (let j = 0; j < 6; j++)
      for (let i = 0; i < 6; i++) {
        const [x, y] = cellCentre(i, j);
        expect(clearance(w, x, y)).toBeCloseTo(MAZE_CELL_FT / 2, 9);
        // East: a wall 1 ft away exactly where the maze says there is one.
        const east = castRay(w, x, y, 0);
        if (i === 5 || m.east[j][i]) expect(east).toBeCloseTo(1, 9);
        else expect(east).toBeGreaterThan(2.9);
        const north = castRay(w, x, y, Math.PI / 2);
        if (j === 5 || m.north[j][i]) expect(north).toBeCloseTo(1, 9);
        else expect(north).toBeGreaterThan(2.9);
      }
    // Joined walls: far fewer segments than cell sides.
    expect(w.walls.length).toBeLessThan(4 + 25);
  });
});

describe("the world a board is in", () => {
  it("follows the WORLD inputs and the placed objects, and the LIDAR sees them at once", () => {
    const b = new Board("robot");
    b.setInput("LIDAR_ROOM", 0);
    b.setInput("LIDAR_X_FT", 5);
    b.setInput("LIDAR_Y_FT", 5);
    b.setInput("LIDAR_THETA_RAD", 0);
    expect(b.output("LIDAR_FRONT_FT")).toBeCloseTo(5, 1);
    setWorldObjects(b, [{ kind: "box", x0: 7, y0: 4, x1: 8, y1: 6 }]);
    expect(b.output("LIDAR_FRONT_FT")).toBeCloseTo(2, 1);
    setWorldObjects(b, []);
    expect(worldOf(b)).toBe(ROOMS[0]);
    expect(b.output("LIDAR_FRONT_FT")).toBeCloseTo(5, 1);
    b.setInput("WORLD_KIND", KIND_MAZE);
    b.setInput("WORLD_SIZE", 6);
    b.setInput("WORLD_SEED", 99);
    expect(worldOf(b).name).toBe("maze 6x6 seed 99");
    expect(worldOf(b)).toBe(worldOf(b));
    b.setInput("WORLD_KIND", 0);
    expect(worldOf(b)).toBe(ROOMS[0]);
  });

  it("leaves out a placed object with a coordinate that is not a number", () => {
    const b = new Board("robot");
    setWorldObjects(b, [{ kind: "post", x: NaN, y: 1, r: 0.25 }, { kind: "box", x0: 1, y0: 1, x1: Infinity, y1: 2 }, { kind: "post", x: 3, y: 3, r: 0.25 }]);
    expect(worldOf(b).posts).toEqual([{ x: 3, y: 3, r: 0.25 }]);
    expect(worldOf(b).walls).toEqual(ROOMS[0].walls);
  });

  const idle = "void main(void) { while (1) {} }";
  it("starts the robot at a terrain's own start and measures the distance to its goal", () => {
    const r = runProgram({ kit: "robot", durationMs: 20, source: idle, stimuli: [{ at: 0, set: "WORLD_KIND", value: KIND_MAZE }, { at: 0, set: "WORLD_SIZE", value: 4 }, { at: 0, set: "WORLD_SEED", value: 3 }, { at: 0.01, set: "ROBOT_WORLD", value: 1 }] });
    expect(r.board.output("ROBOT_X_FT")).toBe(1);
    expect(r.board.output("ROBOT_Y_FT")).toBe(1);
    expect(r.board.output("ROBOT_GOAL_DIST_FT")).toBeCloseTo(Math.hypot(6, 6), 3);
    expect(r.board.output("ROBOT_CRASHED")).toBe(0);
  });

  it("lets the playground put the robot down elsewhere, which also clears a crash", () => {
    const r = runProgram({ kit: "robot", durationMs: 20, source: idle, stimuli: [{ at: 0, set: "LIDAR_ROOM", value: 3 }, { at: 0, set: "ROBOT_START_X_FT", value: 0.2 }, { at: 0, set: "ROBOT_START_Y_FT", value: 5 }, { at: 0.01, set: "ROBOT_WORLD", value: 1 }] });
    const b = r.board;
    expect(b.output("ROBOT_CRASHED")).toBe(1);
    const world = b.plugins.get("robot-world") as RobotWorld;
    world.place(4, 6, 1);
    expect([b.output("ROBOT_X_FT"), b.output("ROBOT_Y_FT"), b.output("ROBOT_THETA_RAD"), b.output("ROBOT_CRASHED")]).toEqual([4, 6, 1, 0]);
    expect(b.inputs.get("LIDAR_X_FT")).toBe(4);
    world.reset();
    expect(b.output("ROBOT_X_FT")).toBe(0.2);
  });
});

// ---------- the arena's own logic: sampling a run, thinning a trail, replay ----------

const MS = 1e6;
/** A history with one entry per millisecond: v(t) for t = 0 .. n ms. */
const trace = (n: number, v: (ms: number) => number): Trace => Array.from({ length: n + 1 }, (_, i) => ({ t: i * MS, v: v(i) }));

describe("sampling output histories", () => {
  it("gives the last value at or before a time, and nothing before the first", () => {
    const tr: Trace = [{ t: 10, v: 1 }, { t: 20, v: 2 }, { t: 30, v: 3 }];
    expect(sampleAt(tr, 5)).toBeUndefined();
    expect(sampleAt(tr, 10)).toBe(1);
    expect(sampleAt(tr, 29)).toBe(2);
    expect(sampleAt(tr, 1e9)).toBe(3);
    expect(sampleAt(undefined, 5)).toBeUndefined();
    expect(sampleAt([], 5)).toBeUndefined();
  });

  it("finds the moment a value first appears in a span", () => {
    const tr: Trace = [{ t: 0, v: 0 }, { t: 50, v: 1 }, { t: 80, v: 0 }, { t: 90, v: 1 }];
    expect(firstTimeOf(tr, 1, 0, 100)).toBe(50);
    expect(firstTimeOf(tr, 1, 60, 100)).toBe(60); // already 1 at 60
    expect(firstTimeOf(tr, 1, 85, 100)).toBe(90);
    expect(firstTimeOf(tr, 1, 0, 40)).toBeUndefined();
  });

  it("samples a trail on a fixed grid, so points do not move as the run grows", () => {
    const a = trailTimes(0, 3000 * MS, 360);
    const b = trailTimes(0, 3100 * MS, 360);
    expect(a.length).toBeLessThanOrEqual(362);
    // Every time of the shorter run but its last is a time of the longer run.
    for (const t of a.slice(0, -1)) expect(b).toContain(t);
    // An hour of driving is still a few hundred points.
    expect(trailTimes(0, 3600_000 * MS, 360).length).toBeLessThanOrEqual(362);
    expect(trailTimes(500 * MS, 500 * MS)).toEqual([500 * MS]);
  });

  it("thins a trail: few points, the right ends, and a break where the robot was carried", () => {
    // 20 s along x at 1 ft/s, with a jump of 5 ft at 10 s.
    const xs = trace(20000, (ms) => ms / 1000 + (ms >= 10000 ? 5 : 0));
    const ys = trace(20000, () => 2);
    const lines = thinTrail(xs, ys, 0, 20000 * MS);
    expect(lines).toHaveLength(2);
    expect(lines.flat().length).toBeLessThanOrEqual(365);
    expect(lines[0][0]).toEqual({ x: 0, y: 2 });
    expect(lines[0][lines[0].length - 1].x).toBeLessThan(10.01);
    expect(lines[1][0].x).toBeGreaterThanOrEqual(15);
    expect(lines[1][lines[1].length - 1]).toEqual({ x: 25, y: 2 });
    // Up to a moment: the trail ends where the robot was then.
    const part = thinTrail(xs, ys, 0, 4000 * MS);
    expect(part).toHaveLength(1);
    expect(part[0][part[0].length - 1]).toEqual({ x: 4, y: 2 });
    // From a moment on (after the robot was put down by hand).
    expect(thinTrail(xs, ys, 12000 * MS, 20000 * MS)[0][0].x).toBeCloseTo(17, 6);
    // A robot standing still is one point, not hundreds.
    expect(thinTrail(trace(5000, () => 1), trace(5000, () => 1), 0, 5000 * MS).flat()).toHaveLength(1);
    expect(thinTrail(undefined, ys, 0, 10)).toEqual([]);
  });

  it("keeps a hand-kept trail short and ignores a runaway estimate", () => {
    const trail: Pt[] = [];
    for (let i = 0; i < 5000; i++) pushTrail(trail, { x: i * 0.05, y: 0 });
    expect(trail.length).toBeLessThanOrEqual(400);
    expect(trail[0]).toEqual({ x: 0, y: 0 });
    expect(trail[trail.length - 1].x).toBeCloseTo(4999 * 0.05, 6);
    const n = trail.length;
    pushTrail(trail, { x: NaN, y: 0 });
    pushTrail(trail, { x: 1e9, y: 0 });
    pushTrail(trail, trail[trail.length - 1]);
    expect(trail.length).toBe(n);
  });
});

describe("the level's world at a moment of its test", () => {
  const level = (id: string) => {
    const l = CHAPTERS.flatMap((c) => c.levels).find((x) => x.id === id);
    if (!l || l.kind !== "code") throw new Error(id);
    return l;
  };

  it("reads inputs from the stimuli as they stood at that time", () => {
    const sets = setStimuli([{ at: 0, set: "LIDAR_X_FT", value: 1 }, { at: 100, press: "PB1" }, { at: 200, set: "LIDAR_X_FT", value: 4 }, { at: 50, set: "LIDAR_ROOM", value: 3 }]);
    expect(sets.map((s) => s.at)).toEqual([0, 50, 200]);
    expect(inputAt(sets, "LIDAR_X_FT", 199)).toBe(1);
    expect(inputAt(sets, "LIDAR_X_FT", 200)).toBe(4);
    expect(inputAt(sets, "LIDAR_ROOM", 10)).toBeUndefined();
    expect(worldFor((n) => inputAt(sets, n, 60))).toBe(ROOMS[3]);
    expect(worldFor((n) => inputAt(sets, n, 10))).toBe(ROOMS[0]);
    expect(worldFor((n) => ({ WORLD_KIND: 5, WORLD_SIZE: 6, WORLD_SEED: 99 })[n]).name).toBe("maze 6x6 seed 99");
  });

  it("takes over a level's world for a live run: room, start, goal and the switch, nothing else", () => {
    const setup = worldSetup(level("cap-final").stimuli);
    expect(setup.map((s) => s.set)).toEqual(["MOTOR_RIGHT_GAIN", "LIDAR_ROOM", "ROBOT_START_X_FT", "ROBOT_START_Y_FT", "ROBOT_START_THETA_RAD", "ROBOT_GOAL_X_FT", "ROBOT_GOAL_Y_FT", "ROBOT_WORLD"]);
    expect(worldSetup([{ at: 0, set: "ADCINA4", value: 1 }, { at: 500, set: "LIDAR_ROOM", value: 2 }])).toEqual([]);
    const pre = sceneOfSetup(setStimuli(level("cap-final").stimuli));
    expect(pre.world).toBe(ROOMS[3]);
    expect(pre.pose).toEqual({ x: 1, y: 2, th: 0 });
    expect(pre.goal).toEqual({ x: 9, y: 7.6 });
  });

  it("replays the checkpoint: start, the pass around the block, and the goal at the end", () => {
    const l = level("cap-final");
    const r = runProgram({ kit: l.kit, source: l.solution, durationMs: l.durationMs, stimuli: l.stimuli, checks: l.checks });
    expect(r.passed).toBe(true);
    const sets = setStimuli(l.stimuli);
    expect(sceneKind(r.board.outputs, r.board.inputsUsed.has("LIDAR_ROOM"))).toBe("world");
    const at = (tMs: number) => {
      const input = (n: string) => inputAt(sets, n, tMs);
      const src: SceneSource = { outputs: r.board.outputs, input, world: worldFor(input), worldOn: true, lidar: true };
      return sceneAt(src, "world", tMs);
    };
    const start = at(0);
    expect(start.pose).toEqual({ x: 1, y: 2, th: 0 });
    expect(start.goalDist).toBeCloseTo(Math.hypot(8, 5.6), 3);
    expect(start.trail.flat().length).toBeLessThanOrEqual(1);
    const mid = at(6000);
    expect(mid.trail.flat().length).toBeGreaterThan(20);
    expect(mid.odometer!).toBeGreaterThan(3);
    expect(mid.odometer!).toBeLessThan(at(9000).odometer!);
    // The scan is recomputed for the pose of that moment: it is what the simulator's LIDAR reads there.
    expect(mid.lidar!.mm).toEqual(scan({ room: 3, x: mid.pose.x, y: mid.pose.y, theta: mid.pose.th }));
    const end = at(l.durationMs);
    expect(end.goalDist!).toBeLessThan(0.15);
    expect(end.crashed).toBe(false);
    expect(end.wheels).toEqual({ left: 0, right: 0 });
    expect(end.trail.flat().length).toBeLessThanOrEqual(365);
    expect(describeScene(end, { goalTol: 0.15 })).toMatch(/^Standing at the goal \(0\.0\d ft from its centre\)/);
    expect(describeScene(mid)).toMatch(/ft to go/);
    // The picture shows the whole room and the goal.
    const v = fitView(end);
    expect(v.x0).toBeLessThan(0);
    expect(v.x1).toBeGreaterThan(10);
    expect(goalTolerance(l.checks)).toBe(0.15);
  });

  it("shows a crash where it happened, and says so", () => {
    // The go-to-goal program believes it starts at (1, 2); put down at (8, 2) it drives into the wall at x = 10.
    const l = level("cap-goto");
    const stimuli = (l.stimuli ?? []).map((s) => ("set" in s && s.set === "ROBOT_START_X_FT" ? { ...s, value: 8 } : s));
    const r = runProgram({ kit: l.kit, source: l.solution, durationMs: 8000, stimuli });
    expect(r.board.output("ROBOT_CRASHED")).toBe(1);
    const sets = setStimuli(stimuli);
    const input = (n: string) => inputAt(sets, n, 8000);
    const s = sceneAt({ outputs: r.board.outputs, input, world: worldFor(input), worldOn: true, lidar: true }, "world", 8000);
    expect(s.crashed).toBe(true);
    expect(s.crashAt!.x).toBeCloseTo(10 - ROBOT_RADIUS_FT, 1);
    expect(describeScene(s)).toMatch(/touched a wall at \(9\.6\d, \d\.\d\d\) ft and stopped/);
    // Before the crash the same run is an ordinary drive.
    const before = sceneAt({ outputs: r.board.outputs, input, world: worldFor(input), worldOn: true, lidar: true }, "world", 1000);
    expect(before.crashed).toBe(false);
    expect(before.crashAt).toBeUndefined();
  });

  it("shows the test bench with the pose the program reports, and the distance between the two", () => {
    const l = level("loc-goto");
    const r = runProgram({ kit: l.kit, source: l.solution, durationMs: l.durationMs, stimuli: l.stimuli });
    expect(sceneKind(r.board.outputs, false)).toBe("bench");
    const s = sceneAt({ outputs: r.board.outputs, input: () => undefined, world: ROOMS[0], worldOn: false, lidar: false }, "bench", l.durationMs);
    expect(s.world).toBeUndefined();
    expect(s.est).toBeDefined();
    expect(s.estErr!).toBeCloseTo(r.board.output("TB_EST_ERR_FT")!, 6);
    expect(s.trail.flat().length).toBeGreaterThan(10);
    expect(describeScene(s)).toMatch(/the program's estimate is 0\.\d{3} ft from the true position/);
    const v = fitView(s);
    expect(v.x1 - v.x0).toBeGreaterThanOrEqual(3);
  });

  it("has nothing to show for a board without a robot or a LIDAR", () => {
    const r = runProgram({ kit: "robot", source: "void main(void) { while (1) {} }", durationMs: 5 });
    expect(sceneKind(r.board.outputs, r.board.inputsUsed.has("LIDAR_ROOM"))).toBeUndefined();
  });
});

describe("replay controls", () => {
  it("marks the instants the checks look at, with their results", () => {
    const checks = [
      { kind: "signal", name: "A", at: 5000, label: "first" },
      { kind: "signal", name: "B", label: "at the end" },
      { kind: "var", name: "x", at: 5000, label: "second" },
      { kind: "signal", name: "C", at: 13000, label: "third" },
      { kind: "signal", name: "D", at: 99000, label: "after the run" },
    ];
    expect(replayMarks(checks, undefined, 16000)).toEqual([{ tMs: 5000, label: "first; second", pass: undefined }, { tMs: 13000, label: "third", pass: undefined }]);
    // Marks close together go to separate rows, so each can be clicked.
    expect(markRows([{ tMs: 1000, label: "a" }, { tMs: 1100, label: "b" }, { tMs: 1150, label: "c" }, { tMs: 9000, label: "d" }], 10000)).toEqual([0, 1, 2, 0]);
    const done = replayMarks(checks, [{ pass: true }, { pass: true }, { pass: false }, { pass: true }, { pass: true }], 16000);
    expect(done.map((m) => m.pass)).toEqual([false, true]);
  });

  it("steps and plays to the end and stops there", () => {
    expect(replayStep(16000)).toBe(50);
    expect(replayStep(260)).toBe(1);
    expect(advanceReplay(1000, 16, 1, 16000)).toEqual({ tMs: 1016, done: false });
    expect(advanceReplay(1000, 16, 4, 16000)).toEqual({ tMs: 1064, done: false });
    expect(advanceReplay(15990, 16, 4, 16000)).toEqual({ tMs: 16000, done: true });
    expect(gridStep(10.8)).toBe(1);
    expect(gridStep(12.8, 8)).toBe(2);
    expect(["state", "right_wall_follow_state", "corner"].every(isStateName)).toBe(true);
    expect(isStateName("vref")).toBe(false);
  });
});

describe("the playground acts through the simulator", () => {
  const l = CHAPTERS.flatMap((c) => c.levels).find((x) => x.id === "cap-final")!;
  if (l.kind !== "code") throw new Error("cap-final");
  const session = () => {
    const s = new LiveSession(l.kit, l.solution, worldSetup(l.stimuli));
    s.step(50, 1e6);
    return s;
  };

  it("starts a live run in the level's world, and a placed robot is where the LIDAR and the meters say", () => {
    const s = session();
    const b = s.board;
    expect(b.output("ROBOT_X_FT")).toBeCloseTo(1, 1);
    expect(worldOf(b)).toBe(ROOMS[3]);
    s.placeRobot(4, 6, 1.5, "world");
    expect([b.output("ROBOT_X_FT"), b.output("ROBOT_Y_FT"), b.output("ROBOT_THETA_RAD")]).toEqual([4, 6, 1.5]);
    expect(b.inputs.get("LIDAR_X_FT")).toBe(4);
    expect(b.output("LIDAR_FRONT_FT")).toBeCloseTo(castRay(ROOMS[3], 4, 6, 1.5 + ((383 - 384) * 2 * Math.PI) / 1024) , 1);
    // The program is not told: its own estimate is still near the start.
    expect(b.readVar("x")!).toBeLessThan(1.5);
  });

  it("changes the world, takes placed objects, and Reset world undoes all of it", () => {
    const s = session();
    const b = s.board;
    s.setInput("WORLD_KIND", KIND_MAZE);
    s.setInput("WORLD_SIZE", 5);
    s.setInput("WORLD_SEED", 1234);
    expect(worldOf(b).name).toBe("maze 5x5 seed 1234");
    s.setObjects([{ kind: "box", x0: 3.1, y0: 0.2, x1: 3.9, y1: 1.8 }, ...Array.from({ length: 30 }, (_, i) => ({ kind: "post" as const, x: 9, y: 0.3 * i, r: 0.2 }))]);
    expect(worldOf(b).obstacles.filter((o) => o.kind !== "wall")).toHaveLength(20);
    s.setInput("ROBOT_GOAL_X_FT", 3);
    s.resetWorld("world");
    expect(worldOf(b)).toBe(ROOMS[3]);
    expect(b.inputs.get("ROBOT_GOAL_X_FT")).toBe(9);
    expect(b.output("ROBOT_X_FT")).toBe(1);
    expect(b.output("ROBOT_ODOMETER_FT")).toBe(0);
  });

  it("never reaches a test run: the same program gets the same result after a playground session", () => {
    const before = runProgram({ kit: l.kit, source: l.solution, durationMs: 3000, stimuli: l.stimuli });
    const s = session();
    s.setObjects([{ kind: "box", x0: 2, y0: 1, x1: 3, y1: 3 }]);
    s.setInput("WORLD_KIND", 3);
    const after = runProgram({ kit: l.kit, source: l.solution, durationMs: 3000, stimuli: l.stimuli });
    expect(after.board.outputs.get("ROBOT_X_FT")).toEqual(before.board.outputs.get("ROBOT_X_FT"));
    expect(worldOf(after.board)).toBe(ROOMS[3]);
  });
});

describe("drawing a wall longer than the picture", () => {
  it("cuts it along its own line and keeps its slope", async () => {
    const { clipSegment } = await import("../src/ui/views/robot-arena-model");
    const c = clipSegment([-100, -52, 100, 48], -6, -6, 18, 8)!;
    expect((c[3] - c[1]) / (c[2] - c[0])).toBeCloseTo(0.5, 9);
    expect(c[0]).toBeCloseTo(-6, 9);
    expect(c[1]).toBeCloseTo(-5, 9);
    expect(c[2]).toBeCloseTo(18, 9);
    // A wall that is wholly inside is unchanged; one that misses the picture is not drawn.
    expect(clipSegment([0, 0, 10, 0], -2, -2, 12, 12)).toEqual([0, 0, 10, 0]);
    expect(clipSegment([0, 20, 10, 20], -2, -2, 12, 12)).toBeNull();
    expect(clipSegment([5, -50, 5, 50], -2, -2, 12, 12)).toEqual([5, -2, 5, 12]);
  });
});
