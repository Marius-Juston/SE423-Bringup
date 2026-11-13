// Interface preferences (pane widths, collapsed panels), kept per computer.
import { useCallback, useSyncExternalStore } from "react";

const KEY = "bringup-ui-v1";
let prefs: Record<string, unknown> = {};
try {
  prefs = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
} catch {
  prefs = {};
}
const listeners = new Set<() => void>();
// Another window of the game changed a preference (the theme, a pane width): follow it.
if (typeof window !== "undefined")
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    try {
      prefs = JSON.parse(e.newValue ?? "{}") ?? {};
    } catch {
      return;
    }
    listeners.forEach((l) => l());
  });

function set(key: string, value: unknown): void {
  prefs = { ...prefs, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* preferences are optional */
  }
  listeners.forEach((l) => l());
}

export function usePref<T>(key: string, fallback: T): [T, (v: T) => void] {
  const all = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => prefs,
  );
  const value = (key in all ? all[key] : fallback) as T;
  const update = useCallback((v: T) => set(key, v), [key]);
  return [value, update];
}
