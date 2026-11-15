// A sensor with a digital output: it stands in for any part that gives the
// chip a 0 or a 1 (a motion detector, a hall switch, an encoder channel).
// The output is a level you set, or a square wave of a frequency you set.
// It drives the pin both ways (push-pull) from its own supply, so a 5 V
// supply puts 5 V on the pin: the bench reports that.
// Not modelled: rise times, a sensor's own timing.
import type { PartDef } from "../types";

/** Fastest square wave the bench makes, Hz: each edge is one simulator event. */
const MAX_HZ = 1000;

export const part: PartDef = {
  kind: "digital-sensor",
  name: "Digital sensor",
  description: "Stands in for any sensor with an on/off output: you set its level, or a pulse rate.",
  addable: true,
  terminals: [
    { id: "out", name: "output", role: "out" },
    { id: "vcc", name: "supply", role: "power" },
    { id: "gnd", name: "ground", role: "ground" },
  ],
  inputs: [
    { id: "high", label: "Output high", kind: "toggle", initial: 0 },
    { id: "hz", label: "Pulses", kind: "range", min: 0, max: MAX_HZ, step: 1, initial: 0, unit: "Hz" },
  ],
  apply(i, r) {
    const powered = (r.rail(i.conn.vcc) ?? 0) > 0 && i.conn.gnd === "GND";
    const m = r.mem(i);
    if (!powered) return r.drive(i, i.conn.out, null);
    if (!i.inputs.hz) return r.drive(i, i.conn.out, i.inputs.high ? 1 : 0);
    // A square wave: one event per edge, from where the last one left off.
    const half = 0.5e9 / Math.min(MAX_HZ, i.inputs.hz);
    const flip = () => {
      m.phase = m.phase ? 0 : 1;
      r.drive(i, i.conn.out, m.phase ? 1 : 0);
      r.later(r.board.now + half, flip);
    };
    r.drive(i, i.conn.out, m.phase ? 1 : 0);
    r.later(r.board.now + half, flip);
  },
  status(i, b) {
    if ((b.rail(i.conn.vcc) ?? 0) <= 0 || i.conn.gnd !== "GND") return { text: "no supply", level: 0, why: "Without a supply and ground the sensor's output is dead." };
    const p = b.pin(i.conn.out);
    const why = p && p.mode !== "in" ? `GPIO${p.n} is not an input, so the sensor and the chip both drive the pin. Make it an input: GPIO_SetupPinOptions(${p.n}, GPIO_INPUT, GPIO_PUSHPULL);` : "";
    return { text: i.inputs.hz ? `pulses at ${i.inputs.hz} Hz` : i.inputs.high ? "high" : "low", level: i.inputs.hz ? 0.5 : i.inputs.high, why };
  },
};
