import type { Kit } from "../../sim/world/kits";
import type { BenchView, ViewProps } from "./types";

type Trace = { t: number; v: number }[];

const MS = 1e6;
const MAX_PLOTS = 6;
const COLORS = ["var(--value)", "var(--info)", "var(--ok)", "var(--accent)", "var(--code-macro)", "var(--text)"];
const DASHES = ["", "", "", "", "6 2", "2 2"];

// Book-keeping values that another view already shows in words (bus counters,
// scan counter) or that only the checks need (peaks).
const HIDDEN = /^(SPI[A-C]_(TX|RX|WORDS)|I2C_[A-Z_]+|CAN_(RX|TX)_FRAMES|CAN_BITRATE|LIDAR_SCANS|TB_V(LEFT|RIGHT)_PEAK)$/;
// Values of the world models around the pins (motors, servos, buzzer,
// encoders): only plotted on a board that has the part, so a serial level
// that happens to toggle the motor pin does not get a wheel-speed plot.
const WORLD = /^((LEFT|RIGHT)_WHEEL_|HANDWHEEL_|SERVO\d|BUZZER_)/;

const meterOf = (kit: Kit, name: string) => {
  for (const p of kit.parts) if (p.kind === "meter" && p.output === name) return p;
  return undefined;
};

/** Names to plot: values with a meter on this kit first, at most MAX_PLOTS. Stops at the first one when `first` is set. */
function plotted(outputs: Map<string, Trace>, kit: Kit, first = false): string[] {
  const withMeter: string[] = [];
  const others: string[] = [];
  for (const [name, tr] of outputs) {
    if (tr.length <= 2 || HIDDEN.test(name)) continue;
    if (meterOf(kit, name)) withMeter.push(name);
    else if (!WORLD.test(name)) others.push(name);
    else continue;
    if (first) break;
  }
  return withMeter.concat(others).slice(0, MAX_PLOTS);
}

/** Index of the first point with t > tNs (traces are in time order). */
function after(tr: Trace, tNs: number): number {
  let lo = 0;
  let hi = tr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tr[mid].t <= tNs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const num = (v: number | undefined, digits: number) => (v === undefined ? "" : Number.isFinite(v) ? v.toPrecision(digits) : "not a number");

const W = 400;
const H = 78;
const X0 = 44;
const X1 = W - 6;
const Y_TOP = 20;
const Y_BOT = H - 16;

/** Plots every numeric value the chip or the world published (DAC volts, wheel speed, ...). */
function AnalogPlot({ board, kit, window: [from, to] }: ViewProps) {
  const shown = plotted(board.outputs, kit);
  if (!shown.length) return <p className="hint-text">Values that change over time will be plotted here.</p>;
  const span = Math.max(1e-9, to - from);
  const x = (tNs: number) => X0 + ((tNs / MS - from) / span) * (X1 - X0);
  return (
    <div className="plots">
      {shown.map((name, i) => {
        const tr = board.outputs.get(name)!;
        // Points inside the window, and the value that was held when the window starts.
        const a = after(tr, from * MS - 1);
        const b = after(tr, to * MS);
        const before = a > 0 ? tr[a - 1].v : undefined;
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
        if (before !== undefined) see(before);
        for (let k = a; k < b; k++) see(tr[k].v);
        const last = b > 0 ? tr[b - 1].v : undefined;
        if (last === undefined) return null;
        if (lo > hi) {
          lo = 0;
          hi = 0;
        }
        const top = hi;
        const bottom = lo;
        if (hi - lo < 1e-9) {
          lo -= 0.5;
          hi += 0.5;
        }
        const y = (v: number) => Y_BOT - ((v - lo) / (hi - lo)) * (Y_BOT - Y_TOP);
        // A step line (a published value holds until the next one). Points
        // that share a pixel column are merged into one vertical stroke
        // from their smallest to their largest value.
        let d = "";
        let held = before !== undefined && Number.isFinite(before) ? before : undefined;
        if (held !== undefined) d = `M${X0},${y(held).toFixed(1)}`;
        let k = a;
        while (k < b) {
          const col = Math.round(x(tr[k].t));
          let cLo = Infinity;
          let cHi = -Infinity;
          let end: number | undefined;
          for (; k < b && Math.round(x(tr[k].t)) === col; k++) {
            const v = tr[k].v;
            if (!Number.isFinite(v)) continue;
            if (v < cLo) cLo = v;
            if (v > cHi) cHi = v;
            end = v;
          }
          if (end === undefined) continue;
          if (held === undefined) d += `M${col},${y(end).toFixed(1)}`;
          else d += `H${col}`;
          if (cLo < cHi) d += `V${y(cLo).toFixed(1)}V${y(cHi).toFixed(1)}`;
          d += `V${y(end).toFixed(1)}`;
          held = end;
        }
        if (d) d += `H${X1}`;
        const meter = meterOf(kit, name);
        const label = meter ? `${meter.label} (${meter.unit})` : name;
        const color = COLORS[i % COLORS.length];
        const places = span >= 10 ? 0 : 2;
        return (
          <svg key={name} className="scope" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: between ${num(bottom, 3)} and ${num(top, 3)} from ${from.toFixed(places)} to ${to.toFixed(places)} milliseconds, now ${num(last, 4)}${bad ? "; some values are not numbers" : ""}`}>
            <text x={6} y={12} style={{ fill: color }}>{label}</text>
            <text x={W - 6} y={12} textAnchor="end" style={{ fill: "var(--text)" }}>{bad && Number.isFinite(last) ? "some values are not numbers · " : ""}now {num(last, 4)}</text>
            <text x={X0 - 4} y={Y_TOP + 6} textAnchor="end">{num(top, 3)}</text>
            {top !== bottom && <text x={X0 - 4} y={Y_BOT} textAnchor="end">{num(bottom, 3)}</text>}
            <line x1={X0} x2={X1} y1={Y_BOT} y2={Y_BOT} stroke="var(--faint)" />
            {lo < 0 && hi > 0 && <line x1={X0} x2={X1} y1={y(0)} y2={y(0)} stroke="var(--dim)" strokeWidth={0.6} strokeDasharray="3 3" />}
            <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeDasharray={DASHES[i % DASHES.length] || undefined} />
            <text x={X0} y={H - 4}>{from.toFixed(places)} ms</text>
            <text x={X1} y={H - 4} textAnchor="end">{to.toFixed(places)} ms</text>
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
  relevant: (board, kit) => plotted(board.outputs, kit, true).length > 0,
  Component: AnalogPlot,
};
