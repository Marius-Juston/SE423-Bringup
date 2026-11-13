import { WHEEL_BASE } from "../../sim/plugins/plant";
import type { BenchView, ViewProps } from "./types";

// Top view of the test bench robot (src/sim/plugins/plant.ts): the true path
// from TB_X_FT / TB_Y_FT / TB_THETA_RAD and, when the program reports one
// with tb_report_pose(), its own estimate from TB_EST_*.

type Trace = { t: number; v: number }[];
const MS = 1e6;
const SAMPLES = 240;
const W = 400;
const H = 250;

/** Value of a trace at time t (ns): the last entry at or before t. */
function at(tr: Trace | undefined, t: number): number | undefined {
  if (!tr || !tr.length || tr[0].t > t) return undefined;
  let lo = 0;
  let hi = tr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tr[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return tr[lo].v;
}

function trail(xs: Trace | undefined, ys: Trace | undefined, now: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (!xs || !ys) return out;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = (now * i) / SAMPLES;
    const x = at(xs, t);
    const y = at(ys, t);
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const last = out[out.length - 1];
    if (!last || last.x !== x || last.y !== y) out.push({ x, y });
  }
  return out;
}

const fmt = (v: number | undefined, d = 2) => {
  if (v === undefined || !Number.isFinite(v)) return "?";
  const s = v.toFixed(d);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
};

