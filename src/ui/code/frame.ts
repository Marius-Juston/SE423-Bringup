// The live run advances on every animation frame, but redrawing the whole
// bench that often keeps the browser busy almost all the time, and on a
// slower computer the picture stutters. So the bench as a whole redraws
// about 20 times a second, and only a view that shows motion (the robot
// arena) redraws about 30 times a second, by subscribing here.
import { useSyncExternalStore } from "react";

const subscribers = new Set<() => void>();
let frame = 0;
let last = 0;

/** Motion views redraw at most this often, ms: about 30 times a second, which the eye reads as smooth. */
export const MOTION_FRAME_MS = 30;

export const frameBus = {
  /** Called by the live run's loop once per animation frame, with the frame's time (ms). */
  emit(now: number, force = false): void {
    if (!force && now - last < MOTION_FRAME_MS) return;
    last = now;
    frame++;
    for (const f of subscribers) f();
  },
  subscribe(f: () => void): () => void {
    subscribers.add(f);
    return () => subscribers.delete(f);
  },
  get: (): number => frame,
};

/** Re-renders the calling component on every frame of a live run. */
export function useFrame(): number {
  return useSyncExternalStore(frameBus.subscribe, frameBus.get, frameBus.get);
}

/** How often the rest of the bench redraws while a program runs, ms. */
export const BENCH_FRAME_MS = 50;
