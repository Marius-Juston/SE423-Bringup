import { Component, useState, type ReactNode } from "react";
import { CHAPTERS, findLevel } from "../levels/index";
import { useSave } from "./store";
import { MapView } from "./MapView";
import { LevelView } from "./LevelView";
import { Handbook } from "./Handbook";
import { Sandbox } from "./Sandbox";
import { Settings } from "./Settings";
import { Figure } from "./figures";

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
  const total = CHAPTERS.reduce((n, c) => n + c.levels.length, 0);
  const done = CHAPTERS.reduce((n, c) => n + c.levels.filter((l) => save.passed[l.id]).length, 0);
  const nav = (name: "map" | "handbook" | "sandbox" | "settings", label: string) => (
    <button aria-current={view.name === name || (name === "map" && view.name === "level") ? "page" : undefined} onClick={() => setView({ name } as View)}>
      {label}
    </button>
  );
  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setView({ name: "map" })} aria-label="Bringup, go to the map">
          <span className="brand-mark" aria-hidden="true">01</span>
          Bringup
        </button>
        <nav className="topnav" aria-label="Main">
          {nav("map", "Map")}
          {nav("handbook", "Handbook")}
          {nav("sandbox", "Sandbox")}
          {nav("settings", "Settings")}
        </nav>
        <span className="spacer" />
        <span className="progress-pill">{done} of {total} levels passed</span>
      </header>
      <main>
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
