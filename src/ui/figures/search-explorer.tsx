import { useMemo, useState } from "react";

// Grid search one expansion at a time: breadth-first, greedy best-first and
// A* (lecture 18, homework 6). The three searches follow the reference
// solutions of chapter 19 (src/levels/chapters/ch19_vision_planning.ts) step
// for step, so the order of expansion seen here is the one the levels teach:
//   neighbours in the order up, left, right, down (dRow / dCol),
//   BFS: an array used as a queue, the goal is tested when a cell is taken out,
//   A*: scan the cells in index order and take the open cell with the
//       smallest f = g + h (strict <, so ties go to the lowest cell index),
//       test for the goal, close the cell, then update each free neighbour
//       that is new or open with a larger g,
//   greedy best-first: the same loop ordered by h alone.
// h is the Manhattan distance. Every step costs 1.

export const ROWS = 6;
export const COLS = 7;
const N = ROWS * COLS;
const D_ROW = [-1, 0, 0, 1];
const D_COL = [0, -1, 1, 0];

export type Algo = "bfs" | "greedy" | "astar";

// The maps of chapter 19: MAZE (levels plan-bfs, plan-astar) and TRAP
// (level plan-overestimate). 'x' is an obstacle, '0' is free.
export const MAZE = ["000x000", "0x0x0x0", "0x000x0", "0xxxxx0", "000000x", "0x0x0x0"];
export const TRAP = ["00xx0x0", "00000x0", "000x0x0", "000x000", "0000000", "0000x00"];

export const wallsOf = (rows: string[]): boolean[] => rows.flatMap((r) => [...r].map((ch) => ch === "x"));

export interface Search {
  /** 0 not seen, 1 on the frontier (open), 2 expanded (closed). */
  st: number[];
  g: number[];
  parent: number[];
  /** BFS only: the queue, oldest first. */
  queue: number[];
  /** Cell taken out by the last step, -1 before the first. */
  cur: number;
  /** Cells the last step put on the frontier or improved. */
  added: number[];
  expanded: number;
  done: "" | "found" | "none";
  /** Start to goal, once found. */
  path: number[];
}

export const heuristic = (cell: number, goal: number): number =>
  Math.abs(Math.floor(cell / COLS) - Math.floor(goal / COLS)) + Math.abs((cell % COLS) - (goal % COLS));

export function initSearch(start: number): Search {
  const st = new Array<number>(N).fill(0);
  st[start] = 1;
  return { st, g: new Array<number>(N).fill(0), parent: new Array<number>(N).fill(-1), queue: [start], cur: -1, added: [], expanded: 0, done: "", path: [] };
}

const canTravel = (walls: boolean[], row: number, col: number): boolean => row >= 0 && row < ROWS && col >= 0 && col < COLS && !walls[row * COLS + col];

/** The cell the next step takes from the frontier, or -1 if the frontier is empty. */
export function nextCell(s: Search, algo: Algo, goal: number): number {
  if (algo === "bfs") return s.queue.length ? s.queue[0] : -1;
  let cur = -1;
  let best = 0;
  for (let i = 0; i < N; i++) {
    if (s.st[i] !== 1) continue;
    const key = algo === "astar" ? s.g[i] + heuristic(i, goal) : heuristic(i, goal);
    if (cur === -1 || key < best) {
      cur = i;
      best = key;
    }
  }
  return cur;
}

/** One round of the loop: take a cell out, test for the goal, expand it. Pure. */
export function step(s: Search, algo: Algo, walls: boolean[], goal: number): Search {
  if (s.done) return s;
  const cur = nextCell(s, algo, goal);
  if (cur === -1) return { ...s, cur: -1, added: [], done: "none" };
  const queue = algo === "bfs" ? s.queue.slice(1) : s.queue;
  if (cur === goal) {
    const path: number[] = [];
    for (let c = cur; c !== -1; c = s.parent[c]) path.unshift(c);
    return { ...s, queue, cur, added: [], done: "found", path };
  }
  const st = s.st.slice();
  const g = s.g.slice();
  const parent = s.parent.slice();
  const added: number[] = [];
  st[cur] = 2;
  for (let k = 0; k < 4; k++) {
    const row = Math.floor(cur / COLS) + D_ROW[k];
    const col = (cur % COLS) + D_COL[k];
    if (!canTravel(walls, row, col)) continue;
    const next = row * COLS + col;
    const newG = g[cur] + 1;
    // BFS: dist == -1 only. A* and greedy: new, or open and now cheaper.
    if (st[next] === 0 || (algo !== "bfs" && st[next] === 1 && newG < g[next])) {
      g[next] = newG;
      parent[next] = cur;
      st[next] = 1;
      added.push(next);
      if (algo === "bfs") queue.push(next);
    }
  }
  return { st, g, parent, queue, cur, added, expanded: s.expanded + 1, done: "", path: [] };
}

