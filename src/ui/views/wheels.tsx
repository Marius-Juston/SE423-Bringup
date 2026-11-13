import type { Board } from "../../sim/board";
import type { Kit } from "../../sim/world/kits";
import type { BenchView, ViewProps } from "./types";

// The wheels seen from the side, turning as the simulated shafts do: the
// encoder angles LEFT_WHEEL_RAD / RIGHT_WHEEL_RAD / HANDWHEEL_RAD
// (src/sim/plugins/eqep.ts; positive = robot forward) with the shaft speeds
// LEFT_WHEEL_RADPS / RIGHT_WHEEL_RADPS / HANDWHEEL_RADPS, or, on the test
// bench, the wheel speeds TB_VLEFT / TB_VRIGHT in ft/s
// (src/sim/plugins/plant.ts) integrated over time. Forward is drawn as
// rolling to the right, which turns the wheel clockwise.

type Trace = { t: number; v: number }[];
const MS = 1e6;
const FT_PER_RAD = 1.235 / 12; // wheel radius, ft (Lab 3)

/** Index of the last entry at or before t (ns), or -1. */
function indexAt(tr: Trace | undefined, t: number): number {
  if (!tr || !tr.length || tr[0].t > t) return -1;
  let lo = 0;
  let hi = tr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tr[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
const at = (tr: Trace | undefined, t: number): number | undefined => {
  const i = indexAt(tr, t);
  return i < 0 ? undefined : tr![i].v;
};

/** Where each speed trace has been integrated to, so a frame only adds the new part. */
const sums = new WeakMap<Trace, { i: number; sum: number }>();

/** Integral of a piecewise-constant trace from its start to t (ns), in value x seconds. */
function integral(tr: Trace | undefined, t: number): number {
  const end = indexAt(tr, t);
  if (!tr || end < 0) return 0;
  let s = sums.get(tr);
  if (!s || s.i > end) sums.set(tr, (s = { i: 0, sum: 0 }));
  for (; s.i < end; s.i++) s.sum += (tr[s.i].v * (tr[s.i + 1].t - tr[s.i].t)) / 1e9;
  return s.sum + (tr[end].v * (t - tr[end].t)) / 1e9;
}

const moved = (tr: Trace | undefined) => (tr?.length ?? 0) > 1;
const ok = (v: number | undefined) => (v !== undefined && Number.isFinite(v) ? v : 0);
/** Two decimals, or two significant digits for a small value, so a slow wheel does not read as 0.00. */
const fmt = (v: number) => {
  const s = Math.abs(v) >= 0.1 || Math.abs(v) < 1e-6 ? v.toFixed(2) : String(+v.toPrecision(2));
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
};

const ENCODERS = [
  ["left wheel", "LEFT_WHEEL_RAD", "LEFT_WHEEL_RADPS", true],
  ["right wheel", "RIGHT_WHEEL_RAD", "RIGHT_WHEEL_RADPS", true],
  ["hand wheel", "HANDWHEEL_RAD", "HANDWHEEL_RADPS", false],
] as const;

/** The board has these wheels (a meter for the angle): a LaunchPad level that toggles a motor pin does not. */
const hasWheels = (kit: Kit) => kit.parts.some((p) => p.kind === "meter" && p.output === "LEFT_WHEEL_RAD");

interface WheelState {
  name: string;
  angle: number;
  radps: number;
  fps?: number;
}

function wheelsOf(board: Board, now: number): WheelState[] {
  const o = board.outputs;
  const out: WheelState[] = [];
  if (moved(o.get("TB_VLEFT")) || moved(o.get("TB_VRIGHT"))) {
    for (const [name, id] of [["left wheel", "TB_VLEFT"], ["right wheel", "TB_VRIGHT"]] as const) {
      const v = ok(at(o.get(id), now));
      out.push({ name, angle: ok(integral(o.get(id), now)) / FT_PER_RAD, radps: v / FT_PER_RAD, fps: v });
    }
    return out;
  }
  for (const [name, id, speed, wheel] of ENCODERS) {
    const tr = o.get(id);
    if (!wheel && !moved(tr)) continue;
    // The shaft speed: its published history (motor model) or, when a test
    // or a knob sets it, the value on the signal bus now.
    const sp = o.get(speed);
    const radps = ok(moved(sp) ? at(sp, now) : board.inputs.get(speed));
    out.push({ name, angle: ok(at(tr, now)), radps, fps: wheel ? radps * FT_PER_RAD : undefined });
  }
  return out;
}

function Wheels({ board, nowMs }: ViewProps) {
  const wheels = wheelsOf(board, nowMs * MS);
  const W = 400;
  const H = 96;
  const slot = W / Math.max(1, wheels.length);
  const R = wheels.length > 2 ? 20 : 26;
  const describe = (w: WheelState) => (Math.abs(w.radps) < 1e-4 ? "stopped" : w.radps > 0 ? "forward" : "backward");
  return (
    <svg className="scope" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={wheels.map((w) => `${w.name}: ${describe(w)}, ${fmt(w.radps)} radians per second${w.fps !== undefined ? `, ${fmt(w.fps)} feet per second` : ""}, ${fmt(w.angle / (2 * Math.PI))} turns so far`).join("; ")}>
      {wheels.map((w, i) => {
        const cx = slot * i + R + 8;
        const cy = 44;
        const tx = cx + R + 9;
        const deg = ((w.angle * 180) / Math.PI) % 360;
        const dir = describe(w);
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
            <text x={tx} y={22} style={{ fill: "var(--text)" }}>{w.name}</text>
            <text x={tx} y={37} style={{ fill: "var(--value)" }}>{fmt(w.radps)} rad/s</text>
            {w.fps !== undefined && <text x={tx} y={51} style={{ fill: "var(--value)" }}>{fmt(w.fps)} ft/s</text>}
            <text x={tx} y={w.fps !== undefined ? 66 : 52}>{dir === "stopped" ? "stopped" : `${dir} ${dir === "forward" ? "↻" : "↺"}`}</text>
            <text x={tx} y={w.fps !== undefined ? 80 : 66}>{fmt(w.angle / (2 * Math.PI))} turns</text>
          </g>
        );
      })}
      <text x={W - 6} y={H - 4} textAnchor="end">forward rolls to the right →</text>
    </svg>
  );
}

export const view: BenchView = {
  id: "wheels",
  title: "Wheels",
  order: 45,
  relevant: (board, kit) => {
    const o = board.outputs;
    if (moved(o.get("TB_VLEFT")) || moved(o.get("TB_VRIGHT"))) return true;
    return hasWheels(kit) && (moved(o.get("LEFT_WHEEL_RAD")) || moved(o.get("RIGHT_WHEEL_RAD")) || moved(o.get("HANDWHEEL_RAD")));
  },
  Component: Wheels,
};
