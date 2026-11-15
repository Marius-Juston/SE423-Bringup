// The wiring bench's state in the interface: saved on this computer under
// its own key, with undo and redo for the session. The simulator reads the
// current bench through src/sim/wiring/active.ts while the Sandbox shows it.
import { useSyncExternalStore } from "react";
import { emptyBench, parseBench, serializeBench } from "../../sim/wiring/bench";
import { benchLink, lessonBench } from "../../sim/wiring/active";
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
    benchLink.changes = 0;
    benchLink.state = v ? state : null;
    if (!v) benchLink.engine = null;
  },
};

type Opts = Record<string, Record<string, string>>;

/** What the panel needs of a store: the Sandbox's saved bench, or the bench of one fault-finding level. */
export interface BenchStore {
  get(): BenchState;
  subscribe(l: () => void): () => void;
  set(next: BenchState, tag?: string): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  enable(v: boolean): void;
  /** Only in a level: what the student has changed so far, and a way to change one option ("" takes it back). */
  touched?(): Opts;
  repair?(id: string, option: string, choice: string): void;
  reset?(): void;
}

/**
 * The bench of a fault-finding level: it starts with the level's faults, which the panel does not show, and
 * keeps what the student repairs. Nothing of it is saved: the level starts afresh each time.
 */
export function lessonStore(faults: Opts): BenchStore {
  let touched: Opts = {};
  let inputs: BenchState["inputs"] = {};
  let past: Opts[] = [];
  let future: Opts[] = [];
  let on = false;
  const subs = new Set<() => void>();
  const build = (): BenchState => {
    const { state, changes } = lessonBench(faults, touched);
    if (on) benchLink.changes = changes;
    return { ...state, inputs };
  };
  let state = build();
  const commit = () => {
    state = build();
    if (on) benchLink.state = state;
    subs.forEach((l) => l());
    if (on) benchLink.engine?.sync();
  };
  const change = (next: Opts) => {
    past.push(touched);
    future = [];
    touched = next;
    commit();
  };
  return {
    get: () => state,
    subscribe(l) {
      subs.add(l);
      return () => subs.delete(l);
    },
    // Only sliders reach here: the options go through repair().
    set(next) {
      inputs = next.inputs;
      commit();
    },
    undo() {
      const prev = past.pop();
      if (!prev) return;
      future.push(touched);
      touched = prev;
      commit();
    },
    redo() {
      const next = future.pop();
      if (!next) return;
      past.push(touched);
      touched = next;
      commit();
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    enable(v) {
      on = v;
      benchLink.state = v ? state : null;
      benchLink.changes = v ? lessonBench(faults, touched).changes : 0;
      if (!v) benchLink.engine = null;
    },
    touched: () => touched,
    repair(id, option, choice) {
      const { [option]: _gone, ...rest } = touched[id] ?? {};
      change({ ...touched, [id]: choice ? { ...rest, [option]: choice } : rest });
    },
    reset() {
      if (Object.values(touched).some((o) => Object.keys(o).length)) change({});
    },
  };
}

export function useBench(store: BenchStore = benchStore): BenchState {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
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
