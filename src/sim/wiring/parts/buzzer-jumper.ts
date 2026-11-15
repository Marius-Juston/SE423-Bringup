// The header beside the buzzer (HW1 solders it, HW3 says to move its
// jumper): a jumper on the GPIO16 position lets GPIO16 reach the buzzer's
// inverter; on the GND position it ties that input to ground, so the buzzer
// is quiet whatever the pin does.
import { fitted } from "../bench";
import type { PartDef } from "../types";
import { empty, rect } from "./_draw";

export const part: PartDef = {
  kind: "buzzer-jumper",
  name: "Buzzer jumper",
  description: "A jumper that decides whether GPIO16 reaches the buzzer.",
  terminals: [{ id: "a", name: "pin position", role: "in" }],
  options: [{ id: "pos", label: "Jumper", fault: true, choices: [{ id: "pin", label: "On the GPIO16 position" }, { id: "gnd", label: "On the GND position (buzzer off)" }, { id: "off", label: "Removed" }] }],
  onBoard: (p) => ({ a: `GPIO${p.pin}` }),
  status: (i) => ({ text: i.opts.pos === "pin" ? `joins ${i.conn.a} to the buzzer` : i.opts.pos === "gnd" ? "ties the buzzer's input to GND" : "removed", level: i.opts.pos === "pin" ? 1 : 0, why: i.opts.pos === "pin" ? "" : `${i.conn.a} does not reach the buzzer. Put the jumper on the ${i.conn.a} position.` }),
  draw(i, _s, box) {
    if (!fitted(i)) return empty(box);
    const [x, y, w, h] = box;
    const out = [rect(x, y, w, h, "metal", false)];
    // The header's left column is GPIO16 (top) over the buzzer's input; the right column is GND beside that input.
    if (i.opts.pos === "pin") out.push(rect(x + 0.3, y + h * 0.3, w * 0.42, h * 0.5, "part"));
    if (i.opts.pos === "gnd") out.push(rect(x + 0.3, y + h * 0.58, w - 0.6, h * 0.24, "bad"));
    return out;
  },
};
