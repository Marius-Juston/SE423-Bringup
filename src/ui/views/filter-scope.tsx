import { useState } from "react";
import type { BenchView, ViewProps } from "./types";

// Signal test bench (src/sim/plugins/signalgen.ts): every input sample is
// published as TB_IN and every tb_output(y) as TB_OUT. A published value is
// only recorded when it changes, so both are drawn as step lines: a value
// holds until the next one.

const MS = 1e6;
const SPANS = [5, 20, 100, 0]; // ms; 0 = the whole window

type Point = { t: number; v: number };

/** Index of the first point with t > tNs (traces are in time order). */
function after(tr: Point[], tNs: number): number {
  let lo = 0;
  let hi = tr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tr[mid].t <= tNs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface Stretch {
  /** Step path, or "" when there is nothing to draw. */
  d: string;
  /** Points to mark with a dot (only when there are few). */
  dots: [number, number][];
  lo: number;
  hi: number;
  /** Value held at the end of the stretch. */
  last: number | undefined;
  /** Values that are not numbers (NaN, infinity). */
  bad: number;
  n: number;
}

const W = 400;
const H = 150;
const X0 = 40;
const X1 = W - 6;
const Y0 = H - 18;
const Y1 = 20;

/** Smallest, largest and latest value of a trace over [from, to] ms. */
function range(tr: Point[] | undefined, from: number, to: number) {
  const a = tr ? after(tr, from * MS - 1) : 0;
  const b = tr ? after(tr, to * MS) : 0;
  let lo = Infinity;
  let hi = -Infinity;
  let bad = 0;
  const see = (v: number) => {
    if (!Number.isFinite(v)) bad++;
    else {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  };
  if (tr && a > 0) see(tr[a - 1].v);
  for (let k = a; k < b; k++) see(tr![k].v);
  return { a, b, lo, hi, bad, last: tr && b > 0 ? tr[b - 1].v : undefined };
}

/** The step line of a trace; points that share a pixel column become one vertical stroke. */
function stretch(tr: Point[] | undefined, r: ReturnType<typeof range>, x: (tNs: number) => number, y: (v: number) => number): Stretch {
  const out: Stretch = { d: "", dots: [], lo: r.lo, hi: r.hi, last: r.last, bad: r.bad, n: r.b - r.a };
  if (!tr) return out;
  const before = r.a > 0 ? tr[r.a - 1].v : undefined;
  let held = before !== undefined && Number.isFinite(before) ? before : undefined;
  if (held !== undefined) out.d = `M${X0},${y(held).toFixed(1)}`;
  const few = out.n <= 80;
  let k = r.a;
  while (k < r.b) {
    const col = Math.round(x(tr[k].t) * 2) / 2;
    let cLo = Infinity;
    let cHi = -Infinity;
    let end: number | undefined;
    for (; k < r.b && Math.round(x(tr[k].t) * 2) / 2 === col; k++) {
      const v = tr[k].v;
      if (!Number.isFinite(v)) continue;
      if (v < cLo) cLo = v;
      if (v > cHi) cHi = v;
      end = v;
      if (few) out.dots.push([col, y(v)]);
    }
    if (end === undefined) continue;
    out.d += held === undefined ? `M${col},${y(end).toFixed(1)}` : `H${col}`;
    if (cLo < cHi) out.d += `V${y(cLo).toFixed(1)}V${y(cHi).toFixed(1)}`;
    out.d += `V${y(end).toFixed(1)}`;
    held = end;
  }
  if (out.d) out.d += `H${X1}`;
  return out;
}

const num = (v: number | undefined, digits = 4) => (v === undefined ? "none yet" : Number.isFinite(v) ? v.toPrecision(digits) : "not a number");
/** Peak to peak of a stretch, in words. */
const swing = (s: { lo: number; hi: number; bad: number }) => (s.lo > s.hi ? (s.bad ? "not a number" : "no values") : s.hi - s.lo < 0.0005 ? "0 (steady)" : (s.hi - s.lo).toPrecision(3));

/** Signal test bench: the input samples (TB_IN) and the program's output (TB_OUT) on one time axis. */
function FilterScope({ board, window: [winFrom, to] }: ViewProps) {
  const [span, setSpan] = useState(5);
  const from = span ? Math.max(winFrom, to - span) : winFrom;
  const trIn = board.outputs.get("TB_IN");
  const trOut = board.outputs.get("TB_OUT");
  const rIn = range(trIn, from, to);
  const rOut = range(trOut, from, to);
  let lo = Math.min(rIn.lo, rOut.lo);
  let hi = Math.max(rIn.hi, rOut.hi);
  if (lo > hi) {
    lo = 0;
    hi = 1;
  }
  if (hi - lo < 1e-6) {
    lo -= 0.5;
    hi += 0.5;
  }
  const top = hi;
  const bottom = lo;
  const pad = (hi - lo) * 0.06;
  lo -= pad;
  hi += pad;
  const x = (tNs: number) => X0 + ((tNs / MS - from) / Math.max(1e-9, to - from)) * (X1 - X0);
  const y = (v: number) => Y0 - ((v - lo) / (hi - lo)) * (Y0 - Y1);
  const input = stretch(trIn, rIn, x, y);
  const output = stretch(trOut, rOut, x, y);
  const places = to - from >= 10 ? 1 : 2;
  const noOutput = output.last === undefined;
  const badOutput = output.bad > 0;
  return (
    <div className="filter-scope">
      <div className="fig-controls">
        <div>
          <span>Show last</span>
          {SPANS.map((s) => (
            <button key={s} type="button" className="fig-opt" aria-pressed={span === s} onClick={() => setSpan(s)}>{s ? `${s} ms` : "everything"}</button>
          ))}
        </div>
      </div>
      <svg className="scope" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Filter input and output from ${from.toFixed(2)} to ${to.toFixed(2)} milliseconds. Input peak to peak ${swing(input)}, output peak to peak ${swing(output)}. Latest input ${num(input.last)}, latest output ${num(output.last)}.`}>
        <line x1={X0} x2={X0 + 12} y1={9} y2={9} stroke="var(--lo)" strokeWidth={1.2} />
        <text x={X0 + 16} y={12} style={{ fill: "var(--lo)" }}>input TB_IN {num(input.last, 4)}</text>
        <line x1={W / 2 + 4} x2={W / 2 + 16} y1={9} y2={9} stroke="var(--value)" strokeWidth={2.4} />
        <text x={W / 2 + 20} y={12} style={{ fill: "var(--value)" }}>output TB_OUT {num(output.last, 4)}</text>
        <text x={X0 - 4} y={y(top) + 4} textAnchor="end">{top.toPrecision(3)}</text>
        <text x={X0 - 4} y={y(bottom) + 3} textAnchor="end">{bottom.toPrecision(3)}</text>
        <line x1={X0} x2={X1} y1={y(top)} y2={y(top)} stroke="var(--border)" />
        <line x1={X0} x2={X1} y1={y(bottom)} y2={y(bottom)} stroke="var(--border)" />
        {lo < 0 && hi > 0 && <line x1={X0} x2={X1} y1={y(0)} y2={y(0)} stroke="var(--dim)" strokeDasharray="3 3" strokeWidth={0.8} />}
        <path d={input.d} fill="none" stroke="var(--lo)" strokeWidth={1.1} strokeLinejoin="round" />
        {input.dots.map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r={1.8} fill="var(--lo)" />)}
        <path d={output.d} fill="none" stroke="var(--value)" strokeWidth={2.2} strokeLinejoin="round" />
        <text x={X0} y={H - 4}>{from.toFixed(places)} ms</text>
        <text x={X1} y={H - 4} textAnchor="end">{to.toFixed(places)} ms</text>
      </svg>
      <p className="hint-text">
        {noOutput
          ? "The program has not called tb_output() yet, so there is no output to compare."
          : badOutput
            ? `The output has ${output.bad} value${output.bad === 1 ? "" : "s"} in this stretch that ${output.bad === 1 ? "is" : "are"} not a number (NaN or infinity). Look for a division by zero or a variable that was never given a value.`
            : `Peak to peak in this stretch: input ${swing(input)}, output ${swing(output)}. A filter that works makes the part you do not want smaller and leaves the rest.`}
      </p>
    </div>
  );
}

export const view: BenchView = {
  id: "filter-scope",
  title: "Filter: input and output",
  order: 40,
  relevant: (board) => (board.outputs.get("TB_OUT")?.length ?? 0) > 0,
  Component: FilterScope,
};
