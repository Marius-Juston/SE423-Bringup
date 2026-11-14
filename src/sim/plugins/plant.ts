// Test bench robot for the control and localisation chapters. It is NOT a
// model of a chip peripheral (so no TRM section applies): it stands in for
// the motors, encoders, gyro and OptiTrack until the real PWM, eQEP and SPI
// models drive them. Every function is prefixed tb_ ("test bench") so
// nobody mistakes it for a TI or course function.
//
// Wheels (each one independently), u = effort saturated to +-10 as the
// course's setEPWM functions do (Lab 3), load = "TB_LOAD_LEFT/RIGHT":
//
//   TAU * dv/dt = -v + GAIN * (u - load - COULOMB * sign(v))
//
// with sign(v) replaced by sign(u - load) when the wheel is at rest, and a
// wheel at rest staying at rest while |u - load| <= COULOMB (dead zone).
// Between calls the effort is constant, so the speed and the distance are
// advanced with the exact solution of this first-order equation, split at
// the instant a wheel stops.
//
// Pose (differential drive, Lecture 15), ft and rad, counter-clockwise
// positive, x along the robot's nose at theta = 0:
//
//   V = (vL + vR) / 2      omega = (vR - vL) / WHEEL_BASE
//   x' = V cos(theta)      y' = V sin(theta)      theta' = omega
//
// integrated over arcs of at most 0.25 ms from the exact wheel distances.
//
// Wheel slip, a scriptable input per wheel: "TB_SLIP_LEFT" / "TB_SLIP_RIGHT"
// is the share (0 to 1) of that wheel's rotation that does not move the
// robot. 0 is a wheel that grips, 1 a wheel that spins on the spot. The
// wheel itself turns as before, so the wheel speed the encoder reports
// (tb_left_speed) does not change, while the pose, the gyro and the
// position fix follow what the robot really does: in the equations above
// vL and vR are replaced by (1 - slip) * v. Not modelled: a slipping wheel
// speeding up because it carries less load, and slip that depends on the
// effort or on the floor.
//
// Sensors: ideal wheel speeds (plus optional bounded reading noise), a rate
// gyro (true rate + constant bias + white noise) and a 100 Hz position fix
// with white noise (OptiTrack stand-in). All noise comes from seeded
// generators, one per sensor, so every run repeats exactly.

import type { Board } from "../board";
import type { SimPlugin } from "../plugin";

/** Wheel time constant, s. */
export const TAU = 0.06;
/** Steady-state speed per unit of effort, ft/s. */
export const GAIN = 0.25;
/** Coulomb friction in effort units: the wheel does not start below this. */
export const COULOMB = 0.8;
/** Largest effort the amplifier accepts (Lab 3: setEPWM saturates at +-10). */
export const MAX_EFFORT = 10;
/** Distance between the wheels, ft (about 7 in, close to the course robot car). */
export const WHEEL_BASE = 0.6;
/** Period of the position fix, ns (OptiTrack sends at 100 Hz). */
export const GPS_PERIOD_NS = 10e6;

const TICK_NS = 1e6;
const SUBSTEP_S = 0.25e-3;

interface Wheel {
  /** Speed of the wheel's rim, ft/s: what the encoder sees. */
  v: number;
  /** Share of the rotation lost to slip, 0 to 1. */
  slip: number;
  u: number;
  load: number;
  peak: number;
  noise: number;
}

interface Plant {
  t: number;
  left: Wheel;
  right: Wheel;
  x: number;
  y: number;
  theta: number;
  started: boolean;
  gpsX: number;
  gpsY: number;
  gpsFresh: boolean;
  gpsSlot: number;
  gpsSum: number;
  gpsN: number;
  estSum: number;
  estN: number;
}

/** mulberry32: small seeded generator, uniform in [0, 1). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal numbers (Box-Muller) from a seeded uniform generator. */
function gauss(seed: number): () => number {
  const u = rng(seed);
  return () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
}

export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Advances one wheel by dt seconds with a constant net effort; returns the
 * distance rolled. Exact for the piecewise-linear friction model.
 */
export function stepWheel(w: { v: number }, uNet: number, dt: number): number {
  let dist = 0;
  for (let guard = 0; guard < 4 && dt > 0; guard++) {
    let dir = Math.sign(w.v);
    if (dir === 0) {
      if (Math.abs(uNet) <= COULOMB) return dist; // held by friction
      dir = Math.sign(uNet);
    }
    const vss = GAIN * (uNet - COULOMB * dir);
    let t = dt;
    let stops = false;
    if (w.v !== 0 && vss * dir < 0) {
      // Decelerating towards zero: the wheel stops at tc.
      const tc = TAU * Math.log(1 - w.v / vss);
      if (tc <= dt) {
        t = tc;
        stops = true;
      }
    }
    const decay = Math.exp(-t / TAU);
    dist += vss * t + (w.v - vss) * TAU * (1 - decay);
    w.v = stops ? 0 : vss + (w.v - vss) * decay;
    dt -= t;
  }
  return dist;
}

