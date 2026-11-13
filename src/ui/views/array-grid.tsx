import { memo, type ReactNode } from "react";
import type { Board } from "../../sim/board";
import type { CType } from "../../sim/cc/types";
import type { BenchView, ViewProps } from "./types";

// Draws the grid-shaped arrays of the student's program: images, masks,
// maps, distance tables. Two shapes count as a grid:
//  - a real 2-D global array, at most 40 x 40;
//  - a flat global array of ROWS * COLS elements (or one more, for a map
//    kept as a string), where ROWS and COLS are whole-number #defines of
//    the program. That is how the course code stores its images and maps:
//    cell (row, col) is element row * COLS + col.

const MAX_SIDE = 40;
const MAX_GRIDS = 8;

interface Grid {
  name: string;
  rows: number;
  cols: number;
  /** Declared length when it differs from rows * cols (flat arrays). */
  flat?: number;
  chars: boolean;
}

/** Value of a `#define NAME 12` or `#define NAME (12)` written in the student's file. */
function userInt(board: Board, name: string): number | undefined {
  const m = board.pp?.macros?.get(name) as { params?: unknown; body?: { v?: string; file?: string }[] } | undefined;
  if (!m || m.params || !m.body?.length || m.body.some((t) => t.file !== "user")) return undefined;
  const text = m.body.map((t) => t.v ?? "").join("");
  const hit = /^\(?(\d{1,3})\)?$/.exec(text);
  return hit ? +hit[1] : undefined;
}

const PAIRS: [string, string][] = [
  ["ROWS", "COLS"],
  ["NROWS", "NCOLS"],
  ["HEIGHT", "WIDTH"],
  ["MAP_ROWS", "MAP_COLS"],
  ["IMG_ROWS", "IMG_COLS"],
];

/** Names of flat arrays that are lists of cells (a queue, a stack, a path), not one value per cell. */
const LISTS = /^(queue|stack|open|path|list)|(queue|stack|list|rows?|cols?)$/i;

function findGrids(board: Board): Grid[] {
  const shapes: [number, number][] = [];
  for (const [r, c] of PAIRS) {
    const rows = userInt(board, r);
    const cols = userInt(board, c);
    if (rows && cols && rows >= 2 && cols >= 2 && rows <= MAX_SIDE && cols <= MAX_SIDE) shapes.push([rows, cols]);
  }
  const out: Grid[] = [];
  for (const g of board.compiler.globals.values()) {
    if (g.file !== "user" || g.t.k !== "array") continue;
    const dims: number[] = [];
    let t: CType = g.t;
    while (t.k === "array") {
      dims.push(t.n);
      t = t.of;
    }
    if (t.k !== "int" && t.k !== "float") continue;
    const chars = t.k === "int" && !!t.ch;
    if (dims.length === 2) {
      if (dims[0] >= 2 && dims[1] >= 2 && dims[0] <= MAX_SIDE && dims[1] <= MAX_SIDE) out.push({ name: g.name, rows: dims[0], cols: dims[1], chars });
    } else if (dims.length === 1) {
      const shape = shapes.find(([r, c]) => dims[0] === r * c || (chars && dims[0] === r * c + 1));
      // Work lists have the same length as the grid but are not pictures of it.
      if (shape && !LISTS.test(g.name)) out.push({ name: g.name, rows: shape[0], cols: shape[1], flat: dims[0], chars });
    }
  }
  return out;
}

// The list only changes when a program is loaded: remember it per board.
const cache = new WeakMap<Board, { size: number; grids: Grid[] }>();
function gridsOf(board: Board): Grid[] {
  const size = board.compiler.globals.size;
  const hit = cache.get(board);
  if (hit && hit.size === size) return hit.grids;
  const grids = findGrids(board);
  cache.set(board, { size, grids });
  return grids;
}

const CELL = 20;
/**
 * Heat-map steps from the smallest value (the panel background) to the
 * largest (the theme's blue), as the share of blue in each step. The value
 * is also written in the cell when it fits, so colour is never the only cue.
 * Steps 0 to 3 carry text in the normal text colour, 4 and 5 in the
 * background colour: both pairs keep their contrast in the light and the
 * dark theme because they are built from the theme's own tokens.
 */
const HEAT = [0, 12, 24, 36, 85, 100];
const heat = (k: number) => `color-mix(in srgb, var(--info) ${HEAT[k]}%, var(--inset))`;
const fmt = (v: number) => (!Number.isFinite(v) ? (Number.isNaN(v) ? "NaN" : v > 0 ? "inf" : "-inf") : Math.abs(v) >= 1e6 ? v.toExponential(1) : Number.isInteger(v) ? String(v) : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(Math.abs(v) >= 10 ? 1 : 2));
const rectPath = (cells: number[], cols: number, inset = 0) =>
  cells.map((i) => `M${(i % cols) * CELL + inset},${Math.floor(i / cols) * CELL + inset}h${CELL - 2 * inset}v${CELL - 2 * inset}h${-(CELL - 2 * inset)}z`).join("");

