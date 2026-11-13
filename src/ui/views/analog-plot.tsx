import type { BenchView, ViewProps } from "./types";

const MS = 1e6;
const COLORS = ["var(--value)", "var(--info)", "var(--ok)", "var(--accent)", "var(--code-macro)", "var(--bad)"];

/** Plots every numeric value the chip or the world published (DAC volts, wheel speed, ...). */
function AnalogPlot({ board, kit, window: [from, to] }: ViewProps) {
  // Prefer the values that have a meter on this kit (they have labels and units).
  const meters = kit.parts.filter((p) => p.kind === "meter");
  const names = [...board.outputs.keys()].filter((n) => (board.outputs.get(n)?.length ?? 0) > 2);
  const shown = names.filter((n) => meters.some((m) => m.kind === "meter" && m.output === n)).concat(names.filter((n) => !meters.some((m) => m.kind === "meter" && m.output === n))).slice(0, 6);
  if (!shown.length) return <p className="hint-text">Values that change over time will be plotted here.</p>;
  const W = 400;
  const H = 70;
  const span = Math.max(1e-9, to - from);
  const x = (tMs: number) => 44 + ((tMs - from) / span) * (W - 50);
  return (
    <div className="plots">
      {shown.map((name, i) => {
        const tr = board.outputs.get(name)!;
        const meter = meters.find((m) => m.kind === "meter" && m.output === name);
        const pts = tr.filter((p) => p.t / MS >= from && p.t / MS <= to);
        const before = [...tr].reverse().find((p) => p.t / MS < from);
        const vals = [...pts.map((p) => p.v), ...(before ? [before.v] : [])];
        if (!vals.length) return null;
        let lo = Math.min(...vals);
        let hi = Math.max(...vals);
        if (hi - lo < 1e-9) {
          lo -= 0.5;
          hi += 0.5;
        }
        const y = (v: number) => 8 + (1 - (v - lo) / (hi - lo)) * (H - 22);
        let d = "";
        let last = before?.v;
        if (last !== undefined) d = `M${x(from)},${y(last)}`;
        for (const p of pts) {
          d += d ? `H${x(p.t / MS)}V${y(p.v)}` : `M${x(p.t / MS)},${y(p.v)}`;
          last = p.v;
        }
        if (d) d += `H${x(to)}`;
        const label = meter && meter.kind === "meter" ? `${meter.label} (${meter.unit})` : name;
        return (
          <svg key={name} className="scope" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} from ${lo.toPrecision(3)} to ${hi.toPrecision(3)}, now ${last?.toPrecision(4)}`}>
            <text x={4} y={11} style={{ fill: COLORS[i % COLORS.length] }}>{label}</text>
            <text x={W - 4} y={11} textAnchor="end" style={{ fill: "var(--text)" }}>{last?.toPrecision(4)}</text>
            <text x={4} y={y(hi) + 12}>{hi.toPrecision(3)}</text>
            <text x={4} y={y(lo)}>{lo.toPrecision(3)}</text>
            <line x1={44} x2={W - 6} y1={y(lo)} y2={y(lo)} stroke="var(--faint)" />
            <path d={d} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth={1.5} />
            <text x={44} y={H - 2}>{from.toFixed(span >= 10 ? 0 : 2)} ms</text>
            <text x={W - 6} y={H - 2} textAnchor="end">{to.toFixed(span >= 10 ? 0 : 2)} ms</text>
          </svg>
        );
      })}
    </div>
  );
}

export const view: BenchView = {
  id: "analog-plot",
  title: "Values over time",
  order: 60,
  relevant: (board) => {
    for (const tr of board.outputs.values()) if (tr.length > 2) return true;
    return false;
  },
  Component: AnalogPlot,
};
