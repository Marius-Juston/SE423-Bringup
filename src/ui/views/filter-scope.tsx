import { useState } from "react";
import type { BenchView, ViewProps } from "./types";

const MS = 1e6;
const SPANS = [5, 20, 100, 0]; // ms; 0 = the whole window

type Point = { t: number; v: number };

/** Points of a trace inside [from, to] ms, thinned to at most ~700. */
function slice(tr: Point[] | undefined, from: number, to: number): Point[] {
  if (!tr) return [];
  // Traces are in time order: binary search for the first point at or after `from`.
  let lo = 0;
  let hi = tr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tr[mid].t / MS < from) lo = mid + 1;
    else hi = mid;
  }
  const out: Point[] = [];
  let end = lo;
  while (end < tr.length && tr[end].t / MS <= to) end++;
  const stride = Math.max(1, Math.ceil((end - lo) / 700));
  for (let i = lo; i < end; i += stride) out.push(tr[i]);
  return out;
}

/** Signal test bench: the input samples (TB_IN) and the program's output (TB_OUT) on one time axis. */
function FilterScope({ board, window: [winFrom, to] }: ViewProps) {
  const [span, setSpan] = useState(5);
  const from = span ? Math.max(winFrom, to - span) : winFrom;
  const input = slice(board.outputs.get("TB_IN"), from, to);
  const output = slice(board.outputs.get("TB_OUT"), from, to);
  const W = 400;
  const H = 150;
  const X0 = 40;
  const X1 = W - 6;
  const Y0 = H - 18;
  const Y1 = 20;
  const all = [...input, ...output].map((p) => p.v);
  let lo = all.length ? Math.min(...all) : 0;
  let hi = all.length ? Math.max(...all) : 1;
  if (hi - lo < 1e-6) {
    lo -= 0.5;
    hi += 0.5;
  }
  const pad = (hi - lo) * 0.06;
  lo -= pad;
  hi += pad;
  const x = (tMs: number) => X0 + ((tMs - from) / Math.max(1e-9, to - from)) * (X1 - X0);
  const y = (v: number) => Y0 - ((v - lo) / (hi - lo)) * (Y0 - Y1);
  const path = (pts: Point[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.t / MS).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const dots = input.length <= 80;
  const lastIn = input[input.length - 1]?.v;
  const lastOut = output[output.length - 1]?.v;
  const swing = (pts: Point[]) => (pts.length ? Math.max(...pts.map((p) => p.v)) - Math.min(...pts.map((p) => p.v)) : 0);
  const fmt = (v: number) => (v < 0.0005 ? "0" : v.toPrecision(3));
  return (
    <div className="filter-scope">
      <div className="fig-controls">
        <div>
          <span>Show last</span>
          {SPANS.map((s) => (
            <button key={s} className="fig-opt" aria-pressed={span === s} onClick={() => setSpan(s)}>{s ? `${s} ms` : "everything"}</button>
          ))}
        </div>
      </div>
      <svg className="scope" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Filter input and output from ${from.toFixed(2)} to ${to.toFixed(2)} milliseconds. Input swings over ${fmt(swing(input))}, output over ${fmt(swing(output))}. Latest input ${lastIn?.toPrecision(4) ?? "none"}, latest output ${lastOut?.toPrecision(4) ?? "none"}.`}>
        <line x1={X0 - 16} x2={X0 - 4} y1={9} y2={9} stroke="var(--arches)" strokeWidth={1.2} />
        <text x={X0} y={12} style={{ fill: "var(--arches)" }}>input TB_IN (thin){lastIn !== undefined ? ` ${lastIn.toFixed(3)}` : ""}</text>
        <line x1={W / 2 + 4} x2={W / 2 + 16} y1={9} y2={9} stroke="var(--harvest)" strokeWidth={2.4} />
        <text x={W / 2 + 20} y={12} style={{ fill: "var(--harvest)" }}>your output TB_OUT{lastOut !== undefined ? ` ${lastOut.toFixed(3)}` : ""}</text>
        <text x={X0 - 4} y={y(hi - pad) + 4} textAnchor="end">{(hi - pad).toPrecision(3)}</text>
        <text x={X0 - 4} y={y(lo + pad) + 3} textAnchor="end">{(lo + pad).toPrecision(3)}</text>
        <line x1={X0} x2={X1} y1={y(hi - pad)} y2={y(hi - pad)} stroke="var(--border)" />
        <line x1={X0} x2={X1} y1={y(lo + pad)} y2={y(lo + pad)} stroke="var(--border)" />
        {lo < 0 && hi > 0 && <line x1={X0} x2={X1} y1={y(0)} y2={y(0)} stroke="var(--dim)" strokeDasharray="3 3" strokeWidth={0.8} />}
        <path d={path(input)} fill="none" stroke="var(--arches)" strokeWidth={1.1} />
        {dots && input.map((p, i) => <circle key={i} cx={x(p.t / MS)} cy={y(p.v)} r={1.8} fill="var(--arches)" />)}
        <path d={path(output)} fill="none" stroke="var(--harvest)" strokeWidth={2.2} strokeLinejoin="round" />
        <text x={X0} y={H - 4}>{from.toFixed(to - from >= 10 ? 1 : 2)} ms</text>
        <text x={X1} y={H - 4} textAnchor="end">{to.toFixed(to - from >= 10 ? 1 : 2)} ms</text>
      </svg>
      <p className="hint-text">
        Peak to peak in this stretch: input {fmt(swing(input))}, output {fmt(swing(output))}. A filter that works makes the part you do not want smaller and leaves the rest.
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
