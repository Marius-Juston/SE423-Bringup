// A test run that leaves the page usable. The simulator runs the program in
// slices of simulated time (runProgramSteps); this file drives the slices in
// short turns of real time and gives the browser a turn in between, so the
// page can draw the progress, scroll and take a press on Cancel.
// The wall clock is read here and never in src/sim.
import { useSyncExternalStore } from "react";
import { runProgramSteps, type RunResult, type RunSpec } from "../../sim/runner";

/** Simulated time per slice, ms. Small, so that one slice of a heavy program stays well inside a turn. */
export const TEST_SLICE_MS = 2;
/** Real time the simulator may work before the browser gets a turn, ms. A frame at 60 Hz is 16.7 ms. */
export const TURN_BUDGET_MS = 12;
/** The progress bar is told at most this often, ms. */
const PROGRESS_EVERY_MS = 80;

/** Timers and other queued work wait at most this long while a test runs, ms. */
const FULL_TURN_EVERY_MS = 50;

type Yielder = { yield?: () => Promise<void> };

let port: MessagePort | null = null;
const waiting: (() => void)[] = [];
let lastFull = 0;

/** A turn for everything that is queued: a message on a MessageChannel, which is not slowed down the way a timer is. */
function fullTurn(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!port) {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => waiting.shift()?.();
      // Outside a browser (the unit tests) an open port must not keep the process alive.
      (ch.port1 as { unref?: () => void }).unref?.();
      port = ch.port2;
    }
    waiting.push(resolve);
    port.postMessage(0);
  });
}

/**
 * Resolves after the browser has had a turn. `scheduler.yield()` where it exists: input is handled
 * and the run resumes ahead of other queued work. That alone would hold back timers and everything
 * else queued until the run ends (measured in Chromium: a 50 ms timer came 9 s late, and the page
 * drew 11 times a second), so at least every 50 ms the turn is a full one. Safari and the WebKit
 * webviews have no scheduler: there every turn is a full one.
 */
export function browserTurn(): Promise<void> {
  const s = (globalThis as { scheduler?: Yielder }).scheduler;
  const now = performance.now();
  if (s && typeof s.yield === "function" && now - lastFull < FULL_TURN_EVERY_MS) return s.yield();
  lastFull = now;
  return fullTurn();
}

export interface TestRun {
  /** The result, or null when the run was cancelled. */
  readonly done: Promise<RunResult | null>;
  /** Drops the run: it stops at its next turn and `done` resolves to null. */
  cancel(): void;
  /** The fraction of the test's simulated time that has run, 0 to 1. */
  fraction(): number;
  subscribe(f: () => void): () => void;
}

/** Starts a level's test run. The first turn goes to the browser, so "running" is on the screen before any work. */
export function startTestRun(spec: RunSpec, turn: () => Promise<void> = browserTurn, now: () => number = () => performance.now()): TestRun {
  let cancelled = false;
  let fraction = 0;
  const subscribers = new Set<() => void>();
  const done = (async (): Promise<RunResult | null> => {
    await turn();
    if (cancelled) return null;
    const steps = runProgramSteps(spec, TEST_SLICE_MS);
    let told = now();
    for (;;) {
      const until = now() + TURN_BUDGET_MS;
      let step = steps.next();
      while (!step.done && now() < until) step = steps.next();
      if (step.done) return cancelled ? null : step.value;
      if (now() - told >= PROGRESS_EVERY_MS) {
        told = now();
        fraction = step.value;
        for (const f of subscribers) f();
      }
      await turn();
      if (cancelled) return null;
    }
  })();
  return {
    done,
    cancel: () => {
      cancelled = true;
    },
    fraction: () => fraction,
    subscribe: (f) => {
      subscribers.add(f);
      return () => subscribers.delete(f);
    },
  };
}

/** The percentage of a test run that is done, re-rendering only the component that shows it. */
export function useTestProgress(run: TestRun): number {
  const f = useSyncExternalStore(run.subscribe, run.fraction, run.fraction);
  return Math.floor(f * 100);
}
