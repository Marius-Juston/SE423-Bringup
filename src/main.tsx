import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./ui/fonts.css";
import "./ui/styles.css";
import { App } from "./ui/App";
import { partMissing } from "./ui/parts";
import { screenReady } from "./ui/screens";
import { viewOf } from "./ui/route";

// A part of the game that is fetched later (a screen, a figure) is no longer there: see partMissing.
window.addEventListener("vite:preloadError", (e) => {
  if (partMissing()) e.preventDefault();
});

const draw = () =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
// The map is in this script. A page that opens on another screen (a reload on a level, a link to the Handbook)
// first fetches that screen's part, so the first thing drawn is the screen and not a placeholder for it.
// On a slow connection the page is drawn after a moment anyway, with a line that says what is loading.
const first = viewOf(window.location.hash);
if (first.name === "map" || new URLSearchParams(window.location.search).has("figure")) draw();
else {
  let drawn = false;
  const once = () => {
    if (!drawn) draw();
    drawn = true;
  };
  screenReady(first).then(once, once);
  window.setTimeout(once, 1500);
}

// In a browser (not the desktop app, not the dev server) keep a copy of the
// game for offline use, which also lets the browser offer "Install".
if (import.meta.env.PROD && !("__TAURI_INTERNALS__" in window) && "serviceWorker" in navigator && location.protocol === "https:")
  window.addEventListener("load", () => void navigator.serviceWorker.register("./sw.js").catch(() => {}));
