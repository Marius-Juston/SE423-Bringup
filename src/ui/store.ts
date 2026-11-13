// Progress is saved on this computer only (the webview's local storage).
import { useSyncExternalStore } from "react";

export interface Save {
  version: 1;
  /** Levels passed. */
  passed: Record<string, true>;
  /** Hints revealed per level. */
  hints: Record<string, number>;
  /** The student's code per code level. */
  code: Record<string, string>;
  unlockAll: boolean;
}

const KEY = "bringup-save-v1";
const empty = (): Save => ({ version: 1, passed: {}, hints: {}, code: {}, unlockAll: false });

function load(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.version === 1) return { ...empty(), ...s };
    }
  } catch {
    /* storage unavailable: play without saving */
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
  pass(id: string) {
    if (!state.passed[id]) commit({ ...state, passed: { ...state.passed, [id]: true } });
  },
  hint(id: string, n: number) {
    if ((state.hints[id] ?? 0) < n) commit({ ...state, hints: { ...state.hints, [id]: n } });
  },
  setCode(id: string, code: string) {
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
      const s = JSON.parse(text);
      if (!s || s.version !== 1 || typeof s.passed !== "object") return false;
      commit({ ...empty(), ...s });
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
