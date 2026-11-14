// Moving average and FIR filter (course Lectures 8-9, Lab 4, HW3; plain
// arithmetic on samples, so there is no TRM section):
//   y[n] = b[0] x[n] + b[1] x[n-1] + ... + b[M] x[n-M]
// An order M filter has M + 1 coefficients. The moving average is the case
// where every coefficient is 1 / (M + 1). A symmetric filter delays the
// signal by M / 2 samples.
import { useRef, useState, type PointerEvent } from "react";

const N = 60;
const EDGE_UP = 16;
const EDGE_DOWN = 42;
const CSS = `
.mavg input[type=range] { flex: 1 1 8rem; min-width: 6rem; padding: 0; accent-color: var(--orange); }
.mavg .mavg-num { font-family: var(--mono); color: var(--harvest); min-width: 2.2em; text-align: right; }
.mavg .mavg-drag { cursor: ew-resize; touch-action: none; }
`;

/** Deterministic noise in [-1, 1). */
function noise(n: number): number {
  let z = (Math.imul(n + 11, 0x9e3779b1) + 0x6d2b79f5) | 0;
  z = Math.imul(z ^ (z >>> 15), z | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
  return (((z ^ (z >>> 14)) >>> 0) / 4294967296) * 2 - 1;
}
const clean = (n: number) => (n >= EDGE_UP && n < EDGE_DOWN ? 2.2 : 0.8);
const X = Array.from({ length: N }, (_, n) => clean(n) + 0.38 * noise(n));

function coefficients(points: number, tapered: boolean): number[] {
  const raw = Array.from({ length: points }, (_, k) => (tapered ? Math.sin((Math.PI * (k + 1)) / (points + 1)) ** 2 : 1));
  const sum = raw.reduce((a, v) => a + v, 0);
  return raw.map((v) => v / sum);
}

function MovingAverage() {
  const [points, setPoints] = useState(5);
  const [pos, setPos] = useState(24);
  const [tapered, setTapered] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const n = Math.max(points - 1, pos);
  const b = coefficients(points, tapered);
  const yAt = (m: number) => b.reduce((acc, bk, k) => acc + bk * X[m - k], 0);
  const yn = yAt(n);
  const delay = (points - 1) / 2;

  // ---- signal plot ----
  const X0 = 30;
  const X1 = 412;
  const dx = (X1 - X0) / N;
  const x = (m: number) => X0 + (m + 0.5) * dx;
  const Y0 = 128;
  const Y1 = 22;
  const y = (v: number) => Y0 - (v / 3) * (Y0 - Y1);
  let raw = "";
  for (let m = 0; m < N; m++) raw += `${m ? "L" : "M"}${x(m).toFixed(1)},${y(X[m]).toFixed(1)}`;
  let out = "";
  for (let m = points - 1; m < N; m++) out += `${m === points - 1 ? "M" : "L"}${x(m).toFixed(1)},${y(yAt(m)).toFixed(1)}`;
  const ideal = `M${X0},${y(0.8)} H${x(EDGE_UP) - dx / 2} V${y(2.2)} H${x(EDGE_DOWN) - dx / 2} V${y(0.8)} H${X1}`;
  const wx0 = x(n - points + 1) - dx / 2;
  const wx1 = x(n) + dx / 2;
  const drag = (e: PointerEvent) => {
    if (e.type === "pointermove" && !(e.buttons & 1)) return;
    // Keep the drag when the pointer leaves the drawing.
    if (e.type === "pointerdown") (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const box = svg.current!.getBoundingClientRect();
    const sx = ((e.clientX - box.left) / box.width) * 420;
    setPos(Math.max(0, Math.min(N - 1, Math.round((sx - X0) / dx - 0.5 + (points - 1) / 2))));
  };

  // ---- FIR view ----
  const BX0 = 62;
  const cw = Math.min(40, 290 / points);
  const bmax = Math.max(...b);
  const fmtB = (v: number) => (Number.isInteger(1 / v) && !tapered ? `1/${Math.round(1 / v)}` : v.toFixed(3));

  const why =
    points === 1
      ? "With one point the output is the input: nothing is averaged and nothing comes late. Add points to smooth the noise."
      : `y[${n}] = ${yn.toFixed(2)} is ${tapered ? "a weighted sum" : "the mean"} of the ${points} newest samples, x[${n - points + 1}] to x[${n}]: each one is multiplied by ${tapered ? (points <= 2 ? "its weight; with only 2 points both weights are the same, 1/2" : "its weight, and the weights favour the middle of the window") : `the same weight, 1/${points}`}. More points give a smoother line, but the output answers later: it follows the signal ${delay} sample${delay === 1 ? "" : "s"} late (half the window; ${(delay * 0.1).toFixed(2)} ms when sampling every 0.1 ms), and each jump is spread over ${points} samples.`;

  return (
    <figure className="figure mavg" aria-label="Interactive moving average: a noisy signal and its average over a sliding window">
      <style>{CSS}</style>
      <svg ref={svg} viewBox="0 0 420 146" role="img" className="mavg-drag" onPointerDown={drag} onPointerMove={drag} aria-label={`Noisy step signal and its ${points}-point ${tapered ? "weighted" : "moving"} average. Window ends at sample ${n}; output ${yn.toFixed(2)}. The output follows ${delay} sample${delay === 1 ? "" : "s"} late.`}>
        <text x={X0} y="12" className="fig-label" style={{ fill: "var(--arches)" }}>thin: noisy samples x[n]</text>
        <text x={X1} y="12" textAnchor="end" className="fig-label" style={{ fill: "var(--harvest)" }}>thick: filtered output y[n]</text>
        <line x1={X0} x2={X1} y1={Y0} y2={Y0} className="fig-wire" />
        <path d={ideal} className="fig-trace dim" strokeDasharray="3 3" style={{ strokeWidth: 1 }} />
        {/* window */}
        <rect x={wx0} y={Y1 - 4} width={wx1 - wx0} height={Y0 - Y1 + 4} fill="var(--orange)" fillOpacity="0.16" stroke="var(--orange)" strokeWidth="1" />
        <path d={raw} className="fig-trace" style={{ strokeWidth: 0.9, opacity: 0.8 }} />
        {X.map((v, m) => {
          const inside = m > n - points && m <= n;
          return <circle key={m} cx={x(m)} cy={y(v)} r={inside ? 2.6 : 1.5} fill={inside ? "var(--orange)" : "var(--arches)"} />;
        })}
        <path d={out} className="fig-trace data" style={{ strokeWidth: 2.2 }} />
        <circle cx={x(n)} cy={y(yn)} r="4" fill="var(--harvest)" stroke="var(--text)" strokeWidth="0.9" />
        <text x={Math.max(X0 + 16, Math.min(X1 - 16, (wx0 + wx1) / 2))} y={Y0 + 12} textAnchor="middle" className="fig-label" style={{ fill: "var(--orange)" }}>window</text>
        {/* delay */}
        {delay > 0 && (
          <>
            <line x1={x(EDGE_UP) - dx / 2} x2={x(EDGE_UP) - dx / 2 + delay * dx} y1={y(1.5)} y2={y(1.5)} stroke="var(--text)" strokeWidth="2" />
            <line x1={x(EDGE_UP) - dx / 2 + delay * dx} x2={x(EDGE_UP) - dx / 2 + delay * dx} y1={y(1.5) - 4} y2={y(1.5) + 4} stroke="var(--text)" strokeWidth="1.2" />
            <text x={x(EDGE_UP) - dx / 2 - 4} y={y(1.5) - 2} textAnchor="end" className="fig-label">{delay} late</text>
          </>
        )}
        {(wx0 + wx1) / 2 > X0 + 62 && <text x={X0} y={Y0 + 12} className="fig-label dim">n = 0</text>}
        {(wx0 + wx1) / 2 < X1 - 46 && <text x={X1} y={Y0 + 12} textAnchor="end" className="fig-label dim">n = {N - 1}</text>}
      </svg>
      <svg viewBox="0 0 420 122" role="img" aria-label={`The ${points} sample${points === 1 ? "" : "s"} in the window times the weights ${b.map((v) => v.toFixed(3)).join(", ")} add up to ${yn.toFixed(2)}.`}>
        <text x="4" y="24" className="fig-label">samples</text>
        <text x="4" y="35" className="fig-value small" style={{ fill: "var(--orange)" }}>xk[i]</text>
        <text x="4" y="62" className="fig-label dim">times</text>
        <text x="4" y="84" className="fig-label">weights</text>
        <text x="4" y="95" className="fig-value small">b[i]</text>
        {b.map((bk, k) => {
          const cx = BX0 + k * cw + cw / 2;
          const v = X[n - k];
          const h = (v / 3) * 34;
          const hb = (bk / bmax) * 22;
          return (
            <g key={k}>
              <rect x={cx - cw * 0.3} y={40 - h} width={cw * 0.6} height={h} fill="var(--orange)" />
              <text x={cx} y="51" textAnchor="middle" className="fig-label">{v.toFixed(2)}</text>
              <text x={cx} y="62" textAnchor="middle" className="fig-label dim">×</text>
              <rect x={cx - cw * 0.3} y={90 - hb} width={cw * 0.6} height={hb} fill="var(--harvest)" />
              <text x={cx} y="101" textAnchor="middle" className="fig-label">{fmtB(bk)}</text>
              <text x={cx} y="116" textAnchor="middle" className="fig-label dim">{k === 0 ? "i=0" : k}</text>
            </g>
          );
        })}
        <text x={BX0 + 2} y="12" className="fig-label dim">newest</text>
        {points > 2 && <text x={BX0 + points * cw - 2} y="12" textAnchor="end" className="fig-label dim">oldest</text>}
        <text x={BX0 + points * cw + 8} y="56" className="fig-label dim">added up:</text>
        <text x={BX0 + points * cw + 8} y="72" className="fig-value">y = {yn.toFixed(2)}</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Window at</span>
          <input type="range" min={points - 1} max={N - 1} value={n} aria-label="Newest sample in the window, n" onChange={(e) => setPos(+e.target.value)} />
          <span className="mavg-num">{n}</span>
          <code>y[{n}] = {yn.toFixed(2)}</code>
        </div>
        <div>
          <span>Points</span>
          <input type="range" min={1} max={9} value={points} aria-label="Number of points" onChange={(e) => setPoints(+e.target.value)} />
          <span className="mavg-num">{points}</span>
          <code>{points} sample{points === 1 ? "" : "s"}, {points} weight{points === 1 ? "" : "s"}</code>
        </div>
        <div>
          <span>Weights</span>
          <button className="fig-opt" aria-pressed={!tapered} onClick={() => setTapered(false)}>all equal (moving average)</button>
          <button className="fig-opt" aria-pressed={tapered} onClick={() => setTapered(true)}>your own (a low-pass)</button>
        </div>
        <div>
          <span>In code</span>
          <code>{tapered ? `for (i = 0; i < ${points}; i++) { yk = yk + b[i] * xk[i]; }` : points === 1 ? "yk = xk[0];" : `yk = (xk[0] + ${points > 2 ? "... + " : ""}xk[${points - 1}]) / ${points};`}</code>
        </div>
      </div>
      <figcaption>Top: a noisy step, and the filter output. The dashed line is the signal without noise. Drag the orange window or use the first slider. Bottom: what happens for the one output sample marked above. Each sample in the window is multiplied by its weight and the products are added. With equal weights that is the moving average; other weights give other filters with the same code.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "moving-average",
  title: "Moving average of a noisy signal",
  description: "Slide a window along a noisy signal and change how many samples it averages, and see the line get smoother and answer later.",
  Component: MovingAverage,
};
