// The path a level's test moves the LIDAR robot along, as something that
// can be played smoothly: the test itself jumps from pose to pose, which a
// person cannot follow. Pure functions, shared by the live run (which drives
// the robot round the path) and by the replay (which glides between jumps).

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
  const mine = sets.filter((s) => /^LIDAR_/.test(s.set) && Number.isFinite(s.value)).sort((a, b) => a.at - b.at);
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

/** True when the robot can glide from a to b: only its pose differs (the room is the same). */
function canGlide(a: Waypoint, b: Waypoint): boolean {
  for (const [k, v] of b.values) if (!isPoseInput(k) && a.values.get(k) !== v) return false;
  return true;
}

const ease = (u: number) => u * u * (3 - 2 * u);

/** The inputs a fraction u (0 to 1) of the way from a to b. Angles take the short way round. */
export function between(a: Waypoint, b: Waypoint, u: number): Map<string, number> {
  if (u >= 1) return b.values;
  if (u <= 0 || !canGlide(a, b)) return a.values;
  const e = ease(u);
  const out = new Map(a.values);
  for (const k of POSE) {
    const from = a.values.get(k);
    const to = b.values.get(k);
    if (to === undefined) continue;
    if (from === undefined) {
      out.set(k, to);
      continue;
    }
    let d = to - from;
    if (k === "LIDAR_THETA_RAD") d = Math.atan2(Math.sin(d), Math.cos(d));
    out.set(k, from + d * e);
  }
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
