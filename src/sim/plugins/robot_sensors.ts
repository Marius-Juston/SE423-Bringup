// The robot's range sensors and its analog gyro, tied to the robot world
// (robot_world.ts): what each one reports for where the robot stands and how
// it turns. Nothing here is a chip feature. The chip side of each sensor is
// in the plugin of its bus: can.ts sends the distance frames, spi_devices.ts
// is the DAN28027 that samples the Sharp sensors, adc.ts converts the gyro's
// voltages.
//
// While ROBOT_WORLD is 0 this plugin does nothing: the knobs and stimuli
// CAN_DIST1_MM, CAN_DIST2_MM, DAN_ADC1 and DAN_ADC2 are all there is, and
// ADCINC2..5 read 0 V unless set, as before. While ROBOT_WORLD is 1 the world
// drives a sensor until something else sets its input: a stimulus or a knob
// always wins, from the moment it is set to the end of the run. (The bench
// puts every knob at its initial position at time 0. That one set, the first
// for the input, at time 0, with exactly the knob's initial value, is not
// taken for a stimulus.)
//
// 1. SEN-36005 time-of-flight sensors on CAN-B, device IDs 1 and 2.
//    Documents: DS "SEN-36005 data sheet" R01 (2023), UG "SEN-36005 CAN
//    User's Guide" R01, VL "VL53L1X data sheet" (ST DocID031281), the ranging
//    chip inside.
//    - DS p1: full field of view 27 degrees. The model casts TOF_RAYS rays
//      across it and reports the nearest surface, rounded to a millimetre.
//    - UG "Ranging configuration", byte 0, and DS p2: short mode (the
//      default) ranges to 1.3 m, medium to about 2.9 m, long to 4 m in the
//      dark. Modelled as hard limits of 1300, 2900 and 4000 mm.
//    - UG "Measured distance", byte 2: ranging status, 0 = valid, 2 = "return
//      signal value is below the internal defined threshold". With nothing
//      inside the mode's range the model sends status 2. The guide does not
//      say what the distance bytes hold then: ASSUMED 0.
//    - VL 3.3: below 4 cm the sensor still detects a target but is not
//      accurate. Not modelled: the true distance is reported down to 0.
//    Mounting, ASSUMED (the course material at hand does not give it):
//    sensor 1 on the robot's nose looking straight ahead, sensor 2 on its
//    right side looking to the right, both on the rim of the robot's disc.
//    Outputs CAN_DIST1_MM and CAN_DIST2_MM: what the sensor last reported
//    (this also takes the knob of that name off the bench).
//
// 2. Sharp GP2Y0A41SK0F infrared distance sensors (the model lecture 14
//    shows), read by the DAN28027's analog inputs: sensor 1 on its ADCINA0
//    (the first value it returns, input DAN_ADC1), sensor 2 on ADCINA2
//    (DAN_ADC2). ASSUMED wiring: the robot board's schematic (RobotsGreenBoard)
//    brings those two F28027 pins to header SV16 and the course material at
//    hand does not say what is plugged in there.
//    Document: SH "GP2Y0A41SK0F" data sheet (Sharp, sheet OP13008EN).
//    - SH p4 "Example of output distance characteristics", white paper: the
//      output voltage against distance, read off the curve at its marked
//      points (SHARP_CURVE) and joined by straight lines. The voltage peaks
//      near 3 cm; nearer than that it falls again, so one voltage below the
//      measuring range of 4 to 30 cm (SH p3) stands for two distances.
//    - The curve ends at 40 cm with 0.31 V. Beyond that, and with nothing in
//      view, the model holds 0.31 V.
//    - SH p3 timing chart: one measurement every 16.5 ms. The output is
//      modelled as held between measurements.
//    Mounting, ASSUMED: sensor 1 on the left side looking left, sensor 2 at
//    the back looking backward, on the rim of the disc. One ray along the
//    sensor's axis.
//    Outputs DAN_ADC1 and DAN_ADC2 (volts; this takes those knobs off the
//    bench), and the inputs of the same names are set to the same value, so
//    the DAN28027 reads it.
//
// 3. LPR510AL analog gyro on ADCC (Lab 4; schematic RobotsGreenBoard, U15):
//    the course's "Z" on ADCINC5, "4Z" on ADCINC4, "X" on ADCINC2, "4X" on
//    ADCINC3.
//    Document: ST data sheet of the LPR510AL / LPY510AL family, Table 3 (the
//    LPY510AL sheet, Doc ID 15805, was the one at hand; the table is the
//    family's) and 3.1, 4.1.
//    - Zero-rate level 1.23 V, not ratiometric. Sensitivity 2.5 mV per deg/s
//      on the outputs that are not amplified (range +-400 deg/s) and 10 mV
//      per deg/s on the 4x outputs (+-100 deg/s).
//    - 3.1: the voltage rises for a counter-clockwise rotation about the
//      sensing axis.
//    Mounting, as the IMU's (+X to the nose, +Y left, +Z up): the Z outputs
//    feel the robot's turn rate, positive for a left turn; the X outputs feel
//    no rotation on a flat floor.
//    The voltage is a source on the four ADC inputs: it is worked out when
//    the ADC samples the pin, from the wheel speeds at that instant.
//    - A real part, only while the input LPR510_REAL is 1: a zero-rate error
//      per axis (Z +3 deg/s, X -2 deg/s: CHOSEN, the data sheet gives the
//      typical level only; Lab 4 has students measure theirs) and noise of
//      0.017 deg/s per root hertz (Table 3) over the 140 Hz bandwidth, 0.2
//      deg/s rms. The noise is a fixed function of the time and the channel,
//      so a run repeats exactly. The input LPR510_ZERO_Z_DPS replaces the Z
//      axis's zero-rate error.
//    Output LPR510_Z_DPS: the turn rate the gyro feels, for a meter.
//    Not modelled: the 140 Hz low-pass, the +-1 % nonlinearity, drift with
//    temperature. Past its range an output is held at the end of the
//    range (0.23 V or 2.23 V), as the owner asked; the data sheet does not
//    say what a real part does there.
//
// Not modelled for any of them: the colour and angle of the surface, ambient
// light, other robots, the time light takes. Walls, boxes and posts of the
// world (world/terrain.ts) are all the same to every sensor.

