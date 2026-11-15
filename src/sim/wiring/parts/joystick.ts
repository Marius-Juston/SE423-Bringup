// The two-axis joystick of homework 2: two potentiometers between its
// supply and ground, one per axis, and a push switch to ground. On the
// board it plugs into the five-pin JOY socket. Each axis gives half the
// supply at rest and swings to 0 V and to the supply at the ends. On the
// board the supply is 3.3 V and the ADC converts up to 3.0 V, so the last
// part of the travel reads 4095.
// Not modelled: the dead band and spring of a real stick.
import { fitted } from "../bench";
import type { BenchView, Inst, PartDef } from "../types";
import { circle, empty, line, rect } from "./_draw";

const ok = (i: Inst, b: BenchView): number => {
  if (i.opts.way === "rev" || i.conn.gnd !== "GND") return 0;
  return b.rail(i.conn.vcc) ?? 0;
};
const axis = (supply: number, pos: number): number => supply * (0.5 + pos / 200);

export const part: PartDef = {
  kind: "joystick",
  name: "Joystick",
  description: "A stick with two axes, each a voltage for an ADC pin, and a push switch.",
  addable: true,
  terminals: [
    { id: "x", name: "X axis", role: "analog" },
    { id: "y", name: "Y axis", role: "analog" },
    { id: "sw", name: "switch", role: "contact" },
    { id: "vcc", name: "supply", role: "power" },
    { id: "gnd", name: "ground", role: "ground" },
  ],
  options: [{ id: "way", label: "Plugged in", boardOnly: true, fault: true, choices: [{ id: "ok", label: "Right way round" }, { id: "rev", label: "Reversed" }] }],
  inputs: [
    { id: "x", label: "X", kind: "range", min: -100, max: 100, step: 1, initial: 0, unit: "%" },
    { id: "y", label: "Y", kind: "range", min: -100, max: 100, step: 1, initial: 0, unit: "%" },
    { id: "held", label: "Hold to press the stick", kind: "hold", initial: 0 },
  ],
  onBoard: (p) => ({ x: p.adcX ?? "", y: p.adcY ?? "", sw: `GPIO${p.pin}`, vcc: "3V3", gnd: "GND" }),
  apply(i, r) {
    const v = fitted(i) ? ok(i, r) : 0;
    r.analog(i, i.conn.x, v > 0 ? axis(v, i.inputs.x) : null);
    r.analog(i, i.conn.y, v > 0 ? axis(v, i.inputs.y) : null);
    r.drive(i, i.conn.sw, v > 0 && (r.mem(i).held ?? 0) > 0 ? 0 : null);
  },
  status(i, b) {
    if (i.opts.way === "rev") return { text: "dead", why: `${i.label} is plugged in the wrong way round: its supply and ground pins do not meet the socket's, so both axes float and the switch does nothing. Turn it round.` };
    const v = ok(i, b);
    if (v <= 0) return { text: "no supply", why: "Without a supply and ground both axes float." };
    const p = b.pin(i.conn.sw);
    const why = p && p.mode === "in" && !p.pullUp ? `GPIO${p.n}'s pull-up is off, so the switch reads random values while it is released. Enable it: GPIO_SetupPinOptions(${p.n}, GPIO_INPUT, GPIO_PULLUP);` : "";
    return { text: `X ${axis(v, i.inputs.x).toFixed(2)} V, Y ${axis(v, i.inputs.y).toFixed(2)} V, switch ${(b.mem(i).held ?? 0) > 0 ? "pressed" : "released"}`, level: (b.mem(i).held ?? 0) > 0 ? 1 : 0, why };
  },
  draw(i, s, box) {
    if (!fitted(i)) return empty(box);
    const [x, y, w, h] = box;
    // The module is drawn below its socket, where the board is empty.
    const side = 5.5;
    const bx = x + w - side;
    const by = y + h + 0.8;
    const k = i.opts.way === "rev" ? 0 : 1;
    const cx = bx + side / 2;
    const cy = by + side / 2;
    const kx = cx + (k * i.inputs.x * 1.5) / 100;
    const ky = cy - (k * i.inputs.y * 1.5) / 100;
    // The knob stands where the stick is pushed, with a line from the centre; pressed, it is filled.
    return [rect(x, y, w, h, i.opts.way === "rev" ? "bad" : "metal", false), rect(bx, by, side, side, "part"), circle(cx, cy, 0.4, "metal"), line(cx, cy, kx, ky, "metal", 0.5), circle(kx, ky, 1.1, s.level ? "lit" : "metal", !!s.level)];
  },
};
