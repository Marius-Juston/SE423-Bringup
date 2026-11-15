// A potentiometer: a resistor between its supply and ground with a wiper
// you turn. The wiper's voltage is the supply times the wiper's position.
// Not modelled: the load of the ADC's sampling capacitor on a large
// potentiometer (TRM 11.13: keep the source resistance low).
import type { PartDef } from "../types";

export const part: PartDef = {
  kind: "potentiometer",
  name: "Potentiometer",
  description: "A knob that puts a voltage between 0 V and its supply on an ADC pin.",
  addable: true,
  terminals: [
    { id: "w", name: "wiper (middle leg)", role: "analog" },
    { id: "vcc", name: "top leg", role: "power" },
    { id: "gnd", name: "bottom leg", role: "ground" },
  ],
  inputs: [{ id: "pos", label: "Knob", kind: "range", min: 0, max: 100, step: 1, initial: 50, unit: "%" }],
  apply(i, r) {
    const v = r.rail(i.conn.vcc);
    r.analog(i, i.conn.w, v !== null && v > 0 && i.conn.gnd === "GND" ? (v * i.inputs.pos) / 100 : null);
  },
  status(i, b) {
    const v = b.rail(i.conn.vcc);
    if (v === null || v <= 0 || i.conn.gnd !== "GND") return { text: "no voltage across it", why: "Its top leg needs a supply and its bottom leg ground: without both the wiper floats." };
    return { text: `wiper at ${((v * i.inputs.pos) / 100).toFixed(2)} V`, level: i.inputs.pos / 100 };
  },
};
