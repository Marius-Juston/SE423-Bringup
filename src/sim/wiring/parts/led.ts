// An LED with its series resistor. On the board: 3V3, 1 k, LED, then the
// output of a 74LVC04 inverter whose input is the pin, so the LED is lit
// while the pin is high (HW1 solders them). Attached to free pins: an LED
// and a resistor between two points of your choice; it is lit while the
// anode side is high and the cathode side is low.
//
// Not modelled: brightness against current (a lit LED is lit), the forward
// voltage's spread. The current is estimated as (3.3 V - 1.8 V) / R for the
// check against the pin's 4 mA rating (data sheet SPRS880P, section 6.6).
import { PIN_MA, fitted } from "../bench";
import type { PartDef } from "../types";
import { empty, isPin, line, notDriven, pct, rect } from "./_draw";

const VF = 1.8;

export const part: PartDef = {
  kind: "led",
  name: "LED with resistor",
  description: "A light that is on while the pin on its anode side is high and its cathode side is low.",
  addable: true,
  terminals: [
    { id: "a", name: "anode side (long leg, through the resistor)", role: "in" },
    { id: "k", name: "cathode side (short leg)", role: "in" },
  ],
  options: [
    { id: "way", label: "Direction", choices: [{ id: "ok", label: "Right way round" }, { id: "rev", label: "Reversed" }], fault: true },
    { id: "ohm", label: "Resistor", addedOnly: true, choices: [{ id: "470", label: "470 ohm" }, { id: "330", label: "330 ohm" }, { id: "1000", label: "1 k" }, { id: "100", label: "100 ohm" }, { id: "0", label: "No resistor" }] },
  ],
  onBoard: (p) => ({ a: `GPIO${p.pin}`, k: "GND" }),
  check(i) {
    const ohm = +i.opts.ohm;
    const onPin = isPin(i.conn.a) || isPin(i.conn.k);
    if (!onPin && i.conn.a && i.conn.k) return [{ inst: i.id, code: "led-fixed", severity: "info", msg: `${i.label}: both sides go to a supply, so no pin controls it.` }];
    if (!onPin) return [];
    if (ohm === 0) return [{ inst: i.id, code: "led-no-resistor", severity: "error", msg: `${i.label}: with no resistor nothing limits the current, and the pin or the LED can be damaged. A pin is rated for ${PIN_MA} mA (data sheet 6.6). Choose a resistor.` }];
    const ma = ((3.3 - VF) / ohm) * 1000;
    if (ma > PIN_MA) return [{ inst: i.id, code: "led-current", severity: "warning", msg: `${i.label}: about ${ma.toFixed(1)} mA would flow, (3.3 V - ${VF} V) / ${ohm} ohm, and a pin is rated for ${PIN_MA} mA (data sheet 6.6). Choose 470 ohm or more.` }];
    return [];
  },
  edge(i, r, t) {
    // The program drives the pin, and the LED cannot answer: say why once.
    const p = r.pin(t);
    if (!p || p.mode === "in") return;
    if (i.opts.way === "rev") r.warn(i, "led-reversed", `${i.label} is soldered the wrong way round: ${t} changes, but current cannot flow through an LED backwards, so it stays dark. Turn it round (Wiring bench, ${i.label}, Direction).`);
    else if (i.part?.via && !fitted(r.inst(i.part.via))) r.warn(i, "led-no-driver", `${t} changes, but inverter chip ${i.part.via} between the pin and ${i.label} is not soldered, so the LED stays dark. Solder ${i.part.via} (Wiring bench, ${i.part.via}).`);
  },
  status(i, b) {
    if (!b.board) return { text: "no program running" };
    if (i.opts.way === "rev") return { text: "dark", level: 0, why: `${i.label} is the wrong way round, so no current flows whatever the pin does. Turn it round.` };
    if (i.part?.via && !fitted(b.inst(i.part.via))) return { text: "dark", level: 0, why: `Inverter chip ${i.part.via}, between the pin and this LED, is not soldered.` };
    if (!i.conn.a || !i.conn.k) return { text: "dark", level: 0, why: "A side is not connected." };
    const a = b.high(i.conn.a);
    const k = b.high(i.conn.k);
    if (a === null || k === null) return { text: "dark", level: 0, why: notDriven(b, a === null ? i.conn.a : i.conn.k) || "Nothing drives it yet." };
    const level = a * (1 - k);
    return { text: level <= 0 ? "off" : level >= 1 ? "on" : `dimmed: on ${pct(level)} of the time`, level };
  },
  draw(i, s, box) {
    if (!fitted(i)) return empty(box);
    const [x, y, w, h] = box;
    const on = (s.level ?? 0) > 0;
    const cx = x + w / 2;
    const cy = y + h / 2;
    // Lit: a filled body with rays. Off: an empty body.
    const rays = on ? [line(x - 1.1, cy, x - 0.3, cy, "metal"), line(x + w + 0.3, cy, x + w + 1.1, cy, "metal"), line(x - 0.9, y + 0.6, x - 0.2, y + 1.2, "metal"), line(x + w + 0.2, y + 1.2, x + w + 0.9, y + 0.6, "metal"), line(x - 0.9, y + h - 0.6, x - 0.2, y + h - 1.2, "metal"), line(x + w + 0.2, y + h - 1.2, x + w + 0.9, y + h - 0.6, "metal")] : [];
    return [rect(x, y, w, h, i.opts.way === "rev" ? "bad" : "metal", false), rect(cx - w * 0.35, cy - h * 0.25, w * 0.7, h * 0.5, on ? "lit" : "dark"), ...rays];
  },
};
