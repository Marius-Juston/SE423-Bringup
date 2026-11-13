import { useFrame } from "../code/frame";
import { useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Board } from "../../sim/board";
import type { LidarState } from "../../sim/plugins/lidar";
import { worldObjects, worldOf } from "../../sim/plugins/lidar";
import { ROBOT_RADIUS_FT } from "../../sim/plugins/robot_world";
import { WHEEL_BASE } from "../../sim/plugins/plant";
import { MAX_OBJECTS, clearance, insideBox, objectTouches, snap, tidyObject, type Obstacle, type World } from "../../sim/world/terrain";
import { usePanelSize } from "../Panel";
import { usePref } from "../prefs";
import { ArenaContext } from "./robot-arena-context";
import {
  NAMED_POINTS,
  RAYS,
  advanceReplay,
  describe,
  describeAll,
  fitView,
  fmt,
  goalTolerance,
  gridStep,
  inputAt,
  isStateName,
  markRows,
  pushTrail,
  rayTip,
  replayMarks,
  replayStep,
  sceneAt,
  sceneKind,
  sceneOfSetup,
  setStimuli,
  worldFor,
  type Pt,
  type Scene,
  type SceneKind,
  type SceneSource,
} from "./robot-arena-model";
import { ArenaPlayground } from "./robot-arena-play";
import type { BenchView, ViewProps } from "./types";

// The robot arena: one top view, in feet, of everything the simulated robot
// does. It shows the three situations the levels have:
//   "world"  the capstone's robot world (robot_world.ts): room or terrain,
//            robot, trail, goal, LIDAR, crash;
//   "bench"  the test-bench robot of chapters 16 and 18 (plant.ts) on an
//            open floor, with the pose the program reports as a ghost;
//   "scan"   a LIDAR standing at a pose the level sets (chapter 17).
// It draws from the board it is given: no timer of its own while a program
// runs. After Run tests a slider replays the run from the output histories
// (the replay's Play button is the one clock this file owns). While a
// program runs with Run, the playground lets the student move the robot,
// the goal and the walls through the LiveSession; a test never sees that.

type ScanMode = "rays" | "points" | "off";
type Tool = "move" | "box" | "post";

const PAD = { l: 30, r: 8, t: 8, b: 18 };
const f1 = (v: number) => v.toFixed(1);
const deg = (rad: number) => (rad * 180) / Math.PI;
const dist = (v: number | undefined) => (v === undefined ? "no echo" : `${fmt(v)} ft`);

const ids = new WeakMap<Board, number>();
let nextId = 1;
/** A number per board, so a new run starts the arena afresh (replay time, trail start). */
const idOf = (b: Board): number => {
  let id = ids.get(b);
  if (!id) ids.set(b, (id = nextId++));
  return id;
};

