// A microphone board with an amplifier: its output rests at 1.5 V and
// swings around it with the sound (Lab 4 uses one on the robot, between
// 0.5 V and 2.5 V). Here the sound is one steady tone you set.
// Not modelled: noise, the amplifier's bandwidth, anything but a sine.
import type { PartDef } from "../types";

const REST_V = 1.5;

export const part: PartDef = {
  kind: "microphone",
  name: "Microphone",
  description: "A microphone board whose output swings around 1.5 V with a tone you set.",
  addable: true,
  terminals: [
    { id: "out", name: "output", role: "analog" },
    { id: "vcc", name: "supply", role: "power" },
    { id: "gnd", name: "ground", role: "ground" },
  ],
  inputs: [
    { id: "hz", label: "Tone", kind: "range", min: 0, max: 4000, step: 10, initial: 440, unit: "Hz" },
    { id: "ampl", label: "Loudness", kind: "range", min: 0, max: 1, step: 0.05, initial: 0.5, unit: "V" },
  ],
  apply(i, r) {
    const v = r.rail(i.conn.vcc);
    if (v === null || v <= 0 || i.conn.gnd !== "GND") return r.analog(i, i.conn.out, null);
    const { hz, ampl } = i.inputs;
    if (!hz || !ampl) return r.analog(i, i.conn.out, REST_V);
    const w = (2 * Math.PI * hz) / 1e9;
    r.analog(i, i.conn.out, (t) => REST_V + ampl * Math.sin(w * t));
  },
  status(i, b) {
    const v = b.rail(i.conn.vcc);
    if (v === null || v <= 0 || i.conn.gnd !== "GND") return { text: "no supply", why: "Without a supply and ground the output floats." };
    return { text: i.inputs.hz && i.inputs.ampl ? `${i.inputs.hz} Hz, ${(REST_V - i.inputs.ampl).toFixed(2)} V to ${(REST_V + i.inputs.ampl).toFixed(2)} V` : `silent: ${REST_V} V`, level: i.inputs.ampl };
  },
};