function install(b: Board): void {
  const wheel = (): Wheel => ({ v: 0, slip: 0, u: 0, load: 0, peak: 0, noise: 0 });
  const p: Plant = {
    t: 0, left: wheel(), right: wheel(), x: 0, y: 0, theta: 0, started: false,
    gpsX: 0, gpsY: 0, gpsFresh: false, gpsSlot: -1, gpsSum: 0, gpsN: 0, estSum: 0, estN: 0,
  };
  b.plugins.set("plant", p);
  const nGyro = gauss(0x5e423001);
  const nGps = gauss(0x5e423002);
  const nEncL = gauss(0x5e423003);
  const nEncR = gauss(0x5e423004);

  /** Brings the plant state up to time t (ns). */
  const advance = (t: number): void => {
    let dt = (t - p.t) / 1e9;
    if (dt <= 0) return;
    p.t = t;
    const uL = p.left.u - p.left.load;
    const uR = p.right.u - p.right.load;
    const n = Math.max(1, Math.ceil(dt / SUBSTEP_S));
    dt /= n;
    for (let i = 0; i < n; i++) {
      // A slipping wheel turns, but only part of that moves the robot.
      const dL = stepWheel(p.left, uL, dt) * (1 - p.left.slip);
      const dR = stepWheel(p.right, uR, dt) * (1 - p.right.slip);
      const dTheta = (dR - dL) / WHEEL_BASE;
      const ds = (dL + dR) / 2;
      // Chord of the arc driven in this step.
      const chord = Math.abs(dTheta) < 1e-9 ? ds : (ds * Math.sin(dTheta / 2)) / (dTheta / 2);
      p.x += chord * Math.cos(p.theta + dTheta / 2);
      p.y += chord * Math.sin(p.theta + dTheta / 2);
      p.theta += dTheta;
      p.left.peak = Math.max(p.left.peak, p.left.v);
      p.right.peak = Math.max(p.right.peak, p.right.v);
    }
    p.theta = wrapAngle(p.theta);
  };

  const publish = (t: number): void => {
    b.publish("TB_X_FT", p.x, t);
    b.publish("TB_Y_FT", p.y, t);
    b.publish("TB_THETA_RAD", p.theta, t);
    b.publish("TB_VLEFT", p.left.v, t);
    b.publish("TB_VRIGHT", p.right.v, t);
    b.publish("TB_VLEFT_PEAK", p.left.peak, t);
    b.publish("TB_VRIGHT_PEAK", p.right.peak, t);
  };

  /** New position fix when a 10 ms slot has started. */
  const gpsUpdate = (t: number): void => {
    const slot = Math.floor(t / GPS_PERIOD_NS);
    if (slot === p.gpsSlot) return;
    p.gpsSlot = slot;
    const s = b.input("TB_GPS_NOISE");
    p.gpsX = p.x + s * nGps();
    p.gpsY = p.y + s * nGps();
    p.gpsFresh = true;
    p.gpsSum += (p.gpsX - p.x) ** 2 + (p.gpsY - p.y) ** 2;
    p.gpsN++;
    b.publish("TB_GPS_RMS_FT", Math.sqrt(p.gpsSum / p.gpsN), t);
  };

  const tick = (t: number): void => {
    advance(t);
    gpsUpdate(t);
    publish(t);
    b.at((Math.floor(t / TICK_NS + 1e-6) + 1) * TICK_NS, tick);
  };

  /** The bench only costs simulation time in programs that use it. */
  const start = (): void => {
    if (p.started) return;
    p.started = true;
    p.t = b.now;
    tick(b.now);
  };
  const sync = (): void => {
    start();
    advance(b.now);
  };

  publish(0);
  b.publish("TB_ULEFT", 0, 0);
  b.publish("TB_URIGHT", 0, 0);

  // ---- world inputs ----
  for (const [name, w] of [["TB_LOAD_LEFT", p.left], ["TB_LOAD_RIGHT", p.right]] as const)
    b.onInput(name, (v, t) => {
      // A value that is not a number would stay in the wheel speed for the rest of the run.
      if (!Number.isFinite(v)) return;
      start();
      advance(t);
      w.load = v;
    });
  // A wheel that turns without moving the robot (wholly, or in part).
  for (const [name, w] of [["TB_SLIP_LEFT", p.left], ["TB_SLIP_RIGHT", p.right]] as const)
    b.onInput(name, (v, t) => {
      if (!Number.isFinite(v)) return;
      start();
      advance(t);
      w.slip = Math.max(0, Math.min(1, v));
      b.mem.writes++;
    });
  // Picking the robot up and putting it down somewhere else.
  const place = (name: string, set: (v: number) => void) =>
    b.onInput(name, (v, t) => {
      if (!Number.isFinite(v)) return;
      start();
      advance(t);
      set(v);
      p.gpsSlot = -1;
      gpsUpdate(t);
      publish(t);
    });
  place("TB_SET_X_FT", (v) => (p.x = v));
  place("TB_SET_Y_FT", (v) => (p.y = v));
  place("TB_SET_THETA_RAD", (v) => (p.theta = wrapAngle(v)));
  b.onInput("TB_STATS_RESET", () => {
    p.gpsSum = p.gpsN = p.estSum = p.estN = 0;
    p.left.peak = p.left.v;
    p.right.peak = p.right.v;
  });
  for (const name of ["TB_GYRO_BIAS", "TB_GYRO_NOISE", "TB_GPS_NOISE", "TB_ENC_NOISE"]) b.onInput(name, start);

  // ---- library functions ----
  const c = b.compiler;
  const sat = (u: number): number => (Number.isFinite(u) ? Math.max(-MAX_EFFORT, Math.min(MAX_EFFORT, u)) : 0);
  c.defineNative("tb_set_effort", (a) => {
    sync();
    p.left.u = sat(a[0]);
    p.right.u = sat(a[1]);
    b.publish("TB_ULEFT", p.left.u);
    b.publish("TB_URIGHT", p.right.u);
    b.mem.writes++;
    return 0;
  });
  // Reading noise is the difference of two bounded errors, like encoder
  // quantisation: it makes one speed reading rough but does not add up to a
  // drifting distance.
  const speed = (w: Wheel, n: () => number): number => {
    sync();
    b.mem.liveReads++;
    const s = b.input("TB_ENC_NOISE");
    if (s === 0) return Math.fround(w.v);
    const e = s * n();
    const v = w.v + e - w.noise;
    w.noise = e;
    return Math.fround(v);
  };
  c.defineNative("tb_left_speed", () => speed(p.left, nEncL));
  c.defineNative("tb_right_speed", () => speed(p.right, nEncR));
  c.defineNative("tb_gyro_z", () => {
    sync();
    b.mem.liveReads++;
    // The gyro turns with the robot, not with the wheels.
    const omega = (p.right.v * (1 - p.right.slip) - p.left.v * (1 - p.left.slip)) / WHEEL_BASE;
    return Math.fround(omega + b.input("TB_GYRO_BIAS") + b.input("TB_GYRO_NOISE") * nGyro());
  });
  const gps = (): void => {
    sync();
    gpsUpdate(b.now);
    b.mem.liveReads++;
  };
  c.defineNative("tb_gps_new", () => {
    gps();
    const fresh = p.gpsFresh;
    p.gpsFresh = false;
    return fresh ? 1 : 0;
  });
  c.defineNative("tb_gps_x", () => (gps(), Math.fround(p.gpsX)));
  c.defineNative("tb_gps_y", () => (gps(), Math.fround(p.gpsY)));
  c.defineNative("tb_report_pose", (a) => {
    sync();
    const err = Math.hypot(a[0] - p.x, a[1] - p.y);
    p.estSum += err * err;
    p.estN++;
    b.publish("TB_EST_X_FT", a[0]);
    b.publish("TB_EST_Y_FT", a[1]);
    b.publish("TB_EST_THETA_RAD", a[2]);
    b.publish("TB_EST_ERR_FT", Number.isFinite(err) ? err : 1e9);
    const eth = Math.abs(wrapAngle(a[2] - p.theta));
    b.publish("TB_EST_ERR_RAD", Number.isFinite(eth) ? eth : 1e9);
    b.publish("TB_EST_RMS_FT", Number.isFinite(p.estSum) ? Math.sqrt(p.estSum / p.estN) : 1e9);
    return 0;
  });
}

