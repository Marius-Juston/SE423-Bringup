// Small helpers for the parts' pictures and sentences.
import type { BenchView, Inst, Shape, Target, Tone } from "../types";
import { gpioOf } from "../board";
import { whyNotDriven } from "../bench";

export type Box = [number, number, number, number];
export const rect = (x: number, y: number, w: number, h: number, tone: Tone, fill = true, r = 0.4): Shape => ({ s: "rect", x, y, w, h, r, tone, fill });
export const circle = (x: number, y: number, r: number, tone: Tone, fill = true): Shape => ({ s: "circle", x, y, r, tone, fill });
export const line = (x1: number, y1: number, x2: number, y2: number, tone: Tone, w = 0.35): Shape => ({ s: "line", x1, y1, x2, y2, tone, w });
export const text = (x: number, y: number, t: string, size = 1.6, anchor: "start" | "middle" | "end" = "middle", tone: Tone = "ink"): Shape => ({ s: "text", x, y, text: t, size, anchor, tone });
/** A cross over a part that is not on the board. */
export const cross = ([x, y, w, h]: Box): Shape[] => [line(x, y, x + w, y + h, "gone"), line(x + w, y, x, y + h, "gone")];
/** The empty place of a part that is not soldered: a dashed box and a cross. */
export const empty = (b: Box): Shape[] => [{ s: "rect", x: b[0], y: b[1], w: b[2], h: b[3], r: 0.4, tone: "gone", dash: true }, ...cross(b)];

/** Why the pin behind a target is not driving the part, or "" (also "" for a supply or with no program running). */
export function notDriven(b: BenchView, t: Target, wants = ""): string {
  const p = b.pin(t);
  return p ? whyNotDriven(p, wants) : "";
}

/** "GPIO22" or the supply's name, for a sentence. */
export const where = (i: Inst, terminal: string): string => i.conn[terminal] || "nothing";
export const isPin = (t: Target): boolean => gpioOf(t) !== null;
export const pct = (v: number): string => `${Math.round(v * 100)} %`;