function RobotMap({ board, nowMs }: ViewProps) {
  const o = board.outputs;
  const now = nowMs * MS;
  const truth = trail(o.get("TB_X_FT"), o.get("TB_Y_FT"), now);
  const est = trail(o.get("TB_EST_X_FT"), o.get("TB_EST_Y_FT"), now);
  const real = (v: number | undefined) => (v !== undefined && Number.isFinite(v) ? v : 0);
  const pose = { x: real(at(o.get("TB_X_FT"), now)), y: real(at(o.get("TB_Y_FT"), now)), th: real(at(o.get("TB_THETA_RAD"), now)) };
  const ex = at(o.get("TB_EST_X_FT"), now);
  const ey = at(o.get("TB_EST_Y_FT"), now);
  const eth = at(o.get("TB_EST_THETA_RAD"), now);
  const hasEst = ex !== undefined && ey !== undefined && Number.isFinite(ex) && Number.isFinite(ey);

  // Fit everything, keep feet square, never zoom in further than a 3 ft wide view.
  // An estimate that has run away (a bug in the program) is left out of the fit.
  const near = (p: { x: number; y: number }) => Math.abs(p.x) < 1e3 && Math.abs(p.y) < 1e3;
  const pts = [...truth.filter(near), ...est.filter(near), ...(near(pose) ? [{ x: pose.x, y: pose.y }] : [{ x: 0, y: 0 }])];
  let x0 = Math.min(...pts.map((p) => p.x)) - 0.5;
  let x1 = Math.max(...pts.map((p) => p.x)) + 0.5;
  let y0 = Math.min(...pts.map((p) => p.y)) - 0.5;
  let y1 = Math.max(...pts.map((p) => p.y)) + 0.5;
  const k = Math.min((W - 34) / Math.max(3, x1 - x0), (H - 34) / Math.max(1.8, y1 - y0));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  x0 = cx - (W - 34) / 2 / k;
  x1 = cx + (W - 34) / 2 / k;
  y0 = cy - (H - 34) / 2 / k;
  y1 = cy + (H - 34) / 2 / k;
  // Kept within a sane range so a runaway estimate still gives valid coordinates.
  const lim = (v: number) => Math.max(-1e4, Math.min(1e4, v));
  const sx = (x: number) => lim(30 + (x - x0) * k);
  const sy = (y: number) => lim(16 + (y1 - y) * k);
  const grid = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].find((g) => (x1 - x0) / g <= 9) ?? 1000;
  const ticks = (lo: number, hi: number) => {
    const out: number[] = [];
    for (let g = Math.ceil(lo / grid) * grid; g <= hi + 1e-9; g += grid) out.push(Math.abs(g) < 1e-9 ? 0 : g);
    return out;
  };
  const line = (a: { x: number; y: number }[]) => a.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join("");
  const s = Math.max(6, (WHEEL_BASE * k) / 2);
  const shape = `M${-s},${-s * 0.8} L${s * 0.5},${-s * 0.8} L${s * 1.3},0 L${s * 0.5},${s * 0.8} L${-s},${s * 0.8} Z`;
  const place = (x: number, y: number, th: number) => `translate(${sx(x).toFixed(1)},${sy(y).toFixed(1)}) rotate(${((-th * 180) / Math.PI).toFixed(1)})`;
  const err = hasEst ? Math.hypot(ex - pose.x, ey - pose.y) : undefined;

  return (
    <div>
      <svg className="scope" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Top view, x to the right and y up, in feet. The robot is at x ${fmt(pose.x)}, y ${fmt(pose.y)} feet, heading ${fmt(pose.th)} radians (counter-clockwise from the x axis).${hasEst ? ` The program's estimate is ${fmt(ex)}, ${fmt(ey)}, ${fmt(err, 3)} feet away.` : ""}`}>
        {ticks(x0, x1).map((g) => (
          <g key={`x${g}`}>
            <line x1={sx(g)} x2={sx(g)} y1={16} y2={H - 18} stroke={g === 0 ? "var(--border-strong)" : "var(--border)"} />
            {sx(g) < W - 62 && <text x={sx(g)} y={H - 6} textAnchor="middle">{g}</text>}
          </g>
        ))}
        {ticks(y0, y1).map((g) => (
          <g key={`y${g}`}>
            <line x1={30} x2={W - 4} y1={sy(g)} y2={sy(g)} stroke={g === 0 ? "var(--border-strong)" : "var(--border)"} />
            {sy(g) > 24 && <text x={26} y={sy(g) + 3} textAnchor="end">{g}</text>}
          </g>
        ))}
        <text x={W - 4} y={H - 6} textAnchor="end">x, ft</text>
        <text x={4} y={11}>y, ft</text>
        {truth.length > 1 && <path d={line(truth)} fill="none" stroke="var(--info)" strokeWidth={2} strokeLinejoin="round" />}
        {est.length > 1 && <path d={line(est)} fill="none" stroke="var(--value)" strokeWidth={1.6} strokeDasharray="5 3" strokeLinejoin="round" />}
        <g transform={place(pose.x, pose.y, pose.th)}>
          <path d={shape} fill="var(--info)" fillOpacity={0.35} stroke="var(--info)" strokeWidth={1.6} />
          <path d={`M0,0 H${s * 1.3}`} stroke="var(--info)" strokeWidth={1.2} />
          <rect x={-s * 0.5} y={-s - 1.5} width={s} height={3} rx={1.5} fill="var(--text)" />
          <rect x={-s * 0.5} y={s - 1.5} width={s} height={3} rx={1.5} fill="var(--text)" />
        </g>
        {hasEst && (
          <g transform={place(ex, ey, eth !== undefined && Number.isFinite(eth) ? eth : 0)}>
            <path d={shape} fill="none" stroke="var(--value)" strokeWidth={1.6} strokeDasharray="3 2" />
            <path d={`M0,0 H${s * 1.3}`} stroke="var(--value)" strokeWidth={1.2} />
          </g>
        )}
        <path d={`M${W - 250} 8 h14`} stroke="var(--info)" strokeWidth={2} />
        <text x={W - 232} y={11} style={{ fill: "var(--info)" }}>robot (true)</text>
        {hasEst && (
          <g>
            <path d={`M${W - 150} 8 h14`} stroke="var(--value)" strokeWidth={1.6} strokeDasharray="5 3" />
            <text x={W - 132} y={11} style={{ fill: "var(--value)" }}>your estimate (dashed)</text>
          </g>
        )}
      </svg>
      <p className="hint-text">
        Robot: x {fmt(pose.x)} ft, y {fmt(pose.y)} ft, heading {fmt(pose.th)} rad.
        {" "}The pointed end is the front. Heading 0 points along +x; positive is counter-clockwise.
        {hasEst ? ` Your estimate: x ${fmt(ex)} ft, y ${fmt(ey)} ft, heading ${fmt(eth)} rad; it is ${fmt(err, 3)} ft from the true position.` : " The program has not reported an estimate (tb_report_pose)."}
      </p>
    </div>
  );
}

export const view: BenchView = {
  id: "robot-map",
  title: "Robot from above",
  order: 40,
  relevant: (board) => {
    const o = board.outputs;
    return (o.get("TB_X_FT")?.length ?? 0) > 1 || (o.get("TB_Y_FT")?.length ?? 0) > 1 || (o.get("TB_THETA_RAD")?.length ?? 0) > 1 || (o.get("TB_EST_X_FT")?.length ?? 0) > 0;
  },
  Component: RobotMap,
};
