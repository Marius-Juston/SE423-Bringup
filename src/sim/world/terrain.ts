// Worlds for the robot and its LIDAR: an outer boundary plus obstacles
// (axis-aligned boxes, round posts and thin walls), and a library of
// terrains built from them, including seeded random mazes. Pure geometry:
// no Board, no randomness of its own (Math.random is never used, so the
// same seed gives the same maze on every machine).
//
// Lengths in feet, angles in radians counter-clockwise from the x axis.
// The ray caster is castRay() in src/sim/plugins/lidar.ts; it reads
// `walls` (every straight surface, boundary first) and `posts`.

/** A straight wall from (x1, y1) to (x2, y2). */
export type Seg = [number, number, number, number];

export type Obstacle =
  | { kind: "box"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "post"; x: number; y: number; r: number }
  | { kind: "wall"; x1: number; y1: number; x2: number; y2: number };

export interface Post {
  x: number;
  y: number;
  r: number;
}

export interface World {
  name: string;
  /** Every straight surface the LIDAR and the robot can meet: the boundary, then the sides of the obstacles. */
  walls: Seg[];
  /** Round posts. */
  posts: Post[];
  /** Pose when nothing else sets one: [x, y, theta]. */
  start: [number, number, number];
  /** Where a trip through this world ends, when it has such a place. */
  goal?: [number, number];
  /** The outer walls alone. */
  boundary: Seg[];
  /** What stands inside. */
  obstacles: Obstacle[];
  /** The part worth drawing: [x0, y0, x1, y1]. */
  bounds: [number, number, number, number];
}

/** The four sides of a box, in the order the rooms of lidar.ts have always listed them. */
export const boxSegs = (x0: number, y0: number, x1: number, y1: number): Seg[] => [
  [x0, y0, x1, y0],
  [x1, y0, x1, y1],
  [x1, y1, x0, y1],
  [x0, y1, x0, y0],
];

/** The straight surfaces of a list of obstacles, in order. */
export function obstacleSegs(obstacles: Obstacle[]): Seg[] {
  const out: Seg[] = [];
  for (const o of obstacles) {
    if (o.kind === "box") out.push(...boxSegs(o.x0, o.y0, o.x1, o.y1));
    else if (o.kind === "wall") out.push([o.x1, o.y1, o.x2, o.y2]);
  }
  return out;
}

export function makeWorld(w: { name: string; boundary: Seg[]; obstacles?: Obstacle[]; start: [number, number, number]; goal?: [number, number]; bounds?: [number, number, number, number] }): World {
  const obstacles = w.obstacles ?? [];
  const walls = [...w.boundary, ...obstacleSegs(obstacles)];
  const xs = w.boundary.flatMap((s) => [s[0], s[2]]);
  const ys = w.boundary.flatMap((s) => [s[1], s[3]]);
  return {
    name: w.name,
    walls,
    posts: obstacles.filter((o): o is Extract<Obstacle, { kind: "post" }> => o.kind === "post").map((o) => ({ x: o.x, y: o.y, r: o.r })),
    start: w.start,
    goal: w.goal,
    boundary: w.boundary,
    obstacles,
    bounds: w.bounds ?? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  };
}

/** The same world with more obstacles in it (objects placed in the playground). */
export function withObstacles(w: World, extra: Obstacle[]): World {
  if (!extra.length) return w;
  return makeWorld({ name: w.name, boundary: w.boundary, obstacles: [...w.obstacles, ...extra], start: w.start, goal: w.goal, bounds: w.bounds });
}

/** Distance from the point (x, y) to the segment s. */
export function distToSeg(s: Seg, x: number, y: number): number {
  const ex = s[2] - s[0];
  const ey = s[3] - s[1];
  const len2 = ex * ex + ey * ey;
  const u = len2 > 0 ? Math.max(0, Math.min(1, ((x - s[0]) * ex + (y - s[1]) * ey) / len2)) : 0;
  return Math.hypot(x - (s[0] + u * ex), y - (s[1] + u * ey));
}

/**
 * Free distance around the point (x, y): to the nearest wall or to the
 * surface of the nearest post. Negative inside a post. A disc of radius r
 * at (x, y) touches something exactly when clearance < r.
 */
