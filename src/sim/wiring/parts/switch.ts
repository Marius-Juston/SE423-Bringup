// A slide switch: its middle contact goes to a pin, and the slider joins it
// to 3V3 or to ground. The pin always has a level, so no pull-up is needed.
import type { PartDef } from "../types";

export const part: PartDef = {
  kind: "switch",
  name: "Slide switch",
  description: "A switch that puts 3.3 V or 0 V on a pin and stays where you leave it.",
  addable: true,
  terminals: [{ id: "c", name: "middle contact", role: "out" }],
  inputs: [{ id: "up", label: "Slider at 3V3", kind: "toggle", initial: 0 }],
  apply(i, r) {
    r.drive(i, i.conn.c, i.inputs.up ? 1 : 0);
  },
  status(i, b) {
    const p = b.pin(i.conn.c);
    const why = p && p.mode !== "in" ? `GPIO${p.n} is not an input, so the switch and the chip both drive the pin. Make it an input: GPIO_SetupPinOptions(${p.n}, GPIO_INPUT, GPIO_PUSHPULL);` : "";
    return { text: i.inputs.up ? "at 3V3: the pin reads 1" : "at GND: the pin reads 0", level: i.inputs.up, why };
  },
};