import type { Board } from "../board";
import type { SimPlugin } from "../plugin";
import { castRay, worldOf, type Room } from "./lidar";
import { WHEEL_BASE } from "./plant";
import { FT_PER_WHEEL_RAD, ROBOT_RADIUS_FT, type RobotWorld } from "./robot_world";

const MM_PER_FT = 304.8;
const CM_PER_FT = 30.48;

/** Where a sensor sits on the robot and where it looks, in the robot's own frame. */
export interface Mount {
  /** Feet ahead of the centre and feet to its left. */
  x: number;
  y: number;
  /** Direction of its axis, radians, counter-clockwise from the nose. */
  angle: number;
  /** For the bench and the arena. */
  where: string;
}

/** Assumed mounting of the two SEN-36005 sensors: [device ID 1, device ID 2]. */
export const TOF_MOUNTS: Mount[] = [
  { x: ROBOT_RADIUS_FT, y: 0, angle: 0, where: "front" },
  { x: 0, y: -ROBOT_RADIUS_FT, angle: -Math.PI / 2, where: "right" },
];
/** Assumed mounting of the two Sharp sensors: [DAN_ADC1, DAN_ADC2]. */
export const SHARP_MOUNTS: Mount[] = [
  { x: 0, y: ROBOT_RADIUS_FT, angle: Math.PI / 2, where: "left" },
  { x: -ROBOT_RADIUS_FT, y: 0, angle: Math.PI, where: "rear" },
];

/** SEN-36005: full field of view, degrees (data sheet p1). */
export const TOF_FOV_DEG = 27;
/** Rays cast across the field of view. */
export const TOF_RAYS = 9;
/** Furthest valid distance by ranging mode 0 short, 1 medium, 2 long, mm (user's guide, data sheet p2). */
export const TOF_MAX_MM = [1300, 2900, 4000];
/** Ranging status values of the measured distance frame (user's guide). */
export const TOF_VALID = 0;
export const TOF_NO_SIGNAL = 2;

/** GP2Y0A41SK0F, white paper: [distance cm, output V], read off the data sheet's curve (p4). */
export const SHARP_CURVE: [number, number][] = [
  [0, 0.03], [0.5, 1.37], [1, 1.85], [2, 2.22], [2.5, 2.73], [3, 3.04], [3.5, 3.0], [4, 2.72], [5, 2.34], [6, 2.02], [7, 1.77], [8, 1.56], [9, 1.4],
  [10, 1.27], [12, 1.06], [14, 0.93], [16, 0.81], [18, 0.74], [20, 0.66], [25, 0.53], [30, 0.43], [35, 0.37], [40, 0.31],
];
/** One measurement of the Sharp sensor, ns (data sheet p3: 16.5 ms). */
export const SHARP_PERIOD_NS = 16_500_000;

