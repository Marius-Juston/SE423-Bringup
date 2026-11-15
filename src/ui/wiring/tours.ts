// What each board lesson's figure shows (primer D, src/levels/chapters/
// chD_board.ts): the region of the board, the names written in it and what
// is chosen when it opens. Every pin here is looked up in the compiled board
// data, never typed in; tests/board_lessons.test.ts holds the lessons'
// questions against the same data.
import { HW_BOARD } from "../../sim/wiring/board";
import type { TourSpec } from "./TourFigure";

const B = HW_BOARD;
const part = (id: string) => B.parts.find((p) => p.id === id)!;
const ids = (kind: string): string[] => B.parts.filter((p) => p.kind === kind).map((p) => p.id);
/** The LaunchPad pin (1 to 80) a part's GPIO pin is on. */
const pinOf = (id: string): number => B.launchpad.pins.find((p) => p[2] === B.nets.indexOf(`GPIO${part(id).pin}`))![3];
const named = (list: string[], words: (id: string) => string = () => ""): Record<string, string> => Object.fromEntries(list.map((id) => [id, words(id)]));
/** The first and the last pin of each of the eight headers. */
const HEADER_ENDS = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((j) => [j * 10 - 9, j * 10]);

const LEDS = ids("led");
const CHIPS = ids("inverter");
const BUTTONS = ids("button");
const IMU_JUMPERS = ids("imu-jumper");

export const TOURS = {
  /** The whole board, for the Handbook. */
  board: {
    start: { t: "part", id: "LED1" },
    views: [{ name: "The homework board, with the LaunchPad in the middle", crop: [0, 0, B.w, B.h] }],
    parts: "all",
    pins: [],
    heads: true,
    caption: "The whole homework board. Parts are named where there is room.",
  },
  /** "The board and the LaunchPad": where the LaunchPad sits, its four header pairs, how its pins are numbered. */
  headers: {
    // The lesson's own example: "pin 8, J1.8".
    start: { t: "pin", n: 8 },
    views: [{ name: "The upper part of the homework board, with the LaunchPad in the middle", crop: [0, 0, B.w, 135], narrow: [10, 0, 120, 135] }],
    parts: named([...LEDS, ...BUTTONS, "B1"]),
    pins: HEADER_ENDS,
    numbers: true,
    heads: true,
    caption: "The LaunchPad's four header pairs are named above their columns, and the first and last pin of each header carry their number.",
  },
  /** "Follow a part to its pin": the 16 LEDs, the three inverter chips, the pins the LEDs are on. */
  leds: {
    start: { t: "part", id: "LED1" },
    views: [{ name: "The upper right of the homework board: the LEDs, the inverter chips and the LaunchPad", crop: [30, 0, B.w - 30, 126], narrow: [14, 0, B.w - 14, 128] }],
    parts: named([...LEDS, ...CHIPS]),
    pins: LEDS.map(pinOf),
    heads: true,
    caption: "The LEDs carry their numbers, the inverter chips their names, and each pin an LED is on its signal.",
  },
  /** "A push button and the pull-up": PB1 to PB4 and their pins. */
  buttons: {
    start: { t: "part", id: BUTTONS[0] },
    views: [{ name: "The upper right of the homework board: the push buttons and the right side of the LaunchPad", crop: [70, 0, B.w - 70, 107] }],
    parts: named(BUTTONS),
    pins: BUTTONS.map(pinOf),
    heads: true,
    caption: "The four push buttons and the pins they are on are named.",
  },
  /** "Jumpers": the buzzer with its jumper, the IMU with its four. */
  jumpers: {
    start: { t: "part", id: "JBUZ" },
    views: [
      { name: "The buzzer and its jumper, at the top right of the homework board", crop: [64, 0, 78, 76] },
      { name: "The IMU and its four jumpers, below the LaunchPad", crop: [30, 88, 78, 76] },
    ],
    parts: { ...named(["B1", "JBUZ", "IC3", "IMU"]), ...named(IMU_JUMPERS, (id) => `${part(id).signal}: GPIO${part(id).pin}`) },
    pins: ["JBUZ", ...IMU_JUMPERS].map(pinOf),
    heads: true,
    caption: "Left: the buzzer and its jumper. Right, or below in a narrow column: the IMU and its four jumpers, each with the pin it carries.",
  },
} satisfies Record<string, TourSpec>;
