// The two supply LEDs of the board: each is lit while its supply is there
// (3V3 or 5V, through 1 k to ground). The bench powers the board from USB,
// so both supplies are always present.
import { fitted } from "../bench";
import type { PartDef } from "../types";
import { empty, rect } from "./_draw";

export const part: PartDef = {
  kind: "power-led",
  name: "Supply LED",
  description: "A light that is on while its supply is present.",
  terminals: [
    { id: "a", name: "anode side", role: "power" },
    { id: "k", name: "cathode side", role: "ground" },
  ],
  onBoard: (p) => ({ a: p.rail ?? "3V3", k: "GND" }),
  status: (i) => ({ text: `on: ${i.conn.a} is present`, level: 1 }),
  draw(i, _s, box) {
    if (!fitted(i)) return empty(box);
    const [x, y, w, h] = box;
    return [rect(x, y, w, h, "metal", false), rect(x + w * 0.25, y + h * 0.15, w * 0.5, h * 0.7, "lit")];
  },
};
