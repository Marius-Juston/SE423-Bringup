// The screens that are fetched when they are first needed.
//
// The map opens at once: its script holds the map, the levels' text and
// React. Everything else arrives in parts of its own: the level screen, the
// code level's editor, simulator and bench, each figure, the Handbook, the
// Sandbox and Settings.
//
// A change of screen is a transition (route.ts), so while a part is on its
// way the screen you are on stays; nothing flashes. A part that has arrived
// is drawn at once the next time. When the page itself opens on such a
// screen, a line of text holds its place.
import { use, type ComponentProps, type ComponentType } from "react";
import { findLevel } from "../levels/index";
import { figureIdsIn, loadFigure } from "./figures";
import { once, onceEach } from "./parts";
import type { View } from "./route";

/** A screen in a part of its own. `preload` fetches it ahead of the press that opens it. */
function screen<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> & { preload: () => Promise<unknown> } {
  const get = once(load);
  const Screen = (props: P) => {
    // Always through use(): it returns at once when the part is there (parts.ts).
    const C = use(get());
    return <C {...props} />;
  };
  Screen.preload = get;
  return Screen;
}

export const Handbook = screen(() => import("./Handbook").then((m) => m.Handbook));
export const Sandbox = screen(() => import("./Sandbox").then((m) => m.Sandbox));
export const Settings = screen(() => import("./Settings").then((m) => m.Settings));

const levelView = once(() => import("./LevelView").then((m) => m.LevelView));
type LevelViewProps = ComponentProps<Awaited<ReturnType<typeof levelView>>>;
const codeLevelView = once(() => import("./code/CodeLevelView").then((m) => m.CodeLevelView));
type CodeLevelProps = ComponentProps<Awaited<ReturnType<typeof codeLevelView>>>;

/** The editor, the simulator and the bench of a code level. LevelScreen has fetched them by the time a code level draws this. */
export function CodeLevel(props: CodeLevelProps) {
  const C = use(codeLevelView());
  return <C {...props} />;
}

/** Fetches what any level needs, ahead of the first level that is opened (when the page is idle). */
export function preloadLevels(): void {
  void levelView();
  void codeLevelView();
}

/** Everything one level shows when it opens: the level screen, the code level's parts, and the figures its text embeds. */
const levelReady = onceEach(async (id: string) => {
  const level = findLevel(id)?.level;
  // A figure that cannot be fetched does not keep the level from opening: the figure says so in its place.
  const figures = level ? figureIdsIn(JSON.stringify(level)).map((f) => loadFigure(f).catch(() => undefined)) : [];
  const [View] = await Promise.all([levelView(), level?.kind === "code" ? codeLevelView() : null, ...figures]);
  return View;
});

/**
 * Fetches what a screen needs. The page waits for this before it draws for the first time when it
 * opens on such a screen (main.tsx): the screen is then drawn at once, whole. Drawing a placeholder
 * first would cost more than it saves, because React shows what replaces a placeholder 300 ms after
 * the placeholder at the earliest.
 */
export function screenReady(view: View): Promise<unknown> {
  return view.name === "level" ? levelReady(view.id) : view.name === "handbook" ? Handbook.preload() : view.name === "sandbox" ? Sandbox.preload() : view.name === "settings" ? Settings.preload() : Promise.resolve();
}

/** A level, with all it shows on opening fetched first: the level appears whole, and nothing in it jumps as a figure arrives. */
export function LevelScreen(props: LevelViewProps) {
  const View = use(levelReady(props.id));
  return <View {...props} />;
}
