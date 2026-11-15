// The battery pack of homework 4: four AA cells, about 6 V, soldered to the
// board for the RC servos (a servo must not run from USB power). It sits on
// the back of the board. Without it, nothing connected to the battery pack
// has a supply.
// Not modelled: the cells running down.
import { fitted } from "../bench";
import type { PartDef } from "../types";
import { line } from "./_draw";

export const part: PartDef = {
  kind: "battery",
  name: "Battery pack",
  description: "Four AA cells, 6 V, that power the RC servos.",
  terminals: [],
  onBoard: () => ({}),
  status: () => ({ text: "6 V for the servo connectors", level: 1 }),
  draw(i, _s, box) {
    const [x, y, w, h] = box;
    // On the back of the board: a dashed outline, crossed out when the pack is not there.
    return [{ s: "rect", x, y, w, h, r: 1, tone: fitted(i) ? "part" : "gone", dash: true }, ...(fitted(i) ? [] : [line(x, y, x + w, y + h, "gone"), line(x + w, y, x, y + h, "gone")])];
  },
};
