// Progress is saved on this computer only (the webview's local storage).
import { useSyncExternalStore } from "react";
import { dayKey, nextReview, type Review } from "./review";

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
  /** When each level was first passed (ms since the epoch). Saves from before this was recorded get the time they were loaded. */
  passedAt: Record<string, number>;
  /** Spaced review: when a passed puzzle is due again (levels not listed are due two days after `passedAt`). */
  reviews: Record<string, Review>;
  /** The day a warm-up was last started or dismissed: one is suggested per day at most. */
  warmupDay: string;
  /** Personal bests per code level and star label: the best measured value on a pass without help. */
  bests: Record<string, Record<string, number>>;
}

const KEY = "bringup-save-v1";
const empty = (): Save => ({ version: 1, passed: {}, assisted: {}, stars: {}, hints: {}, fails: {}, code: {}, unlockAll: false, passedAt: {}, reviews: {}, warmupDay: "", bests: {} });

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Builds a complete save from whatever was stored: older versions miss fields, and a hand-edited file can hold anything. */
export function clean(s: unknown, now = Date.now()): Save | null {
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
  const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  keep(s.passedAt, out.passedAt, isCount);
  keep(s.reviews, out.reviews, (v): v is Review => isMap(v) && isNum(v.due) && isNum(v.interval) && v.interval > 0);
  keep(s.bests, out.bests, (v): v is Record<string, number> => isMap(v) && Object.values(v).every(isNum));
  // A save from before passes were dated: its levels count as passed now, so their first review is two days away.
  for (const id of Object.keys(out.passed)) if (out.passedAt[id] === undefined) out.passedAt[id] = now;
  for (const m of [out.passedAt, out.reviews]) for (const id of Object.keys(m)) if (!out.passed[id]) delete m[id];
  out.warmupDay = typeof s.warmupDay === "string" ? s.warmupDay : "";
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

// Another window of the game saved: take its progress, so that this window's next save does not undo it.
if (typeof window !== "undefined")
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY && e.key !== null) return;
    state = load();
    listeners.forEach((l) => l());
  });

/** Work that must be saved before the window goes away (code typed a moment ago). */
const pending = new Set<() => void>();
const flush = () => pending.forEach((f) => f());
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
}

export const store = {
  get: () => state,
  /** Registers a save to make when the window is hidden or closed. Returns the function that removes it. */
  beforeLeave(f: () => void) {
    pending.add(f);
    return () => {
      pending.delete(f);
    };
  },
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
    commit({ ...state, passed: { ...state.passed, [id]: true }, assisted, passedAt: was ? state.passedAt : { ...state.passedAt, [id]: Date.now() } });
  },
  /** Records a warm-up answer: right at the first try waits longer, a miss comes back in two days. */
  review(id: string, right: boolean, now = Date.now()) {
    if (!state.passed[id]) return;
    commit({ ...state, reviews: { ...state.reviews, [id]: nextReview(state.reviews[id], right, now) } });
  },
  /** A warm-up was started or dismissed: none is suggested again today. */
  warmupSeen(now = Date.now()) {
    const day = dayKey(now);
    if (state.warmupDay !== day) commit({ ...state, warmupDay: day });
  },
  /** Stores improved personal bests of a level (the caller decides what improves). */
  best(id: string, values: Record<string, number>) {
    if (!Object.keys(values).length) return;
    commit({ ...state, bests: { ...state.bests, [id]: { ...state.bests[id], ...values } } });
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
