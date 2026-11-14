// Screens and their addresses: the part of the URL after "#".
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
