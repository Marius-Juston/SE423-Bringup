import { FT_PER_MM, LIDAR_POINTS, MAX_MM, MIN_MM, pointDeg, scan, worldOf } from "../../sim/plugins/lidar";
import type { ReactElement } from "react";
import type { BenchView, ViewProps } from "./types";

// The LIDAR scan as the program gets it: 228 distances, one per point of
// the course's scan (G04472503), drawn against the point's index. The top
// view of the same scan is in the robot arena (robot-arena.tsx); this is
// the array a parser fills and a wall follower reads, for the chapter 17
// levels that study it. It yields to the arena wherever the robot drives
// through a world. Read-only: it reads the signal-bus inputs with
// board.inputs.get, never board.input, so it does not mark one as used.
const W = 400;
const H = 190;
const L = 34;
const B = 30;
const T = 12;
const REACH_FT = MAX_MM * FT_PER_MM; // 13.4 ft
const NAMED = [
  { i: 28, name: "right" },
  { i: 113, name: "front" },
  { i: 199, name: "left" },
];
const f1 = (v: number) => v.toFixed(1);

interface Drawing {
  key: string;
  body: ReactElement;
}
// The picture only changes when the robot moves: keep the last one.
let lastDrawing: Drawing | undefined;

function LidarView({ board }: ViewProps) {
  const world = worldOf(board);
  const inp = (name: string, fallback: number) => {
    const v = board.inputs.get(name);
    return v !== undefined && Number.isFinite(v) ? v : fallback;
  };
  const x = inp("LIDAR_X_FT", world.start[0]);
  const y = inp("LIDAR_Y_FT", world.start[1]);
  const theta = inp("LIDAR_THETA_RAD", world.start[2]);
  const offset = inp("LIDAR_OFFSET_FT", 0);
  const scans = board.output("LIDAR_SCANS");
  const key = [world.name, world.walls.length, x, y, theta, offset, scans].join(",");
  if (lastDrawing?.key !== key) lastDrawing = { key, body: draw(scan({ room: 0, world, x, y, theta, offset }), scans) };
  return lastDrawing.body;
}

function draw(mm: number[], scans: number | undefined): ReactElement {
  const top = Math.min(14, Math.max(4, Math.ceil(Math.max(...mm.map((v) => (v >= MIN_MM ? v * FT_PER_MM : 0))) / 2) * 2));
  const px = (i: number) => L + (i / (LIDAR_POINTS - 1)) * (W - L - 8);
  const py = (ft: number) => T + (1 - Math.min(ft, top) / top) * (H - T - B);
  let line = "";
  let pen = false;
  let none = "";
  for (let i = 0; i < LIDAR_POINTS; i++) {
    if (mm[i] >= MIN_MM) {
      line += `${pen ? "L" : "M"}${f1(px(i))},${f1(py(mm[i] * FT_PER_MM))}`;
      pen = true;
    } else {
      // An error code, not a distance: a tick on the top edge (0, nothing in reach) or the bottom (6, too close).
      none += `M${f1(px(i))},${mm[i] === 0 ? T : H - B - 5}v5`;
      pen = false;
    }
  }
  const ft = (i: number) => (mm[i] >= MIN_MM ? `${(mm[i] * FT_PER_MM).toFixed(2)} ft` : mm[i] === 0 ? "no echo (0)" : "too close (6)");
  const echoes = mm.filter((v) => v >= MIN_MM).length;
  return (
    <div className="lview">
      <style>{`
        .lview svg { width: 100%; display: block; background: var(--inset); border: 1px solid var(--border); border-radius: 6px; }
        .lview text { font-family: var(--sans); font-size: 11.5px; fill: var(--dim); }
        .lview text.lbl { fill: var(--text); font-weight: 600; }
        .lview-grid { stroke: var(--border); }
        .lview-line { stroke: var(--info); stroke-width: 1.8; fill: none; stroke-linejoin: round; }
        .lview-none { stroke: var(--dim); stroke-width: 1.2; fill: none; }
        .lview-named { stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 4 3; }
        .lview-info { display: flex; flex-wrap: wrap; gap: 0.2rem 1rem; margin: 0.35rem 0 0; font-size: 0.85rem; color: var(--dim); }
        .lview-info b { color: var(--text); font-family: var(--mono); font-weight: 600; }
      `}</style>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`The LIDAR scan as an array: distance in feet against the point's index, 0 on the right of the robot to 227 on its left. ${echoes} of 228 points have an echo. Point 113, straight ahead: ${ft(113)}. Point 28, to the right: ${ft(28)}. Point 199, to the left: ${ft(199)}.`}>
        {Array.from({ length: top / 2 + 1 }, (_, n) => n * 2).map((g) => (
          <g key={g}>
            <line x1={L} x2={W - 8} y1={py(g)} y2={py(g)} className="lview-grid" />
            <text x={L - 4} y={py(g) + 3} textAnchor="end">{g}</text>
          </g>
        ))}
        <text x={3} y={9}>ft</text>
        {NAMED.map((n) => (
          <g key={n.i}>
            <line x1={px(n.i)} x2={px(n.i)} y1={T} y2={H - B} className="lview-named" />
            <text className="lbl" x={px(n.i)} y={H - B + 11} textAnchor="middle">[{n.i}] {n.name}</text>
          </g>
        ))}
        <text x={L} y={H - 5}>[0] {pointDeg(0).toFixed(0)}°</text>
        <text x={(L + W - 8) / 2} y={H - 5} textAnchor="middle">index of the point, right to left</text>
        <text x={W - 8} y={H - 5} textAnchor="end">[227] +{pointDeg(227).toFixed(0)}°</text>
        {none && <path d={none} className="lview-none" />}
        <path d={line} className="lview-line" />
      </svg>
      <p className="lview-info">
        <span>front [113] <b>{ft(113)}</b></span>
        <span>right [28] <b>{ft(28)}</b></span>
        <span>left [199] <b>{ft(199)}</b></span>
        {scans !== undefined && <span>scans sent <b>{scans}</b></span>}
      </p>
      <p className="lview-info">The same scan as in the robot arena, as the 228 numbers your program gets. Ticks on the top edge: nothing within {REACH_FT.toFixed(1)} ft, the sensor sends 0. Ticks on the bottom edge: closer than 20 mm, it sends 6.</p>
    </div>
  );
}

export const view: BenchView = {
  id: "lidar-view",
  title: "The scan as an array",
  order: 40,
  // The LIDAR model reads LIDAR_ROOM whenever it measures anything: for a
  // scan request, a tb_lidar_* call or a pose set by a test. Where the
  // robot drives (the capstone's world) the arena alone shows it.
  relevant: (board) => board.inputsUsed.has("LIDAR_ROOM") && !board.outputs.has("ROBOT_X_FT"),
  Component: LidarView,
};
