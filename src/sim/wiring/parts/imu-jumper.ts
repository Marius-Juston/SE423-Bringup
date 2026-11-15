// One of the four jumpers of homework 3 that take the SPIB pins (GPIO63 to
// GPIO66) to the IMU's socket. With one missing, that signal does not reach
// the IMU and no transfer works.
import { fitted } from "../bench";
import type { PartDef } from "../types";
import { empty, rect } from "./_draw";

export const part: PartDef = {
  kind: "imu-jumper",
  name: "IMU jumper",
  description: "A jumper that takes one SPIB pin to the IMU's socket.",
  terminals: [{ id: "a", name: "pin", role: "in" }],
  options: [{ id: "pos", label: "Jumper", fault: true, choices: [{ id: "on", label: "Fitted" }, { id: "off", label: "Removed" }] }],
  onBoard: (p) => ({ a: `GPIO${p.pin}` }),
  status: (i) => (i.opts.pos === "on" ? { text: `joins ${i.conn.a} to the IMU's ${i.part?.signal ?? "pin"}`, level: 1 } : { text: "removed", level: 0, why: `${i.conn.a} (${i.part?.signal ?? ""}) does not reach the IMU. Put the jumper back.` }),
  draw(i, _s, box) {
    if (!fitted(i)) return empty(box);
    const [x, y, w, h] = box;
    return i.opts.pos === "on" ? [rect(x, y, w, h, "part")] : [{ s: "rect", x, y, w, h, r: 0.4, tone: "bad", dash: true }];
  },
};
