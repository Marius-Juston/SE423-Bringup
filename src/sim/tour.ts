// The path a level's test moves the LIDAR robot along, as something that
// can be played smoothly: the test itself jumps from pose to pose, which a
// person cannot follow. Pure functions, shared by the live run (which drives
// the robot round the path) and by the replay (which drives between jumps).
// Every move obeys the robot's kinematics: turn on the spot, drive straight.

import { ROOMS } from "./plugins/lidar";
import { clearance } from "./world/terrain";

export interface PathSet {
  at: number;
  set: string;
  value: number;
}

/** The pose inputs: these glide. Every other input changes in one step. */
const POSE = ["LIDAR_X_FT", "LIDAR_Y_FT", "LIDAR_THETA_RAD"];
export const isPoseInput = (name: string): boolean => POSE.includes(name);

export interface Waypoint {
  /** Time of the test at which the robot is put here, ms. */
  at: number;
  /** Every input the path sets, with its value from this moment on. */
  values: Map<string, number>;
}

/** The poses of a test, in order. Fewer than two: the test never moves the robot. */
export function waypoints(sets: readonly PathSet[]): Waypoint[] {
  const mine = sets.filter((s) => /^(LIDAR_|WORLD_)/.test(s.set) && Number.isFinite(s.value)).sort((a, b) => a.at - b.at);
  if (!mine.some((s) => s.at > 0.02 && isPoseInput(s.set))) return [];
  const out: Waypoint[] = [];
  const now = new Map<string, number>();
  for (const s of mine) {
    now.set(s.set, s.value);
    const at = s.at <= 0.02 ? 0 : s.at;
    const last = out[out.length - 1];
    if (last && last.at === at) last.values = new Map(now);
    else out.push({ at, values: new Map(now) });
  }
  return out;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (u: number) => u * u * (3 - 2 * u);

/** Feet of driving that a radian of turning on the spot counts as, when the time of a move is shared out. */
const TURN_FT = 1;
/** The robot backs up instead of turning round only over short distances. */
const REVERSE_MAX_FT = 2;

/**
 * True when a robot can drive from a to b: the room is the same and the
 * straight line between them touches no wall. Otherwise the robot is picked
 * up and put down, as the test does.
 */
function canDrive(a: Waypoint, b: Waypoint): boolean {
  for (const [k, v] of b.values) if (!isPoseInput(k) && a.values.get(k) !== v) return false;
  if ((b.values.get("WORLD_KIND") ?? 0) !== 0) return false;
  const room = ROOMS[Math.round(b.values.get("LIDAR_ROOM") ?? 0)] ?? ROOMS[0];
  const [x0, y0] = [a.values.get("LIDAR_X_FT") ?? room.start[0], a.values.get("LIDAR_Y_FT") ?? room.start[1]];
  const [x1, y1] = [b.values.get("LIDAR_X_FT") ?? x0, b.values.get("LIDAR_Y_FT") ?? y0];
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.04));
  for (let i = 0; i <= n; i++) if (clearance(room, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n) < 0.03) return false;
  return true;
}

/**
 * The inputs a fraction u (0 to 1) of the way from a to b, moving as the
 * robot can: it turns on the spot to face where it is going, drives there
 * in a straight line, and turns on the spot to its new heading. Over a
 * short distance it backs up when that needs less turning. It never slides
 * sideways.
 */
export function between(a: Waypoint, b: Waypoint, u: number): Map<string, number> {
  if (u >= 1) return b.values;
  if (u <= 0 || !canDrive(a, b)) return a.values;
  const get = (w: Waypoint, k: string, d: number) => w.values.get(k) ?? d;
  const x0 = get(a, "LIDAR_X_FT", 0);
  const y0 = get(a, "LIDAR_Y_FT", 0);
  const th0 = get(a, "LIDAR_THETA_RAD", 0);
  const x1 = get(b, "LIDAR_X_FT", x0);
  const y1 = get(b, "LIDAR_Y_FT", y0);
  const th1 = get(b, "LIDAR_THETA_RAD", th0);
  const d = Math.hypot(x1 - x0, y1 - y0);
  let t1: number;
  let t2: number;
  if (d < 0.02) {
    t1 = wrap(th1 - th0);
    t2 = 0;
  } else {
    const dir = Math.atan2(y1 - y0, x1 - x0);
    t1 = wrap(dir - th0);
    t2 = wrap(th1 - dir);
    // Backwards: the heading while driving is opposite to the direction of travel.
    const r1 = wrap(dir + Math.PI - th0);
    const r2 = wrap(th1 - dir - Math.PI);
    if (d <= REVERSE_MAX_FT && Math.abs(r1) + Math.abs(r2) < Math.abs(t1) + Math.abs(t2)) {
      t1 = r1;
      t2 = r2;
    }
  }
  const w1 = Math.abs(t1) * TURN_FT;
  const w2 = Math.abs(t2) * TURN_FT;
  const total = w1 + d + w2;
  if (total < 1e-9) return b.values;
  // Each part starts and ends at rest.
  let s = u * total;
  const part = (w: number) => {
    const f = w > 0 ? ease(Math.min(1, Math.max(0, s / w))) : s >= 0 ? 1 : 0;
    s -= w;
    return f;
  };
  const f1 = part(w1);
  const fd = part(d);
  const f2 = part(w2);
  const out = new Map(a.values);
  out.set("LIDAR_X_FT", x0 + (x1 - x0) * fd);
  out.set("LIDAR_Y_FT", y0 + (y1 - y0) * fd);
  out.set("LIDAR_THETA_RAD", th0 + t1 * f1 + t2 * f2);
  return out;
}

/** How long the robot stands at each pose of the tour, and how long it takes to the next, in simulated ms. */
export const TOUR_HOLD_MS = 1200;
export const TOUR_MOVE_MS = 1800;

/** The inputs at time tMs of a tour that goes round the waypoints for ever. */
export function tourAt(wps: readonly Waypoint[], tMs: number): Map<string, number> {
  const n = wps.length;
  const leg = TOUR_HOLD_MS + TOUR_MOVE_MS;
  const t = ((tMs % (n * leg)) + n * leg) % (n * leg);
  const i = Math.floor(t / leg);
  const into = t - i * leg;
  return between(wps[i], wps[(i + 1) % n], (into - TOUR_HOLD_MS) / TOUR_MOVE_MS);
}

/**
 * The inputs at time tMs of the test's replay: the test's own jumps, each
 * shown as a short glide that ends at the moment of the jump (`glideMs` of
 * test time, never more than 40 % of the time since the jump before).
 */
export function replayAt(wps: readonly Waypoint[], tMs: number, glideMs: number): Map<string, number> {
  let i = 0;
  while (i + 1 < wps.length && wps[i + 1].at <= tMs) i++;
  const a = wps[i];
  const b = wps[i + 1];
  if (!b) return a.values;
  const g = Math.min(glideMs, 0.4 * (b.at - a.at));
  return g > 0 ? between(a, b, (tMs - (b.at - g)) / g) : a.values;
}
