import { useState } from "react";
import type { Board } from "../../sim/board";
import type { LiveSession } from "../../sim/live";
import { worldOf, worldSpec } from "../../sim/plugins/lidar";
import { KIND_MAZE, KIND_ROOM, KIND_SLALOM, KIND_U_TRAP, MAX_OBJECTS, MAZE_MAX, MAZE_MIN, TERRAINS, mulberry32, type Obstacle, type WorldSpec } from "../../sim/world/terrain";
import { usePref } from "../prefs";
import type { Scene, SceneKind } from "./robot-arena-model";

// The playground of the robot arena: number fields and buttons for
// everything that can be dragged in the picture, the choice of world, and
// the list of placed objects. It only exists while a program runs with Run.

const STYLE = `
.arena-play { border: 1px solid var(--border-strong); border-left: 3px solid var(--accent); border-radius: var(--radius); background: var(--surface); padding: 0.3rem 0.6rem 0.5rem; }
.arena-play > summary { font-weight: 680; font-size: 0.9rem; padding: 0.15rem 0; }
.arena-play-note { margin: 0.2rem 0 0.4rem; font-size: 0.82rem; color: var(--dim); }
.arena-row { display: flex; flex-wrap: wrap; gap: 0.3rem 0.6rem; align-items: center; padding: 0.25rem 0; border-top: 1px solid var(--border); font-size: 0.85rem; }
.arena-row > b { min-width: 3.6rem; font-weight: 680; }
.arena-num { display: inline-flex; align-items: center; gap: 0.25rem; color: var(--dim); }
.arena-num input { width: 4.6rem; min-height: 1.75rem; padding: 0.1em 0.3em; font-family: var(--mono); font-size: 0.85rem; }
.arena-num.short input { width: 3.6rem; }
.arena-row select { min-height: 1.75rem; padding: 0.1em 0.3em; font-size: 0.85rem; max-width: 100%; }
.arena-objs { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.2rem; width: 100%; }
.arena-objs li { display: flex; flex-wrap: wrap; gap: 0.25rem 0.5rem; align-items: center; padding: 0.15rem 0.3rem; border-radius: var(--radius); }
.arena-objs li.on { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
.arena-objs .name { min-width: 3.4rem; text-align: left; }
.arena-check { display: inline-flex; align-items: center; gap: 0.3rem; color: var(--dim); }
`;

/** A number field that shows the live value, except while it is being typed in. */
function Num({ label, value, step, digits = 2, short, onSet }: { label: string; value: number; step: number; digits?: number; short?: boolean; onSet: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = value.toFixed(digits).replace(/^-0(\.0+)?$/, "0$1");
  return (
    <label className={`arena-num ${short ? "short" : ""}`}>
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={draft ?? text}
        onFocus={() => setDraft(text)}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onSet(v);
        }}
      />
    </label>
  );
}

