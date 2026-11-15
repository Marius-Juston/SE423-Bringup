import { Activity, Component, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, ViewTransition, type ReactNode } from "react";
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
import { hashOf, navigate, SCREEN_CHANGE, viewOf, type View } from "./route";

export type { View } from "./route";

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
  if (only) return <FigurePage id={only} />;
  return <Game />;
}

/** The Theme and Text size settings, applied to the page. */
function useAppearance(): ["system" | "light" | "dark", (v: "system" | "light" | "dark") => void] {
  const [theme, setTheme] = usePref<"system" | "light" | "dark">("theme", "system");
  const [scale] = usePref<number>("text-scale", 1);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    root.style.fontSize = `${16 * scale}px`;
  }, [theme, scale]);
  return [theme, setTheme];
}

/** One figure on its own, with the same theme and text size as the game. */
function FigurePage({ id }: { id: string }) {
  useAppearance();
  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "1rem" }}>
      <Figure id={id} />
    </div>
  );
}

function Game() {
  const [view, show] = useState<View>(() => viewOf(window.location.hash));
  /** A warm-up in progress: its levels, the one showing, and how many were right at the first try. */
  const [warm, setWarm] = useState<{ ids: string[]; i: number; right: number } | null>(null);
  /** The result of the warm-up just finished, shown on the map until another screen is opened. */
  const [warmNote, setWarmNote] = useState("");
  // The level opened last stays alive while another screen shows, so a trip to the Handbook, Settings or the map
  // and back finds the editor (with its undo history), the answers and the bench as they were. It is hidden, not
  // removed: React keeps its state and its page elements and switches its effects off (<Activity>). One level only:
  // opening another level lets the kept one go. A warm-up question is never kept, and a warm-up on the kept level
  // itself lets it go, so the level is never open twice.
  const [kept, setKept] = useState<string | null>(() => (view.name === "level" ? view.id : null));
  if (view.name === "level" && !warm && kept !== view.id) setKept(view.id);
  else if (view.name === "level" && warm && kept === view.id) setKept(null);
  const keptShown = view.name === "level" && !warm && view.id === kept;
  // A hidden level holds the progress it read when it was opened. When the whole progress is replaced (loaded from
  // a file or reset in Settings, saved by another window) it is let go, and opens anew from what is saved now.
  const replacements = useSyncExternalStore(store.subscribe, store.replacements);
  const [seenReplacements, setSeenReplacements] = useState(replacements);
  if (replacements !== seenReplacements) {
    setSeenReplacements(replacements);
    if (!keptShown) setKept(null);
  }
  // Every change of screen goes through navigate (route.ts): a short cross-fade where motion is allowed.
  // Going anywhere by hand leaves a warm-up.
  const setView = (v: View) =>
    navigate(() => {
      setWarm(null);
      setWarmNote("");
      show(v);
    });
  const startWarmup = (ids: string[]) => {
    store.warmupSeen();
    navigate(() => {
      setWarmNote("");
      setWarm({ ids, i: 0, right: 0 });
      show({ name: "level", id: ids[0] });
    });
  };
  const warmNext = (right: boolean) => {
    if (!warm) return;
    const n = warm.right + (right ? 1 : 0);
    navigate(() => {
      if (warm.i + 1 < warm.ids.length) {
        setWarm({ ...warm, i: warm.i + 1, right: n });
        show({ name: "level", id: warm.ids[warm.i + 1] });
      } else {
        setWarm(null);
        setWarmNote(sessionSummary(n, warm.ids.length));
        show({ name: "map" });
      }
    });
  };
  // The address follows the screen, and the Back and Forward buttons move between screens.
  // A layout effect: it runs as the new screen is put in the page, not after the cross-fade.
  useLayoutEffect(() => {
    const want = hashOf(view);
    if (hashOf(viewOf(window.location.hash)) === want) return;
    try {
      window.history.pushState(null, "", want || window.location.pathname + window.location.search);
    } catch {
      /* the address is a convenience: the game works without it */
    }
  }, [view]);
  useEffect(() => {
    const on = () =>
      navigate(() => {
        setWarm(null);
        setWarmNote("");
        show((v) => {
          const to = viewOf(window.location.hash);
          return hashOf(to) === hashOf(v) ? v : to;
        });
      });
    window.addEventListener("popstate", on);
    window.addEventListener("hashchange", on);
    return () => {
      window.removeEventListener("popstate", on);
      window.removeEventListener("hashchange", on);
    };
  }, []);
  const save = useSave();
  const [theme, setTheme] = useAppearance();
  // A new screen starts at its top, with the focus on its heading (so a screen reader announces where you are).
  // A layout effect, so the focus is never left on a button of the screen that went away while the two cross-fade.
  const where = view.name === "level" ? view.id : view.name;
  const shownOnce = useRef(false);
  useLayoutEffect(() => {
    const main = document.getElementById("main");
    // The heading of the screen that shows: a level that is kept hidden has one too.
    const h = [...(main?.querySelectorAll<HTMLElement>("h1") ?? [])].find((x) => x.getClientRects().length > 0);
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
  const screenKey = view.name === "level" ? (warm ? `warm-${view.id}` : view.id) : view.name;
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
      {/* A change of screen made by navigate() cross-fades what is in <main>. The boundary is <main> itself and not the
          screen inside it: <main> scrolls, and the picture the browser takes of a transition's element is not clipped
          by what it scrolls in, so a scrolled screen would be drawn over the top bar for the length of the fade.
          Any other change inside a screen is never animated here (default: "none"). */}
      <ViewTransition update={{ [SCREEN_CHANGE]: "screen", default: "none" }} enter="none" exit="none">
      <main id="main" tabIndex={-1}>
        <Boundary key={screenKey} onReset={() => setView({ name: "map" })}>
        {view.name === "map" && <MapView open={(id) => setView({ name: "level", id })} warmup={startWarmup} note={warmNote} />}
        {view.name === "level" && warm && findLevel(view.id) && <LevelView key={`warm-${view.id}`} id={view.id} go={setView} warmup={{ index: warm.i, total: warm.ids.length, next: warmNext, end: () => setView({ name: "map" }) }} />}
        {view.name === "handbook" && <Handbook open={(id) => setView({ name: "level", id })} at={view.reg ? { reg: view.reg } : undefined} />}
        {view.name === "sandbox" && <Sandbox />}
        {view.name === "settings" && <Settings />}
        </Boundary>
        {/* After the other screens in the page: while it is hidden, the first heading and the first element of a given id are the visible screen's. */}
        {kept && findLevel(kept) && (
          <Activity key={`kept-${kept}`} mode={keptShown ? "visible" : "hidden"} name="level">
            <Boundary
              onReset={() => {
                setKept(null);
                setView({ name: "map" });
              }}
            >
              <LevelView id={kept} go={setView} />
            </Boundary>
          </Activity>
        )}
      </main>
      </ViewTransition>
    </div>
  );
}
