import type { Board } from "../../sim/board";
import type { BenchView, ViewProps } from "./types";

const MS = 1e6;
const MAX_LANES = 6;
const COLORS = ["var(--hi)", "var(--lo)", "var(--ok)", "var(--value)", "var(--code-macro)", "var(--text)"];

const span = (ns: number) => (ns >= 1e6 ? `${+(ns / 1e6).toPrecision(3)} ms` : ns >= 1e3 ? `${+(ns / 1e3).toPrecision(3)} us` : `${Math.round(ns)} ns`);

interface Lane {
  vector: string;
  n: number;
  last: number;
  prev: number;
  dur: number;
}
interface Tally {
  log: Board["isrLog"];
  /** Entries of the log already counted. */
  done: number;
  lanes: Map<string, Lane>;
}
// Counts per function are kept between frames, so a frame only looks at the
// log entries added since the last one (the log grows for as long as the
// program runs).
const tallies = new WeakMap<Board, Tally>();
function tally(board: Board): Tally {
  const log = board.isrLog;
  let s = tallies.get(board);
  if (!s || s.log !== log || s.done > log.length) tallies.set(board, (s = { log, done: 0, lanes: new Map() }));
  // An entry gets its duration when the function returns: wait for it.
  while (s.done < log.length && log[s.done].dur >= 0) {
    const e = log[s.done++];
    let l = s.lanes.get(e.name);
    if (!l) s.lanes.set(e.name, (l = { vector: e.vector, n: 0, last: -1, prev: -1, dur: 0 }));
    l.n++;
    l.prev = l.last;
    l.last = e.t;
    l.dur = e.dur;
  }
  return s;
}

/** Index of the first log entry that starts at or after tNs (entries are in time order). */
function firstFrom(log: Board["isrLog"], tNs: number): number {
  let lo = 0;
  let hi = log.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (log[mid].t < tNs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const W = 400;
const X0 = 6;
const X1 = W - 6;

/** A strip per interrupt function: when it ran (board.isrLog), how often and for how long. */
function InterruptLog({ board, window: [from, to] }: ViewProps) {
  const log = board.isrLog;
  const { lanes } = tally(board);
  const names = [...lanes.keys()].slice(0, MAX_LANES);
  const range = Math.max(1e-9, to - from);
  const px = (ms: number) => X0 + ((Math.max(from, Math.min(to, ms)) - from) / range) * (X1 - X0);
  // Marks inside the window: one path per function. Runs narrower than a
  // pixel become a thin tick, and ticks that share a half pixel are one tick.
  const marks = new Map<string, { d: string; lastTick: number }>();
  // A run that began before the window can still reach into it: start one long run early.
  let longest = 0;
  for (const l of lanes.values()) longest = Math.max(longest, l.dur);
  for (let i = firstFrom(log, from * MS - longest); i < log.length && log[i].t <= to * MS; i++) {
    const e = log[i];
    let m = marks.get(e.name);
    if (!m) marks.set(e.name, (m = { d: "", lastTick: -1 }));
    const a = px(e.t / MS);
    const b = px((e.t + Math.max(0, e.dur)) / MS);
    if (b - a >= 1.5) m.d += `M${a.toFixed(1)},18h${(b - a).toFixed(1)}v12h${(-(b - a)).toFixed(1)}z`;
    else {
      const tick = Math.round(a * 2) / 2;
      if (tick === m.lastTick) continue;
      m.lastTick = tick;
      m.d += `M${tick - 0.6},18h1.2v12h-1.2z`;
    }
  }
  const hidden = lanes.size - names.length;
  const once = names.some((n) => lanes.get(n)!.n === 1);
  return (
    <div className="plots">
      {names.map((name, i) => {
        const l = lanes.get(name)!;
        const color = COLORS[i % COLORS.length];
        const period = l.prev >= 0 ? l.last - l.prev : -1;
        const runs = `${l.n} run${l.n === 1 ? "" : "s"}`;
        const every = period > 0 ? `last two ${span(period)} apart` : l.n === 1 ? "ran once" : "";
        const each = l.dur > 0 ? `last run took ${span(l.dur)}` : "";
        return (
          <svg key={name} className="scope" viewBox={`0 0 ${W} 44`} role="img" aria-label={`Interrupt function ${name} (${l.vector}): ${[runs, every, each].filter(Boolean).join(", ")}`}>
            <text x={X0} y={12} style={{ fill: color }}>{name}() <tspan style={{ fill: "var(--dim)" }}>{l.vector}</tspan></text>
            <text x={X1} y={12} textAnchor="end" style={{ fill: "var(--text)" }}>{runs}</text>
            <line x1={X0} x2={X1} y1={30} y2={30} stroke="var(--dim)" strokeWidth={0.6} />
            <path d={marks.get(name)?.d ?? ""} fill={color} />
            <text x={X0} y={41}>{every}</text>
            <text x={X1} y={41} textAnchor="end">{each}</text>
          </svg>
        );
      })}
      {names.length === 0 && <p className="hint-text">An interrupt function has started and has not returned yet.</p>}
      <p className="hint-text">
        Each mark is one run of the function, from {from.toFixed(range >= 10 ? 0 : 2)} ms to {to.toFixed(range >= 10 ? 0 : 2)} ms (the same span as the pins below).
        {once ? " A function that ran once and never again usually did not acknowledge its interrupt group (PieCtrlRegs.PIEACK.all)." : ""}
        {hidden > 0 ? ` ${hidden} more interrupt function${hidden === 1 ? "" : "s"} not shown.` : ""}
      </p>
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