/** LPR510AL (data sheet Table 3): zero-rate level, V; sensitivities, V per deg/s. */
export const LPR_ZERO_V = 1.23;
export const LPR_SENS = 0.0025;
export const LPR_SENS_4X = 0.01;
/** Full scale of either kind of output, V either side of the zero-rate level (400 * 2.5 mV = 100 * 10 mV). */
const LPR_SWING_V = 1.0;
/** Table 3: 0.017 deg/s per root hertz over 140 Hz. */
const LPR_NOISE_DPS = 0.017 * Math.sqrt(140);
/** A real part's zero-rate error, deg/s: [Z, X]. */
const LPR_ZERO_ERR_DPS = [3, -2];
/** The four outputs: ADC input, sensitivity, axis (0 = Z, the robot's turn; 1 = X, no rotation). */
export const LPR_OUTPUTS: { input: string; sens: number; axis: 0 | 1 }[] = [
  { input: "ADCINC5", sens: LPR_SENS, axis: 0 },
  { input: "ADCINC4", sens: LPR_SENS_4X, axis: 0 },
  { input: "ADCINC2", sens: LPR_SENS, axis: 1 },
  { input: "ADCINC3", sens: LPR_SENS_4X, axis: 1 },
];

/** Output voltage of the Sharp sensor for a surface `cm` away along its axis (Infinity: nothing there). */
export function sharpVolts(cm: number): number {
  const c = SHARP_CURVE;
  if (!(cm < c[c.length - 1][0])) return c[c.length - 1][1];
  if (cm <= 0) return c[0][1];
  let i = 1;
  while (c[i][0] < cm) i++;
  const [x0, v0] = c[i - 1];
  const [x1, v1] = c[i];
  return +(v0 + ((v1 - v0) * (cm - x0)) / (x1 - x0)).toFixed(4);
}

/** What a SEN-36005 puts in its distance frame for the nearest surface `feet` away, in ranging mode 0, 1 or 2. */
export function tofReading(feet: number, mode = 0): { mm: number; status: number } {
  const mm = Math.round(feet * MM_PER_FT);
  if (!(mm <= (TOF_MAX_MM[mode] ?? TOF_MAX_MM[0]))) return { mm: 0, status: TOF_NO_SIGNAL };
  return { mm, status: TOF_VALID };
}

/**
 * Voltage on one output of the gyro for a turn rate in deg/s. The output
 * stops at the ends of its range: 1 V either side of the zero-rate level,
 * which is +-400 deg/s without and +-100 deg/s with the amplifier.
 */
export function lprVolts(dps: number, sens: number, zeroErrDps = 0): number {
  return LPR_ZERO_V + Math.max(-LPR_SWING_V, Math.min(LPR_SWING_V, sens * (dps + zeroErrDps)));
}

export interface Pose2 {
  x: number;
  y: number;
  th: number;
}

/** Where a mounted sensor is in the world and where it looks. */
export function mounted(p: Pose2, m: Mount): { x: number; y: number; angle: number } {
  const c = Math.cos(p.th);
  const s = Math.sin(p.th);
  return { x: p.x + m.x * c - m.y * s, y: p.y + m.x * s + m.y * c, angle: p.th + m.angle };
}

/** Feet to the nearest surface inside a cone of `fovDeg` degrees about the sensor's axis (one ray when 0). */
export function coneDistance(world: Room, p: Pose2, m: Mount, fovDeg = 0, rays = 1): number {
  const o = mounted(p, m);
  // A robot that has run into a wall stands a hair inside it: the sensor on that side is at the wall, not past it.
  if (castRay(world, p.x, p.y, Math.atan2(o.y - p.y, o.x - p.x)) <= Math.hypot(m.x, m.y)) return 0;
  if (!(fovDeg > 0) || rays < 2) return castRay(world, o.x, o.y, o.angle);
  const half = (fovDeg * Math.PI) / 360;
  let best = Infinity;
  for (let i = 0; i < rays; i++) best = Math.min(best, castRay(world, o.x, o.y, o.angle - half + (2 * half * i) / (rays - 1)));
  return best;
}

/** What the plugin keeps for the bench: b.plugins.get("robot-sensors"). */
export interface RobotSensors {
  /** The world drives at least one sensor now. */
  readonly on: boolean;
  /** Last report of each SEN-36005 the world drives (undefined: knob or stimulus). */
  tof: ({ mm: number; status: number; mode: number } | undefined)[];
  /** Last measurement of each Sharp sensor the world drives. */
  sharp: ({ cm: number; volts: number } | undefined)[];
  /** The distance frame of sensor `id` (1 or 2) for a measurement made now, or undefined when the world does not drive it. */
  tofMeasure(id: number, mode: number): { mm: number; status: number } | undefined;
}

