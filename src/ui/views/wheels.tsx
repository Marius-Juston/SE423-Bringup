import type { BenchView, ViewProps } from "./types";

// The wheels seen from the side, turning as the simulated shafts do: the
// encoder angles LEFT_WHEEL_RAD / RIGHT_WHEEL_RAD / HANDWHEEL_RAD
// (src/sim/plugins/eqep.ts) or, on the test bench, the wheel speeds
// TB_VLEFT / TB_VRIGHT (src/sim/plugins/plant.ts) integrated over time.

type Trace = { t: number; v: number }[];
const MS = 1e6;
const FT_PER_RAD = 1.235 / 12; // wheel radius, ft (Lab 3)

function at(tr: Trace | undefined, t: number): number {
  if (!tr || !tr.length || tr[0].t > t) return 0;
  let lo = 0;
  let hi = tr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tr[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return tr[lo].v;
}

/** Integral of a piecewise-constant trace from 0 to t (ns), in value x seconds. */
function integral(tr: Trace | undefined, t: number): number {
  if (!tr) return 0;
  let sum = 0;
  for (let i = 0; i < tr.length && tr[i].t < t; i++) {
    const end = i + 1 < tr.length ? Math.min(tr[i + 1].t, t) : t;
    sum += (tr[i].v * (end - tr[i].t)) / 1e9;
  }
  return sum;
}

const moved = (tr: Trace | undefined) => (tr?.length ?? 0) > 1;
const fmt = (v: number, d = 2) => {
  const s = v.toFixed(d);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
};

function Wheels({ board, nowMs }: ViewProps) {
  const o = board.outputs;
  const now = nowMs * MS;
  const bench = moved(o.get("TB_VLEFT")) || moved(o.get("TB_VRIGHT"));
  const wheels: { name: string; angle: number; radps: number; fps?: number }[] = [];
  if (bench) {
    for (const [name, id] of [["left wheel", "TB_VLEFT"], ["right wheel", "TB_VRIGHT"]] as const) {
      const v = at(o.get(id), now);
      wheels.push({ name, angle: integral(o.get(id), now) / FT_PER_RAD, radps: v / FT_PER_RAD, fps: v });
    }
  } else {
    for (const [name, id, wheel] of [["left wheel", "LEFT_WHEEL_RAD", true], ["right wheel", "RIGHT_WHEEL_RAD", true], ["hand wheel", "HANDWHEEL_RAD", false]] as const) {
      const tr = o.get(id);
      if (!wheel && !moved(tr)) continue;
      const a = at(tr, now);
      // Speed over the last 20 ms of the angle's history.
      const back = Math.min(20 * MS, now);
      const radps = back > 0 ? (a - at(tr, now - back)) / (back / 1e9) : 0;
      wheels.push({ name, angle: a, radps, fps: wheel ? radps * FT_PER_RAD : undefined });
    }
  }
  const W = 400;
  const H = 96;
  const slot = W / wheels.length;
  const R = 26;
  return (
    <svg className="scope" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={wheels.map((w) => `${w.name}: ${fmt(w.radps)} radians per second${w.fps !== undefined ? `, ${fmt(w.fps)} feet per second` : ""}`).join("; ")}>
      {wheels.map((w, i) => {
        const cx = slot * i + 36;
        const cy = 44;
        const deg = (w.angle * 180) / Math.PI;
        const dir = Math.abs(w.radps) < 1e-4 ? "stopped" : w.radps > 0 ? "forward" : "backward";
        return (
          <g key={w.name}>
            <line x1={cx - R - 6} x2={cx + R + 6} y1={cy + R + 2} y2={cy + R + 2} stroke="var(--border-strong)" />
            <g transform={`rotate(${deg.toFixed(1)} ${cx} ${cy})`}>
              <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--text)" strokeWidth={3} />
              {[0, 60, 120].map((a) => (
                <line key={a} x1={cx - (R - 3) * Math.cos((a * Math.PI) / 180)} y1={cy - (R - 3) * Math.sin((a * Math.PI) / 180)} x2={cx + (R - 3) * Math.cos((a * Math.PI) / 180)} y2={cy + (R - 3) * Math.sin((a * Math.PI) / 180)} stroke="var(--dim)" strokeWidth={1.2} />
              ))}
              <line x1={cx} y1={cy} x2={cx} y2={cy - R + 3} stroke="var(--accent)" strokeWidth={3} />
              <circle cx={cx} cy={cy - R + 6} r={3} fill="var(--accent)" />
            </g>
            <circle cx={cx} cy={cy} r={3} fill="var(--text)" />
            <text x={cx + R + 12} y={24} style={{ fill: "var(--text)" }}>{w.name}</text>
            <text x={cx + R + 12} y={40} style={{ fill: "var(--value)" }}>{fmt(w.radps)} rad/s</text>
            {w.fps !== undefined && <text x={cx + R + 12} y={54} style={{ fill: "var(--value)" }}>{fmt(w.fps)} ft/s</text>}
            <text x={cx + R + 12} y={w.fps !== undefined ? 70 : 56}>{dir === "stopped" ? "stopped" : `${dir} ${dir === "forward" ? "↻" : "↺"}`}</text>
            <text x={cx + R + 12} y={w.fps !== undefined ? 84 : 70}>{fmt(w.angle / (2 * Math.PI), 2)} turns</text>
          </g>
        );
      })}
    </svg>
  );
}

export const view: BenchView = {
  id: "wheels",
  title: "Wheels",
  order: 45,
  relevant: (board) => {
    const o = board.outputs;
    return moved(o.get("TB_VLEFT")) || moved(o.get("TB_VRIGHT")) || moved(o.get("LEFT_WHEEL_RAD")) || moved(o.get("RIGHT_WHEEL_RAD")) || moved(o.get("HANDWHEEL_RAD"));
  },
  Component: Wheels,
};
