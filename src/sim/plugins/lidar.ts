// Hokuyo URG-04LX scanning laser range finder (the course's "LADAR") on
// SCIC, and a small 2-D world for it to look at.
//
// Chip side: TRM chapter 19 "Serial Communications Interface (SCI)". The
// sensor is wired to SCIC (GPIO139 RX, GPIO56 TX, mux 6, set up by
// init_serialSCIC) and talks 8N1.
//
// Sensor side (lectures 14 and 16, SCIP 1.x protocol): 1024 steps per turn
// (360 / 1024 = 0.3515625 degrees), step 384 looks straight ahead, usable
// steps 44 to 725 (240 degrees), 20 to 4095 mm. The command
//   G<start:3 digits><end:3 digits><cluster:2 digits> LF
// is answered with
//   echo of the command, LF          (10 characters for G04472503)
//   status '0', LF                   (2 characters)
//   data lines of up to 64 characters, each followed by LF
//   one more LF                      (so the reply ends with two LFs)
// Each distance is 12 bits sent as two characters of 6 bits, high part
// first, each with 0x30 added. That is exactly what the course's parser,
// RXCINT_recv_ready in F28379dSerial.c (FinalProjectwithCANAprilStarter),
// accepts: it counts 12 characters from the 'G', requires the 11th to be
// '0', pairs the data characters, skips single LFs and ends on two LFs in a
// row. For G04472503 the reply is 12 + 456 + 8 + 1 = 477 characters, the
// size of the debug buffer in that file. Only the G reply is verified
// against course code; the S (baud rate) and L (laser) replies follow the
// same echo / status / empty line pattern.
//
// Readings below 20 are error codes, not distances. This model reports 0
// when nothing is within 4095 mm and 6 when the surface is closer than
// 20 mm (the two codes the course parser replaces with LADAR_MAX_READING).
//
// The world: the robot stands in a room made of wall segments (feet).
// Signal-bus inputs, set by test stimuli:
//   LIDAR_ROOM        0 box, 1 corridor, 2 wall on the right,
//                     3 box with an obstacle, 4 box with a doorway
//   WORLD_KIND        0 (default): the room LIDAR_ROOM names. Otherwise a
//                     terrain of src/sim/world/terrain.ts: 1 two rooms and
//                     a door, 2 slalom of posts, 3 U-shaped dead end,
//                     4 narrow gap, 5 random maze
//   WORLD_SEED        maze: the seed; slalom and U: the layout number
//   WORLD_SIZE        maze: cells per side, 3 to 8 (2 ft cells; default 4)
//   WORLD_LOOPS       maze: 1 takes away extra walls (more than one way)
//                     A world is an outer boundary plus obstacles: boxes,
//                     round posts, thin walls. worldOf(board) is the one in
//                     use; rooms 0 to 4 are unchanged.
//   LIDAR_X_FT, LIDAR_Y_FT, LIDAR_THETA_RAD   pose of the robot
//   LIDAR_OFFSET_FT   how far ahead of the robot's centre the sensor sits
//                     (default 0; the course robot has 3.5 inches)
//   LIDAR_BAUD        baud rate of the sensor at power-up (default 115200,
//                     as after the course's S command; a real one starts
//                     at 19200)
//   LIDAR_DROP_CHAR   n > 0: the n-th character of the next reply is lost
//                     on the wire (once), to test a parser
// Outputs: LIDAR_SCANS (replies sent), LIDAR_FRONT_FT (straight ahead).
//
// Natives for levels that do not need the serial parser: tb_lidar_mm,
// tb_lidar_ft, tb_pose_x, tb_pose_y, tb_pose_theta.

import type { Board } from "../board";
import { RuntimeError } from "../cc/compile";
import type { SimPlugin } from "../plugin";
import { MAX_OBJECTS, boxSegs, makeWorld, terrain, tidyObject, withObstacles, type Obstacle, type Post, type Seg, type World, type WorldSpec } from "../world/terrain";

