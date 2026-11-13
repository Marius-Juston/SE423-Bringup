import { FT_PER_MM, G_CLUSTER, G_START, LIDAR_POINTS, MAX_MM, MIN_MM, ROOMS, scan, stepAngle } from "../../sim/plugins/lidar";
import type { BenchView, ViewProps } from "./types";

// Top view of the simulated LIDAR's world (src/sim/plugins/lidar.ts): the
// room, the robot at the pose the test stimuli set, and the 228 rays of the
// course's scan (G04472503) to where they hit. Read-only: it reads the
// signal-bus inputs with board.inputs.get, never board.input, so it does not
// mark an input as used.
const W = 400;
const PAD = 12;
const REACH_FT = MAX_MM * FT_PER_MM; // 13.4 ft
const NAMED = [
  { i: 113, name: "front" },
  { i: 28, name: "right" },
  { i: 199, name: "left" },
];
const f1 = (v: number) => v.toFixed(1);

function LidarView({ board }: ViewProps) {
  const roomNo = Math.round(board.inputs.get("LIDAR_ROOM") ?? 0);
  const room = ROOMS[roomNo] ?? ROOMS[0];
  const x = board.inputs.get("LIDAR_X_FT") ?? room.start[0];
  const y = board.inputs.get("LIDAR_Y_FT") ?? room.start[1];
  const theta = board.inputs.get("LIDAR_THETA_RAD") ?? room.start[2];
  const offset = board.inputs.get("LIDAR_OFFSET_FT") ?? 0;
  const sx = x + offset * Math.cos(theta);
  const sy = y + offset * Math.sin(theta);
  const mm = scan({ room: ROOMS[roomNo] ? roomNo : 0, x, y, theta, offset });

  // Window in feet: the room, but never further than the sensor can see.
  const xs = room.walls.flatMap((w) => [w[0], w[2]]);
  const ys = room.walls.flatMap((w) => [w[1], w[3]]);
  const reach = REACH_FT + 1;
  const x0 = Math.max(Math.min(...xs, x - 1), x - reach);
  const x1 = Math.min(Math.max(...xs, x + 1), x + reach);
  const y0 = Math.max(Math.min(...ys, y - 1.5), y - reach);
  const y1 = Math.min(Math.max(...ys, y + 1.5), y + reach);
  const s = Math.min((W - 2 * PAD) / (x1 - x0), 260 / (y1 - y0));
  const H = (y1 - y0) * s + 2 * PAD;
  const left = (W - (x1 - x0) * s) / 2;
  const px = (wx: number) => left + (wx - x0) * s;
  const py = (wy: number) => PAD + (y1 - wy) * s;
  const clampX = (v: number) => Math.max(x0 - 1, Math.min(x1 + 1, v));
  const clampY = (v: number) => Math.max(y0 - 1, Math.min(y1 + 1, v));

  let hits = "";
  let misses = "";
  let dots = "";
  const tip = (i: number): [number, number, boolean] => {
    const a = theta + stepAngle(G_START + G_CLUSTER * i);
    const echo = mm[i] >= MIN_MM;
    const d = echo ? mm[i] / 304.8 : mm[i] === 0 ? REACH_FT : 0;
    return [px(sx + d * Math.cos(a)), py(sy + d * Math.sin(a)), echo];
  };
  for (let i = 0; i < LIDAR_POINTS; i++) {
    const [tx, ty, echo] = tip(i);
    const seg = `M${f1(px(sx))},${f1(py(sy))}L${f1(tx)},${f1(ty)}`;
    if (echo) {
      hits += seg;
      dots += `M${f1(tx)},${f1(ty)}h0.01`;
    } else misses += seg;
  }
  const ft = (i: number) => (mm[i] >= MIN_MM ? `${(mm[i] * FT_PER_MM).toFixed(2)} ft` : mm[i] === 0 ? "no echo" : "too close");
  const scans = board.output("LIDAR_SCANS");
  const deg = (theta * 180) / Math.PI;
  const r = Math.max(5, 0.35 * s);
  return (
    <div className="lview">
      <style>{`
        .lview svg { width: 100%; max-height: 320px; display: block; background: var(--inset); border: 1px solid var(--border); border-radius: 6px; }
        .lview text { font-family: var(--sans); font-size: 10px; fill: var(--text); paint-order: stroke; stroke: var(--inset); stroke-width: 3px; stroke-linejoin: round; }
        .lview-wall { stroke: var(--text); stroke-width: 2.5; stroke-linecap: square; fill: none; }
        .lview-hit { stroke: var(--info); stroke-width: 0.6; opacity: 0.6; fill: none; }
        .lview-miss { stroke: var(--dim); stroke-width: 0.5; stroke-dasharray: 3 4; opacity: 0.6; fill: none; }
        .lview-dot { stroke: var(--value); stroke-width: 2.6; stroke-linecap: round; fill: none; }
        .lview-named { stroke: var(--accent); stroke-width: 1.8; fill: none; }
        .lview-named.miss { stroke-dasharray: 4 3; }
        .lview-robot { fill: var(--surface); stroke: var(--text); stroke-width: 1.5; }
        .lview-nose { stroke: var(--text); stroke-width: 2; stroke-linecap: round; }
        .lview-info { display: flex; flex-wrap: wrap; gap: 0.2rem 1rem; margin: 0.35rem 0 0; font-size: 0.85rem; color: var(--dim); }
        .lview-info b { color: var(--text); font-family: var(--mono); font-weight: 600; }
      `}</style>
      <svg
        viewBox={`0 0 ${W} ${f1(H)}`}
        role="img"
        aria-label={`Top view of the LIDAR in room ${roomNo}, ${room.name}. Robot at x ${x.toFixed(2)} feet, y ${y.toFixed(2)} feet, heading ${deg.toFixed(0)} degrees. Front ${ft(113)}, right ${ft(28)}, left ${ft(199)}.`}
      >
        <path d={misses} className="lview-miss" />
        <path d={hits} className="lview-hit" />
        {room.walls.map(([ax, ay, bx, by], k) => (
          <line key={k} x1={px(clampX(ax))} y1={py(clampY(ay))} x2={px(clampX(bx))} y2={py(clampY(by))} className="lview-wall" />
        ))}
        <path d={dots} className="lview-dot" />
        {NAMED.map((n) => {
          const [tx, ty, echo] = tip(n.i);
          return <line key={n.i} x1={px(sx)} y1={py(sy)} x2={tx} y2={ty} className={`lview-named ${echo ? "" : "miss"}`} />;
        })}
        <circle cx={px(x)} cy={py(y)} r={r} className="lview-robot" />
        <line x1={px(x)} y1={py(y)} x2={px(x) + r * Math.cos(theta)} y2={py(y) - r * Math.sin(theta)} className="lview-nose" />
        {NAMED.map((n) => {
          // Label a little way along the ray, kept inside the picture.
          const a = theta + stepAngle(G_START + G_CLUSTER * n.i);
          const lx = Math.max(22, Math.min(W - 22, px(x) + (r + 16) * Math.cos(a)));
          const ly = Math.max(10, Math.min(H - 4, py(y) - (r + 14) * Math.sin(a) + 3));
          return <text key={n.i} x={lx} y={ly} textAnchor="middle">{n.name}</text>;
        })}
      </svg>
      <p className="lview-info">
        <span>Room {roomNo}: {room.name}</span>
        <span>pose <b>({x.toFixed(2)}, {y.toFixed(2)}) ft, {deg.toFixed(0)}°</b></span>
        <span>front [113] <b>{ft(113)}</b></span>
        <span>right [28] <b>{ft(28)}</b></span>
        <span>left [199] <b>{ft(199)}</b></span>
        {scans !== undefined && <span>scans sent <b>{scans}</b></span>}
      </p>
    </div>
  );
}

export const view: BenchView = {
  id: "lidar-view",
  title: "What the LIDAR sees",
  order: 40,
  // The LIDAR model reads LIDAR_ROOM whenever it measures anything: for a
  // scan request, a tb_lidar_* call or a pose set by a test.
  relevant: (board) => board.inputsUsed.has("LIDAR_ROOM"),
  Component: LidarView,
};
