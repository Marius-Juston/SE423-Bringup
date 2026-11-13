// Inside the desktop app, links open in the system browser; in a normal
// browser tab they behave as ordinary links.
import type { MouseEvent } from "react";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function openExternal(e: MouseEvent, url: string): void {
  if (!inTauri) return;
  e.preventDefault();
  void import("@tauri-apps/plugin-opener").then((m) => m.openUrl(url));
}
