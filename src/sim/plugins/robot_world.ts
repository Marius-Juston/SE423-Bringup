// The whole robot in one room, for capstone levels: it joins the models the
// earlier chapters use separately. The PWM-driven motors (actuators.ts)
// set the wheel speeds, this plugin turns wheel speeds into a pose, and the
// pose is what the LIDAR (lidar.ts) sees. The encoders (eqep.ts) read the
// same wheel speeds. Nothing here is a chip feature.
//
// Off unless a level sets the input ROBOT_WORLD to 1, so other levels pay
// nothing and keep their own way of placing the robot.
//
//   inputs   ROBOT_WORLD (1 = on), ROBOT_START_X_FT, ROBOT_START_Y_FT,
//            ROBOT_START_THETA_RAD, ROBOT_GOAL_X_FT, ROBOT_GOAL_Y_FT,
//            LIDAR_ROOM, WORLD_KIND, WORLD_SEED, WORLD_SIZE, WORLD_LOOPS
//            (which room or terrain, see lidar.ts; with a terrain, its own
//            start and goal are used where the START and GOAL inputs are
//            not set),
//            LEFT_WHEEL_RADPS, RIGHT_WHEEL_RADPS (forward-positive, from the motors)
//   outputs  ROBOT_X_FT, ROBOT_Y_FT, ROBOT_THETA_RAD, ROBOT_GOAL_DIST_FT,
//            ROBOT_ODOMETER_FT, ROBOT_CRASHED (1 after touching a wall)
//   sets     LIDAR_X_FT, LIDAR_Y_FT, LIDAR_THETA_RAD
//
// The robot is a disc: it has crashed when a wall or a post is nearer to
// its centre than its radius (exact distance to every wall and post), or
// when its centre is inside a box.
//
// For the playground of a live run, b.plugins.get("robot-world") is a
// RobotWorld: place() puts the robot down somewhere else and clears the
// crash, reset() puts it back at the start. Tests never call them.
//
// Kinematics (lecture 15): V = (vL + vR) / 2, omega = (vR - vL) / b, with
// b = WHEEL_BASE from the test bench and the course's feet per wheel radian.

import type { SimPlugin } from "../plugin";
import { worldOf } from "./lidar";
import { WHEEL_BASE } from "./plant";
import { clearance, insideBox } from "../world/terrain";

/** Feet travelled per radian of wheel rotation (course code: 1.235 / 12). */
export const FT_PER_WHEEL_RAD = 1.235 / 12;
/** The robot is treated as a disc of this radius when it meets a wall. */
export const ROBOT_RADIUS_FT = 0.35;
const STEP_NS = 1_000_000;

/** What the playground may do to the robot during a live run. */
export interface RobotWorld {
  /** Is the world switched on (ROBOT_WORLD)? */
  readonly on: boolean;
  /** Puts the robot down at a new pose, standing where it is put; clears the crash. */
  place(x: number, y: number, theta: number): void;
  /** Back to the start pose, odometer at 0, crash cleared. */
  reset(): void;
}