export function ArenaPlayground({
  session,
  board,
  kind,
  scene,
  objects,
  tool,
  setTool,
  selected,
  setSelected,
  placeRobot,
  moveGoal,
  setObjects,
  onReset,
  onWorld,
  large,
}: {
  /** The arena is in the large view. */
  large: boolean;
  session: LiveSession;
  board: Board;
  kind: SceneKind;
  scene: Scene;
  objects: Obstacle[];
  tool: "move" | "box" | "post";
  setTool: (t: "move" | "box" | "post") => void;
  selected: number | null;
  setSelected: (i: number | null) => void;
  placeRobot: (x: number, y: number, th: number) => boolean;
  moveGoal: (x: number, y: number) => void;
  setObjects: (list: Obstacle[]) => boolean;
  onReset: () => void;
  onWorld: () => void;
}) {
  // Open by default where there is room for it beside the picture; in the bench column it would push the picture away.
  const [open, setOpen] = usePref<boolean>("arena-play-open", large);
  const spec = worldSpec(board);
  const current = TERRAINS.find((t) => t.spec.kind === spec.kind && (spec.kind !== KIND_ROOM || t.spec.room === spec.room));
  const s = scene;
  const rad = (d: number) => (d * Math.PI) / 180;

  /** Switches to another world and puts the robot and the goal where that world starts and ends. */
  const choose = (next: WorldSpec) => {
    session.setInput("WORLD_KIND", next.kind);
    if (next.kind === KIND_ROOM) session.setInput("LIDAR_ROOM", next.room ?? 0);
    if (next.seed !== undefined) session.setInput("WORLD_SEED", next.seed);
    if (next.size !== undefined) session.setInput("WORLD_SIZE", next.size);
    session.setInput("WORLD_LOOPS", next.loops ? 1 : 0);
    // Placed objects belong to the world they were put in.
    session.setObjects([]);
    const w = worldOf(board);
    session.placeRobot(w.start[0], w.start[1], w.start[2], kind);
    if (kind === "world" && w.goal) {
      session.setInput("ROBOT_GOAL_X_FT", w.goal[0]);
      session.setInput("ROBOT_GOAL_Y_FT", w.goal[1]);
    }
    onWorld();
  };
  const maze = (change: Partial<WorldSpec>) => choose({ kind: KIND_MAZE, size: spec.size ?? 5, seed: spec.seed ?? 1234, loops: spec.loops, ...change });
  const newSeed = () => Math.floor(mulberry32(((spec.seed ?? 0) + 1) * 7919 + Math.floor(session.timeMs))() * 10000);
  const name = (o: Obstacle, i: number) => `${o.kind === "box" ? "Box" : o.kind === "post" ? "Post" : "Wall"} ${i + 1}`;
  const replace = (i: number, o: Obstacle) => setObjects(objects.map((x, j) => (j === i ? o : x)));

  return (
    <details className="arena-play" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <style>{STYLE}</style>
      <summary>Playground: move the robot, the goal and the walls (the tests are not affected)</summary>
      <p className="arena-play-note">
        Drag the robot, its orange handle (to turn it), the goal or an object in the picture, or use the fields below. <strong>This does not change the tests</strong>: Run tests always uses the level's own world, and everything here is gone when the program stops. Your program is not told when you move the robot: watch what its own estimate does.
      </p>
      <div className="arena-row" role="group" aria-label="Robot pose">
        <b>Robot</b>
        <Num label="x, ft" value={s.pose.x} step={0.25} onSet={(v) => placeRobot(v, s.pose.y, s.pose.th)} />
        <Num label="y, ft" value={s.pose.y} step={0.25} onSet={(v) => placeRobot(s.pose.x, v, s.pose.th)} />
        <Num label="heading, °" value={(s.pose.th * 180) / Math.PI} step={15} digits={0} short onSet={(v) => placeRobot(s.pose.x, s.pose.y, rad(v))} />
      </div>
      {s.goal && (
        <div className="arena-row" role="group" aria-label="Goal position">
          <b>Goal</b>
          <Num label="x, ft" value={s.goal.x} step={0.25} onSet={(v) => moveGoal(v, s.goal!.y)} />
          <Num label="y, ft" value={s.goal.y} step={0.25} onSet={(v) => moveGoal(s.goal!.x, v)} />
        </div>
      )}
      {kind !== "bench" && (
        <>
          <div className="arena-row" role="group" aria-label="World">
            <b>World</b>
            <select aria-label="Room or terrain" value={current?.id ?? ""} onChange={(e) => { const t = TERRAINS.find((x) => x.id === e.target.value); if (t) choose(t.spec.kind === KIND_MAZE ? { ...t.spec, size: spec.size ?? t.spec.size, seed: spec.seed ?? t.spec.seed, loops: spec.loops } : t.spec); }}>
              {!current && <option value="">{worldOf(board).name}</option>}
              {TERRAINS.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
            {spec.kind === KIND_MAZE && (
              <>
                <label className="arena-num">
                  <span>size</span>
                  <select aria-label="Maze size" value={Math.max(MAZE_MIN, Math.min(MAZE_MAX, Math.round(spec.size ?? 4)))} onChange={(e) => maze({ size: +e.target.value })}>
                    {[3, 4, 5, 6, 7, 8].map((n) => (
                      <option key={n} value={n}>{n} x {n}</option>
                    ))}
                  </select>
                </label>
                <Num label="seed" value={spec.seed ?? 0} step={1} digits={0} onSet={(v) => maze({ seed: Math.max(0, Math.round(v)) })} />
                <label className="arena-check">
                  <input type="checkbox" checked={!!spec.loops} onChange={(e) => maze({ loops: e.target.checked })} /> with loops
                </label>
                <button className="btn small" onClick={() => maze({ seed: newSeed() })}>New maze</button>
              </>
            )}
            {(spec.kind === KIND_SLALOM || spec.kind === KIND_U_TRAP) && <Num label="layout" value={spec.seed ?? 0} step={1} digits={0} short onSet={(v) => choose({ kind: spec.kind, seed: Math.max(0, Math.round(v)) })} />}
          </div>
          {spec.kind === KIND_MAZE && <p className="arena-play-note">This maze is "maze {Math.round(spec.size ?? 4)}x{Math.round(spec.size ?? 4)} seed {spec.seed ?? 0}{spec.loops ? " with loops" : ""}": the same numbers give the same maze on every computer.</p>}
          <div className="arena-row" role="group" aria-label="Objects">
            <b>Objects</b>
            <button className="btn small" aria-pressed={tool === "box"} disabled={objects.length >= MAX_OBJECTS} onClick={() => setTool(tool === "box" ? "move" : "box")}>Add a box</button>
            <button className="btn small" aria-pressed={tool === "post"} disabled={objects.length >= MAX_OBJECTS} onClick={() => setTool(tool === "post" ? "move" : "post")}>Add a post</button>
            <span className="arena-check">{tool === "move" ? `${objects.length} of ${MAX_OBJECTS}` : "Now click the floor where it should stand."}</span>
            {objects.length > 0 && (
              <ul className="arena-objs">
                {objects.map((o, i) => (
                  <li key={i} className={selected === i ? "on" : ""}>
                    <button className="btn small ghost name" aria-pressed={selected === i} onClick={() => setSelected(selected === i ? null : i)}>{name(o, i)}</button>
                    {o.kind === "box" ? (
                      <>
                        <Num label="x" value={o.x0} step={0.25} short onSet={(v) => replace(i, { ...o, x0: v, x1: v + (o.x1 - o.x0) })} />
                        <Num label="y" value={o.y0} step={0.25} short onSet={(v) => replace(i, { ...o, y0: v, y1: v + (o.y1 - o.y0) })} />
                        <Num label="width" value={o.x1 - o.x0} step={0.25} short onSet={(v) => replace(i, { ...o, x1: o.x0 + Math.max(0.25, v) })} />
                        <Num label="height" value={o.y1 - o.y0} step={0.25} short onSet={(v) => replace(i, { ...o, y1: o.y0 + Math.max(0.25, v) })} />
                      </>
                    ) : o.kind === "post" ? (
                      <>
                        <Num label="x" value={o.x} step={0.25} short onSet={(v) => replace(i, { ...o, x: v })} />
                        <Num label="y" value={o.y} step={0.25} short onSet={(v) => replace(i, { ...o, y: v })} />
                        <Num label="radius" value={o.r} step={0.125} digits={3} short onSet={(v) => replace(i, { ...o, r: v })} />
                      </>
                    ) : null}
                    <button className="btn small ghost" aria-label={`Delete ${name(o, i)}`} onClick={() => { setObjects(objects.filter((_, j) => j !== i)); setSelected(null); }}>Delete</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      <div className="arena-row">
        <button className="btn small" onClick={onReset}>Reset world</button>
        <span className="arena-check">Back to the level's own room, start pose and goal, without placed objects.</span>
      </div>
    </details>
  );
}