/** A standard normal number that depends only on the two arguments. */
function noiseAt(t: number, channel: number): number {
  const u = (k: number) => {
    let a = (Math.floor(t / 1000) ^ Math.imul(channel + k, 0x9e3779b1)) >>> 0;
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), a | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  return Math.sqrt(-2 * Math.log(1 - u(1))) * Math.cos(2 * Math.PI * u(2));
}

/** Knob positions the bench sets at time 0 (can.ts and spi_devices.ts `parts`). */
const KNOB_INITIAL: Record<string, number> = { CAN_DIST1_MM: 500, CAN_DIST2_MM: 1200, DAN_ADC1: 0, DAN_ADC2: 0 };

function install(b: Board): void {
  const world = () => (b.plugins.get("robot-world") as RobotWorld | undefined)?.on === true;
  const pose = (): Pose2 => {
    const start = worldOf(b).start;
    return { x: b.inputs.get("LIDAR_X_FT") ?? start[0], y: b.inputs.get("LIDAR_Y_FT") ?? start[1], th: b.inputs.get("LIDAR_THETA_RAD") ?? start[2] };
  };

  // ---- who drives an input: the world, or a knob or stimulus ----
  /** Inputs a stimulus or a knob has set: the world leaves them alone. */
  const taken = new Set<string>();
  const sets = new Map<string, number>();
  let writing = false;
  for (const name of Object.keys(KNOB_INITIAL))
    b.onInput(name, (v, t) => {
      if (writing) return;
      const n = (sets.get(name) ?? 0) + 1;
      sets.set(name, n);
      // The bench putting the knob at its initial position.
      if (n === 1 && t === 0 && v === KNOB_INITIAL[name]) return;
      taken.add(name);
    });
  /** Two entries in the history at once: the bench then takes the knob of that name away. */
  const shown = new Set<string>();
  const show = (name: string, v: number, t: number) => {
    if (!shown.has(name)) {
      shown.add(name);
      b.publish(name, v + 1e-4, Math.max(0, t - 1));
    }
    b.publish(name, v, t);
  };

  const state: RobotSensors = {
    get on() {
      return world() && Object.keys(KNOB_INITIAL).some((n) => !taken.has(n));
    },
    tof: [undefined, undefined],
    sharp: [undefined, undefined],
    tofMeasure(id, mode) {
      const name = `CAN_DIST${id}_MM`;
      const m = TOF_MOUNTS[id - 1];
      if (!m || !world() || taken.has(name)) {
        if (m) state.tof[id - 1] = undefined;
        return undefined;
      }
      const r = tofReading(coneDistance(worldOf(b), pose(), m, TOF_FOV_DEG, TOF_RAYS), mode);
      state.tof[id - 1] = { ...r, mode };
      show(name, r.mm, b.now);
      return r;
    },
  };
  b.plugins.set("robot-sensors", state);

  // ---- Sharp sensors: one measurement every 16.5 ms while the world is on ----
  let ticking = false;
  const sharpTick = (t: number) => {
    if (!world()) {
      ticking = false;
      state.sharp = [undefined, undefined];
      return;
    }
    const w = worldOf(b);
    const p = pose();
    SHARP_MOUNTS.forEach((m, i) => {
      const name = `DAN_ADC${i + 1}`;
      if (taken.has(name)) {
        state.sharp[i] = undefined;
        return;
      }
      const cm = coneDistance(w, p, m) * CM_PER_FT;
      const volts = sharpVolts(cm);
      state.sharp[i] = { cm, volts };
      if (b.inputs.get(name) !== volts) {
        writing = true;
        b.setInput(name, volts, t);
        writing = false;
      }
      show(name, volts, t);
    });
    b.at(t + SHARP_PERIOD_NS, sharpTick);
  };

  // ---- gyro ----
  const turnDps = (): number => {
    if (b.output("ROBOT_CRASHED") === 1) return 0;
    const vl = (b.inputs.get("LEFT_WHEEL_RADPS") ?? 0) * FT_PER_WHEEL_RAD;
    const vr = (b.inputs.get("RIGHT_WHEEL_RADPS") ?? 0) * FT_PER_WHEEL_RAD;
    return (((vr - vl) / WHEEL_BASE) * 180) / Math.PI;
  };
  LPR_OUTPUTS.forEach((o, ch) =>
    b.sources.set(o.input, (t) => {
      // Without the robot world nothing drives the pin, as before this model existed.
      if (!world()) return 0;
      const real = (b.inputs.get("LPR510_REAL") ?? 0) !== 0;
      const zero = real ? (o.axis === 0 ? (b.inputs.get("LPR510_ZERO_Z_DPS") ?? LPR_ZERO_ERR_DPS[0]) : LPR_ZERO_ERR_DPS[1]) : 0;
      const dps = (o.axis === 0 ? turnDps() : 0) + (real ? LPR_NOISE_DPS * noiseAt(t, ch) : 0);
      return lprVolts(dps, o.sens, zero);
    }),
  );

  // The robot world sets the pose every millisecond, the heading last: the pose is complete here.
  b.onInput("LIDAR_THETA_RAD", (_v, t) => {
    if (!world()) return;
    if (!ticking) {
      ticking = true;
      sharpTick(t);
    }
    b.publish("LPR510_Z_DPS", +turnDps().toFixed(2), t);
  });
}