export function clearance(w: { walls: Seg[]; posts?: Post[] }, x: number, y: number): number {
  let best = Infinity;
  for (const s of w.walls) {
    const d = distToSeg(s, x, y);
    if (d < best) best = d;
  }
  if (w.posts) {
    for (const p of w.posts) {
      const d = Math.hypot(x - p.x, y - p.y) - p.r;
      if (d < best) best = d;
    }
  }
  return best;
}

/** True when the point lies inside a box obstacle (its walls alone would not say so). */
export function insideBox(w: { obstacles: Obstacle[] }, x: number, y: number): boolean {
  return w.obstacles.some((o) => o.kind === "box" && x > o.x0 && x < o.x1 && y > o.y0 && y < o.y1);
}

// ---------- seeded numbers ----------

/** mulberry32: a small seeded generator, uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- mazes ----------

/** Side of one maze cell, ft: a corridor the 0.7 ft wide robot can turn in. */
export const MAZE_CELL_FT = 2;
export const MAZE_MIN = 3;
export const MAZE_MAX = 8;

export interface Maze {
  /** Cells per side. */
  n: number;
  seed: number;
  loops: boolean;
  /** east[j][i]: a wall between cell (i, j) and cell (i + 1, j). i = 0 .. n - 2. */
  east: boolean[][];
  /** north[j][i]: a wall between cell (i, j) and cell (i, j + 1). j = 0 .. n - 2. */
  north: boolean[][];
  /** Start and goal cells [i, j]: opposite corners. */
  start: [number, number];
  goal: [number, number];
}

/** Directions: 0 east (+x), 1 north (+y), 2 west, 3 south. */
export const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/** May the robot go from cell (i, j) one cell in direction d? */
export function mazeOpen(m: Maze, i: number, j: number, d: number): boolean {
  const ni = i + DIRS[d][0];
  const nj = j + DIRS[d][1];
  if (ni < 0 || nj < 0 || ni >= m.n || nj >= m.n) return false;
  if (d === 0) return !m.east[j][i];
  if (d === 2) return !m.east[j][ni];
  if (d === 1) return !m.north[j][i];
  return !m.north[nj][i];
}

/**
 * A maze from a seed: a recursive backtracker (depth-first carving), which
 * gives a "perfect" maze, one way and only one between any two cells.
 * `loops` then takes away a few more walls, so some walls stand free as
 * islands and there is more than one way.
 */
export function makeMaze(size: number, seed: number, loops = false): Maze {
  const n = Math.max(MAZE_MIN, Math.min(MAZE_MAX, Math.round(Number.isFinite(size) ? size : 4)));
  const rnd = mulberry32((Math.round(Number.isFinite(seed) ? seed : 0) >>> 0) * 31 + n);
  const east = Array.from({ length: n }, () => Array<boolean>(n - 1).fill(true));
  const north = Array.from({ length: n - 1 }, () => Array<boolean>(n).fill(true));
  const seen = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
  const open = (i: number, j: number, d: number) => {
    if (d === 0) east[j][i] = false;
    else if (d === 2) east[j][i - 1] = false;
    else if (d === 1) north[j][i] = false;
    else north[j - 1][i] = false;
  };
  const stack: [number, number][] = [[0, 0]];
  seen[0][0] = true;
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const next: number[] = [];
    for (let d = 0; d < 4; d++) {
      const ni = i + DIRS[d][0];
      const nj = j + DIRS[d][1];
      if (ni >= 0 && nj >= 0 && ni < n && nj < n && !seen[nj][ni]) next.push(d);
    }
    if (!next.length) {
      stack.pop();
      continue;
    }
    const d = next[Math.floor(rnd() * next.length)];
    open(i, j, d);
    const ni = i + DIRS[d][0];
    const nj = j + DIRS[d][1];
    seen[nj][ni] = true;
    stack.push([ni, nj]);
  }
  if (loops) {
    // Take away about one wall in five of those that are left.
    const left: [number, number, number][] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n - 1; i++) if (east[j][i]) left.push([i, j, 0]);
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n; i++) if (north[j][i]) left.push([i, j, 1]);
    const take = Math.max(1, Math.round(left.length / 5));
    for (let k = 0; k < take && left.length; k++) {
      const [i, j, d] = left.splice(Math.floor(rnd() * left.length), 1)[0];
      open(i, j, d);
    }
  }
  return { n, seed: Math.round(Number.isFinite(seed) ? seed : 0) >>> 0, loops, east, north, start: [0, 0], goal: [n - 1, n - 1] };
}