export type { Obstacle, Post, Seg, World, WorldSpec };

/** Angle between two steps of the scanner: 360 / 1024 degrees. */
export const STEP_DEG = 360 / 1024;
/** Step that looks straight ahead. */
export const FRONT_STEP = 384;
/** The course's command: steps 44 to 725, groups of 3. */
export const G_START = 44;
export const G_END = 725;
export const G_CLUSTER = 3;
export const G_COMMAND = "G04472503\n";
/** Points in the reply to the course's command. */
export const LIDAR_POINTS = 228;
export const MIN_MM = 20;
export const MAX_MM = 4095;
/** Error codes of this model. */
export const ERR_NOTHING = 0;
export const ERR_TOO_CLOSE = 6;
/** What the course code stores instead of an error code (F28379dSerial.h). */
export const LADAR_MAX_READING = 5700;
/** Feet per millimetre, the constant in the course code. */
export const FT_PER_MM = 0.00328084;
const MM_PER_FT = 304.8;
const SCIC = 2;

/** What castRay needs of a world: straight walls and, optionally, round posts. */
export interface Room {
  name: string;
  /** Wall segments [x1, y1, x2, y2] in feet. */
  walls: Seg[];
  /** Round posts (none in the rooms 0 to 4). */
  posts?: Post[];
  /** Pose when the stimuli set none: [x, y, theta]. */
  start: [number, number, number];
}

const box = boxSegs;

/** The rooms LIDAR_ROOM chooses. Their walls, and the order of the walls, never change: levels depend on the exact scans. */
export const ROOMS: World[] = [
  // 0: an empty 10 ft x 10 ft box.
  makeWorld({ name: "empty box", boundary: box(0, 0, 10, 10), start: [5, 5, 0] }),
  // 1: a 3 ft wide corridor along +x, closed at x = -2 and x = 30.
  makeWorld({ name: "corridor", boundary: box(-2, -1.5, 30, 1.5), start: [0, 0, 0] }),
  // 2: one long wall 2 ft to the right of the x axis, nothing else.
  makeWorld({ name: "wall on the right", boundary: [[-100, -2, 100, -2]], start: [0, 0, 0], bounds: [-4, -2, 16, 6] }),
  // 3: the box with a 1 ft x 1 ft obstacle.
  makeWorld({ name: "box with an obstacle", boundary: box(0, 0, 10, 10), obstacles: [{ kind: "box", x0: 7, y0: 6, x1: 8, y1: 7 }], start: [5, 5, 0] }),
  // 4: the box with a doorway in the wall x = 10, from y = 6 to y = 8.5.
  makeWorld({
    name: "box with a doorway",
    boundary: [
      [0, 0, 10, 0],
      [10, 0, 10, 6],
      [10, 8.5, 10, 10],
      [10, 10, 0, 10],
      [0, 10, 0, 0],
    ],
    start: [5, 5, 0],
    bounds: [0, 0, 13, 10],
  }),
];

/** Angle of a step relative to straight ahead, radians (positive to the left). */
export const stepAngle = (step: number): number => ((step - FRONT_STEP) * STEP_DEG * Math.PI) / 180;

/** Angle of point i of the course's scan in degrees: (3 i + 44) * 0.3515625 - 135. */
export const pointDeg = (i: number): number => (G_CLUSTER * i + G_START) * STEP_DEG - 135;