const STYLE = `
.arena { display: grid; gap: 0.5rem; min-width: 0; contain: layout style; }
.arena-pic { position: relative; min-width: 0; contain: layout paint style; }
.arena-pic svg { display: block; width: 100%; background: var(--inset); border: 1px solid var(--border); border-radius: var(--radius); touch-action: none; user-select: none; }
.arena-pic text { font-family: var(--sans); font-size: 11px; fill: var(--dim); }
.arena-pic text.lbl { fill: var(--text); paint-order: stroke; stroke: var(--inset); stroke-width: 3px; stroke-linejoin: round; font-weight: 600; }
.arena-grid { stroke: var(--border); stroke-width: 1; }
.arena-grid.zero { stroke: var(--border-strong); }
.arena-wall { stroke: var(--text); stroke-width: 2.5; stroke-linecap: square; fill: none; }
.arena-box { fill: var(--control); fill-opacity: 0.45; stroke: var(--text); stroke-width: 2; stroke-linejoin: miter; }
.arena-hit { stroke: var(--info); stroke-width: 0.6; stroke-opacity: 0.4; fill: none; }
.arena-miss { stroke: var(--dim); stroke-width: 0.6; stroke-dasharray: 3 5; stroke-opacity: 0.5; fill: none; }
.arena-dot { stroke: var(--info); stroke-width: 3; stroke-linecap: round; fill: none; }
.arena-named { stroke: var(--accent); stroke-width: 2; fill: none; }
.arena-named.miss { stroke-dasharray: 5 4; }
.arena-named-end { fill: var(--accent); stroke: var(--inset); stroke-width: 1; }
.arena-trail { stroke: var(--info); stroke-width: 2.4; fill: none; stroke-linejoin: round; stroke-linecap: round; }
.arena-est-trail { stroke: var(--value); stroke-width: 1.8; stroke-dasharray: 6 4; fill: none; stroke-linejoin: round; }
.arena-robot { fill: var(--surface); stroke: var(--text); stroke-width: 2; }
.arena-nose { stroke: var(--text); stroke-width: 2.5; stroke-linecap: round; }
.arena-wheel { fill: var(--text); }
.arena-ghost { fill: none; stroke: var(--value); stroke-width: 2; stroke-dasharray: 4 3; }
.arena-ghost-nose { stroke: var(--value); stroke-width: 2; stroke-linecap: round; }
.arena-goal { stroke: var(--ok); stroke-width: 2; fill: none; }
.arena-goal-tol { stroke: var(--ok); stroke-width: 1.5; stroke-dasharray: 4 3; fill: var(--ok-soft); }
.arena-crash { stroke: var(--bad); stroke-width: 3; fill: none; stroke-linecap: round; }
.arena-h { cursor: grab; outline: none; }
.arena-h:focus-visible .arena-ring, .arena-h.on .arena-ring { stroke: var(--focus); stroke-width: 3; opacity: 1; }
.arena-ring { fill: transparent; stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 3 3; opacity: 0.8; }
.arena-turn { fill: var(--accent); stroke: var(--inset); stroke-width: 1.5; cursor: grab; }
.arena-size { fill: var(--accent); stroke: var(--inset); stroke-width: 1.5; cursor: nwse-resize; }
.arena-pic.tool-box svg, .arena-pic.tool-post svg { cursor: crosshair; }
.arena-key { display: flex; flex-wrap: wrap; gap: 0.1rem 0.8rem; font-size: 0.78rem; color: var(--dim); margin-top: 0.25rem; min-height: 1.2em; }
.arena-key span { display: inline-flex; align-items: center; gap: 0.3rem; white-space: nowrap; }
.arena-key i { display: inline-block; width: 18px; height: 0; border-top: 2.4px solid var(--info); }
.arena-key i.est { border-top: 2px dashed var(--value); }
.arena-key i.named { border-top-color: var(--accent); }
.arena-now { margin: 0; font-size: 0.95rem; color: var(--text); border-left: 3px solid var(--info); padding: 0.15rem 0.6rem; background: var(--surface); border-radius: 0 var(--radius) var(--radius) 0; }
.arena-now.bad { border-left-color: var(--bad); }
.arena-read { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: 0.25rem 0.5rem; margin: 0; font-size: 0.82rem; }
.arena-read > div { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.5rem; align-items: baseline; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 0.2rem 0.5rem; }
.arena-read dt { color: var(--dim); }
.arena-read dd { margin: 0; font-family: var(--mono); text-align: right; color: var(--text); overflow-wrap: anywhere; }
.arena-read > div.wide { grid-column: span 2; }
.arena-read dd small { color: var(--dim); font-size: 0.92em; }
.arena-opts { display: flex; flex-wrap: wrap; gap: 0.3rem 0.8rem; align-items: center; font-size: 0.82rem; color: var(--dim); }
.arena-opts select { min-height: 1.75rem; padding: 0.1em 0.3em; font-size: 0.85rem; }
.arena-replay { display: grid; gap: 0.15rem; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 0.35rem 0.5rem; }
.arena-replay-row { display: flex; gap: 0.5rem; align-items: center; min-width: 0; }
.arena-replay input[type="range"] { width: 100%; min-width: 0; padding: 0; margin: 0.2rem 0 0; }
.arena-replay-row output { font-family: var(--mono); font-size: 0.82rem; white-space: nowrap; color: var(--text); }
.arena-marks { position: relative; height: 1.5rem; margin: 0 8px; }
.arena-mark { position: absolute; top: 0; transform: translateX(-50%); min-width: 24px; height: 1.5rem; padding: 0 0.15rem; display: grid; place-items: center; background: none; border: none; color: var(--dim); font-size: 0.7rem; font-family: var(--mono); line-height: 1; }
.arena-mark::before { content: ""; position: absolute; left: 50%; top: -3px; height: 6px; border-left: 2px solid currentColor; margin-left: -1px; }
.arena-mark.pass { color: var(--ok); }
.arena-mark.fail { color: var(--bad); font-weight: 700; }
.arena-mark:hover { color: var(--text); }
.arena-hint { margin: 0; font-size: 0.82rem; color: var(--dim); }
.arena.large { align-content: start; }
.arena.large .arena-pic { height: 58vh; min-height: 14rem; }
.arena.large .arena-side { align-content: start; }
@container (min-width: 46rem) {
  .arena.large { grid-template-columns: minmax(0, 1fr) minmax(16rem, 21rem); grid-template-rows: minmax(0, 1fr); height: 100%; }
  .arena.large .arena-pic { height: 100%; }
  .arena.large .arena-side { overflow: auto; max-height: 100%; padding-right: 2px; }
  .arena.large .arena-side > .arena-key { margin-top: 0; }
  .arena.large .arena-read { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.arena-side { display: grid; gap: 0.5rem; min-width: 0; }
.arena-side > .arena-key { margin-top: -0.3rem; }
`;

/** The interactive things in the picture, by what a pointer went down on. */
type Grab =
  | { what: "robot"; dx: number; dy: number }
  | { what: "turn" }
  | { what: "goal"; dx: number; dy: number }
  | { what: "obj"; i: number; from: Pt; orig: Obstacle }
  | { what: "size"; i: number };

