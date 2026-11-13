import type { BenchView, ViewProps } from "./types";

const MS = 1e6;
const COLORS = ["var(--orange)", "var(--arches)", "var(--ok)", "var(--harvest)", "var(--code-macro, #d8a6ff)", "var(--bad)"];

const span = (ns: number) => (ns >= 1e6 ? `${+(ns / 1e6).toPrecision(3)} ms` : ns >= 1e3 ? `${+(ns / 1e3).toPrecision(3)} us` : `${Math.round(ns)} ns`);

/** A strip per interrupt function: when it ran (board.isrLog), how often and for how long. */
function InterruptLog({ board, window: [from, to] }: ViewProps) {
  const log = board.isrLog;
  const lanes = new Map<string, { vector: string; n: number; last: number; prev: number; dur: number; px: Set<number>; wide: [number, number][] }>();
  const W = 400;
  const X0 = 6;
  const width = W - 12;
  const range = Math.max(1e-9, to - from);
  for (const e of log) {
    let l = lanes.get(e.name);
    if (!l) {
      if (lanes.size >= 6) continue;
      lanes.set(e.name, (l = { vector: e.vector, n: 0, last: -1, prev: -1, dur: 0, px: new Set(), wide: [] }));
    }
    l.n++;
    l.prev = l.last;
    l.last = e.t;
    if (e.dur >= 0) l.dur = e.dur;
    const t = e.t / MS;
    const end = t + Math.max(0, e.dur) / MS;
    if (end < from || t > to) continue;
    const a = X0 + ((Math.max(t, from) - from) / range) * width;
    const b = X0 + ((Math.min(end, to) - from) / range) * width;
    if (b - a >= 1.5 && l.wide.length < 150) l.wide.push([a, b]);
    else l.px.add(Math.round(a));
  }
  const names = [...lanes.keys()];
  return (
    <div className="plots">
      {names.map((name, i) => {
        const l = lanes.get(name)!;
        const color = COLORS[i % COLORS.length];
        const period = l.prev >= 0 ? l.last - l.prev : -1;
        const summary = `${l.n} run${l.n === 1 ? "" : "s"}${period > 0 ? `, last two ${span(period)} apart` : ""}${l.dur > 0 ? `, each about ${span(l.dur)} long` : ""}`;
        return (
          <svg key={name} className="scope" viewBox={`0 0 ${W} 44`} role="img" aria-label={`Interrupt function ${name} (${l.vector}): ${summary}`}>
            <text x={X0} y={12} style={{ fill: color }}>{name}() <tspan style={{ fill: "var(--dim)" }}>{l.vector}</tspan></text>
            <text x={W - 6} y={12} textAnchor="end" style={{ fill: "var(--text)" }}>{l.n} run{l.n === 1 ? "" : "s"}</text>
            <line x1={X0} x2={W - 6} y1={30} y2={30} stroke="var(--dim)" strokeWidth={0.6} />
            {l.wide.map(([a, b], k) => (
              <rect key={`w${k}`} x={a} y={18} width={b - a} height={12} fill={color} />
            ))}
            {[...l.px].map((p) => (
              <rect key={p} x={p - 0.6} y={18} width={1.2} height={12} fill={color} />
            ))}
            <text x={X0} y={41}>{period > 0 ? `every ${span(period)}` : l.n === 1 ? "ran once" : ""}</text>
            <text x={W - 6} y={41} textAnchor="end">{l.dur > 0 ? `${span(l.dur)} per run` : ""}</text>
          </svg>
        );
      })}
      <p className="hint-text">Each mark is one run of the function, over the same time span as the pins below. A function that ran once and never again usually forgot to clear PIEACK.</p>
    </div>
  );
}

export const view: BenchView = {
  id: "interrupt-log",
  title: "Interrupt functions",
  order: 55,
  relevant: (board) => board.isrLog.length > 0,
  Component: InterruptLog,
};
