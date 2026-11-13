import { Component, useEffect, useState, type ReactNode } from "react";
import { CHAPTERS, findLevel } from "../levels/index";
import { useSave } from "./store";
import { MapView } from "./MapView";
import { LevelView } from "./LevelView";
import { Handbook } from "./Handbook";
import { Sandbox } from "./Sandbox";
import { Settings } from "./Settings";
import { Figure } from "./figures";
import { Icon, Ring } from "./Icon";
import { usePref } from "./prefs";
import { tierOf } from "../levels/types";

export type View = { name: "map" } | { name: "level"; id: string } | { name: "handbook" } | { name: "sandbox" } | { name: "settings" };

/** Shows a message instead of a blank window if a screen fails to draw. */
class Boundary extends Component<{ children: ReactNode; onReset: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="map" role="alert">
        <h1>Something went wrong on this screen</h1>
        <p className="map-intro">Your progress is safe. This is a bug in the game, not in your code.</p>
        <pre>{String(this.state.error.message)}</pre>
        <button
          className="btn primary"
          onClick={() => {
            this.setState({ error: null });
            this.props.onReset();
          }}
        >
          Back to the map
        </button>
      </div>
    );
  }
}

export function App() {
  // ?figure=<id> shows one figure on its own (used by tools/shot.mjs).
  const only = new URLSearchParams(window.location.search).get("figure");
  if (only) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "1rem" }}>
        <Figure id={only} />
      </div>
    );
  }
  return <Game />;
}

function Game() {
  const [view, setView] = useState<View>({ name: "map" });
  const save = useSave();
  const [theme, setTheme] = usePref<"system" | "light" | "dark">("theme", "system");
  const [scale] = usePref<number>("text-scale", 1);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    root.style.fontSize = `${16 * scale}px`;
  }, [theme, scale]);
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches) || (theme === "system" && !window.matchMedia("(prefers-color-scheme: light)").matches);
  const core = CHAPTERS.flatMap((c) => c.levels).filter((l) => tierOf(l) === "core");
  const done = core.filter((l) => save.passed[l.id]).length;
  const nav = (name: "map" | "handbook" | "sandbox" | "settings", label: string, icon: string) => (
    <button aria-current={view.name === name || (name === "map" && view.name === "level") ? "page" : undefined} onClick={() => setView({ name } as View)}>
      <Icon name={icon} size={16} /> {label}
    </button>
  );
  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <button className="brand" onClick={() => setView({ name: "map" })} aria-label="Bringup, go to the map">
          <span className="brand-mark" aria-hidden="true">
            <i /><i /><i /><i />
          </span>
          Bringup
        </button>
        <nav className="topnav" aria-label="Main">
          {nav("map", "Map", "map")}
          {nav("handbook", "Handbook", "book")}
          {nav("sandbox", "Sandbox", "flask")}
          {nav("settings", "Settings", "gear")}
        </nav>
        <span className="spacer" />
        <span className="progress-pill" title="Core levels passed">
          <Ring value={done} max={core.length} size={22} /> {done}/{core.length}
        </span>
        <button className="icon-btn" onClick={() => setTheme(dark ? "light" : "dark")} aria-label={dark ? "Switch to the light theme" : "Switch to the dark theme"} title={dark ? "Light theme" : "Dark theme"}>
          <Icon name={dark ? "sun" : "moon"} size={18} />
        </button>
      </header>
      <main id="main" tabIndex={-1}>
        <Boundary key={view.name === "level" ? view.id : view.name} onReset={() => setView({ name: "map" })}>
        {view.name === "map" && <MapView open={(id) => setView({ name: "level", id })} />}
        {view.name === "level" && findLevel(view.id) && <LevelView key={view.id} id={view.id} go={setView} />}
        {view.name === "handbook" && <Handbook />}
        {view.name === "sandbox" && <Sandbox />}
        {view.name === "settings" && <Settings />}
        </Boundary>
      </main>
    </div>
  );
}