function Frame({ rows, cols, label, children }: { rows: number; cols: number; label: string; children: ReactNode }) {
  const w = cols * CELL;
  const h = rows * CELL;
  let lines = "";
  for (let c = 1; c < cols; c++) lines += `M${c * CELL},0v${h}`;
  for (let r = 1; r < rows; r++) lines += `M0,${r * CELL}h${w}`;
  return (
    <svg viewBox={`-1 -1 ${w + 2} ${h + 2}`} style={{ maxWidth: `${Math.max(120, cols * 24)}px` }} role="img" aria-label={label}>
      <rect x="0" y="0" width={w} height={h} className="agrid-bg" />
      {children}
      <path d={lines} className="agrid-lines" />
      <rect x="0" y="0" width={w} height={h} className="agrid-edge" />
    </svg>
  );
}

/** Same grid and the same numbers as last frame: nothing to draw again. */
const sameData = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

const OneGrid = memo(function OneGrid({ grid, data }: { grid: Grid; data: number[] }) {
  const { rows, cols } = grid;
  const n = rows * cols;
  const vals = data.slice(0, n);
  // Smallest and largest of the real numbers; NaN and infinity (a float
  // array of a program with a bug) are drawn as marked cells of their own.
  let lo = Infinity;
  let hi = -Infinity;
  const odd: number[] = [];
  vals.forEach((v, i) => {
    if (!Number.isFinite(v)) odd.push(i);
    else {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  });
  if (lo > hi) lo = hi = 0;
  const decl = `${grid.name}[${grid.flat ?? `${rows}][${cols}`}]`;
  const texts = (label: (v: number, i: number) => string | null, cls: (v: number) => string) =>
    n > 400
      ? null
      : vals.map((v, i) => {
          const s = label(v, i);
          return s === null || s.length > 3 ? null : (
            <text key={i} x={(i % cols) * CELL + CELL / 2} y={Math.floor(i / cols) * CELL + CELL / 2 + 3.5} textAnchor="middle" className={`agrid-num ${cls(v)}`} style={s.length === 3 ? { fontSize: "8px" } : undefined}>{s}</text>
          );
        });

  // A map kept as characters: 'x' is an obstacle, everything else is free.
  const printable = grid.chars && vals.every((v) => v === 0 || (v >= 32 && v < 127));
  if (printable) {
    const walls = vals.flatMap((v, i) => (v === 120 || v === 88 || v === 35 ? [i] : []));
    return (
      <figure className="agrid-item" style={itemStyle(cols)}>
        <figcaption><code>{decl}</code> <span>{rows} x {cols}, {walls.length} obstacle{walls.length === 1 ? "" : "s"}</span></figcaption>
        <Frame rows={rows} cols={cols} label={`${grid.name}: character map of ${rows} rows by ${cols} columns, ${walls.length} obstacle cells`}>
          <path d={rectPath(walls, cols)} className="agrid-wall" />
          {texts((v) => (v === 0 || v === 32 || v === 48 ? null : String.fromCharCode(v)), (v) => (v === 120 || v === 88 || v === 35 ? "on-wall" : ""))}
        </Frame>
      </figure>
    );
  }
  // Only 0 and 1: a mask.
  if (lo >= 0 && hi <= 1 && vals.every((v) => v === 0 || v === 1)) {
    const on = vals.flatMap((v, i) => (v === 1 ? [i] : []));
    return (
      <figure className="agrid-item" style={itemStyle(cols)}>
        <figcaption><code>{decl}</code> <span>{rows} x {cols} mask, {on.length} set</span></figcaption>
        <Frame rows={rows} cols={cols} label={`${grid.name}: mask of ${rows} rows by ${cols} columns, ${on.length} cells are 1`}>
          <path d={rectPath(on, cols, 1)} className="agrid-on" />
        </Frame>
      </figure>
    );
  }
  // Anything else: a heat map between the smallest and the largest value.
  const span = hi - lo || 1;
  const level = (v: number) => Math.min(HEAT.length - 1, Math.floor(((v - lo) / span) * HEAT.length));
  const groups: number[][] = HEAT.map(() => []);
  vals.forEach((v, i) => {
    if (Number.isFinite(v)) groups[level(v)].push(i);
  });
  const oddNote = odd.length ? `, ${odd.length} cell${odd.length === 1 ? " is" : "s are"} not a number` : "";
  return (
    <figure className="agrid-item" style={itemStyle(cols)}>
      <figcaption><code>{decl}</code> <span>{rows} x {cols}, {fmt(lo)} (faint) to {fmt(hi)} (strong){oddNote}</span></figcaption>
      <Frame rows={rows} cols={cols} label={`${grid.name}: ${rows} rows by ${cols} columns, values from ${fmt(lo)} to ${fmt(hi)}${oddNote}`}>
        {groups.map((cells, k) => (cells.length ? <path key={k} d={rectPath(cells, cols)} style={{ fill: heat(k) }} /> : null))}
        {odd.length > 0 && <path d={rectPath(odd, cols, 1.5)} className="agrid-odd" />}
        {texts((v) => fmt(v), (v) => (!Number.isFinite(v) ? "" : level(v) >= 4 ? "strong" : ""))}
      </Frame>
    </figure>
  );
}, (a, b) => a.grid === b.grid && sameData(a.data, b.data));

/** Wide grids take a row of their own, so their cells stay large enough to read. */
const itemStyle = (cols: number) => (cols > 8 ? { flexBasis: "100%", maxWidth: `${cols * 30}px` } : undefined);

const Picture = memo(function Picture({ rows, cols, r, g, b }: { rows: number; cols: number; r: number[]; g: number[]; b: number[] }) {
  // Channels above 1 are taken as 0..255, otherwise as 0..1.
  const top = [r, g, b].some((ch) => ch.some((v) => v > 1)) ? 1 : 255;
  const c = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v * top))) : 0);
  return (
    <figure className="agrid-item" style={itemStyle(cols)}>
      <figcaption><code>img_r, img_g, img_b</code> <span>{rows} x {cols} as one colour picture</span></figcaption>
      <Frame rows={rows} cols={cols} label={`The colour image stored in img_r, img_g and img_b, ${rows} rows by ${cols} columns; cell (row, column) is element row times ${cols} plus column`}>
        {Array.from({ length: rows * cols }, (_, i) => (
          <rect key={i} x={(i % cols) * CELL} y={Math.floor(i / cols) * CELL} width={CELL} height={CELL} style={{ fill: `rgb(${c(r[i])},${c(g[i])},${c(b[i])})` }} />
        ))}
      </Frame>
    </figure>
  );
}, (a, b) => a.rows === b.rows && a.cols === b.cols && sameData(a.r, b.r) && sameData(a.g, b.g) && sameData(a.b, b.b));

