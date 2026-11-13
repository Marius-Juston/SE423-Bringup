// Personal bests: the measured number behind a star (time in an interrupt,
// distance from a goal, distance driven), kept per level and check label.
import type { Check } from "../sim/runner";

/** What a measured value is compared by, and how it reads. */
export interface Measure {
  /** Lower is better for every kind of check. */
  score: number;
  /** "0.42 us", "5.3 ft", "0.004 ft off target". */
  text: string;
}

const UNITS: [RegExp, string][] = [
  [/_RADPS$/, "rad/s"],
  [/_RAD$/, "rad"],
  [/_FT$/, "ft"],
  [/_IN$/, "in"],
  [/_MS$/, "ms"],
  [/_US$/, "us"],
  [/_S$/, "s"],
  [/_V$/, "V"],
  [/_HZ$/, "Hz"],
  [/_PCT$/, "%"],
  [/^TB_V(LEFT|RIGHT)/, "ft/s"],
];

/** The unit a signal is measured in, from the end of its name (ROBOT_ODOMETER_FT is in feet). */
export function unitOf(signal: string): string {
  return UNITS.find(([re]) => re.test(signal))?.[1] ?? "";
}

/** A number as short as it can be read: three significant digits, no trailing zeros. */
export function fmt(v: number): string {
  if (!Number.isFinite(v)) return "?";
  const a = Math.abs(v);
  if (a !== 0 && a < 0.001) return v.toExponential(1);
  return String(+v.toPrecision(a >= 100 ? 4 : 3));
}

/**
 * How a measured value counts. Lower is better (time in an interrupt, a limit
 * to stay under); a check with only a minimum wants more; a check with a
 * target or a range wants the smallest distance from the target or the middle.
 * Returns null for checks that measure nothing.
 */
export function measure(check: Check, value: number, unit?: string): Measure | null {
  if (!Number.isFinite(value)) return null;
  if (check.kind === "isr-time") return { score: value, text: `${fmt(value)} us` };
  if (check.kind !== "signal") return null;
  const u = unit ?? unitOf(check.name);
  const withUnit = (v: number) => (u === "%" ? `${fmt(v)}%` : u ? `${fmt(v)} ${u}` : fmt(v));
  if (check.equals !== undefined) return { score: Math.abs(value - check.equals), text: `${withUnit(Math.abs(value - check.equals))} off target` };
  if (check.min !== undefined && check.max !== undefined) {
    const off = Math.abs(value - (check.min + check.max) / 2);
    return { score: off, text: `${withUnit(off)} from the middle` };
  }
  if (check.min !== undefined) return { score: -value, text: withUnit(value) };
  return { score: value, text: withUnit(value) };
}

/** True when `value` beats `best` by more than rounding noise (or there is no best yet). */
export function improves(check: Check, value: number, best: number | undefined): boolean {
  const now = measure(check, value);
  if (!now) return false;
  if (best === undefined) return true;
  const was = measure(check, best);
  if (!was) return true;
  return now.score < was.score - 1e-9 * Math.max(1, Math.abs(was.score));
}

export interface BestNote {
  label: string;
  /** This run's value. */
  now: string;
  /** The best before this run, when there was one. */
  was?: string;
  improved: boolean;
}

/**
 * Compares a passing run's star values with the stored bests. Returns the
 * values to store (only improvements) and a note per measured star.
 */
export function compareBests(bonus: Check[], results: { value?: number }[], stored: Record<string, number> | undefined): { store: Record<string, number>; notes: BestNote[] } {
  const out: Record<string, number> = {};
  const notes: BestNote[] = [];
  bonus.forEach((c, i) => {
    const v = results[i]?.value;
    if (v === undefined) return;
    const m = measure(c, v);
    if (!m) return;
    const best = stored?.[c.label];
    const improved = improves(c, v, best);
    if (improved) out[c.label] = v;
    notes.push({ label: c.label, now: m.text, was: best !== undefined ? measure(c, best)?.text : undefined, improved });
  });
  return { store: out, notes };
}
