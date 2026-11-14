// Interface preferences (pane widths, collapsed panels), kept per computer.
import { useCallback, useSyncExternalStore } from "react";

const KEY = "bringup-ui-v1";
/** The stored preferences, or none when what was stored is not a map of them (a hand-edited or damaged entry). */
export function readPrefs(raw: string | null): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** One preference. A stored value of another type than the fallback (text where a number belongs) counts as not set. */
export function prefValue<T>(all: Record<string, unknown>, key: string, fallback: T): T {
  if (!Object.prototype.hasOwnProperty.call(all, key)) return fallback;
  const v = all[key];
  if (fallback !== null && fallback !== undefined && (typeof v !== typeof fallback || (typeof v === "number" && !Number.isFinite(v)))) return fallback;
  return v as T;
}

let prefs: Record<string, unknown> = {};
try {
  prefs = readPrefs(localStorage.getItem(KEY));
} catch {
  prefs = {};
}
const listeners = new Set<() => void>();
// Another window of the game changed a preference (the theme, a pane width): follow it.
if (typeof window !== "undefined")
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    prefs = readPrefs(e.newValue);
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
  const value = prefValue(all, key, fallback);
  const update = useCallback((v: T) => set(key, v), [key]);
  return [value, update];
}