export function runAll(algo: Algo, walls: boolean[], start: number, goal: number): Search {
  let s = initSearch(start);
  while (!s.done) s = step(s, algo, walls, goal);
  return s;
}

const PRESETS: { name: string; rows: string[]; start: [number, number]; goal: [number, number]; note: string }[] = [
  { name: "chapter maze", rows: MAZE, start: [4, 0], goal: [0, 6], note: "The map of the BFS and A* levels: one gap in the wall, at row 2, column 3." },
  { name: "greedy trap", rows: TRAP, start: [5, 0], goal: [0, 6], note: "The map of the heuristic level. Greedy search goes straight towards the goal's row and then has to go back round the walls. A* also counts the cost so far." },
  { name: "walled in", rows: ["000x000", "0x0x0x0", "0x0x0x0", "0xxxxx0", "000000x", "0x0x0x0"], start: [4, 0], goal: [0, 6], note: "The chapter maze with its only gap closed, as homework 6 asks: there is no path." },
];

const ALGOS: { id: Algo; name: string; rule: string }[] = [
  { id: "bfs", name: "BFS", rule: "takes the oldest frontier cell (a queue)" },
  { id: "greedy", name: "Greedy", rule: "takes the frontier cell with the smallest h" },
  { id: "astar", name: "A*", rule: "takes the frontier cell with the smallest f = g + h" },
];

const rc = (cell: number) => `(${Math.floor(cell / COLS)}, ${cell % COLS})`;

const CSS = `
.sx-cell { cursor: pointer; outline: none; }
.sx-cell:focus-visible .sx-bg { stroke: var(--focus); stroke-width: 3; stroke-dasharray: none; }
.sx-bg { fill: var(--surface); stroke: var(--border); stroke-width: 1; }
.sx-bg.wall { fill: var(--dim); fill-opacity: 0.85; stroke: var(--dim); }
.sx-bg.open { fill: var(--arches); fill-opacity: 0.1; stroke: var(--arches); stroke-width: 2; stroke-dasharray: 4 3; }
.sx-bg.closed { fill: var(--arches); fill-opacity: 0.24; stroke: var(--arches); stroke-width: 1.5; }
.sx-bg.cur { stroke: var(--orange); stroke-width: 3; stroke-dasharray: none; }
.sx-x { stroke: var(--inset); stroke-width: 2; }
.sx-path { fill: none; stroke: var(--ok); stroke-width: 13; stroke-linecap: round; stroke-linejoin: round; opacity: 0.5; }
.sx-path.key { stroke-width: 7; }
.sx-tag { font-size: max(9px, calc(9px / var(--fig-k, 1))); font-weight: 700; font-family: var(--sans); fill: var(--inset); }
.sx-tagbox { fill: var(--text); }
.sx-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 0.5rem; }
.sx-hint { color: var(--dim); font-size: 0.82rem; margin: 0; }
.sx-table caption { text-align: left; color: var(--dim); font-size: 0.82rem; }
.sx-table th, .sx-table td { text-align: left; padding: 0.15rem 0.5rem 0.15rem 0; border-bottom: 1px solid var(--border); }
.sx-table th { white-space: nowrap; }
.sx-table tr.sx-now th, .sx-table tr.sx-now td { color: var(--harvest); font-weight: 700; }
.sx-table td.sx-bad { color: var(--bad); }
.sx-count { margin-left: auto; color: var(--dim); font-size: 0.82rem; }
.sx-count strong { color: var(--harvest); }
`;

