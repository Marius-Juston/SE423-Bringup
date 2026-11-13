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
//            LIDAR_ROOM (which room, see lidar.ts),
//            LEFT_WHEEL_RADPS, RIGHT_WHEEL_RADPS (forward-positive, from the motors)
//   outputs  ROBOT_X_FT, ROBOT_Y_FT, ROBOT_THETA_RAD, ROBOT_GOAL_DIST_FT,
//            ROBOT_ODOMETER_FT, ROBOT_CRASHED (1 after touching a wall)
//   sets     LIDAR_X_FT, LIDAR_Y_FT, LIDAR_THETA_RAD
//
// Kinematics (lecture 15): V = (vL + vR) / 2, omega = (vR - vL) / b, with
// b = WHEEL_BASE from the test bench and the course's feet per wheel radian.

import type { SimPlugin } from "../plugin";
import { ROOMS, castRay } from "./lidar";
import { WHEEL_BASE } from "./plant";

/** Feet travelled per radian of wheel rotation (course code: 1.235 / 12). */
export const FT_PER_WHEEL_RAD = 1.235 / 12;
/** The robot is treated as a disc of this radius when it meets a wall. */
export const ROBOT_RADIUS_FT = 0.35;
const STEP_NS = 1_000_000;

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
      const gx = b.inputs.get("ROBOT_GOAL_X_FT");
      const gy = b.inputs.get("ROBOT_GOAL_Y_FT");
      if (gx !== undefined && gy !== undefined) b.publish("ROBOT_GOAL_DIST_FT", +Math.hypot(gx - x, gy - y).toFixed(4), t);
    };
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
        const room = ROOMS[Math.round(b.inputs.get("LIDAR_ROOM") ?? 0)] ?? ROOMS[0];
        for (let k = 0; k < 8 && !crashed; k++) if (castRay(room, x, y, (k * Math.PI) / 4) < ROBOT_RADIUS_FT) crashed = true;
      }
      out(t);
      b.at(t + STEP_NS, step);
    };
    b.onInput("ROBOT_WORLD", (v, t) => {
      if (v && !on) {
        on = true;
        x = b.inputs.get("ROBOT_START_X_FT") ?? 5;
        y = b.inputs.get("ROBOT_START_Y_FT") ?? 5;
        th = b.inputs.get("ROBOT_START_THETA_RAD") ?? 0;
        odo = 0;
        crashed = false;
        last = t;
        out(t);
        b.at(t + STEP_NS, step);
      } else if (!v) on = false;
    });
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