/** Centre of a cell, ft. */
export const cellCentre = (i: number, j: number): [number, number] => [(i + 0.5) * MAZE_CELL_FT, (j + 0.5) * MAZE_CELL_FT];

/** Shortest way from one cell to another (breadth-first), as the list of cells, or null. */
export function mazePath(m: Maze, from: [number, number] = m.start, to: [number, number] = m.goal): [number, number][] | null {
  const key = (i: number, j: number) => j * m.n + i;
  const prev = new Map<number, number>([[key(from[0], from[1]), -1]]);
  const queue: [number, number][] = [from];
  for (let q = 0; q < queue.length; q++) {
    const [i, j] = queue[q];
    if (i === to[0] && j === to[1]) {
      const path: [number, number][] = [];
      for (let k = key(i, j); k >= 0; k = prev.get(k)!) path.unshift([k % m.n, Math.floor(k / m.n)]);
      return path;
    }
    for (let d = 0; d < 4; d++) {
      if (!mazeOpen(m, i, j, d)) continue;
      const ni = i + DIRS[d][0];
      const nj = j + DIRS[d][1];
      if (prev.has(key(ni, nj))) continue;
      prev.set(key(ni, nj), key(i, j));
      queue.push([ni, nj]);
    }
  }
  return null;
}

/**
 * The cells a wall follower passes, keeping one hand on a wall: at every
 * cell it takes the first open way in the order (hand side, ahead, other
 * side, back). Stops at `to`, or gives null when it comes back to where it
 * began without having been there (a goal on an island).
 */
export function mazeWallFollow(m: Maze, hand: "right" | "left" = "right", from: [number, number] = m.start, heading = 0, to: [number, number] = m.goal): [number, number][] | null {
  const side = hand === "right" ? 3 : 1;
  let [i, j] = from;
  let d = heading;
  const path: [number, number][] = [[i, j]];
  for (let steps = 0; steps < 4 * m.n * m.n + 4; steps++) {
    if (i === to[0] && j === to[1]) return path;
    const order = [(d + side) % 4, d, (d + 4 - side) % 4, (d + 2) % 4];
    const go = order.find((k) => mazeOpen(m, i, j, k));
    if (go === undefined) return null;
    d = go;
    i += DIRS[d][0];
    j += DIRS[d][1];
    path.push([i, j]);
  }
  return null;
}

/** The first open direction out of a cell, east first: where the robot looks at the start. */
export function mazeHeading(m: Maze, cell: [number, number] = m.start): number {
  for (const d of [0, 1, 2, 3]) if (mazeOpen(m, cell[0], cell[1], d)) return d;
  return 0;
}

/** The walls of a maze as a world: neighbouring pieces of wall on one line are joined. */
export function mazeWorld(m: Maze): World {
  const c = MAZE_CELL_FT;
  const obstacles: Obstacle[] = [];
  // Walls along x (between rows j and j + 1).
  for (let j = 0; j < m.n - 1; j++) {
    for (let i = 0; i < m.n; i++) {
      if (!m.north[j][i]) continue;
      const from = i;
      while (i + 1 < m.n && m.north[j][i + 1]) i++;
      obstacles.push({ kind: "wall", x1: from * c, y1: (j + 1) * c, x2: (i + 1) * c, y2: (j + 1) * c });
    }
  }
  // Walls along y (between columns i and i + 1).
  for (let i = 0; i < m.n - 1; i++) {
    for (let j = 0; j < m.n; j++) {
      if (!m.east[j][i]) continue;
      const from = j;
      while (j + 1 < m.n && m.east[j + 1][i]) j++;
      obstacles.push({ kind: "wall", x1: (i + 1) * c, y1: from * c, x2: (i + 1) * c, y2: (j + 1) * c });
    }
  }
  const [sx, sy] = cellCentre(...m.start);
  return makeWorld({
    name: `maze ${m.n}x${m.n} seed ${m.seed}${m.loops ? " with loops" : ""}`,
    boundary: boxSegs(0, 0, m.n * c, m.n * c),
    obstacles,
    start: [sx, sy, (mazeHeading(m) * Math.PI) / 2],
    goal: cellCentre(...m.goal),
  });
}

// ---------- the simple terrains ----------

const box = (x0: number, y0: number, x1: number, y1: number): Obstacle => ({ kind: "box", x0, y0, x1, y1 });
const post = (x: number, y: number, r = 0.3): Obstacle => ({ kind: "post", x, y, r });