function SearchExplorer() {
  const [walls, setWalls] = useState<boolean[]>(() => wallsOf(MAZE));
  const [start, setStart] = useState(4 * COLS + 0);
  const [goal, setGoal] = useState(0 * COLS + 6);
  const [algo, setAlgo] = useState<Algo>("bfs");
  const [tool, setTool] = useState<"wall" | "start" | "goal">("wall");
  const [preset, setPreset] = useState(0);
  const [s, setS] = useState<Search>(() => initSearch(4 * COLS + 0));

  const restart = (st = start) => setS(initSearch(st));
  const pickAlgo = (a: Algo) => {
    setAlgo(a);
    restart();
  };
  const loadPreset = (i: number) => {
    const p = PRESETS[i];
    setPreset(i);
    setWalls(wallsOf(p.rows));
    setStart(p.start[0] * COLS + p.start[1]);
    setGoal(p.goal[0] * COLS + p.goal[1]);
    restart(p.start[0] * COLS + p.start[1]);
  };
  const clickCell = (cell: number) => {
    if (tool === "wall") {
      if (cell === start || cell === goal) return;
      setWalls(walls.map((w, i) => (i === cell ? !w : w)));
      setPreset(-1);
      restart();
    } else if (!walls[cell] && cell !== (tool === "start" ? goal : start)) {
      if (tool === "start") setStart(cell);
      else setGoal(cell);
      setPreset(-1);
      restart(tool === "start" ? cell : start);
    }
  };

  const results = useMemo(() => ALGOS.map((a) => runAll(a.id, walls, start, goal)), [walls, start, goal]);
  const shortest = results[0].done === "found" ? results[0].path.length - 1 : -1;

  const S = 52;
  const X0 = 28;
  const Y0 = 16;
  const cx = (cell: number) => X0 + (cell % COLS) * S + S / 2;
  const cy = (cell: number) => Y0 + Math.floor(cell / COLS) * S + S / 2;
  const next = s.done ? -1 : nextCell(s, algo, goal);
  const name = ALGOS.find((a) => a.id === algo)!;
  const keyOf = (cell: number) => (algo === "bfs" ? `g = ${s.g[cell]}` : algo === "greedy" ? `h = ${heuristic(cell, goal)}` : `f = ${s.g[cell]} + ${heuristic(cell, goal)} = ${s.g[cell] + heuristic(cell, goal)}`);
  const frontier = algo === "bfs" ? s.queue : s.st.flatMap((v, i) => (v === 1 ? [i] : []));

  let status: string;
  if (s.done === "found") {
    const len = s.path.length - 1;
    status = `The goal ${rc(goal)} came off the frontier: path found, ${len} steps, after ${s.expanded} expansions. ${shortest >= 0 && len > shortest ? `That is ${len - shortest} more than the shortest path (${shortest}): ${name.name} does not look at the cost so far.` : "It is a shortest path."}`;
  } else if (s.done === "none") {
    status = `The frontier is empty and the goal was never taken out: there is no path. ${s.expanded} cells were expanded, every cell that can be reached from the start. In the A* level this is where the function returns 0.`;
  } else if (s.cur === -1) {
    status = `${name.name} ${name.rule}. The frontier holds only the start ${rc(start)}. Press Step to expand it.`;
  } else {
    status = `Expanded ${rc(s.cur)}${s.added.length ? `, which put ${s.added.map(rc).join(", ")} on the frontier` : ": no new neighbour, a dead end"}. Next comes ${rc(next)}, ${algo === "bfs" ? "the oldest cell in the queue" : `the smallest on the frontier with ${keyOf(next)}`}${next === goal ? ": the goal" : ""}.`;
  }
  const label = `${name.name} on a ${ROWS} by ${COLS} grid from ${rc(start)} to ${rc(goal)}. ${s.expanded} cells expanded, ${frontier.length} on the frontier. ${s.done === "found" ? `Path found with ${s.path.length - 1} steps.` : s.done === "none" ? "No path." : ""}`;

  return (
    <figure className="figure" aria-label="Interactive grid search: breadth-first, greedy best-first and A star, one expansion at a time">
      <style>{CSS}</style>
      <svg viewBox={`0 0 420 ${Y0 + ROWS * S + 30}`} role="group" aria-label={label}>
        {Array.from({ length: COLS }, (_, c) => (
          <text key={`c${c}`} x={X0 + c * S + S / 2} y={11} textAnchor="middle" className="fig-label dim">{c}</text>
        ))}
        {Array.from({ length: ROWS }, (_, r) => (
          <text key={`r${r}`} x={X0 - 8} y={Y0 + r * S + S / 2 + 3} textAnchor="end" className="fig-label dim">{r}</text>
        ))}
        {walls.map((wall, cell) => {
          const x = X0 + (cell % COLS) * S;
          const y = Y0 + Math.floor(cell / COLS) * S;
          const st = s.st[cell];
          const isCur = cell === s.cur && !s.done;
          const cls = wall ? "wall" : `${st === 1 ? "open" : st === 2 ? "closed" : ""} ${isCur ? "cur" : ""}`;
          const h = heuristic(cell, goal);
          const what = wall ? "obstacle" : `${cell === start ? "start, " : cell === goal ? "goal, " : ""}${st === 0 ? "not seen" : `${st === 1 ? "on the frontier" : "expanded"}, g ${s.g[cell]}${algo === "bfs" ? "" : `, h ${h}`}${algo === "astar" ? `, f ${s.g[cell] + h}` : ""}`}`;
          const act = tool === "wall" ? (wall ? "remove the obstacle" : "put an obstacle here") : `move the ${tool} here`;
          return (
            <g
              key={cell}
              className="sx-cell"
              role="button"
              tabIndex={0}
              aria-label={`Row ${Math.floor(cell / COLS)}, column ${cell % COLS}: ${what}. Press to ${act}.`}
              onClick={() => clickCell(cell)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  clickCell(cell);
                }
              }}
            >
              <rect x={x + 2} y={y + 2} width={S - 4} height={S - 4} rx={4} className={`sx-bg ${cls}`} />
              {wall && <path d={`M${x + 14} ${y + 14} L${x + S - 14} ${y + S - 14} M${x + S - 14} ${y + 14} L${x + 14} ${y + S - 14}`} className="sx-x" />}
            </g>
          );
        })}
        {s.path.length > 1 && <path d={`M${s.path.map((c) => `${cx(c)} ${cy(c)}`).join(" L")}`} className="sx-path" pointerEvents="none" />}
        <g pointerEvents="none" aria-hidden="true">
          {walls.map((wall, cell) => {
            const x = X0 + (cell % COLS) * S;
            const y = Y0 + Math.floor(cell / COLS) * S;
            const st = s.st[cell];
            const h = heuristic(cell, goal);
            return (
              <g key={cell}>
              {!wall && st !== 0 && algo === "astar" && (
                <>
                  <text x={x + 6} y={y + 14} className="fig-label">g {s.g[cell]}</text>
                  <text x={x + S - 6} y={y + 14} textAnchor="end" className="fig-label">h {h}</text>
                  <text x={x + S / 2} y={y + 32} textAnchor="middle" className="fig-value">f {s.g[cell] + h}</text>
                </>
              )}
              {!wall && st !== 0 && algo === "greedy" && (
                <>
                  <text x={x + 6} y={y + 14} className="fig-label dim">g {s.g[cell]}</text>
                  <text x={x + S / 2} y={y + 32} textAnchor="middle" className="fig-value">h {h}</text>
                </>
              )}
              {!wall && st !== 0 && algo === "bfs" && <text x={x + S / 2} y={y + 30} textAnchor="middle" className="fig-value">g {s.g[cell]}</text>}
              </g>
            );
          })}
        </g>
        {[
          [start, "START"],
          [goal, "GOAL"],
        ].map(([cell, text]) => (
          <g key={text as string} pointerEvents="none">
            <rect x={cx(cell as number) - 20} y={cy(cell as number) + 10} width={40} height={13} rx={3} className="sx-tagbox" />
            <text x={cx(cell as number)} y={cy(cell as number) + 20.5} textAnchor="middle" className="sx-tag">{text}</text>
          </g>
        ))}
        {/* key, drawn with the same marks */}
        <g transform={`translate(${X0} ${Y0 + ROWS * S + 10})`}>
          <rect x={1} y={0} width={13} height={13} rx={3} className="sx-bg open" />
          <text x={19} y={10} className="fig-label">frontier (dashed)</text>
          <rect x={101} y={0} width={13} height={13} rx={3} className="sx-bg closed" />
          <text x={119} y={10} className="fig-label">expanded (filled)</text>
          <rect x={203} y={0} width={13} height={13} rx={3} className="sx-bg closed cur" />
          <text x={221} y={10} className="fig-label">last expanded</text>
          <path d="M291 7 H305" className="sx-path key" />
          <text x={311} y={10} className="fig-label">path</text>
        </g>
      </svg>
      <div className="fig-why" role="status">
        {status}
        {!s.done && algo === "bfs" && frontier.length > 1 && <> Queue, oldest first: {frontier.map(rc).join(" ")}.</>}
      </div>
      <div className="fig-controls row">
        <button className="btn small primary" onClick={() => setS(step(s, algo, walls, goal))} disabled={!!s.done}>Step</button>
        <button className="btn small" onClick={() => setS(runAll(algo, walls, start, goal))} disabled={!!s.done}>Run to the end</button>
        <button className="btn small" onClick={() => restart()} disabled={s.cur === -1 && !s.done}>Reset</button>
        <span className="sx-count">expanded: <strong>{s.expanded}</strong></span>
      </div>
      <div className="fig-controls">
        <div>
          <span>Search</span>
          {ALGOS.map((a) => (
            <button key={a.id} className="fig-opt" aria-pressed={algo === a.id} onClick={() => pickAlgo(a.id)}>{a.name}</button>
          ))}
        </div>
        <div>
          <span>Map</span>
          {PRESETS.map((p, i) => (
            <button key={p.name} className="fig-opt" aria-pressed={preset === i} onClick={() => loadPreset(i)}>{p.name}</button>
          ))}
        </div>
      </div>
      <details className="fig-more">
        <summary>More controls: draw your own map</summary>
        <div className="fig-controls">
          <div>
            <span>A click</span>
            <button className="fig-opt" aria-pressed={tool === "wall"} onClick={() => setTool("wall")}>adds or removes an obstacle</button>
            <button className="fig-opt" aria-pressed={tool === "start"} onClick={() => setTool("start")}>moves the start</button>
            <button className="fig-opt" aria-pressed={tool === "goal"} onClick={() => setTool("goal")}>moves the goal</button>
          </div>
          <p className="sx-hint">Click a cell of the grid (or move to it with Tab and press Enter). The search starts again on the new map.</p>
        </div>
      </details>
      <table className="sx-table">
        <caption>The three searches on this map, run to the end</caption>
        <thead>
          <tr>
            <th scope="col">Search</th>
            <th scope="col">Takes next</th>
            <th scope="col">Expanded</th>
            <th scope="col">Path</th>
          </tr>
        </thead>
        <tbody>
          {ALGOS.map((a, i) => {
            const r = results[i];
            const len = r.path.length - 1;
            return (
              <tr key={a.id} className={a.id === algo ? "sx-now" : ""} aria-current={a.id === algo ? "true" : undefined}>
                <th scope="row">{a.id === algo ? "▸ " : ""}{a.name}</th>
                <td>{a.id === "bfs" ? "oldest" : a.id === "greedy" ? "smallest h" : "smallest f"}</td>
                <td>{r.expanded}</td>
                <td className={r.done === "none" || len > shortest ? "sx-bad" : ""}>{r.done === "none" ? "none" : `${len} steps${len > shortest ? ` (shortest is ${shortest})` : ""}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <figcaption>
        {preset >= 0 ? PRESETS[preset].note : "Your own map."} Each Step is one round of the loop: take a cell off the frontier, stop if it is the goal, otherwise mark it expanded and put its free neighbours on the frontier. g is the cost so far, h the Manhattan distance to the goal, and f = g + h.
      </figcaption>
    </figure>
  );
}

export const figure = {
  id: "search-explorer",
  title: "Grid search, one step at a time",
  description: "Step breadth-first search, greedy search and A* across a small map and watch which cell each one takes next, how many cells it expands and how long its path is.",
  Component: SearchExplorer,
};
