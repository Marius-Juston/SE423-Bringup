// The homework board as data: src/sim/world/boards/hw-board.json, compiled
// from the course's board file by tools/gen-board.mjs. This file gives it
// types and answers the questions the bench asks of it: which pins exist,
// where each one is on the LaunchPad's headers, what a pin can do.

import raw from "../world/boards/hw-board.json";
import { pinMuxRow, signalName } from "../device/pinmux";
import type { BoardPart, Target } from "./types";

export interface HwBoard {
  v: number;
  name: string;
  rev: string;
  /** Size in mm. */
  w: number;
  h: number;
  /** Net names by index: "GND", "3V3", "GPIO22", "ADCINA4", or a row of the pad field. */
  nets: string[];
  groups: { id: string; kind: string; label: string }[];
  /** Every pad a wire could be soldered to: x, y (mm, y down), net, group. */
  holes: [number, number, number, number][];
  parts: BoardPart[];
  /** Copper traces: net, layer (0 top, 1 bottom), then x, y pairs of one line (mm, y down). */
  traces: number[][];
  /** Silkscreen words: x, y, letter height, rotation in degrees, text. */
  texts: [number, number, number, number, string][];
  /** Parts that are only drawn: x, y, width, height, word. */
  decor: [number, number, number, number, string][];
  launchpad: { x: number; y: number; w: number; h: number; pins: [number, number, number, number][]; heads: [number, number, string][] };
}

export const HW_BOARD = raw as unknown as HwBoard;

/** Supplies a terminal can go to, in the order the lists show them. BAT is the battery pack's positive lead. */
export const RAILS: { id: Target; name: string; volts: number }[] = [
  { id: "GND", name: "GND (ground)", volts: 0 },
  { id: "3V3", name: "3V3 (3.3 V)", volts: 3.3 },
  { id: "5V", name: "5V (USB)", volts: 5 },
  { id: "BAT", name: "Battery pack (6 V)", volts: 6 },
];
/** Four AA cells (HW4). */
export const BATTERY_VOLTS = 6;

export const isRail = (t: Target): boolean => RAILS.some((r) => r.id === t);
export const gpioOf = (t: Target): number | null => (/^GPIO(\d+)$/.test(t) ? +t.slice(4) : null);
export const isAdc = (t: Target): boolean => /^ADCIN/.test(t);

/** A header pin of the LaunchPad that the board brings out. */
export interface HeaderPin {
  target: Target;
  /** LaunchPad pin number, 1 to 80. */
  number: number;
  /** Where it is, as the LaunchPad prints it: "J4.10". */
  header: string;
  /** The ePWM outputs the pin can carry ("EPWM8A"), from the course's pin mux table. */
  pwm: string[];
}

/** The LaunchPad's header of a pin number: pins 1 to 10 are J1, 11 to 20 J2, and so on to J8, as its pin mux table prints them. */
const headerOf = (n: number): string => `J${Math.ceil(n / 10)}.${((n - 1) % 10) + 1}`;

/** Every GPIO and ADC pin the board brings out, GPIO first, in natural order. */
export const HEADER_PINS: HeaderPin[] = HW_BOARD.launchpad.pins
  .filter(([, , net]) => net >= 0 && /^(GPIO\d+|ADCIN[A-D]?\d+)$/.test(HW_BOARD.nets[net]))
  .map(([, , net, number]): HeaderPin => {
    const target = HW_BOARD.nets[net];
    const g = gpioOf(target);
    const row = g === null ? undefined : pinMuxRow(g);
    const pwm = row ? Object.values(row.fn).map((f) => signalName(f!)).filter((f) => /^EPWM\d+[AB]$/.test(f)) : [];
    return { target, number, header: headerOf(number), pwm: [...new Set(pwm)] };
  })
  .sort((a, b) => Number(isAdc(a.target)) - Number(isAdc(b.target)) || a.target.localeCompare(b.target, "en", { numeric: true }));

export const headerPin = (t: Target): HeaderPin | undefined => HEADER_PINS.find((p) => p.target === t);

/** "GPIO22 (pin 8, J1.8)", "3V3", or "not connected". */
export function targetWords(t: Target): string {
  if (!t) return "not connected";
  if (t === "BAT") return "battery pack";
  const h = headerPin(t);
  return h ? `${t} (pin ${h.number}, ${h.header})` : t;
}

export const boardPart = (id: string): BoardPart | undefined => HW_BOARD.parts.find((p) => p.id === id);