/** Two 7 ft x 8 ft rooms side by side, joined by a 2 ft door. */
export function twoRooms(): World {
  return makeWorld({
    name: "two rooms and a door",
    boundary: boxSegs(0, 0, 14, 8),
    obstacles: [box(6.9, 0, 7.1, 4.5), box(6.9, 6.5, 7.1, 8)],
    start: [2, 2, 0],
    goal: [12, 2],
  });
}

/**
 * A slalom: three posts on the straight line from the start to the goal,
 * each a little to one side of it. Layout 0 begins with a post to the left
 * of the line, odd layouts mirror it, and every layout moves the posts a
 * little (seeded), so a path learnt by heart does not fit the next one.
 */
export function slalom(layout = 0): World {
  const k = Math.max(0, Math.round(Number.isFinite(layout) ? layout : 0));
  const rnd = mulberry32(0x51a10 + k);
  const sign = k % 2 === 0 ? 1 : -1;
  const posts: Obstacle[] = [];
  for (let p = 0; p < 3; p++) {
    const x = 3.5 + 2.5 * p + (k === 0 ? 0 : Math.round((rnd() - 0.5) * 4) / 4);
    const y = 3 + sign * (p % 2 === 0 ? 1 : -1) * (k === 0 ? 0.25 : 0.25 * (1 + Math.floor(rnd() * 2)));
    posts.push(post(x, y));
  }
  return makeWorld({ name: `slalom, layout ${k}`, boundary: boxSegs(0, 0, 12, 6), obstacles: posts, start: [1, 3, 0], goal: [11, 3] });
}

/**
 * A U-shaped dead end between the start and the goal, open towards the
 * start: the trap for a robot that only ever steers at its goal. Even
 * layouts have the start on the left, odd layouts on the right (so a robot
 * that has just crossed layout 0 stands at the start of layout 1); the U
 * is longer on a different side in each.
 */
export function uTrap(layout = 0): World {
  const k = Math.max(0, Math.round(Number.isFinite(layout) ? layout : 0));
  const t = 0.2; // wall thickness
  const [lo, hi] = [[3, 6.5], [3.5, 7], [2.5, 7], [3, 7.5]][k % 4];
  const even = k % 2 === 0;
  // The closed side of the U and its two arms.
  const back = even ? 6.5 : 3.5;
  const arm0 = even ? 4.5 : 3.5;
  const arm1 = even ? 6.5 : 5.5;
  const obstacles = [box(back - t / 2, lo, back + t / 2, hi), box(arm0, lo - t / 2, arm1, lo + t / 2), box(arm0, hi - t / 2, arm1, hi + t / 2)];
  const left: [number, number] = [1.5, 5];
  const right: [number, number] = [8.5, 5];
  return makeWorld({
    name: `U-shaped dead end, layout ${k}`,
    boundary: boxSegs(0, 0, 10, 10),
    obstacles,
    start: even ? [left[0], left[1], 0] : [right[0], right[1], Math.PI],
    goal: even ? right : left,
  });
}

/** A wall across the room with a gap of 1.2 ft: half a foot more than the robot is wide. */
export function narrowGap(): World {
  return makeWorld({
    name: "narrow gap",
    boundary: boxSegs(0, 0, 10, 10),
    obstacles: [box(4.9, 0, 5.1, 4.4), box(4.9, 5.6, 5.1, 10)],
    start: [1.5, 3, 0],
    goal: [8.5, 3],
  });
}

/** Slope and intercept of the slanted wall: the line y = SLANT_M * x + SLANT_C. */
export const SLANT_M = 0.5;
export const SLANT_C = -2;

/**
 * One long, straight wall that is not parallel to an axis: the line
 * y = 0.5 x - 2, and nothing else. A program that fits a line to it finds a
 * slope that is not 0, so a slope and the angle of a line (atan of the
 * slope, 0.4636 rad here) are different numbers. Like LIDAR room 2 it is
 * open on the other three sides: there is no goal to drive to.
 */
export function slantedWall(): World {
  const x0 = -100;
  const x1 = 100;
  return makeWorld({
    name: "slanted wall",
    boundary: [[x0, SLANT_M * x0 + SLANT_C, x1, SLANT_M * x1 + SLANT_C]],
    start: [0, 0, 0],
    bounds: [-4, -4, 16, 6],
  });
}

// ---------- choosing a world by numbers ----------

