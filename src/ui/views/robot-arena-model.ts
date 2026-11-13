// Pure logic of the robot arena (robot-arena.tsx): what the world looks like
// at one moment of a run, from the simulator's output histories. No React
// and no Board, so tests/robot_arena.test.ts can exercise it directly.

import { FT_PER_MM, G_CLUSTER, G_START, LIDAR_POINTS, MAX_MM, MIN_MM, ROOMS, scan, stepAngle } from "../../sim/plugins/lidar";
import { terrain, type World, type WorldSpec } from "../../sim/world/terrain";

export type Trace = { t: number; v: number }[];
export interface Pt {
  x: number;
  y: number;
}
export interface PoseFt extends Pt {
  th: number;
}

const MS = 1e6;
/** Feet per wheel radian (the course's 1.235 inch wheel radius), as in robot_world.ts. */
const FT_PER_WHEEL_RAD = 1.235 / 12;
/** How far the sensor sees, ft. */
export const REACH_FT = MAX_MM * FT_PER_MM;
/** Points of the scan the course code names: straight ahead, exactly right (-90 degrees), exactly left. */
export const NAMED_POINTS = { front: 113, right: 28, left: 199 } as const;

// ---------- histories ----------

/** Value of a history at time t (ns): the last entry at or before t. Undefined before the first entry. */
export function sampleAt(tr: Trace | undefined, t: number): number | undefined {
  if (!tr || !tr.length || tr[0].t > t) return undefined;
  let lo = 0;
  let hi = tr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tr[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return tr[lo].v;
}

/** Time (ns) at which a history first holds `value` at or after `from`, up to `to`. */
export function firstTimeOf(tr: Trace | undefined, value: number, from: number, to: number): number | undefined {
  if (!tr) return undefined;
  // The value in force at `from` counts.
  if (sampleAt(tr, from) === value) return from;
  let lo = 0;
  let hi = tr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tr[mid].t <= from) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < tr.length && tr[i].t <= to; i++) if (tr[i].v === value) return tr[i].t;
  return undefined;
}

/**
 * The times (ns) at which a trail from `from` to `to` is sampled: a fixed
 * grid whose step doubles as the run gets longer, so there are never more
 * than about `max` points and a point, once drawn, stays where it is
 * (re-sampling at new times every frame would make the line shimmer).
 */
export function trailTimes(from: number, to: number, max = 360, baseNs = 10 * MS): number[] {
  if (!(to > from)) return [to];
  let step = baseNs;
  while ((to - from) / step > max) step *= 2;
  const out: number[] = [];
  for (let t = Math.ceil(from / step) * step; t < to; t += step) out.push(t);
  if (!out.length || out[0] > from) out.unshift(from);
  out.push(to);
  return out;
}

/**
 * The path between two times as polylines, thinned: points closer than
 * `minStep` to the last one are left out, and the line is broken where the
 * robot was picked up and put down elsewhere (a jump no robot could drive
 * in the time between two samples).
 */
export function thinTrail(xs: Trace | undefined, ys: Trace | undefined, from: number, to: number, o: { max?: number; minStep?: number; maxSpeed?: number } = {}): Pt[][] {
  const lines: Pt[][] = [];
  if (!xs || !ys || !xs.length || !ys.length) return lines;
  const minStep = o.minStep ?? 0.02;
  const maxSpeed = o.maxSpeed ?? 6;
  let line: Pt[] = [];
  let last: Pt | undefined;
  let lastT = from;
  let pending: Pt | undefined;
  for (const t of trailTimes(from, to, o.max ?? 360)) {
    const x = sampleAt(xs, t);
    const y = sampleAt(ys, t);
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const p = { x, y };
    if (last) {
      const d = Math.hypot(x - last.x, y - last.y);
      if (d > 0.25 + (maxSpeed * (t - lastT)) / 1e9) {
        // Carried: end this line where the robot was, start a new one where it is.
        if (pending) line.push(pending);
        if (line.length) lines.push(line);
        line = [p];
        last = p;
        lastT = t;
        pending = undefined;
        continue;
      }
      if (d < minStep) {
        // Too close to draw, but remember it: the line must end at the robot.
        pending = p;
        continue;
      }
    }
    line.push(p);
    last = p;
    lastT = t;
    pending = undefined;
  }
  if (pending && last && (pending.x !== last.x || pending.y !== last.y)) line.push(pending);
  if (line.length) lines.push(line);
  return lines;
}

