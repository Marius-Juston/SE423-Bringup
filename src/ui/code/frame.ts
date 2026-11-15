// The live run advances on every animation frame, but redrawing the whole
// bench that often keeps the browser busy almost all the time, and on a
// slower computer the picture stutters. So the parts of the bench redraw
// about 20 times a second, and only a view that shows motion (the robot
// arena) redraws about 30 times a second.
//
// Nothing above the bench redraws on a frame. The level view steps the
// program and tells the two buses here; each part of the bench that shows
// the running board subscribes to one (useBenchFrame, useFrame), and a
// part that only needs to know when something about the run changes
// (running, paused, the line, the number of messages) asks with useLive,
// which redraws it only when the answer changes.
//
// The board of a running program is one object that changes in place: it
// can never be compared to see whether something changed. So a part that
// reads it subscribes here, and is never skipped because "its props are
// the same".
import { useSyncExternalStore } from "react";

/** Motion views redraw at most this often, ms: about 30 times a second, which the eye reads as smooth. */
export const MOTION_FRAME_MS = 30;
/** How often the rest of the bench redraws while a program runs, ms. */
export const BENCH_FRAME_MS = 50;

interface Bus {
  /** Called once per animation frame of a live run, with the frame's time (ms). `force` skips the rate limit. */
  emit(now: number, force?: boolean): void;
  subscribe(f: () => void): () => void;
  get(): number;
}

function bus(everyMs: number): Bus {
  const subscribers = new Set<() => void>();
  let frame = 0;
  let last = 0;
  return {
    emit(now, force = false) {
      if (!force && now - last < everyMs) return;
      last = now;
      frame++;
      for (const f of [...subscribers]) f();
    },
    subscribe(f) {
      subscribers.add(f);
      return () => subscribers.delete(f);
    },
    get: () => frame,
  };
}

export const frameBus = bus(MOTION_FRAME_MS);
export const benchBus = bus(BENCH_FRAME_MS);

/** Tells every part of the bench to redraw now: after a step, a pause, or a change made by hand while paused. */
export function redrawBench(): void {
  const now = performance.now();
  frameBus.emit(now, true);
  benchBus.emit(now, true);
}

/** Re-renders the calling component on every motion frame of a live run. */
export function useFrame(): number {
  return useSyncExternalStore(frameBus.subscribe, frameBus.get, frameBus.get);
}

/** Re-renders the calling component about 20 times a second while a program runs. */
export function useBenchFrame(): number {
  return useSyncExternalStore(benchBus.subscribe, benchBus.get, benchBus.get);
}

/**
 * A fact about the running program, read again on every bench frame; the calling component
 * re-renders only when it changes. `select` must return a string, number or boolean.
 */
export function useLive<T extends string | number | boolean>(select: () => T): T {
  return useSyncExternalStore(benchBus.subscribe, select, select);
}