export const plugin: SimPlugin = {
  name: "plant",
  prelude: `
/* ---- test bench robot (simulator only, not on the chip): see src/sim/plugins/plant.ts ---- */
/* Wheel speeds in ft/s, as the encoder code of Lab 3 computes them. */
float tb_left_speed(void);
float tb_right_speed(void);
/* Control efforts, -10 to 10 (saturated), held until the next call. */
void tb_set_effort(float uLeft, float uRight);
/* Rate gyro about the vertical axis, rad/s, counter-clockwise positive: rate + bias + noise. */
float tb_gyro_z(void);
/* Absolute position fix (OptiTrack stand-in), ft, updated at 100 Hz. tb_gps_new() is 1 once per fix. */
int tb_gps_new(void);
float tb_gps_x(void);
float tb_gps_y(void);
/* Tell the bench your pose estimate (ft, ft, rad): it publishes how far off it is. */
void tb_report_pose(float x, float y, float theta);
`,
  install,
  parts: {
    robot: [
      { kind: "meter", id: "TB_VLEFT", label: "Left wheel speed", output: "TB_VLEFT", unit: "ft/s", digits: 3 },
      { kind: "meter", id: "TB_VRIGHT", label: "Right wheel speed", output: "TB_VRIGHT", unit: "ft/s", digits: 3 },
      { kind: "meter", id: "TB_X_FT", label: "Robot x", output: "TB_X_FT", unit: "ft", digits: 3 },
      { kind: "meter", id: "TB_Y_FT", label: "Robot y", output: "TB_Y_FT", unit: "ft", digits: 3 },
      { kind: "meter", id: "TB_THETA_RAD", label: "Robot heading", output: "TB_THETA_RAD", unit: "rad", digits: 3 },
    ],
  },
};
