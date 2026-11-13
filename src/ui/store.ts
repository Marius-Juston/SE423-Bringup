// Progress is saved on this computer only (the webview's local storage).
import { useSyncExternalStore } from "react";

export interface Save {
  version: 1;
  /** Levels passed. */
  passed: Record<string, true>;
  /**
   * Passed levels that were passed with help (the reference solution was
   * open, or the last hint was showing). They count like any other pass;
   * a later pass without help removes the mark.
   */
  assisted: Record<string, true>;
  /** Bonus objectives earned per level (indices into the level's `bonus` list). */
  stars: Record<string, number[]>;
  /** Hints revealed per level. */
  hints: Record<string, number>;
  /** Failed test runs per code level (check hints appear from the second one). */
  fails: Record<string, number>;
  /** The student's code per code level. */
  code: Record<string, string>;
  /** Kept so older saves load; chapters are no longer gated. */
  unlockAll: boolean;
}

const KEY = "bringup-save-v1";
const empty = (): Save => ({ version: 1, passed: {}, assisted: {}, stars: {}, hints: {}, fails: {}, code: {}, unlockAll: false });

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Builds a complete save from whatever was stored: older versions miss fields, and a hand-edited file can hold anything. */
function clean(s: unknown): Save | null {
  if (!isMap(s) || s.version !== 1 || !isMap(s.passed)) return null;
  const out = empty();
  const keep = <T>(from: unknown, to: Record<string, T>, ok: (v: unknown) => v is T) => {
    if (isMap(from)) for (const [k, v] of Object.entries(from)) if (ok(v)) to[k] = v;
  };
  const isTrue = (v: unknown): v is true => v === true;
  const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  keep(s.passed, out.passed, isTrue);
  keep(s.assisted, out.assisted, isTrue);
  keep(s.stars, out.stars, (v): v is number[] => Array.isArray(v) && v.every(isCount));
  keep(s.hints, out.hints, isCount);
  keep(s.fails, out.fails, isCount);
  keep(s.code, out.code, (v): v is string => typeof v === "string");
  for (const id of Object.keys(out.assisted)) if (!out.passed[id]) delete out.assisted[id];
  out.unlockAll = s.unlockAll === true;
  return out;
}

function load(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return clean(JSON.parse(raw)) ?? empty();
  } catch {
    /* storage unavailable or unreadable: play without saving */
  }
  return empty();
}

let state = load();
const listeners = new Set<() => void>();

function commit(next: Save): void {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export const store = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** Records a pass. A pass with help never downgrades an earlier pass without help. */
  pass(id: string, withHelp = false) {
    const was = !!state.passed[id];
    if (was && (withHelp || !state.assisted[id])) return;
    const assisted = { ...state.assisted };
    if (withHelp) assisted[id] = true;
    else delete assisted[id];
    commit({ ...state, passed: { ...state.passed, [id]: true }, assisted });
  },
  /** Adds earned stars (they are never taken away by a later, plainer solution). */
  star(id: string, earned: number[]) {
    const have = state.stars[id] ?? [];
    const merged = [...new Set([...have, ...earned])].sort((a, b) => a - b);
    if (merged.length !== have.length) commit({ ...state, stars: { ...state.stars, [id]: merged } });
  },
  hint(id: string, n: number) {
    if ((state.hints[id] ?? 0) < n) commit({ ...state, hints: { ...state.hints, [id]: n } });
  },
  /** Hides the hints of a level again (for another try without help). */
  clearHints(id: string) {
    if (!state.hints[id]) return;
    const hints = { ...state.hints };
    delete hints[id];
    commit({ ...state, hints });
  },
  /** Counts a failed test run and returns the new count. */
  fail(id: string): number {
    const n = (state.fails[id] ?? 0) + 1;
    commit({ ...state, fails: { ...state.fails, [id]: n } });
    return n;
  },
  setCode(id: string, code: string) {
    if (state.code[id] === code) return;
    commit({ ...state, code: { ...state.code, [id]: code } });
  },
  resetCode(id: string) {
    const code = { ...state.code };
    delete code[id];
    commit({ ...state, code });
  },
  setUnlockAll(v: boolean) {
    commit({ ...state, unlockAll: v });
  },
  export: () => JSON.stringify(state, null, 2),
  import(text: string): boolean {
    try {
      const s = clean(JSON.parse(text));
      if (!s) return false;
      commit(s);
      return true;
    } catch {
      return false;
    }
  },
  reset() {
    commit(empty());
  },
};

export function useSave(): Save {
  return useSyncExternalStore(store.subscribe, store.get);
}