/** Appends a point to a trail kept by hand (the program's own estimate during a live run), keeping it short. */
export function pushTrail(trail: Pt[], p: Pt, max = 400, minStep = 0.04): void {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1e4 || Math.abs(p.y) > 1e4) return;
  const last = trail[trail.length - 1];
  if (last && Math.hypot(p.x - last.x, p.y - last.y) < minStep) return;
  trail.push(p);
  if (trail.length > max) {
    // Drop every other point of the older half: old detail goes first.
    const half = trail.length >> 1;
    const thin = trail.filter((_, i) => i >= half || i % 2 === 0);
    trail.length = 0;
    trail.push(...thin);
  }
}

// ---------- the level's set-up, at a moment of its test ----------

export interface SetStimulus {
  at: number;
  set: string;
  value: number;
}

/** The `set` stimuli of a level, in the order they take effect. */
export function setStimuli(stimuli: readonly unknown[] | undefined): SetStimulus[] {
  const out: SetStimulus[] = [];
  for (const s of stimuli ?? []) {
    const x = s as Partial<SetStimulus>;
    if (typeof x.set === "string" && typeof x.value === "number" && typeof x.at === "number") out.push({ at: x.at, set: x.set, value: x.value });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Value of a signal-bus input at time tMs of a test run, from the level's stimuli. */
export function inputAt(sets: SetStimulus[], name: string, tMs: number): number | undefined {
  let v: number | undefined;
  for (const s of sets) {
    if (s.at > tMs) break;
    if (s.set === name) v = s.value;
  }
  return v;
}

/** Inputs that describe the world and where things stand in it: what a live run takes over from the level. */
export const isWorldInput = (name: string): boolean => /^(ROBOT_|LIDAR_|WORLD_|TB_SET_)/.test(name) || name === "MOTOR_RIGHT_GAIN";

/** The world inputs a level sets before its program has done anything (at 0 ms). */
export function worldSetup(stimuli: readonly unknown[] | undefined): SetStimulus[] {
  return setStimuli(stimuli).filter((s) => s.at <= 0.02 && isWorldInput(s.set));
}

const worldCache = new Map<string, World>();
/** The world a set of input values describes (without placed objects), built once per description. */
export function worldFor(get: (name: string) => number | undefined): World {
  const num = (name: string) => {
    const v = get(name);
    return v !== undefined && Number.isFinite(v) ? v : undefined;
  };
  const spec: WorldSpec = { kind: Math.round(num("WORLD_KIND") ?? 0), room: Math.round(num("LIDAR_ROOM") ?? 0), seed: num("WORLD_SEED"), size: num("WORLD_SIZE"), loops: (num("WORLD_LOOPS") ?? 0) > 0 };
  const key = `${spec.kind},${spec.room},${spec.seed},${spec.size},${spec.loops}`;
  let w = worldCache.get(key);
  if (!w) {
    w = terrain(spec) ?? ROOMS[spec.room ?? 0] ?? ROOMS[0];
    if (worldCache.size > 40) worldCache.clear();
    worldCache.set(key, w);
  }
  return w;
}

// ---------- one moment ----------

export type SceneKind = "world" | "bench" | "scan";

export interface Lidar {
  /** Readings of the 228 points, mm (0: nothing in reach, 6: too close). */
  mm: number[];
  /** Where the sensor is. */
  x: number;
  y: number;
  /** Feet straight ahead, to the right and to the left; undefined without an echo. */
  front?: number;
  right?: number;
  left?: number;
}

export interface Scene {
  kind: SceneKind;
  /** Time shown, ms. */
  tMs: number;
  /** The room or terrain. Undefined on the test bench, which has an open floor. */
  world?: World;
  pose: PoseFt;
  /** Wheel speeds, ft/s. */
  wheels?: { left: number; right: number };
  goal?: Pt;
  goalDist?: number;
  odometer?: number;
  crashed: boolean;
  /** Where the robot touched something. */
  crashAt?: Pt;
  trail: Pt[][];
  /** The program's own pose estimate, when it reports one. */
  est?: { x: number; y: number; th?: number };
  estTrail: Pt[][];
  /** Distance between the estimate and the truth, ft. */
  estErr?: number;
  lidar?: Lidar;
}

/** What sceneAt reads: the output histories, and the inputs as they were at the time shown. */
export interface SceneSource {
  outputs: Map<string, Trace>;
  /** A signal-bus input at the time shown. */
  input(name: string): number | undefined;
  /** The world in use (with placed objects in a live run). */
  world: World;
  /** The robot world plugin is switched on. */
  worldOn: boolean;
  /** The LIDAR is in use (so its scan is worth drawing). */
  lidar: boolean;
}

/** Which of the three situations the board is in, or undefined when it has no robot and no LIDAR at all. */
export function sceneKind(outputs: Map<string, Trace>, lidarUsed: boolean): SceneKind | undefined {
  if ((outputs.get("ROBOT_X_FT")?.length ?? 0) > 0) return "world";
  const moved = (name: string) => (outputs.get(name)?.length ?? 0) > 1;
  if (moved("TB_X_FT") || moved("TB_Y_FT") || moved("TB_THETA_RAD") || (outputs.get("TB_EST_X_FT")?.length ?? 0) > 0) return "bench";
  return lidarUsed ? "scan" : undefined;
}

const finite = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v);

/** One LIDAR scan from a pose in a world, with the three named distances in feet. */
export function lidarAt(world: World, pose: PoseFt, offset = 0): Lidar {
  const mm = scan({ room: 0, world, x: pose.x, y: pose.y, theta: pose.th, offset });
  const ft = (i: number) => (mm[i] >= MIN_MM ? mm[i] * FT_PER_MM : undefined);
  return { mm, x: pose.x + offset * Math.cos(pose.th), y: pose.y + offset * Math.sin(pose.th), front: ft(NAMED_POINTS.front), right: ft(NAMED_POINTS.right), left: ft(NAMED_POINTS.left) };
}

/** Where point i of a scan ends, ft, and whether it is an echo (false: drawn to the sensor's reach, or to the sensor for "too close"). */
export function rayTip(l: Lidar, theta: number, i: number): [number, number, boolean] {
  const a = theta + stepAngle(G_START + G_CLUSTER * i);
  const echo = l.mm[i] >= MIN_MM;
  const d = echo ? l.mm[i] / 304.8 : l.mm[i] === 0 ? REACH_FT : 0;
  return [l.x + d * Math.cos(a), l.y + d * Math.sin(a), echo];
}
export const RAYS = LIDAR_POINTS;

/**
 * The world at time tMs of a run. `trailFromMs` is where the drawn path
 * begins (after the robot was last put down by hand).
 */
export function sceneAt(src: SceneSource, kind: SceneKind, tMs: number, o: { trailFromMs?: number; withLidar?: boolean } = {}): Scene {
  const t = tMs * MS;
  const from = Math.max(0, (o.trailFromMs ?? 0) * MS);
  const out = src.outputs;
  // Before a signal's first entry (the world switches on a moment after power-up) its first value stands.
  const at = (name: string) => sampleAt(out.get(name), t) ?? out.get(name)?.[0]?.v;
  const num = (name: string, fallback = 0) => {
    const v = at(name);
    return finite(v) ? v : fallback;
  };
  if (kind === "world") {
    const pose = { x: num("ROBOT_X_FT"), y: num("ROBOT_Y_FT"), th: num("ROBOT_THETA_RAD") };
    const gx = src.input("ROBOT_GOAL_X_FT") ?? ((src.input("WORLD_KIND") ?? 0) !== 0 ? src.world.goal?.[0] : undefined);
    const gy = src.input("ROBOT_GOAL_Y_FT") ?? ((src.input("WORLD_KIND") ?? 0) !== 0 ? src.world.goal?.[1] : undefined);
    const goal = finite(gx) && finite(gy) ? { x: gx, y: gy } : undefined;
    const crashed = at("ROBOT_CRASHED") === 1;
    const crashT = crashed ? firstTimeOf(out.get("ROBOT_CRASHED"), 1, from, t) : undefined;
    const wl = at("LEFT_WHEEL_RADPS");
    const wr = at("RIGHT_WHEEL_RADPS");
    return {
      kind,
      tMs,
      world: src.world,
      pose,
      wheels: finite(wl) && finite(wr) ? { left: wl * FT_PER_WHEEL_RAD + 0, right: wr * FT_PER_WHEEL_RAD + 0 } : undefined,
      goal,
      goalDist: goal ? Math.hypot(goal.x - pose.x, goal.y - pose.y) : undefined,
      odometer: at("ROBOT_ODOMETER_FT"),
      crashed,
      crashAt: crashT !== undefined ? { x: sampleAt(out.get("ROBOT_X_FT"), crashT) ?? pose.x, y: sampleAt(out.get("ROBOT_Y_FT"), crashT) ?? pose.y } : undefined,
      trail: thinTrail(out.get("ROBOT_X_FT"), out.get("ROBOT_Y_FT"), from, t),
      estTrail: [],
      lidar: o.withLidar === false ? undefined : lidarAt(src.world, pose, src.input("LIDAR_OFFSET_FT") ?? 0),
    };
  }
  if (kind === "bench") {
    const pose = { x: num("TB_X_FT"), y: num("TB_Y_FT"), th: num("TB_THETA_RAD") };
    const ex = at("TB_EST_X_FT");
    const ey = at("TB_EST_Y_FT");
    const eth = at("TB_EST_THETA_RAD");
    const has = finite(ex) && finite(ey);
    return {
      kind,
      tMs,
      pose,
      wheels: { left: num("TB_VLEFT"), right: num("TB_VRIGHT") },
      crashed: false,
      trail: thinTrail(out.get("TB_X_FT"), out.get("TB_Y_FT"), from, t),
      est: has ? { x: ex, y: ey, th: finite(eth) ? eth : undefined } : undefined,
      estTrail: thinTrail(out.get("TB_EST_X_FT"), out.get("TB_EST_Y_FT"), from, t, { maxSpeed: 1e9 }),
      estErr: has ? Math.hypot(ex - pose.x, ey - pose.y) : undefined,
    };
  }
  const start = src.world.start;
  const pose = { x: src.input("LIDAR_X_FT") ?? start[0], y: src.input("LIDAR_Y_FT") ?? start[1], th: src.input("LIDAR_THETA_RAD") ?? start[2] };
  return { kind, tMs, world: src.world, pose, crashed: false, trail: [], estTrail: [], lidar: lidarAt(src.world, pose, src.input("LIDAR_OFFSET_FT") ?? 0) };
}

/** The level's world before anything has run: the room, the robot at its start and the goal. */
export function sceneOfSetup(sets: SetStimulus[]): Scene {
  const input = (name: string) => inputAt(sets, name, 0.02);
  const world = worldFor(input);
  const terrainStart = (input("WORLD_KIND") ?? 0) !== 0 ? world.start : [5, 5, 0];
  const pose = { x: input("ROBOT_START_X_FT") ?? terrainStart[0], y: input("ROBOT_START_Y_FT") ?? terrainStart[1], th: input("ROBOT_START_THETA_RAD") ?? terrainStart[2] };
  const gx = input("ROBOT_GOAL_X_FT") ?? ((input("WORLD_KIND") ?? 0) !== 0 ? world.goal?.[0] : undefined);
  const gy = input("ROBOT_GOAL_Y_FT") ?? ((input("WORLD_KIND") ?? 0) !== 0 ? world.goal?.[1] : undefined);
  const goal = finite(gx) && finite(gy) ? { x: gx, y: gy } : undefined;
  return { kind: "world", tMs: 0, world, pose, goal, goalDist: goal ? Math.hypot(goal.x - pose.x, goal.y - pose.y) : undefined, crashed: false, trail: [], estTrail: [] };
}

// ---------- the picture ----------

export interface ViewBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The part of the floor to draw. A room is shown whole (plus the goal and
 * the robot if they are outside it); the open floor of the test bench
 * follows the paths, in steps of half a foot so the picture does not creep,
 * and is never closer than 3 ft across.
 */
export function fitView(s: Scene): ViewBox {
  const near = (p: Pt) => Math.abs(p.x) < 1e3 && Math.abs(p.y) < 1e3;
  if (s.world) {
    let [x0, y0, x1, y1] = s.world.bounds;
    // A long room (the 32 ft corridor) is cut to what the sensor can reach from the robot.
    if (near(s.pose) && x1 - x0 > 2 * REACH_FT) {
      x0 = Math.max(x0, s.pose.x - REACH_FT - 1);
      x1 = Math.min(x1, s.pose.x + REACH_FT + 1);
    }
    if (near(s.pose) && y1 - y0 > 2 * REACH_FT) {
      y0 = Math.max(y0, s.pose.y - REACH_FT - 1);
      y1 = Math.min(y1, s.pose.y + REACH_FT + 1);
    }
    const [bx0, by0, bx1, by1] = [x0, y0, x1, y1];
    const grow = (p: Pt | undefined, m: number) => {
      if (!p || !near(p)) return;
      // Only as far as the sensor reaches from the room: a robot carried a mile away is not followed.
      x0 = Math.max(Math.min(x0, p.x - m), bx0 - 15);
      x1 = Math.min(Math.max(x1, p.x + m), bx1 + 15);
      y0 = Math.max(Math.min(y0, p.y - m), by0 - 15);
      y1 = Math.min(Math.max(y1, p.y + m), by1 + 15);
    };
    grow(s.pose, 0.6);
    grow(s.goal, 0.6);
    return { x0: x0 - 0.4, y0: y0 - 0.4, x1: x1 + 0.4, y1: y1 + 0.4 };
  }
  const pts = [...s.trail.flat(), ...s.estTrail.flat().filter(near), near(s.pose) ? s.pose : { x: 0, y: 0 }, ...(s.est && near(s.est) ? [s.est] : [])];
  const q = (v: number, up: boolean) => (up ? Math.ceil(v * 2) / 2 : Math.floor(v * 2) / 2);
  let x0 = q(Math.min(...pts.map((p) => p.x)) - 0.5, false);
  let x1 = q(Math.max(...pts.map((p) => p.x)) + 0.5, true);
  let y0 = q(Math.min(...pts.map((p) => p.y)) - 0.5, false);
  let y1 = q(Math.max(...pts.map((p) => p.y)) + 0.5, true);
  if (x1 - x0 < 3) {
    const c = (x0 + x1) / 2;
    x0 = c - 1.5;
    x1 = c + 1.5;
  }
  if (y1 - y0 < 2) {
    const c = (y0 + y1) / 2;
    y0 = c - 1;
    y1 = c + 1;
  }
  return { x0, y0, x1, y1 };
}

/** Grid spacing in feet that gives at most `max` lines across `span` feet. */
export function gridStep(span: number, max = 12): number {
  return [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].find((g) => span / g <= max) ?? 1000;
}

// ---------- words ----------

const f1 = (v: number) => v.toFixed(1);
const f2 = (v: number) => {
  const s = v.toFixed(2);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
};
export const fmt = f2;

/** Angle from a to b, wrapped into -pi .. pi. */
export const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** What the robot is doing, in a few words: "Standing still", "Turning left on the spot", "Driving", "Backing up". */
export function motion(w: { left: number; right: number } | undefined): string {
  if (!w) return "Standing";
  const v = (w.left + w.right) / 2;
  const diff = w.right - w.left;
  if (Math.abs(v) < 0.03 && Math.abs(diff) < 0.03) return "Standing still";
  if (Math.abs(v) < 0.05) return diff > 0 ? "Turning left on the spot" : "Turning right on the spot";
  return v > 0 ? "Driving" : "Backing up";
}

/** One sentence that says what is happening at this moment. */
export function describe(s: Scene, o: { goalTol?: number; live?: boolean } = {}): string {
  const parts: string[] = [];
  const ahead = s.lidar ? (s.lidar.front !== undefined ? (s.lidar.front < 4 ? `the wall ahead is ${f1(s.lidar.front)} ft away` : "") : "") : "";
  if (s.kind === "scan") {
    const l = s.lidar!;
    const d = (v: number | undefined) => (v === undefined ? "nothing in reach" : `${f2(v)} ft`);
    return `The robot stands at (${f2(s.pose.x)}, ${f2(s.pose.y)}) ft in the ${s.world!.name}. The LIDAR measures ${d(l.front)} straight ahead, ${d(l.right)} to the right and ${d(l.left)} to the left.`;
  }
  if (s.crashed) {
    const at = s.crashAt ?? s.pose;
    return `The robot touched a wall at (${f2(at.x)}, ${f2(at.y)}) ft and stopped there.${o.live ? " Drag it away from the wall, or press Reset world." : ""}`;
  }
  const what = motion(s.wheels);
  if (s.goal && s.goalDist !== undefined) {
    const tol = o.goalTol ?? 0.15;
    if (s.goalDist <= tol) parts.push(`${what === "Standing still" ? "Standing at the goal" : `${what}, at the goal`} (${f2(s.goalDist)} ft from its centre)`);
    else {
      const bearing = Math.abs(wrap(Math.atan2(s.goal.y - s.pose.y, s.goal.x - s.pose.x) - s.pose.th));
      const toward = what === "Driving" ? (bearing < 0.6 ? " toward the goal" : bearing > 2 ? " away from the goal" : "") : "";
      parts.push(`${what}${toward}, ${f1(s.goalDist)} ft to go`);
    }
  } else if (s.wheels && what === "Driving") parts.push(`Driving at ${f2((s.wheels.left + s.wheels.right) / 2)} ft/s`);
  else parts.push(what);
  if (ahead) parts.push(ahead);
  if (s.estErr !== undefined) parts.push(`the program's estimate is ${s.estErr < 10 ? s.estErr.toFixed(3) : s.estErr.toFixed(0)} ft from the true position`);
  return `${parts.join("; ")}.`;
}

/** A longer description for the picture's accessible name. */
export function describeAll(s: Scene, o: { goalTol?: number; live?: boolean } = {}): string {
  const deg = (s.pose.th * 180) / Math.PI;
  const where = s.world ? `Top view of the ${s.world.name}` : "Top view of the open floor of the test bench";
  const pose = s.kind === "scan" ? "" : ` The robot is at x ${f2(s.pose.x)}, y ${f2(s.pose.y)} feet, heading ${deg.toFixed(0)} degrees counter-clockwise from the x axis.`;
  const goal = s.goal ? ` The goal is at x ${f2(s.goal.x)}, y ${f2(s.goal.y)} feet.` : "";
  return `${where}, x to the right and y up, in feet.${pose}${goal} ${describe(s, o)}`;
}

// ---------- replay ----------

export interface ReplayMark {
  tMs: number;
  label: string;
  /** Whether the check passed; undefined before the tests have run. */
  pass?: boolean;
}

/**
 * The instants a level's checks look at: every check with an `at` (signal,
 * var, led, pin). Checks at the same instant share one mark; a mark has
 * failed when any of its checks did.
 */
export function replayMarks(checks: readonly unknown[], results: readonly { pass: boolean }[] | undefined, endMs: number): ReplayMark[] {
  const marks = new Map<number, ReplayMark>();
  checks.forEach((c, i) => {
    const x = c as { at?: unknown; label?: unknown };
    if (typeof x.at !== "number" || !(x.at >= 0) || x.at > endMs) return;
    const pass = results?.[i]?.pass;
    const m = marks.get(x.at);
    const label = typeof x.label === "string" ? x.label : "check";
    if (m) {
      m.label = `${m.label}; ${label}`;
      if (pass !== undefined) m.pass = (m.pass ?? true) && pass;
    } else marks.set(x.at, { tMs: x.at, label, pass });
  });
  return [...marks.values()].sort((a, b) => a.tMs - b.tMs);
}

/**
 * A row for each mark, so that marks closer together than `gap` (a fraction
 * of the run) do not lie on top of each other: each goes to the first row
 * whose last mark is far enough to its left.
 */
export function markRows(marks: ReplayMark[], endMs: number, gap = 0.09): number[] {
  const last: number[] = [];
  return marks.map((m) => {
    const at = m.tMs / Math.max(1, endMs);
    let row = last.findIndex((x) => at - x >= gap);
    if (row < 0) row = last.length;
    last[row] = at;
    return row;
  });
}

/** A slider step that gives about 400 positions over a run, on a round number of milliseconds. */
export function replayStep(endMs: number): number {
  const raw = endMs / 400;
  return [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((s) => s >= raw) ?? 1000;
}

/** The replay clock: where the time is after `dtMs` of wall time at `speed`, stopping at the end. */
export function advanceReplay(tMs: number, dtMs: number, speed: number, endMs: number): { tMs: number; done: boolean } {
  const next = tMs + Math.max(0, dtMs) * speed;
  return next >= endMs ? { tMs: endMs, done: true } : { tMs: next, done: false };
}

/** The largest goal distance a level accepts: the radius of the circle drawn around the goal. */
export function goalTolerance(checks: readonly unknown[]): number | undefined {
  let tol: number | undefined;
  for (const c of checks) {
    const x = c as { kind?: unknown; name?: unknown; max?: unknown };
    if (x.kind === "signal" && x.name === "ROBOT_GOAL_DIST_FT" && typeof x.max === "number") tol = Math.max(tol ?? 0, x.max);
  }
  return tol;
}

/** Watched variables that name a state of a state machine. */
export const isStateName = (name: string): boolean => /state|corner|phase|mode/i.test(name);