/** Values of the simulator input WORLD_KIND. 0 leaves the choice to LIDAR_ROOM. */
export const KIND_ROOM = 0;
export const KIND_TWO_ROOMS = 1;
export const KIND_SLALOM = 2;
export const KIND_U_TRAP = 3;
export const KIND_GAP = 4;
export const KIND_MAZE = 5;
export const KIND_SLANT = 6;

export interface WorldSpec {
  kind: number;
  /** LIDAR_ROOM, used when kind is 0. */
  room?: number;
  /** Maze: the seed. Slalom and U: the layout number. */
  seed?: number;
  /** Maze: cells per side. */
  size?: number;
  /** Maze: take away extra walls. */
  loops?: boolean;
}

/** The terrain for kinds 1 and up (kind 0 is a room of lidar.ts), or undefined for an unknown kind. */
export function terrain(s: WorldSpec): World | undefined {
  switch (Math.round(s.kind)) {
    case KIND_TWO_ROOMS:
      return twoRooms();
    case KIND_SLALOM:
      return slalom(s.seed ?? 0);
    case KIND_U_TRAP:
      return uTrap(s.seed ?? 0);
    case KIND_GAP:
      return narrowGap();
    case KIND_MAZE:
      return mazeWorld(makeMaze(s.size ?? 4, s.seed ?? 1, !!s.loops));
    case KIND_SLANT:
      return slantedWall();
    default:
      return undefined;
  }
}

/** The worlds offered in the playground and the sandbox, in menu order. */
export const TERRAINS: { id: string; label: string; spec: WorldSpec }[] = [
  { id: "room-0", label: "Empty room", spec: { kind: KIND_ROOM, room: 0 } },
  { id: "room-3", label: "Room with a block", spec: { kind: KIND_ROOM, room: 3 } },
  { id: "room-1", label: "Corridor", spec: { kind: KIND_ROOM, room: 1 } },
  { id: "room-4", label: "Room with a doorway", spec: { kind: KIND_ROOM, room: 4 } },
  { id: "two-rooms", label: "Two rooms and a door", spec: { kind: KIND_TWO_ROOMS } },
  { id: "slalom", label: "Slalom of posts", spec: { kind: KIND_SLALOM, seed: 0 } },
  { id: "u-trap", label: "U-shaped dead end", spec: { kind: KIND_U_TRAP, seed: 0 } },
  { id: "gap", label: "Narrow gap", spec: { kind: KIND_GAP } },
  { id: "maze", label: "Random maze", spec: { kind: KIND_MAZE, size: 5, seed: 1234 } },
  { id: "slant", label: "Slanted wall", spec: { kind: KIND_SLANT } },
];

// ---------- objects placed by hand ----------

/** Most objects a world takes on top of its own, so ray casting stays cheap. */
export const MAX_OBJECTS = 20;
/** Placed objects sit on this grid, ft. */
export const SNAP_FT = 0.25;
export const snap = (v: number): number => Math.round(v / SNAP_FT) * SNAP_FT;

/** A placed object, snapped to the grid and kept to a sensible size. */
export function tidyObject(o: Obstacle): Obstacle {
  if (o.kind === "post") return { kind: "post", x: snap(o.x), y: snap(o.y), r: Math.max(0.125, Math.min(1, Math.round(o.r / 0.125) * 0.125)) };
  if (o.kind === "wall") return { kind: "wall", x1: snap(o.x1), y1: snap(o.y1), x2: snap(o.x2), y2: snap(o.y2) };
  const x0 = snap(Math.min(o.x0, o.x1));
  const y0 = snap(Math.min(o.y0, o.y1));
  return { kind: "box", x0, y0, x1: Math.max(x0 + SNAP_FT, snap(Math.max(o.x0, o.x1))), y1: Math.max(y0 + SNAP_FT, snap(Math.max(o.y0, o.y1))) };
}

/** Would this object touch a disc of radius r at (x, y)? Used to keep objects off the robot. */
export function objectTouches(o: Obstacle, x: number, y: number, r: number): boolean {
  if (o.kind === "post") return Math.hypot(x - o.x, y - o.y) < r + o.r;
  if (o.kind === "wall") return distToSeg([o.x1, o.y1, o.x2, o.y2], x, y) < r;
  if (x > o.x0 && x < o.x1 && y > o.y0 && y < o.y1) return true;
  return clearance({ walls: boxSegs(o.x0, o.y0, o.x1, o.y1) }, x, y) < r;
}
