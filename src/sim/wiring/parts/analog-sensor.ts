// A sensor with a voltage output: it stands in for any part that gives the
// chip a voltage (a distance sensor, a temperature sensor, a gyro). You set
// the voltage; it cannot exceed the sensor's supply.
import type { PartDef } from "../types";

export const part: PartDef = {
  kind: "analog-sensor",
  name: "Analog sensor",
  description: "Stands in for any sensor with a voltage output: you set the voltage it puts on an ADC pin.",
  addable: true,
  terminals: [
    { id: "out", name: "output", role: "analog" },
    { id: "vcc", name: "supply", role: "power" },
    { id: "gnd", name: "ground", role: "ground" },
  ],
  inputs: [{ id: "v", label: "Output", kind: "range", min: 0, max: 5, step: 0.01, initial: 1.5, unit: "V" }],
  apply(i, r) {
    const v = r.rail(i.conn.vcc);
    r.analog(i, i.conn.out, v !== null && v > 0 && i.conn.gnd === "GND" ? Math.min(v, i.inputs.v) : null);
  },
  status(i, b) {
    const v = b.rail(i.conn.vcc);
    if (v === null || v <= 0 || i.conn.gnd !== "GND") return { text: "no supply", why: "Without a supply and ground the sensor's output floats." };
    const out = Math.min(v, i.inputs.v);
    return { text: `output ${out.toFixed(2)} V${out < i.inputs.v ? ` (limited by its ${v} V supply)` : ""}`, level: out / v };
  },
};
