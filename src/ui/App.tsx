import { useState } from "react";
import { CHAPTERS, findLevel } from "../levels/index";
import { useSave } from "./store";
import { MapView } from "./MapView";
import { LevelView } from "./LevelView";
import { Handbook } from "./Handbook";
import { Sandbox } from "./Sandbox";
import { Settings } from "./Settings";

export type View = { name: "map" } | { name: "level"; id: string } | { name: "handbook" } | { name: "sandbox" } | { name: "settings" };

export function App() {
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
        {view.name === "map" && <MapView open={(id) => setView({ name: "level", id })} />}
        {view.name === "level" && findLevel(view.id) && <LevelView key={view.id} id={view.id} go={setView} />}
        {view.name === "handbook" && <Handbook />}
        {view.name === "sandbox" && <Sandbox />}
        {view.name === "settings" && <Settings />}
      </main>
    </div>
  );
}
