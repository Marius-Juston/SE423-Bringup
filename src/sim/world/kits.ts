import { PLUGINS } from "../plugin";

// The parts wired to the chip on the course boards. Pin numbers come from
// the course handouts (Lab 1, Lab 2, HW1) and the LABstarter project.

export interface Led {
  kind: "led";
  id: string;
  label: string;
  pin: number;
  /** The LaunchPad's own LEDs light when the pin is low. */
  activeLow: boolean;
  color: "red" | "blue" | "green" | "amber";
  /** Where the LED sits in the board's LED display: column and row, counted from 1 at the top left. */
  at?: [col: number, row: number];
}

export interface Button {
  kind: "button";
  id: string;
  label: string;
  pin: number;
}

/** A value the student can turn: feeds a named input of the signal bus. */
export interface Knob {
  kind: "knob";
  id: string;
  label: string;
  /** Name on the signal bus, e.g. "ADCINA4". */
  input: string;
  min: number;
  max: number;
  step?: number;
  initial: number;
  unit: string;
}

/** A read-out of a named output of the signal bus (a voltage, a speed, an angle). */
export interface Meter {
  kind: "meter";
  id: string;
  label: string;
  /** Name on the signal bus, e.g. "DACA". */
  output: string;
  unit: string;
  /** Digits after the decimal point (default 2). */
  digits?: number;
}

export type Part = Led | Button | Knob | Meter;

export interface Kit {
  id: string;
  name: string;
  parts: Part[];
}

const launchpadLeds: Led[] = [
  { kind: "led", id: "BLUE", label: "LaunchPad blue LED", pin: 31, activeLow: true, color: "blue" },
  { kind: "led", id: "RED", label: "LaunchPad red LED", pin: 34, activeLow: true, color: "red" },
];

const led = (i: number, pin: number): Led => ({ kind: "led", id: `LED${i}`, label: `LED${i}`, pin, activeLow: false, color: "amber" });
const pb = (i: number, pin: number): Button => ({ kind: "button", id: `PB${i}`, label: `PB${i}`, pin });

export const KITS: Record<string, Kit> = {
  launchpad: { id: "launchpad", name: "LaunchPad", parts: launchpadLeds },
  robot: {
    id: "robot",
    name: "Robot board",
    parts: [
      ...launchpadLeds,
      led(1, 22), led(2, 94), led(3, 95), led(4, 97), led(5, 111),
      pb(1, 157), pb(2, 158), pb(3, 159), pb(4, 160),
    ],
  },
  redboard: {
    id: "redboard",
    name: "Homework red board",
    parts: [
      ...launchpadLeds,
      // The 16 LEDs are a display, as on the board: LED1 to LED15 fill three columns of five from the
      // top, column by column, and LED16 stands to the right of the bottom row.
      ...[22, 94, 95, 97, 111, 130, 131, 25, 26, 27, 60, 61, 157, 158, 159, 160].map((p, i): Led => ({
        ...led(i + 1, p),
        at: i < 15 ? [Math.floor(i / 5) + 1, (i % 5) + 1] : [4, 5],
      })),
      pb(1, 4), pb(2, 5), pb(3, 6), pb(4, 7),
    ],
  },
};

// Parts contributed by simulator plugins.
for (const p of PLUGINS) for (const [kit, parts] of Object.entries(p.parts ?? {})) KITS[kit]?.parts.push(...parts);

export function findPart(kit: Kit, id: string): Part {
  const p = kit.parts.find((x) => x.id === id);
  if (!p) throw new Error(`kit ${kit.id} has no part ${id}`);
  return p;
}