export const plugin: SimPlugin = {
  name: "robot-sensors",
  install,
  parts: {
    robot: [
      { kind: "meter", id: "TOF1_MM", label: "CAN sensor 1 reports (front)", output: "CAN_DIST1_MM", unit: "mm", digits: 0 },
      { kind: "meter", id: "TOF2_MM", label: "CAN sensor 2 reports (right)", output: "CAN_DIST2_MM", unit: "mm", digits: 0 },
      { kind: "meter", id: "SHARP1_V", label: "Sharp sensor 1 output (left)", output: "DAN_ADC1", unit: "V", digits: 2 },
      { kind: "meter", id: "SHARP2_V", label: "Sharp sensor 2 output (rear)", output: "DAN_ADC2", unit: "V", digits: 2 },
      { kind: "meter", id: "LPR510_Z", label: "Turn rate at the LPR510 gyro", output: "LPR510_Z_DPS", unit: "deg/s", digits: 1 },
    ],
  },
};

/** One range sensor's beam as the arena draws it: world coordinates in feet. */
export interface Beam {
  kind: "tof" | "sharp";
  where: string;
  /** Where the sensor is. */
  x: number;
  y: number;
  /** Ends of the lines to draw: the axis for a Sharp sensor, the two edges of the cone for a CAN sensor. */
  ends: [number, number][];
  /** The sensor has something in range. */
  hit: boolean;
  /** What it reports, for the read-out. */
  text: string;
}

/**
 * The beams of the sensors the world drives, for a pose in a world. `st` is
 * the plugin's state (which sensors the world drives, the ranging modes);
 * `used` says whether the program reads the input of that name.
 */
export function beamsAt(world: Room, p: Pose2, st: RobotSensors, used: (input: string) => boolean): Beam[] {
  const out: Beam[] = [];
  TOF_MOUNTS.forEach((m, i) => {
    const s = st.tof[i];
    if (!s || !used(`CAN_DIST${i + 1}_MM`)) return;
    const r = tofReading(coneDistance(world, p, m, TOF_FOV_DEG, TOF_RAYS), s.mode);
    const o = mounted(p, m);
    const len = (r.status === TOF_VALID ? r.mm : TOF_MAX_MM[s.mode]) / MM_PER_FT;
    const half = (TOF_FOV_DEG * Math.PI) / 360;
    out.push({ kind: "tof", where: m.where, x: o.x, y: o.y, ends: [-half, half].map((a) => [o.x + len * Math.cos(o.angle + a), o.y + len * Math.sin(o.angle + a)]), hit: r.status === TOF_VALID, text: r.status === TOF_VALID ? `${r.mm} mm` : "nothing in range" });
  });
  SHARP_MOUNTS.forEach((m, i) => {
    if (!st.sharp[i] || !used(`DAN_ADC${i + 1}`)) return;
    const d = coneDistance(world, p, m);
    const o = mounted(p, m);
    const reach = SHARP_CURVE[SHARP_CURVE.length - 1][0] / CM_PER_FT;
    const len = Math.min(d, reach);
    out.push({ kind: "sharp", where: m.where, x: o.x, y: o.y, ends: [[o.x + len * Math.cos(o.angle), o.y + len * Math.sin(o.angle)]], hit: d < reach, text: `${sharpVolts(d * CM_PER_FT).toFixed(2)} V` });
  });
  return out;
}
