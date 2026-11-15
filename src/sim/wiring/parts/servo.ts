// An RC servo: three wires, signal, supply and ground. It turns its horn to
// the angle the pulse width asks for, as in src/sim/plugins/actuators.ts
// (HW4): pulses at about 50 Hz (40 to 60 Hz are accepted); 0.8 ms is -90
// degrees, 1.6 ms is 0, 2.4 ms is +90. With no pulses it keeps its angle.
// On the board the two connectors RC1 and RC2 take their signal from GPIO14
// and GPIO15 and their supply from the battery pack, because a stalled
// servo draws more than USB should give (HW4). A hobby servo wants 4.8 V
// to 6 V: on 3.3 V it does not move.
// Not modelled: the horn's speed, its load, the current it draws.
import { fitted } from "../bench";
import { servoAngle } from "../../plugins/actuators";
import type { BenchView, Inst, PartDef } from "../types";
import { circle, empty, line, notDriven, rect } from "./_draw";

/** "" when the servo has power, else why not. */
function unpowered(i: Inst, b: BenchView): string {
  if (i.conn.gnd !== "GND") return "Its ground wire is not on GND.";
  if (i.conn.pwr === "BAT" && !fitted(b.inst("BAT"))) return "The battery pack is not on the board, so the servo has no supply. Solder the battery pack (Wiring bench, Battery pack).";
  const v = b.rail(i.conn.pwr) ?? 0;
  if (v < 4.5) return v > 0 ? `Its supply is ${v} V, and a servo needs 4.8 V to 6 V. Use the battery pack.` : "Its supply wire is not on a supply.";
  return "";
}

export const part: PartDef = {
  kind: "servo",
  name: "RC servo",
  description: "A geared motor that turns its horn to the angle a 50 Hz pulse asks for.",
  addable: true,
  terminals: [
    { id: "sig", name: "signal wire", role: "pwm" },
    { id: "pwr", name: "supply wire", role: "power" },
    { id: "gnd", name: "ground wire", role: "ground" },
  ],
  onBoard: (p) => ({ sig: `GPIO${p.pin}`, pwr: "BAT", gnd: "GND" }),
  check(i) {
    if (i.conn.pwr === "5V") return [{ inst: i.id, code: "servo-usb", severity: "warning", msg: `${i.label}: its supply is the USB's 5 V. A stalled servo draws more current than USB should give and can reset the board (HW4). Use the battery pack.` }];
    if (i.conn.pwr === "3V3") return [{ inst: i.id, code: "servo-3v3", severity: "error", msg: `${i.label}: its supply is 3.3 V, and a servo needs 4.8 V to 6 V, so it will not move. Use the battery pack.` }];
    return [];
  },
  works: (i, b) => unpowered(i, b) === "",
  edge(i, r, t, level) {
    if (t !== i.conn.sig || level !== 0) return;
    // A pulse just ended: the servo takes it if pulses come at an RC rate.
    const w = r.pin(t)?.wave;
    if (!w || w.hz < 40 || w.hz > 60) return;
    const dead = unpowered(i, r);
    if (dead) r.warn(i, "servo-no-power", `${i.label} gets pulses on ${t} and does not move. ${dead}`);
    else r.mem(i).angle = Math.round(servoAngle(w.pulseMs) * 10) / 10;
  },
  status(i, b) {
    const angle = b.mem(i).angle ?? 0;
    if (!b.board) return { text: "no program running", angle };
    const dead = unpowered(i, b);
    if (dead) return { text: "not moving", angle, why: dead };
    const p = b.pin(i.conn.sig);
    const w = p?.wave;
    if (!w) return { text: `holding ${angle} degrees, no pulses`, angle, why: notDriven(b, i.conn.sig, "set up its ePWM") };
    if (w.hz < 40 || w.hz > 60) return { text: `holding ${angle} degrees`, angle, why: `${i.conn.sig} carries ${w.hz.toFixed(0)} Hz. A servo wants a pulse every 20 ms (50 Hz): set the ePWM's period for that.` };
    return { text: `${angle} degrees (${w.pulseMs.toFixed(2)} ms pulse)`, angle, level: 1 };
  },
  draw(i, s, box) {
    const [x, y, w, h] = box;
    // The servo lies beside its connector; a wire runs to it.
    const bx = x + w + 2;
    const by = y - 1;
    if (!fitted(i)) return empty(box);
    const a = (((s.angle ?? 0) - 90) * Math.PI) / 180;
    const cx = bx + 5;
    const cy = by + h / 2 + 1;
    return [rect(x, y, w, h, "metal", false), line(x + w, y + h / 2, bx, cy, "metal"), rect(bx, by, 10, h + 2, "part"), circle(cx, cy, 1.4, "metal"), line(cx, cy, cx + 4.2 * Math.cos(a), cy + 4.2 * Math.sin(a), "lit", 0.9)];
  },
};
