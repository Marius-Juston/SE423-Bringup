// The wiring bench's state in the interface: saved on this computer under
// its own key, with undo and redo for the session. The simulator reads the
// current bench through src/sim/wiring/active.ts while the Sandbox shows it.
import { useSyncExternalStore } from "react";
import { emptyBench, parseBench, serializeBench } from "../../sim/wiring/bench";
import { benchLink } from "../../sim/wiring/active";
import type { BenchState } from "../../sim/wiring/types";

/** A new key and a version of its own: damaged or older data gives the default bench (see parseBench). */
export const BENCH_KEY = "bringup-bench-v1";
const HISTORY = 60;

function load(): BenchState {
  try {
    return parseBench(localStorage.getItem(BENCH_KEY));
  } catch {
    return emptyBench();
  }
}

let state = load();
let past: BenchState[] = [];
let future: BenchState[] = [];
/** What the last change was about: moving one slider is one step to undo, not a hundred. */
let lastTag = "";
let on = false;
const listeners = new Set<() => void>();

function commit(next: BenchState): void {
  state = next;
  if (on) benchLink.state = state;
  try {
    localStorage.setItem(BENCH_KEY, serializeBench(state));
  } catch {
    /* the bench still works for this visit */
  }
  listeners.forEach((l) => l());
  // A running program sees the change at once.
  if (on) benchLink.engine?.sync();
}

export const benchStore = {
  get: (): BenchState => state,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** Changes the bench. Changes with the same `tag` in a row (a slider being dragged) are one step to undo. */
  set(next: BenchState, tag = ""): void {
    if (next === state) return;
    if (!tag || tag !== lastTag) {
      past.push(state);
      if (past.length > HISTORY) past.shift();
    }
    lastTag = tag;
    future = [];
    commit(next);
  },
  undo(): void {
    const prev = past.pop();
    if (!prev) return;
    future.push(state);
    lastTag = "";
    commit(prev);
  },
  redo(): void {
    const next = future.pop();
    if (!next) return;
    past.push(state);
    lastTag = "";
    commit(next);
  },
  canUndo: (): boolean => past.length > 0,
  canRedo: (): boolean => future.length > 0,
  /** Switches the bench on for boards made from now on (the Sandbox on the homework board), or off. */
  enable(v: boolean): void {
    on = v;
    benchLink.state = v ? state : null;
    if (!v) benchLink.engine = null;
  },
};

export function useBench(): BenchState {
  return useSyncExternalStore(benchStore.subscribe, benchStore.get, benchStore.get);
}

/** Hands the browser a file to save. */
export function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