function ArrayGrid({ board }: ViewProps) {
  const grids = gridsOf(board);
  const by = new Map(grids.map((g) => [g.name, g]));
  const rgb = ["img_r", "img_g", "img_b"].map((n) => by.get(n));
  const picture = rgb.every((g) => g && g.rows === rgb[0]!.rows && g.cols === rgb[0]!.cols && g.rows * g.cols <= 400) ? rgb[0]! : null;
  const rest = grids.filter((g) => !(picture && /^img_[rgb]$/.test(g.name))).slice(0, picture ? MAX_GRIDS - 1 : MAX_GRIDS);
  const hidden = grids.length - rest.length - (picture ? 3 : 0);
  const read = (name: string) => board.readArray(name)?.data ?? [];
  return (
    <div className="agrid">
      <style>{`
        .agrid { display: flex; flex-wrap: wrap; gap: 0.6rem 0.9rem; align-items: flex-start; }
        .agrid-item { margin: 0; flex: 1 1 150px; min-width: 130px; max-width: 320px; }
        .agrid-item figcaption { font-size: 0.8rem; color: var(--dim); margin-bottom: 0.2rem; }
        .agrid-item figcaption code { color: var(--text); font-size: 0.8rem; }
        .agrid-item svg { display: block; width: 100%; height: auto; }
        .agrid-bg { fill: var(--surface); }
        .agrid-edge { fill: none; stroke: var(--dim); stroke-width: 1; }
        .agrid-lines { fill: none; stroke: var(--border); stroke-width: 0.6; }
        .agrid-on { fill: var(--orange); }
        .agrid-wall { fill: var(--dim); }
        .agrid-num { font-family: var(--mono); font-size: 9.5px; fill: var(--text); }
        .agrid-num.on-wall { fill: var(--bg); font-weight: 700; }
        .agrid-num.strong { fill: var(--bg); font-weight: 700; }
        .agrid-odd { fill: var(--bad-soft); stroke: var(--bad); stroke-width: 1; stroke-dasharray: 3 2; }
        .agrid-more { flex-basis: 100%; }
      `}</style>
      {picture && <Picture rows={picture.rows} cols={picture.cols} r={read("img_r")} g={read("img_g")} b={read("img_b")} />}
      {rest.map((g) => {
        const data = read(g.name);
        return data.length >= g.rows * g.cols ? <OneGrid key={g.name} grid={g} data={data} /> : null;
      })}
      {hidden > 0 && <p className="hint-text agrid-more">{hidden} more grid-shaped array{hidden === 1 ? "" : "s"} not shown.</p>}
    </div>
  );
}

export const view: BenchView = {
  id: "array-grid",
  title: "Arrays as grids",
  order: 40,
  relevant: (board) => gridsOf(board).length > 0,
  Component: ArrayGrid,
};
