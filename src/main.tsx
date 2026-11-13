import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./ui/styles.css";
import { App } from "./ui/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// In a browser (not the desktop app, not the dev server) keep a copy of the
// game for offline use, which also lets the browser offer "Install".
if (import.meta.env.PROD && !("__TAURI_INTERNALS__" in window) && "serviceWorker" in navigator && location.protocol === "https:")
  window.addEventListener("load", () => void navigator.serviceWorker.register("./sw.js").catch(() => {}));
