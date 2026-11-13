import { Component, useEffect, useRef, useState, type ReactNode } from "react";
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
import { store } from "./store";
import { sessionSummary } from "./review";

export type View = { name: "map" } | { name: "level"; id: string } | { name: "handbook"; reg?: string } | { name: "sandbox" } | { name: "settings" };

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
        <h1 tabIndex={-1}>Something went wrong on this screen</h1>
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
  const [view, show] = useState<View>({ name: "map" });
  /** A warm-up in progress: its levels, the one showing, and how many were right at the first try. */
  const [warm, setWarm] = useState<{ ids: string[]; i: number; right: number } | null>(null);
  /** The result of the warm-up just finished, shown on the map until another screen is opened. */
  const [warmNote, setWarmNote] = useState("");
  // Going anywhere by hand leaves a warm-up.
  const setView = (v: View) => {
    setWarm(null);
    setWarmNote("");
    show(v);
  };
  const startWarmup = (ids: string[]) => {
    store.warmupSeen();
    setWarmNote("");
    setWarm({ ids, i: 0, right: 0 });
    show({ name: "level", id: ids[0] });
  };
  const warmNext = (right: boolean) => {
    if (!warm) return;
    const n = warm.right + (right ? 1 : 0);
    if (warm.i + 1 < warm.ids.length) {
      setWarm({ ...warm, i: warm.i + 1, right: n });
      show({ name: "level", id: warm.ids[warm.i + 1] });
    } else {
      setWarm(null);
      setWarmNote(sessionSummary(n, warm.ids.length));
      show({ name: "map" });
    }
  };
  const save = useSave();
  const [theme, setTheme] = usePref<"system" | "light" | "dark">("theme", "system");
  const [scale] = usePref<number>("text-scale", 1);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    root.style.fontSize = `${16 * scale}px`;
  }, [theme, scale]);
  // A new screen starts at its top, with the focus on its heading (so a screen reader announces where you are).
  const where = view.name === "level" ? view.id : view.name;
  const shownOnce = useRef(false);
  useEffect(() => {
    const main = document.getElementById("main");
    const h = main?.querySelector<HTMLElement>("h1");
    document.title = h && view.name !== "map" ? `${h.textContent} · Bringup` : "Bringup: SE 423 practice";
    if (!shownOnce.current) {
      shownOnce.current = true;
      return;
    }
    if (main) main.scrollTop = 0;
    if (h) {
      h.tabIndex = -1;
      h.focus({ preventScroll: true });
    } else main?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [where]);
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches) || (theme === "system" && !window.matchMedia("(prefers-color-scheme: light)").matches);
  const core = CHAPTERS.flatMap((c) => c.levels).filter((l) => tierOf(l) === "core");
  const done = core.filter((l) => save.passed[l.id]).length;
  const nav = (name: "map" | "handbook" | "sandbox" | "settings", label: string, icon: string) => (
    <button aria-current={view.name === name || (name === "map" && view.name === "level") ? "page" : undefined} onClick={() => setView({ name } as View)}>
      <Icon name={icon} size={16} /> <span className="lbl">{label}</span>
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
          <span className="lbl">Bringup</span>
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
          <span className="sr-only"> core levels passed</span>
        </span>
        <button className="icon-btn" onClick={() => setTheme(dark ? "light" : "dark")} aria-label={dark ? "Switch to the light theme" : "Switch to the dark theme"} title={dark ? "Light theme" : "Dark theme"}>
          <Icon name={dark ? "sun" : "moon"} size={18} />
        </button>
      </header>
      <main id="main" tabIndex={-1}>
        <Boundary key={view.name === "level" ? view.id : view.name} onReset={() => setView({ name: "map" })}>
        {view.name === "map" && <MapView open={(id) => setView({ name: "level", id })} warmup={startWarmup} note={warmNote} />}
        {view.name === "level" && findLevel(view.id) && <LevelView key={warm ? `warm-${view.id}` : view.id} id={view.id} go={setView} warmup={warm ? { index: warm.i, total: warm.ids.length, next: warmNext, end: () => setView({ name: "map" }) } : undefined} />}
        {view.name === "handbook" && <Handbook open={(id) => setView({ name: "level", id })} at={view.reg ? { reg: view.reg } : undefined} />}
        {view.name === "sandbox" && <Sandbox />}
        {view.name === "settings" && <Settings />}
        </Boundary>
      </main>
    </div>
  );
}
