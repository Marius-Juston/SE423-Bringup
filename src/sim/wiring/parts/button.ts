// A push button: a contact between a pin and ground (the board's PB1 to PB4,
// HW1) or between a pin and 3V3. The button is passive: released, it
// connects nothing, so the pin needs a pull-up (to ground) to have a level.
// Not modelled: contact bounce.
import { fitted } from "../bench";
import type { BenchView, Inst, PartDef } from "../types";
import { circle, empty, rect } from "./_draw";

const held = (i: Inst, b: BenchView): boolean => (b.mem(i).held ?? 0) > 0;

export const part: PartDef = {
  kind: "button",
  name: "Push button",
  description: "A contact that joins a pin to ground, or to 3V3, while you hold it.",
  addable: true,
  terminals: [
    { id: "a", name: "pin side", role: "contact" },
    { id: "b", name: "other side", role: "in" },
  ],
  inputs: [{ id: "held", label: "Hold to press", kind: "hold", initial: 0 }],
  onBoard: (p) => ({ a: `GPIO${p.pin}`, b: "GND" }),
  check(i) {
    if (i.conn.b && i.conn.b !== "GND" && i.conn.b !== "3V3") return [{ inst: i.id, code: "button-side", severity: "error", msg: `${i.label}: its other side goes to ${i.conn.b}. Choose GND (and enable the pin's pull-up) or 3V3.` }];
    if (i.conn.b === "3V3") return [{ inst: i.id, code: "button-high", severity: "info", msg: `${i.label}: pressed, the pin reads 1. Released, nothing pulls it low: the chip has pull-ups only, so add a resistor to ground or wire the button to GND and use the pull-up.` }];
    return [];
  },
  apply(i, r) {
    const rail = r.rail(i.conn.b);
    r.drive(i, i.conn.a, fitted(i) && held(i, r) && rail !== null ? (rail > 0 ? 1 : 0) : null);
  },
  status(i, b) {
    const down = held(i, b);
    const p = b.pin(i.conn.a);
    let why = "";
    if (p?.mode === "out") why = `GPIO${p.n} is an output, so the program cannot read the button, and pressing it shorts the pin to ${i.conn.b}. Make it an input: GPIO_SetupPinOptions(${p.n}, GPIO_INPUT, GPIO_PULLUP);`;
    else if (p?.mode === "periph") why = `GPIO${p.n}'s mux gives the pin to ${p.fn || "a peripheral"}, so GP${"ABCDEF"[p.n >> 5]}DAT still shows the pin, but check that this is what you want.`;
    else if (p && i.conn.b === "GND" && !p.pullUp) why = `GPIO${p.n}'s pull-up is off. Released, the button connects nothing, so the pin floats and reads random values. Enable it: GPIO_SetupPinOptions(${p.n}, GPIO_INPUT, GPIO_PULLUP);`;
    const reads = !p ? "" : down ? ` (the pin reads ${i.conn.b === "GND" ? 0 : 1})` : p.level < 0 ? " (the pin floats)" : ` (the pin reads ${p.level})`;
    return { text: `${down ? "pressed" : "released"}${reads}`, level: down ? 1 : 0, why };
  },
  draw(i, s, box) {
    if (!fitted(i)) return empty(box);
    const [x, y, w, h] = box;
    const side = Math.min(w, 6);
    const cx = x + w / 2;
    const cy = y + h / 2;
    // Pressed: a filled cap inside a second ring. Released: an empty cap.
    return [rect(cx - side / 2, cy - side / 2, side, side, "part"), circle(cx, cy, side * 0.26, s.level ? "lit" : "metal", !!s.level), ...(s.level ? [circle(cx, cy, side * 0.42, "metal", false)] : [])];
  },
};
