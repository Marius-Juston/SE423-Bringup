// A transistor used as a switch on the ground side of a load, as homework 4
// describes for the TIP122: the pin drives the base through a resistor
// (470 ohm), the emitter is on ground, and the load (an LED with its
// resistor, or a relay coil with a diode across it) sits between its supply
// and the collector. A high pin switches the load on. The pin only gives
// the small base current; the load's current comes from the load's supply,
// which is why the handout says to use the battery pack and never the
// USB's 5 V or 3.3 V for such loads.
// Not modelled: the transistor's voltage drop, its gain, the load's current.
import { fitted } from "../bench";
import type { BenchView, Inst, PartDef } from "../types";
import { notDriven } from "./_draw";

const supply = (i: Inst, b: BenchView): number => (i.conn.load === "BAT" && !fitted(b.inst("BAT")) ? 0 : (b.rail(i.conn.load) ?? 0));

export const part: PartDef = {
  kind: "transistor",
  name: "Transistor switch",
  description: "A transistor that lets a pin switch a load a pin could never drive itself.",
  addable: true,
  terminals: [
    { id: "base", name: "input (to the base resistor)", role: "in" },
    { id: "load", name: "load's supply", role: "power" },
    { id: "gnd", name: "emitter", role: "ground" },
  ],
  options: [{ id: "what", label: "Load", choices: [{ id: "led", label: "Bright LED with its resistor" }, { id: "relay", label: "Relay coil with its diode" }] }],
  check(i) {
    if (i.conn.load === "3V3" || i.conn.load === "5V") return [{ inst: i.id, code: "load-usb", severity: "warning", msg: `${i.label}: its load is powered from ${i.conn.load}, which comes from USB. The handout (HW4) says to use only the battery pack for transistor and relay loads. Choose the battery pack.` }];
    return [];
  },
  status(i, b) {
    if (!b.board) return { text: "no program running" };
    const v = supply(i, b);
    if (v <= 0 || i.conn.gnd !== "GND") return { text: "load off", level: 0, why: i.conn.load === "BAT" ? "The battery pack is not on the board, so the load has no supply." : "The load has no supply, or the emitter is not on GND." };
    const h = b.high(i.conn.base);
    if (h === null) return { text: "load off", level: 0, why: notDriven(b, i.conn.base) || "Nothing drives the base yet." };
    const what = i.opts.what === "relay" ? "relay" : "LED";
    return { text: h <= 0 ? `${what} off` : h >= 1 ? `${what} on` : `${what} switching, on ${Math.round(h * 100)} % of the time`, level: h };
  },
};
