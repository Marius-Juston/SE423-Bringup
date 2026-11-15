// The photoresistor circuit of homework 2: the photoresistor from 3V3 to a
// junction, a fixed resistor from the junction to ground, the junction to
// an ADC pin. More light means less resistance, so the junction's voltage
// rises with the light:
//   V = 3.3 V * R / (R_photo + R)
// The photoresistor's resistance here runs on a logarithmic scale from
// 200 k in the dark to 500 ohm in bright light, which is typical of a small
// cadmium sulphide cell; a real one differs from part to part.
// Not modelled: the cell's slow response (tens of milliseconds).
import { fitted } from "../bench";
import type { Inst, PartDef } from "../types";
import { circle, empty, line, rect } from "./_draw";

const DARK_OHM = 200_000;
const BRIGHT_OHM = 500;

/** Resistance of the photoresistor at a light level of 0 to 100 %. */
export const photoOhms = (light: number): number => DARK_OHM * Math.pow(BRIGHT_OHM / DARK_OHM, Math.min(100, Math.max(0, light)) / 100);
/** Voltage at the junction of the divider. */
export const dividerVolts = (light: number, ohm: number, supply = 3.3): number => (supply * ohm) / (photoOhms(light) + ohm);

const fixedOhm = (i: Inst): number => i.part?.ohm ?? 2200;

export const part: PartDef = {
  kind: "photoresistor",
  name: "Photoresistor",
  description: "A light sensor: with a fixed resistor it makes a voltage that rises with the light.",
  terminals: [
    { id: "out", name: "junction", role: "analog" },
    { id: "vcc", name: "photoresistor's free leg", role: "power" },
    { id: "gnd", name: "fixed resistor's free leg", role: "ground" },
  ],
  inputs: [{ id: "light", label: "Light", kind: "range", min: 0, max: 100, step: 1, initial: 60, unit: "%" }],
  onBoard: (p) => ({ out: p.adc ?? "", vcc: "3V3", gnd: "GND" }),
  apply(i, r) {
    r.analog(i, i.conn.out, fitted(i) ? dividerVolts(i.inputs.light, fixedOhm(i)) : null);
  },
  status(i) {
    const v = dividerVolts(i.inputs.light, fixedOhm(i));
    return { text: `${v.toFixed(2)} V on ${i.conn.out}`, level: i.inputs.light / 100 };
  },
  draw(i, s, box) {
    if (!fitted(i)) return empty(box);
    const [x, y, w, h] = box;
    const cx = x + h / 2;
    return [
      circle(cx, y + h / 2, h * 0.42, "part"),
      circle(cx, y + h / 2, h * 0.24, (s.level ?? 0) > 0.5 ? "lit" : "dark"),
      rect(x + h + 0.8, y + h / 2 - 1, w - h - 1.6, 2, "part"),
      line(x + h * 0.92, y + h / 2, x + h + 0.8, y + h / 2, "metal"),
    ];
  },
};