/** Distance in feet from (x, y) along `angle` to the nearest wall, or Infinity. */
export function castRay(room: Room, x: number, y: number, angle: number): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best = Infinity;
  for (const [x1, y1, x2, y2] of room.walls) {
    const ex = x2 - x1;
    const ey = y2 - y1;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue; // parallel
    const t = ((x1 - x) * ey - (y1 - y) * ex) / den; // along the ray
    const u = ((x1 - x) * dy - (y1 - y) * dx) / den; // along the wall, 0..1
    if (t >= 0 && u >= 0 && u <= 1 && t < best) best = t;
  }
  if (room.posts) {
    // A post is a circle: the nearer root of |p + t d - c|^2 = r^2.
    for (const p of room.posts) {
      const cx = p.x - x;
      const cy = p.y - y;
      const along = cx * dx + cy * dy;
      const disc = along * along - (cx * cx + cy * cy - p.r * p.r);
      if (disc < 0) continue;
      const root = Math.sqrt(disc);
      // From inside a post the ray leaves through the far side.
      const t = along - root >= 0 ? along - root : along + root;
      if (t >= 0 && t < best) best = t;
    }
  }
  return best;
}

/** What the sensor reports for a true distance in feet: millimetres, or an error code. */
export function reading(feet: number): number {
  const mm = Math.round(feet * MM_PER_FT);
  if (!(mm <= MAX_MM)) return ERR_NOTHING;
  if (mm < MIN_MM) return ERR_TOO_CLOSE;
  return mm;
}

export interface Pose {
  room: number;
  x: number;
  y: number;
  theta: number;
  /** Sensor position ahead of the robot's centre, feet. */
  offset?: number;
  /** The world to look at instead of ROOMS[room] (a terrain, or a room with placed objects). */
  world?: Room;
}

/**
 * One scan: the reading of every `cluster`-th step from `start` to `end`.
 * A real sensor reports the smallest reading of each group of `cluster`
 * steps; this model measures the first step of each group, the direction
 * the course's angle formula assigns to the point.
 */
export function scan(p: Pose, start = G_START, end = G_END, cluster = G_CLUSTER): number[] {
  const room = p.world ?? ROOMS[p.room] ?? ROOMS[0];
  const off = p.offset ?? 0;
  const sx = p.x + off * Math.cos(p.theta);
  const sy = p.y + off * Math.sin(p.theta);
  const out: number[] = [];
  for (let step = start; step <= end; step += cluster) out.push(reading(castRay(room, sx, sy, p.theta + stepAngle(step))));
  return out;
}

/** Two characters for one reading: high 6 bits, low 6 bits, each plus 0x30. */
export const encode = (mm: number): string => String.fromCharCode(((mm >> 6) & 0x3f) + 0x30, (mm & 0x3f) + 0x30);

/** The data lines of a reply (without line feeds): 64 characters each, the last one shorter. */
export function dataLines(mm: number[]): string[] {
  const all = mm.map(encode).join("");
  const lines: string[] = [];
  for (let i = 0; i < all.length; i += 64) lines.push(all.slice(i, i + 64));
  return lines;
}

/** The complete reply to a G command (given with its line feed). */
export function gReply(command: string, mm: number[]): string {
  return `${command}0\n${dataLines(mm).map((l) => `${l}\n`).join("")}\n`;
}

export interface LidarState {
  /** Current baud rate of the sensor (undefined: still at its power-up rate). */
  baud?: number;
  /** Characters of the command being received. */
  cmd: string;
  /** The sensor's transmitter is busy until this time, ns. */
  busyUntil: number;
  scans: number;
  /** Readings the program took with tb_lidar_mm / tb_lidar_ft. */
  reads: number;
  /** Objects placed by hand in the playground (never by a test). */
  objects: Obstacle[];
  /** The world the inputs describe, kept until they change. */
  world?: World;
  worldKey?: string;
}
type State = LidarState;

const WORLD_INPUTS = ["LIDAR_ROOM", "WORLD_KIND", "WORLD_SEED", "WORLD_SIZE", "WORLD_LOOPS"];

/** What the world inputs of a board say, without marking any of them as used. */
export function worldSpec(b: Board): WorldSpec {
  const v = (name: string) => {
    const x = b.inputs.get(name);
    return x !== undefined && Number.isFinite(x) ? x : undefined;
  };
  return { kind: Math.round(v("WORLD_KIND") ?? 0), room: Math.round(v("LIDAR_ROOM") ?? 0), seed: v("WORLD_SEED"), size: v("WORLD_SIZE"), loops: (v("WORLD_LOOPS") ?? 0) > 0 };
}