function ArenaBody({ board, nowMs: benchNowMs, live, preview }: { board: Board | null; nowMs: number; live: boolean; preview?: Scene }) {
  const ctx = useContext(ArenaContext);
  const size = usePanelSize();
  const session = live && ctx?.session?.running ? ctx.session : null;
  // The bench redraws about 20 times a second; motion needs every frame, so
  // this view follows the live run's own clock.
  useFrame();
  const nowMs = session ? session.timeMs : benchNowMs;
  const running = !!session && !session.paused;
  const [scanPref, setScanPref] = usePref<ScanMode | "auto">("arena-scan", "auto");
  const [replayT, setReplayT] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [trailFrom, setTrailFrom] = useState(0);
  const [rev, setRev] = useState(0);
  const [tool, setTool] = useState<Tool>("move");
  const [selected, setSelected] = useState<number | null>(null);
  const sets = useMemo(() => setStimuli(ctx?.stimuli), [ctx?.stimuli]);
  const lidarState = board?.plugins.get("lidar") as LidarState | undefined;
  const lidarUsed = !!board && board.inputsUsed.has("LIDAR_ROOM");
  const kind: SceneKind | undefined = board ? sceneKind(board.outputs, lidarUsed) : preview ? "world" : undefined;
  const endMs = nowMs;
  const tMs = live || !board ? nowMs : Math.min(replayT ?? endMs, endMs);
  const atEnd = live || tMs >= endMs;
  const programReads = !!lidarState && (lidarState.scans > 0 || lidarState.reads > 0);
  const scanMode: ScanMode = kind === "bench" ? "off" : scanPref === "auto" ? (kind === "scan" || programReads ? "rays" : "off") : scanPref;

  // A fresh test run plays itself once, so the student sees the robot drive rather than only where it ended.
  // Pressing Run tests is the student's action that starts it; any use of the slider stops it, and it does
  // not start at all for someone who asked for reduced motion.
  const played = useRef<Board | null>(null);
  useEffect(() => {
    if (live || !board || endMs <= 0 || played.current === board) return;
    played.current = board;
    if (kind === "scan" || kind === undefined) return;
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setSpeed(endMs > 8000 ? 4 : 1);
    setReplayT(0);
    setPlaying(true);
  }, [board, live, endMs, kind]);

  // The replay clock: the only animation this view runs itself, started by Play or by a fresh test run.
  useEffect(() => {
    if (!playing || live) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      let done = false;
      setReplayT((t) => {
        const r = advanceReplay(t ?? 0, dt, speed, endMs);
        done = r.done;
        return r.tMs;
      });
      if (done) setPlaying(false);
      else raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, live, speed, endMs]);

  const scene: Scene | undefined = useMemo(() => {
    if (!board || !kind) return preview;
    const input = live ? (name: string) => board.inputs.get(name) : (name: string) => inputAt(sets, name, tMs) ?? (sets.some((s) => s.set === name) ? undefined : board.inputs.get(name));
    const src: SceneSource = { outputs: board.outputs, input, world: live ? worldOf(board) : worldFor(input), worldOn: kind === "world", lidar: lidarUsed };
    return sceneAt(src, kind, tMs, { trailFromMs: live ? trailFrom : 0, withLidar: scanMode !== "off" || kind === "scan" });
    // `rev` counts playground changes made while the program is paused (the time does not move then).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, kind, tMs, live, sets, trailFrom, scanMode, rev, preview]);

  // The program's own x, y and theta, when the level watches them: its belief, next to the truth.
  const estTrail = useRef<Pt[]>([]);
  const watch = ctx?.watch ?? [];
  let shown = scene;
  if (scene && board && kind === "world" && atEnd && watch.includes("x") && watch.includes("y")) {
    const ex = board.readVar("x");
    const ey = board.readVar("y");
    const eth = watch.includes("theta") ? board.readVar("theta") : undefined;
    if (ex !== undefined && ey !== undefined && Number.isFinite(ex) && Number.isFinite(ey)) {
      // Not before the program has run: its variables are all 0 at power-up.
      if (live && nowMs > 1) pushTrail(estTrail.current, { x: ex, y: ey });
      shown = { ...scene, est: { x: ex, y: ey, th: eth }, estTrail: live ? [estTrail.current] : [], estErr: Math.hypot(ex - scene.pose.x, ey - scene.pose.y) };
    }
  }

  // The picture is drawn in real pixels: measure the room it has.
  const pic = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 400, h: 0 });
  useLayoutEffect(() => {
    const el = pic.current;
    if (!el) return;
    const measure = () => setBox((b) => (Math.abs(b.w - el.clientWidth) < 1 && Math.abs(b.h - el.clientHeight) < 1 ? b : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size]);

  const svg = useRef<SVGSVGElement>(null);
  const grab = useRef<Grab | null>(null);
  const clipId = useId();
  // The accessible name says what is happening, but changes at most once a second while the program runs.
  const said = useRef({ text: "", at: 0 });
  const goalTol = useMemo(() => goalTolerance(ctx?.checks ?? []), [ctx?.checks]);

  if (!shown || !kind) return <p className="hint-text">Nothing to show yet: the program has not used the robot or the LIDAR.</p>;
  const s = shown;
  const view = fitView(s);
  const W = Math.max(220, box.w);
  const spanX = view.x1 - view.x0;
  const spanY = view.y1 - view.y0;
  const natural = ((W - PAD.l - PAD.r) * spanY) / spanX + PAD.t + PAD.b;
  const cap = size === "normal" ? 340 : Math.max(420, (typeof window === "undefined" ? 800 : window.innerHeight) * 0.62);
  const H = size === "large" ? Math.max(200, box.h - 2) : Math.round(Math.max(170, Math.min(natural, cap)));
  const k = Math.min((W - PAD.l - PAD.r) / spanX, (H - PAD.t - PAD.b) / spanY);
  const ox = PAD.l + (W - PAD.l - PAD.r - spanX * k) / 2;
  const oy = PAD.t + (H - PAD.t - PAD.b - spanY * k) / 2;
  const px = (x: number) => ox + (x - view.x0) * k;
  const py = (y: number) => oy + (view.y1 - y) * k;
  const lim = (v: number) => Math.max(-2e4, Math.min(2e4, v));
  const P = (x: number, y: number) => `${f1(lim(px(x)))},${f1(lim(py(y)))}`;
  const line = (a: Pt[]) => a.map((p, i) => `${i ? "L" : "M"}${P(p.x, p.y)}`).join("");
  const step = gridStep(Math.max(spanX, spanY), Math.max(4, Math.floor((W - PAD.l) / 42)));
  const ticks = (lo: number, hi: number) => {
    const out: number[] = [];
    for (let g = Math.ceil(lo / step - 1e-9) * step; g <= hi + 1e-9; g += step) out.push(Math.abs(g) < 1e-9 ? 0 : +g.toFixed(4));
    return out;
  };
  const R = Math.max(5, ROBOT_RADIUS_FT * k);
  const robotAt = `translate(${f1(lim(px(s.pose.x)))},${f1(lim(py(s.pose.y)))}) rotate(${(-deg(s.pose.th)).toFixed(1)})`;

  // ---- the scan ----
  let hits = "";
  let misses = "";
  let dots = "";
  const l = scanMode !== "off" ? s.lidar : undefined;
  if (l) {
    const from = P(l.x, l.y);
    for (let i = 0; i < RAYS; i++) {
      const [tx, ty, echo] = rayTip(l, s.pose.th, i);
      if (echo) {
        if (scanMode === "rays") hits += `M${from}L${P(tx, ty)}`;
        dots += `M${P(tx, ty)}h0.01`;
      } else if (scanMode === "rays") misses += `M${from}L${P(tx, ty)}`;
    }
  }
  const named = l
    ? (Object.entries(NAMED_POINTS) as [keyof typeof NAMED_POINTS, number][]).map(([name, i]) => {
        const [tx, ty, echo] = rayTip(l, s.pose.th, i);
        const a = Math.atan2(ty - l.y, tx - l.x);
        const len = Math.hypot(tx - l.x, ty - l.y) * k;
        // The label sits a little way along the ray, outside the robot, inside the picture.
        const at = Math.min(Math.max(R + 30, len * 0.5), R + 44);
        return { name, i, echo, x1: px(l.x), y1: py(l.y), x2: lim(px(tx)), y2: lim(py(ty)), lx: Math.max(PAD.l + 14, Math.min(W - 18, px(l.x) + at * Math.cos(a))), ly: Math.max(14, Math.min(H - PAD.b - 4, py(l.y) - at * Math.sin(a) + 4)) };
      })
    : [];

  // ---- words ----
  const sentence = describe(s, { goalTol, live: !!session });
  const now = typeof performance === "undefined" ? 0 : performance.now();
  if (!running || now - said.current.at > 1000 || !said.current.text) said.current = { text: describeAll(s, { goalTol, live: !!session }), at: now };
  const states = board ? watch.filter(isStateName).map((w) => ({ name: w, v: board.readVar(w) })).filter((x) => x.v !== undefined) : [];

  // ---- the playground: pointer and keys on the picture ----
  const play = session && board ? session : null;
  const objects = play && board ? worldObjects(board) : [];
  const changed = () => {
    setRev((r) => r + 1);
    ctx?.redraw();
  };
  const toFt = (e: { clientX: number; clientY: number }): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return { x: view.x0 + (e.clientX - r.left - ox) / k, y: view.y1 - (e.clientY - r.top - oy) / k };
  };
  const free = (w: World | undefined, x: number, y: number) => !w || (x >= w.bounds[0] && x <= w.bounds[2] && y >= w.bounds[1] && y <= w.bounds[3] && clearance(w, x, y) >= ROBOT_RADIUS_FT && !insideBox(w, x, y));
  const placeRobot = (x: number, y: number, th: number) => {
    if (!play || !free(s.world, x, y)) return false;
    play.placeRobot(x, y, th, kind);
    setTrailFrom(play.timeMs);
    changed();
    return true;
  };
  const moveGoal = (x: number, y: number) => {
    if (!play) return;
    const w = s.world;
    const cx = w ? Math.max(w.bounds[0], Math.min(w.bounds[2], x)) : x;
    const cy = w ? Math.max(w.bounds[1], Math.min(w.bounds[3], y)) : y;
    play.setInput("ROBOT_GOAL_X_FT", +cx.toFixed(2));
    play.setInput("ROBOT_GOAL_Y_FT", +cy.toFixed(2));
    changed();
  };
  const setObjects = (list: Obstacle[]) => {
    if (!play) return false;
    const tidy = list.slice(0, MAX_OBJECTS).map(tidyObject);
    // Nothing may be put down on the robot.
    if (tidy.some((o) => objectTouches(o, s.pose.x, s.pose.y, ROBOT_RADIUS_FT))) return false;
    play.setObjects(tidy);
    changed();
    return true;
  };
  const moved = (o: Obstacle, dx: number, dy: number): Obstacle => (o.kind === "box" ? { ...o, x0: o.x0 + dx, y0: o.y0 + dy, x1: o.x1 + dx, y1: o.y1 + dy } : o.kind === "post" ? { ...o, x: o.x + dx, y: o.y + dy } : { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy });
  const replaceObject = (i: number, o: Obstacle) => setObjects(objects.map((x, j) => (j === i ? o : x)));
  const removeObject = (i: number) => {
    setObjects(objects.filter((_, j) => j !== i));
    setSelected(null);
  };

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!play || e.button !== 0) return;
    const p = toFt(e);
    const h = (e.target as Element).closest<SVGElement>("[data-h]")?.dataset.h;
    if (tool !== "move" && !h) {
      const o: Obstacle = tool === "box" ? { kind: "box", x0: snap(p.x) - 0.5, y0: snap(p.y) - 0.5, x1: snap(p.x) + 0.5, y1: snap(p.y) + 0.5 } : { kind: "post", x: p.x, y: p.y, r: 0.25 };
      if (objects.length < MAX_OBJECTS && setObjects([...objects, o])) setSelected(objects.length);
      setTool("move");
      return;
    }
    if (!h) {
      setSelected(null);
      return;
    }
    if (h === "robot") grab.current = { what: "robot", dx: s.pose.x - p.x, dy: s.pose.y - p.y };
    else if (h === "turn") grab.current = { what: "turn" };
    else if (h === "goal" && s.goal) grab.current = { what: "goal", dx: s.goal.x - p.x, dy: s.goal.y - p.y };
    else if (h.startsWith("obj-")) {
      const i = +h.slice(4);
      setSelected(i);
      grab.current = { what: "obj", i, from: p, orig: objects[i] };
    } else if (h.startsWith("size-")) grab.current = { what: "size", i: +h.slice(5) };
    if (grab.current) {
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = grab.current;
    if (!g || !play) return;
    const p = toFt(e);
    if (g.what === "robot") placeRobot(p.x + g.dx, p.y + g.dy, s.pose.th);
    else if (g.what === "turn") placeRobot(s.pose.x, s.pose.y, Math.atan2(p.y - s.pose.y, p.x - s.pose.x));
    else if (g.what === "goal") moveGoal(p.x + g.dx, p.y + g.dy);
    else if (g.what === "obj") replaceObject(g.i, moved(g.orig, snap(p.x - g.from.x), snap(p.y - g.from.y)));
    else {
      const o = objects[g.i];
      if (o?.kind === "box") replaceObject(g.i, { ...o, x1: Math.max(o.x0 + 0.25, p.x), y0: Math.min(o.y1 - 0.25, p.y) });
      else if (o?.kind === "post") replaceObject(g.i, { ...o, r: Math.hypot(p.x - o.x, p.y - o.y) });
    }
  };
  const onUp = () => {
    grab.current = null;
  };
  const arrow = (e: ReactKeyboardEvent, fine = e.shiftKey): [number, number] | null => {
    const d = fine ? 0.05 : 0.25;
    return e.key === "ArrowLeft" ? [-d, 0] : e.key === "ArrowRight" ? [d, 0] : e.key === "ArrowUp" ? [0, d] : e.key === "ArrowDown" ? [0, -d] : null;
  };
  const robotKey = (e: ReactKeyboardEvent) => {
    const a = arrow(e);
    const turn = e.key === "l" || e.key === "L" ? 1 : e.key === "r" || e.key === "R" ? -1 : 0;
    if (!a && !turn) return;
    e.preventDefault();
    if (a) placeRobot(s.pose.x + a[0], s.pose.y + a[1], s.pose.th);
    else placeRobot(s.pose.x, s.pose.y, s.pose.th + (turn * Math.PI) / (e.shiftKey ? 36 : 12));
  };
  const goalKey = (e: ReactKeyboardEvent) => {
    const a = arrow(e);
    if (!a || !s.goal) return;
    e.preventDefault();
    moveGoal(s.goal.x + a[0], s.goal.y + a[1]);
  };
  const objectKey = (i: number) => (e: ReactKeyboardEvent) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeObject(i);
      return;
    }
    const a = arrow(e, false);
    if (!a) return;
    e.preventDefault();
    const o = objects[i];
    // Shift and an arrow resize; an arrow alone moves.
    if (e.shiftKey && o.kind === "box") replaceObject(i, { ...o, x1: Math.max(o.x0 + 0.25, o.x1 + a[0]), y1: Math.max(o.y0 + 0.25, o.y1 + a[1]) });
    else if (e.shiftKey && o.kind === "post") replaceObject(i, { ...o, r: o.r + (a[0] + a[1]) / 2 });
    else replaceObject(i, moved(o, a[0], a[1]));
  };
  const objName = (o: Obstacle, i: number) => (o.kind === "box" ? `Box ${i + 1}, ${fmt(o.x1 - o.x0)} by ${fmt(o.y1 - o.y0)} ft at x ${fmt(o.x0)}, y ${fmt(o.y0)}` : o.kind === "post" ? `Post ${i + 1}, radius ${fmt(o.r)} ft at x ${fmt(o.x)}, y ${fmt(o.y)}` : `Wall ${i + 1}`);

  const marks = !live && board ? replayMarks(ctx?.checks ?? [], ctx?.results, endMs) : [];
  const rows = markRows(marks, endMs);
  const rStep = replayStep(endMs);
  const world = s.world;
  const baseObstacles = world ? world.obstacles.slice(0, world.obstacles.length - objects.length) : [];

  const sideParts = (
    <>
      <div className="arena-key" aria-hidden="true">
        {s.trail.some((t) => t.length > 1) && <span><i /> path driven</span>}
        {s.est && <span><i className="est" /> {kind === "bench" ? "pose the program reports (dashed)" : "the program's own x, y (dashed)"}</span>}
        {named.length > 0 && <span><i className="named" /> LIDAR front, left, right</span>}
        {world && <span>grid: {step} ft</span>}
      </div>
      <p className={`arena-now ${s.crashed ? "bad" : ""}`} data-arena-now aria-live={running || playing ? "off" : "polite"}>{sentence}</p>
      <dl className="arena-read">
        {board && (
          <div data-read="time"><dt>Time</dt><dd>{(tMs / 1000).toFixed(2)} s</dd></div>
        )}
        <div data-read="pose" className="wide"><dt>{kind === "scan" ? "LIDAR at x, y; heading" : "Robot x, y; heading"}</dt><dd>{fmt(s.pose.x)}, {fmt(s.pose.y)} ft; {deg(s.pose.th).toFixed(0)}°</dd></div>
        {s.wheels && <div data-read="wheels" className="wide"><dt>Wheels, ft/s</dt><dd>{fmt(s.wheels.left)} <small>L</small> {fmt(s.wheels.right)} <small>R</small></dd></div>}
        {s.goalDist !== undefined && <div data-read="goal"><dt>To the goal</dt><dd>{fmt(s.goalDist)} ft</dd></div>}
        {s.odometer !== undefined && <div data-read="odometer"><dt>Driven</dt><dd>{fmt(s.odometer)} ft</dd></div>}
        {s.lidar && (
          <>
            <div data-read="front"><dt>Front [113]</dt><dd>{dist(s.lidar.front)}</dd></div>
            <div data-read="left"><dt>Left [199]</dt><dd>{dist(s.lidar.left)}</dd></div>
            <div data-read="right"><dt>Right [28]</dt><dd>{dist(s.lidar.right)}</dd></div>
          </>
        )}
        {s.est && <div data-read="estimate" className="wide"><dt>{kind === "bench" ? "Pose the program reports" : "The program's own x, y"}</dt><dd>{fmt(s.est.x)}, {fmt(s.est.y)} ft</dd></div>}
        {s.estErr !== undefined && <div data-read="error"><dt>It is off by</dt><dd>{s.estErr < 100 ? s.estErr.toFixed(3) : s.estErr.toFixed(0)} ft</dd></div>}
        {states.map((x) => (
          <div key={x.name} data-read={`var-${x.name}`}><dt>{x.name}</dt><dd>{Number.isInteger(x.v) ? x.v : x.v!.toPrecision(4)}{!atEnd && <small> (end of run)</small>}</dd></div>
        ))}
      </dl>
      {kind !== "bench" && (
        <div className="arena-opts">
          <label>
            LIDAR scan{" "}
            <select value={scanMode} onChange={(e) => setScanPref(e.target.value as ScanMode)}>
              <option value="rays">rays</option>
              <option value="points">points where it hits</option>
              <option value="off">hidden</option>
            </select>
          </label>
          {kind === "world" && !programReads && scanMode !== "off" && <span>The program has not read the LIDAR: this is what it would see.</span>}
        </div>
      )}
      {!live && board && endMs > 0 && (
        <div className="arena-replay" role="group" aria-label="Replay of the test run">
          <div className="arena-replay-row">
            <button className="btn small" onClick={() => { if (!playing && tMs >= endMs) setReplayT(0); setPlaying(!playing); }} aria-label={playing ? "Pause the replay" : "Play the replay"}>
              {playing ? "Pause" : "Play"}
            </button>
            <button className="btn small ghost" aria-pressed={speed === 4} onClick={() => setSpeed(speed === 4 ? 1 : 4)} title="Replay four times faster than it happened">4x speed</button>
            <output>{(tMs / 1000).toFixed(2)} / {(endMs / 1000).toFixed(2)} s</output>
          </div>
          <input
            type="range"
            min={0}
            max={endMs}
            step={rStep}
            value={tMs}
            aria-label="Time in the test run"
            aria-valuetext={`${(tMs / 1000).toFixed(2)} seconds of ${(endMs / 1000).toFixed(2)}`}
            onChange={(e) => { setPlaying(false); setReplayT(Math.min(endMs, +e.target.value)); }}
          />
          {marks.length > 0 && (
            <div className="arena-marks" style={{ height: `${1.5 * (Math.max(...rows) + 1)}rem` }}>
              {marks.map((m, i) => (
                <button key={m.tMs} className={`arena-mark ${m.pass === undefined ? "" : m.pass ? "pass" : "fail"}`} style={{ left: `${(100 * m.tMs) / endMs}%`, top: `${1.5 * rows[i]}rem` }} title={`${(m.tMs / 1000).toFixed(2)} s: ${m.label}${m.pass === undefined ? "" : m.pass ? " (passed)" : " (failed)"}`} aria-label={`Go to ${(m.tMs / 1000).toFixed(2)} seconds, where a test looks: ${m.label}${m.pass === undefined ? "" : m.pass ? " (passed)" : " (failed)"}`} onClick={() => { setPlaying(false); setReplayT(m.tMs); }}>
                  {m.pass === false ? "✕" : "▲"}
                </button>
              ))}
            </div>
          )}
          <p className="arena-hint">Replay of the test run{playing ? ` (playing${speed === 4 ? " at 4x" : ""})` : ""}: drag the slider or use the arrow keys.{marks.length ? " The marks are the moments the tests look at." : ""}</p>
        </div>
      )}
      {play && scene && <ArenaPlayground large={size === "large"} session={play} board={board!} kind={kind} scene={s} objects={objects} tool={tool} setTool={setTool} selected={selected} setSelected={setSelected} placeRobot={placeRobot} moveGoal={moveGoal} setObjects={setObjects} onReset={() => { play.resetWorld(kind); setTrailFrom(play.timeMs); estTrail.current = []; setSelected(null); changed(); }} onWorld={() => { setTrailFrom(play.timeMs); setSelected(null); changed(); }} />}
      {!play && !board && <p className="arena-hint">The level's world before the program runs. Press <strong>Run</strong> to watch it live and to move the robot, the goal and the walls yourself; <strong>Run tests</strong> to check your program and replay the run.</p>}
      {!play && board && live && <p className="arena-hint">The program has stopped. Press <strong>Run</strong> again to use the playground.</p>}
    </>
  );

  return (
    <div className={`arena ${size === "large" ? "large" : ""}`} data-arena-kind={kind} data-arena-size={size}>
      <style>{STYLE}</style>
      <div className={`arena-pic tool-${tool}`} ref={pic}>
        <svg ref={svg} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={said.current.text} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <g aria-hidden="true">
            <clipPath id={clipId}><rect x={PAD.l} y={0} width={W - PAD.l} height={H - PAD.b} /></clipPath>
            {ticks(view.x0, view.x1).map((g) => (
              <g key={`x${g}`}>
                <line x1={px(g)} x2={px(g)} y1={0} y2={H - PAD.b} className={`arena-grid ${g === 0 ? "zero" : ""}`} />
                {px(g) > PAD.l + 4 && px(g) < W - 34 && <text x={px(g)} y={H - 5} textAnchor="middle">{g}</text>}
              </g>
            ))}
            {ticks(view.y0, view.y1).map((g) => (
              <g key={`y${g}`}>
                <line x1={PAD.l} x2={W} y1={py(g)} y2={py(g)} className={`arena-grid ${g === 0 ? "zero" : ""}`} />
                {py(g) > 22 && py(g) < H - PAD.b - 2 && <text x={PAD.l - 4} y={py(g) + 4} textAnchor="end">{g}</text>}
              </g>
            ))}
            <text x={W - 4} y={H - 5} textAnchor="end">x, ft</text>
            <text x={3} y={13}>y, ft</text>
            <g clipPath={`url(#${clipId})`}>
              {misses && <path d={misses} className="arena-miss" />}
              {hits && <path d={hits} className="arena-hit" />}
              {s.goal && (
                <g>
                  <circle cx={px(s.goal.x)} cy={py(s.goal.y)} r={Math.max(4, (goalTol ?? 0.15) * k)} className="arena-goal-tol" />
                  <path d={`M${f1(px(s.goal.x) - 7)},${f1(py(s.goal.y))}h14M${f1(px(s.goal.x))},${f1(py(s.goal.y) - 7)}v14`} className="arena-goal" />
                  <text className="lbl" x={px(s.goal.x) + 9} y={py(s.goal.y) - 8}>goal</text>
                </g>
              )}
              {world && (
                <>
                  {baseObstacles.map((o, i) =>
                    o.kind === "box" ? (
                      <rect key={i} x={px(o.x0)} y={py(o.y1)} width={(o.x1 - o.x0) * k} height={(o.y1 - o.y0) * k} className="arena-box" />
                    ) : o.kind === "post" ? (
                      <circle key={i} cx={px(o.x)} cy={py(o.y)} r={o.r * k} className="arena-box" />
                    ) : (
                      <line key={i} x1={px(o.x1)} y1={py(o.y1)} x2={px(o.x2)} y2={py(o.y2)} className="arena-wall" />
                    ),
                  )}
                  <path d={world.boundary.map((w) => `M${P(Math.max(view.x0 - 2, Math.min(view.x1 + 2, w[0])), w[1])}L${P(Math.max(view.x0 - 2, Math.min(view.x1 + 2, w[2])), w[3])}`).join("")} className="arena-wall" />
                </>
              )}
              {s.trail.map((t, i) => t.length > 1 && <path key={i} d={line(t)} className="arena-trail" />)}
              {s.estTrail.map((t, i) => t.length > 1 && <path key={i} d={line(t)} className="arena-est-trail" />)}
              {dots && <path d={dots} className="arena-dot" />}
              {named.map((n) => (
                <g key={n.name}>
                  <line x1={n.x1} y1={n.y1} x2={n.x2} y2={n.y2} className={`arena-named ${n.echo ? "" : "miss"}`} />
                  {n.echo && <rect x={n.x2 - 3.5} y={n.y2 - 3.5} width={7} height={7} transform={`rotate(45 ${f1(n.x2)} ${f1(n.y2)})`} className="arena-named-end" />}
                </g>
              ))}
              {s.crashAt && (
                <g>
                  <circle cx={px(s.crashAt.x)} cy={py(s.crashAt.y)} r={R + 5} className="arena-crash" strokeDasharray="2 5" />
                  <path d={`M${f1(px(s.crashAt.x) - 6)},${f1(py(s.crashAt.y) - 6)}l12,12m0,-12l-12,12`} className="arena-crash" />
                </g>
              )}
              {s.est && Math.abs(s.est.x) < 1e3 && Math.abs(s.est.y) < 1e3 && (
                <g transform={`translate(${f1(px(s.est.x))},${f1(py(s.est.y))}) rotate(${(-deg(s.est.th ?? 0)).toFixed(1)})`}>
                  <circle r={R} className="arena-ghost" />
                  {s.est.th !== undefined && Number.isFinite(s.est.th) && <line x1={0} y1={0} x2={R + 4} y2={0} className="arena-ghost-nose" />}
                </g>
              )}
              <g transform={robotAt}>
                <circle r={R} className="arena-robot" />
                <rect x={-R * 0.43} y={-(WHEEL_BASE / 2 / ROBOT_RADIUS_FT) * R - 2} width={R * 0.86} height={4} rx={2} className="arena-wheel" />
                <rect x={-R * 0.43} y={(WHEEL_BASE / 2 / ROBOT_RADIUS_FT) * R - 2} width={R * 0.86} height={4} rx={2} className="arena-wheel" />
                <path d={`M0,0H${f1(R)}M${f1(R - 5)},-4L${f1(R + 3)},0L${f1(R - 5)},4`} className="arena-nose" fill="none" />
              </g>
              {named.map((n) => (
                <text key={n.name} className="lbl" x={n.lx} y={n.ly} textAnchor="middle">{n.name}</text>
              ))}
              {s.crashAt && <text className="lbl" x={Math.min(W - 70, px(s.crashAt.x) + R + 8)} y={Math.max(14, py(s.crashAt.y) - R - 6)}>touched here</text>}
              {s.est && Math.abs(s.est.x) < 1e3 && Math.abs(s.est.y) < 1e3 && Math.hypot(s.est.x - s.pose.x, s.est.y - s.pose.y) * k > 2 * R && <text className="lbl" x={Math.min(W - 60, px(s.est.x) + R + 4)} y={Math.min(H - PAD.b - 4, py(s.est.y) + R + 12)}>estimate</text>}
            </g>
          </g>
          {play && (
            <g clipPath={`url(#${clipId})`}>
              {objects.map((o, i) => {
                const on = selected === i;
                return o.kind === "box" ? (
                  <g key={i} className={`arena-h ${on ? "on" : ""}`} data-h={`obj-${i}`} role="button" tabIndex={0} aria-label={`${objName(o, i)}. Arrow keys move it, Shift and an arrow key resize it, Delete removes it.`} onKeyDown={objectKey(i)} onFocus={() => setSelected(i)}>
                    <rect x={px(o.x0)} y={py(o.y1)} width={(o.x1 - o.x0) * k} height={(o.y1 - o.y0) * k} className="arena-box" />
                    <rect x={px(o.x0) - 3} y={py(o.y1) - 3} width={(o.x1 - o.x0) * k + 6} height={(o.y1 - o.y0) * k + 6} className="arena-ring" />
                    {on && <rect data-h={`size-${i}`} x={px(o.x1) - 6} y={py(o.y0) - 6} width={12} height={12} className="arena-size" />}
                  </g>
                ) : o.kind === "post" ? (
                  <g key={i} className={`arena-h ${on ? "on" : ""}`} data-h={`obj-${i}`} role="button" tabIndex={0} aria-label={`${objName(o, i)}. Arrow keys move it, Shift and an arrow key resize it, Delete removes it.`} onKeyDown={objectKey(i)} onFocus={() => setSelected(i)}>
                    <circle cx={px(o.x)} cy={py(o.y)} r={o.r * k} className="arena-box" />
                    <circle cx={px(o.x)} cy={py(o.y)} r={o.r * k + 4} className="arena-ring" />
                    {on && <rect data-h={`size-${i}`} x={px(o.x + o.r) - 6} y={py(o.y) - 6} width={12} height={12} className="arena-size" />}
                  </g>
                ) : null;
              })}
              {s.goal && (
                <g className="arena-h" data-h="goal" role="button" tabIndex={0} aria-label={`Goal at x ${fmt(s.goal.x)}, y ${fmt(s.goal.y)} feet. Arrow keys move it.`} onKeyDown={goalKey}>
                  <circle cx={px(s.goal.x)} cy={py(s.goal.y)} r={12} className="arena-ring" />
                </g>
              )}
              <g className="arena-h" data-h="robot" role="button" tabIndex={0} aria-label={`Robot at x ${fmt(s.pose.x)}, y ${fmt(s.pose.y)} feet, heading ${deg(s.pose.th).toFixed(0)} degrees. Arrow keys move it, L and R turn it left and right.`} onKeyDown={robotKey}>
                <circle cx={px(s.pose.x)} cy={py(s.pose.y)} r={R + 4} className="arena-ring" />
              </g>
              <circle data-h="turn" cx={px(s.pose.x) + (R + 14) * Math.cos(s.pose.th)} cy={py(s.pose.y) - (R + 14) * Math.sin(s.pose.th)} r={6} className="arena-turn" />
            </g>
          )}
        </svg>
      </div>
      <div className="arena-side">{sideParts}</div>
    </div>
  );
}

function RobotArena({ board, nowMs, live }: ViewProps) {
  return <ArenaBody key={idOf(board)} board={board} nowMs={nowMs} live={live} />;
}

/** The level's world before anything has run, from its stimuli. */
export function ArenaPreview() {
  const ctx = useContext(ArenaContext);
  const scene = useMemo(() => sceneOfSetup(setStimuli(ctx?.stimuli)), [ctx?.stimuli]);
  return <ArenaBody board={null} nowMs={0} live={false} preview={scene} />;
}

export const view: BenchView = {
  id: "robot-arena",
  title: "Robot arena",
  order: 5,
  relevant: (board) => sceneKind(board.outputs, board.inputsUsed.has("LIDAR_ROOM")) !== undefined,
  Component: RobotArena,
};
