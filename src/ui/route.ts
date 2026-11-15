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
 * Runs a change of screen, as a transition: while the new screen's part of the game is fetched
 * (screens.tsx) the old one stays, and nothing flashes. Where motion is allowed the transition is
 * named, and React cross-fades the two screens in a browser that has view transitions (the
 * ViewTransition in App.tsx); one that has not simply swaps them. With prefers-reduced-motion it
 * has no name: the screens are swapped, no view transition is started and nothing is animated.
 */
export function navigate(change: () => void): void {
  const still = typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  startTransition(() => {
    if (!still) addTransitionType(SCREEN_CHANGE);
    change();
  });
}
