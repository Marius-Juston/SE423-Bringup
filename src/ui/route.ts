// Screens and their addresses: the part of the URL after "#".
import { addTransitionType, startTransition } from "react";
import { findLevel } from "../levels/index";

export type View = { name: "map" } | { name: "level"; id: string } | { name: "handbook"; reg?: string } | { name: "sandbox" } | { name: "settings" };

/** The address of a screen ("#/level/out-blink"), so a reload and the Back button keep your place. The map has none. */
export function hashOf(v: View): string {
  return v.name === "map" ? "" : v.name === "level" ? `#/level/${encodeURIComponent(v.id)}` : `#/${v.name}`;
}

/** The screen an address names; the map for anything else (an unknown level, an old link). */
export function viewOf(hash: string): View {
  const [, name, arg] = hash.split("/");
  if (name === "level") {
    let id = arg ?? "";
    try {
      id = decodeURIComponent(id);
    } catch {
      /* not a level id */
    }
    return findLevel(id) ? { name: "level", id } : { name: "map" };
  }
  return name === "handbook" || name === "sandbox" || name === "settings" ? { name } : { name: "map" };
}

/** The name navigate() gives its transitions, so only a change of screen is animated and no other change in the page. */
export const SCREEN_CHANGE = "screen-change";

/**
 * Runs a change of screen. Where motion is allowed it is a transition: React then cross-fades the
 * old screen into the new one in a browser that has view transitions (the ViewTransition in
 * App.tsx), and simply swaps them in one that has not. With prefers-reduced-motion the change is
 * made at once and nothing is animated.
 */
export function navigate(change: () => void): void {
  const still = typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (still) change();
  else
    startTransition(() => {
      addTransitionType(SCREEN_CHANGE);
      change();
    });
}
