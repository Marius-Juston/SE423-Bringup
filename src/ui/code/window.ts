// How much time the bench shows of a live run. A program that runs on has no
// end, so the panels that draw time (interrupt functions, pins over time,
// the analog plot) show a window that moves with it. Its size follows what
// the program does: about thirty runs of its fastest interrupt function, or
// a few periods of its fastest pin. Pure, so it can be tested.

const MS = 1e6;
/** The sizes a window can have, ms: round numbers a time axis reads well in. */
export const WINDOW_STEPS_MS = [1, 2, 5, 10, 20, 50, 100, 200, 400, 1000, 2000, 5000, 10000];
/** Before anything has happened, and for a program that does nothing periodic. */
export const WINDOW_DEFAULT_MS = 400;

interface Activity {
  /** Interrupt runs in time order (the recent ones are enough). */
  isrLog: readonly { t: number; name: string }[];
  /** Pin changes in time order, per pin. */
  pins: Iterable<readonly { t: number }[]>;
}

/** The shortest time between two runs of the same interrupt function among the last few hundred runs, ns. */
function fastestIsrNs(log: Activity["isrLog"]): number | undefined {
  const last = new Map<string, number>();
  let best: number | undefined;
  for (let i = Math.max(0, log.length - 300); i < log.length; i++) {
    const e = log[i];
    const before = last.get(e.name);
    if (before !== undefined && e.t > before && (best === undefined || e.t - before < best)) best = e.t - before;
    last.set(e.name, e.t);
  }
  return best;
}

/** The shortest full period (two changes) among the pins' latest changes, ns. */
function fastestPinNs(pins: Activity["pins"]): number | undefined {
  let best: number | undefined;
  for (const tr of pins) {
    const n = tr.length;
    if (n < 3) continue;
    const period = tr[n - 1].t - tr[n - 3].t;
    if (period > 0 && (best === undefined || period < best)) best = period;
  }
  return best;
}

/**
 * The window for what the program is doing now. `before` is the window in
 * use: it is kept while it still fits, so the picture does not change size
 * at every small change of rate. It grows as soon as it holds fewer than
 * about ten runs, and shrinks only when it holds more than about a hundred.
 */
export function autoWindowMs(a: Activity, before?: number): number {
  const isr = fastestIsrNs(a.isrLog);
  const pin = fastestPinNs(a.pins);
  // Thirty runs of an interrupt function; eight periods of a pin when no function runs.
  const want = isr !== undefined ? (isr * 30) / MS : pin !== undefined ? (pin * 8) / MS : undefined;
  if (want === undefined) return before ?? WINDOW_DEFAULT_MS;
  const snapped = WINDOW_STEPS_MS.find((s) => s >= want) ?? WINDOW_STEPS_MS[WINDOW_STEPS_MS.length - 1];
  if (before === undefined) return snapped;
  if (want > before * 3 || want < before / 3.5) return snapped;
  return before;
}

/** "5 ms", "2 s". */
export const windowName = (ms: number): string => (ms >= 1000 ? `${ms / 1000} s` : `${ms} ms`);