export const plugin: SimPlugin = {
  name: "robot-world",
  order: 90,
  install(b) {
    let on = false;
    let x = 0;
    let y = 0;
    let th = 0;
    let odo = 0;
    let crashed = false;
    let last = 0;
    const out = (t: number) => {
      b.setInput("LIDAR_X_FT", x, t);
      b.setInput("LIDAR_Y_FT", y, t);
      b.setInput("LIDAR_THETA_RAD", th, t);
      b.publish("ROBOT_X_FT", +x.toFixed(4), t);
      b.publish("ROBOT_Y_FT", +y.toFixed(4), t);
      b.publish("ROBOT_THETA_RAD", +th.toFixed(4), t);
      b.publish("ROBOT_ODOMETER_FT", +odo.toFixed(4), t);
      b.publish("ROBOT_CRASHED", crashed ? 1 : 0, t);
      const goal = (b.inputs.get("WORLD_KIND") ?? 0) !== 0 ? worldOf(b).goal : undefined;
      const gx = b.inputs.get("ROBOT_GOAL_X_FT") ?? goal?.[0];
      const gy = b.inputs.get("ROBOT_GOAL_Y_FT") ?? goal?.[1];
      if (gx !== undefined && gy !== undefined) b.publish("ROBOT_GOAL_DIST_FT", +Math.hypot(gx - x, gy - y).toFixed(4), t);
    };
    // Touching a wall or a post, or standing inside a box (far from its sides in a big one).
    const touches = () => {
      const w = worldOf(b);
      return clearance(w, x, y) < ROBOT_RADIUS_FT || insideBox(w, x, y);
    };
    let onAt = -1;
    let pending: ReturnType<typeof b.at> | null = null;
    const step = (t: number) => {
      if (!on) return;
      const dt = (t - last) / 1e9;
      last = t;
      if (!crashed) {
        const vl = (b.inputs.get("LEFT_WHEEL_RADPS") ?? 0) * FT_PER_WHEEL_RAD;
        const vr = (b.inputs.get("RIGHT_WHEEL_RADPS") ?? 0) * FT_PER_WHEEL_RAD;
        const v = (vl + vr) / 2;
        const w = (vr - vl) / WHEEL_BASE;
        // Midpoint rule: turn half the step, move, turn the other half.
        const mid = th + (w * dt) / 2;
        x += v * Math.cos(mid) * dt;
        y += v * Math.sin(mid) * dt;
        th += w * dt;
        if (th > Math.PI) th -= 2 * Math.PI;
        if (th <= -Math.PI) th += 2 * Math.PI;
        odo += Math.abs(v) * dt;
        if (touches()) crashed = true;
      }
      out(t);
      pending = b.at(t + STEP_NS, step);
    };
    const toStart = () => {
      // A terrain brings its own start; the rooms keep the middle of the 10 ft box.
      const start = (b.inputs.get("WORLD_KIND") ?? 0) !== 0 ? worldOf(b).start : [5, 5, 0];
      x = b.inputs.get("ROBOT_START_X_FT") ?? start[0];
      y = b.inputs.get("ROBOT_START_Y_FT") ?? start[1];
      const th0 = b.inputs.get("ROBOT_START_THETA_RAD") ?? start[2];
      // Any start heading, however many turns it holds, is brought into -pi .. pi.
      th = Math.atan2(Math.sin(th0), Math.cos(th0));
      odo = 0;
      crashed = false;
    };
    b.onInput("ROBOT_WORLD", (v, t) => {
      if (v && !on) {
        on = true;
        toStart();
        last = t;
        onAt = t;
        out(t);
        b.cancel(pending);
        pending = b.at(t + STEP_NS, step);
      } else if (!v) on = false;
    });
    // A start pose given at the very instant of switching on counts, whichever stimulus comes first.
    for (const name of ["ROBOT_START_X_FT", "ROBOT_START_Y_FT", "ROBOT_START_THETA_RAD"])
      b.onInput(name, (_v, t) => {
        if (!on || t !== onAt || last !== onAt) return;
        toStart();
        out(t);
      });
    const api: RobotWorld = {
      get on() {
        return on;
      },
      place(nx, ny, nth) {
        if (!on || ![nx, ny, nth].every(Number.isFinite)) return;
        x = nx;
        y = ny;
        th = Math.atan2(Math.sin(nth), Math.cos(nth));
        crashed = false;
        out(b.now);
      },
      reset() {
        if (!on) return;
        toStart();
        out(b.now);
      },
    };
    b.plugins.set("robot-world", api);
  },
  parts: {
    robot: [
      { kind: "meter", id: "ROBOT_X", label: "Robot x", output: "ROBOT_X_FT", unit: "ft", digits: 2 },
      { kind: "meter", id: "ROBOT_Y", label: "Robot y", output: "ROBOT_Y_FT", unit: "ft", digits: 2 },
      { kind: "meter", id: "ROBOT_TH", label: "Robot heading", output: "ROBOT_THETA_RAD", unit: "rad", digits: 2 },
      { kind: "meter", id: "ROBOT_GOAL", label: "Distance to goal", output: "ROBOT_GOAL_DIST_FT", unit: "ft", digits: 2 },
    ],
  },
};
