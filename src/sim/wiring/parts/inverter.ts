// A 74LVC04: six inverters. On the board each LED (and the buzzer) hangs on
// an inverter's output, so the chip's pin only has to drive the inverter's
// input, not the LED's current (HW1 solders three of them, each with a
// 0.1 uF capacitor). Without the chip, everything behind it stays off.
// Not modelled: the capacitor, propagation delay.
import { fitted } from "../bench";
import type { PartDef } from "../types";
import { empty, rect, text } from "./_draw";

export const part: PartDef = {
  kind: "inverter",
  name: "Inverter chip",
  description: "Six inverters that drive the LEDs for the chip's pins.",
  terminals: [],
  onBoard: () => ({}),
  status: (i) => ({ text: `drives ${(i.part?.serves ?? []).join(", ")}` }),
  draw(i, _s, box) {
    if (!fitted(i)) return empty(box);
    const [x, y, w, h] = box;
    return [rect(x, y, w, h, "part"), text(x + w / 2, y + h / 2 + 0.6, i.id, 1.7)];
  },
};