/**
 * The world this board's robot and LIDAR are in: the room LIDAR_ROOM names
 * or, when WORLD_KIND is not 0, a terrain of src/sim/world/terrain.ts, plus
 * the objects placed in the playground. Built once and kept until an input
 * or the objects change.
 */
export function worldOf(b: Board): World {
  const st = b.plugins.get("lidar") as State | undefined;
  const spec = worldSpec(b);
  const key = `${spec.kind},${spec.room},${spec.seed},${spec.size},${spec.loops}`;
  if (st && st.world && st.worldKey === key) return st.world;
  const base = terrain(spec) ?? ROOMS[spec.room ?? 0] ?? ROOMS[0];
  const world = st ? withObstacles(base, st.objects) : base;
  if (st) {
    st.world = world;
    st.worldKey = key;
  }
  return world;
}

/** The objects placed by hand in this board's world. */
export const worldObjects = (b: Board): Obstacle[] => (b.plugins.get("lidar") as State | undefined)?.objects ?? [];

/**
 * Replaces the objects placed by hand (at most MAX_OBJECTS, snapped to the
 * grid). For the playground of a live run: a test never calls this, so the
 * world of every level's test is the one its stimuli describe.
 */
export function setWorldObjects(b: Board, objects: Obstacle[]): void {
  const st = b.plugins.get("lidar") as State | undefined;
  if (!st) return;
  st.objects = objects.slice(0, MAX_OBJECTS).map(tidyObject);
  st.world = undefined;
  // Tell everything that watches the room that it has changed.
  b.setInput("LIDAR_ROOM", b.inputs.get("LIDAR_ROOM") ?? 0);
}

const poseOf = (b: Board): Pose => {
  const room = Math.round(b.input("LIDAR_ROOM", 0));
  const world = worldOf(b);
  const start = world.start;
  return {
    room,
    world,
    x: b.input("LIDAR_X_FT", start[0]),
    y: b.input("LIDAR_Y_FT", start[1]),
    theta: b.input("LIDAR_THETA_RAD", start[2]),
    offset: b.input("LIDAR_OFFSET_FT", 0),
  };
};

const feet = (mm: number): number => (mm < MIN_MM ? LADAR_MAX_READING : mm) * FT_PER_MM;

export const plugin: SimPlugin = {
  name: "lidar",
  prelude: `
#define LADAR_MAX_READING 5700
/* Test-bench access to the simulated LIDAR, for exercises without the serial parser. */
int tb_lidar_mm(int index);
float tb_lidar_ft(int index);
float tb_pose_x(void);
float tb_pose_y(void);
float tb_pose_theta(void);
`,
  install(b) {
    const st: State = { cmd: "", busyUntil: 0, scans: 0, reads: 0, objects: [] };
    b.plugins.set("lidar", st);
    const sensorBaud = () => st.baud ?? b.input("LIDAR_BAUD", 115200);

    const publishFront = (t = b.now) => b.publish("LIDAR_FRONT_FT", feet(scan(poseOf(b), FRONT_STEP - 1, FRONT_STEP - 1, 1)[0]), t);
    for (const name of [...WORLD_INPUTS, "LIDAR_X_FT", "LIDAR_Y_FT", "LIDAR_THETA_RAD", "LIDAR_OFFSET_FT"]) b.onInput(name, (_v, t) => publishFront(t));

    /** Sends text to the chip, one character after another at the sensor's baud rate. */
    const reply = (text: string, t: number) => {
      const charNs = (10 / sensorBaud()) * 1e9;
      let at = Math.max(t, st.busyUntil);
      const drop = Math.round(b.input("LIDAR_DROP_CHAR", 0));
      if (drop > 0) b.setInput("LIDAR_DROP_CHAR", 0, t);
      for (let i = 0; i < text.length; i++) {
        at += charNs;
        if (i + 1 !== drop) b.sci.receive(SCIC, text.charCodeAt(i), at);
      }
      st.busyUntil = at;
    };

    const execute = (cmd: string, t: number) => {
      const line = `${cmd}\n`;
      const g = /^G(\d{3})(\d{3})(\d{2})$/.exec(cmd);
      if (g) {
        const start = +g[1];
        const end = +g[2];
        const cluster = +g[3];
        if (start > end || end > 768 || cluster < 1) {
          b.warn(b.line, "lidar-command", `The LIDAR refused "${cmd}": the start step must not be after the end step, the end step is at most 768 and the cluster count at least 1. The course's command is G04472503 (steps 44 to 725 in groups of 3).`);
          reply(`${line}1\n\n`, t);
          return;
        }
        st.scans++;
        b.publish("LIDAR_SCANS", st.scans, t);
        publishFront(t);
        reply(gReply(line, scan(poseOf(b), start, end, cluster)), t);
        return;
      }
      const s = /^S(\d{6})/.exec(cmd);
      if (s) {
        const baud = +s[1];
        const ok = [19200, 57600, 115200].includes(baud);
        reply(`${line}${ok ? "0" : "1"}\n\n`, t);
        if (ok) st.baud = baud;
        return;
      }
      if (/^L[01]$/.test(cmd)) {
        reply(`${line}0\n\n`, t);
        return;
      }
      b.warn(b.line, "lidar-command", `The LIDAR does not know the command "${cmd.slice(0, 20)}". A distance request looks like "G04472503" followed by a line feed.`);
    };

    b.sci.onTx.push((port, ch, t) => {
      if (port !== SCIC) return;
      const chip = b.sci.baud(SCIC);
      if (Math.abs(chip - sensorBaud()) > 0.03 * sensorBaud()) {
        b.warn(b.line, "lidar-baud", `SCIC sends at ${Math.round(chip)} baud but the LIDAR listens at ${sensorBaud()} baud, so it cannot read the command. Use init_serialSCIC(&SerialC, ${sensorBaud()});`);
        return;
      }
      b.mem.writes++;
      if (ch === 10 || ch === 13) {
        if (st.cmd) execute(st.cmd, t);
        st.cmd = "";
      } else if (ch !== 0) {
        // The course sends its command with the terminating 0 of the string: ignored.
        st.cmd = (st.cmd + String.fromCharCode(ch)).slice(-32);
      }
    });

    const c = b.compiler;
    const point = (index: number): number => {
      if (index < 0 || index >= LIDAR_POINTS || index !== Math.floor(index))
        throw new RuntimeError(b.line, `The LIDAR scan has points 0 to ${LIDAR_POINTS - 1}; point ${index} does not exist. Check the loop limits.`);
      const step = G_START + G_CLUSTER * index;
      st.reads++;
      return scan(poseOf(b), step, step, 1)[0];
    };
    c.defineNative("tb_lidar_mm", (a) => point(a[0]));
    c.defineNative("tb_lidar_ft", (a) => Math.fround(feet(point(a[0]))));
    c.defineNative("tb_pose_x", () => Math.fround(poseOf(b).x));
    c.defineNative("tb_pose_y", () => Math.fround(poseOf(b).y));
    c.defineNative("tb_pose_theta", () => Math.fround(poseOf(b).theta));
  },
  parts: {
    robot: [
      { kind: "meter", id: "LIDAR_FRONT", label: "LIDAR straight ahead", output: "LIDAR_FRONT_FT", unit: "ft", digits: 2 },
      { kind: "meter", id: "LIDAR_SCANS", label: "LIDAR scans sent", output: "LIDAR_SCANS", unit: "", digits: 0 },
    ],
  },
};
