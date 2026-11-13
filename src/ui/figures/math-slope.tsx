import { useState } from "react";

// Maths you need for the D term (Lecture 11): a rate of change is
// "how much it changed, divided by how long that took", computed from two
// samples. Dividing by a small time step magnifies measurement noise,
// which is why the robot's speed loops are PI. No TRM section applies.

const N = 11; // samples shown
const X0 = 44;
const X1 = 392;
const fmt = (v: number, d = 2) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);
// fixed "noise" pattern between -1 and 1, so the figure never changes by itself
const JITTER = [0.3, -0.8, 0.6, -0.2, 0.9, -1.0, 0.4, 0.7, -0.6, 0.1, -0.4];
const TRUE_SLOPE = 1; // ft/s gained per second

function MathSlope() {
  const [dtMs, setDtMs] = useState(10);
  const [noise, setNoise] = useState(0);
  const [k, setK] = useState(5);

  const dt = dtMs / 1000;
  const val = (i: number) => 0.5 + TRUE_SLOPE * i * dt + noise * JITTER[i];
  const slope = (i: number) => (val(i) - val(i - 1)) / dt;
  const sx = (i: number) => X0 + (i / (N - 1)) * (X1 - X0);
  // top: the signal, scaled to what is on screen
  const lo = 0.5 - noise - 0.002;
  const hi = 0.5 + TRUE_SLOPE * (N - 1) * dt + noise + 0.002;
  const vy = (v: number) => 92 - ((v - lo) / (hi - lo)) * 70;
  const slopes = Array.from({ length: N - 1 }, (_, i) => slope(i + 1));
  const top = Math.max(2, ...slopes.map((s) => Math.abs(s))) * 1.1;
  const dy = (s: number) => 168 - (s / top) * 40;
  const change = val(k) - val(k - 1);
  const worst = Math.max(...slopes.map((s) => Math.abs(s - TRUE_SLOPE)));
  const why =
    noise === 0
      ? `Between sample ${k - 1} and sample ${k} the speed rose by ${fmt(change, 4)} ft/s in ${dt} s. Rate of change = ${fmt(change, 4)} / ${dt} = ${fmt(slope(k))} ft/s per second. Without noise every pair of samples gives the same slope. Now add measurement noise.`
      : `Each sample is now off by up to ${noise} ft/s. Between sample ${k - 1} and ${k} the reading changed by ${fmt(change, 4)} ft/s in ${dt} s: a computed slope of ${fmt(slope(k), 1)}, although the true slope is still 1. The division by ${dt} turns tiny errors into slopes that are up to ${fmt(worst, 0)} off.${dtMs === 1 ? " A shorter time step makes it worse." : ""}`;

  return (
    <figure className="figure mk-fig" aria-label="Interactive figure: a rate of change computed from two samples, and what noise does to it">
      <style>{`.mk-fig .mk-range{flex:1;min-width:110px;accent-color:var(--orange)}.mk-fig .mk-axis{stroke:var(--dim);stroke-width:1}.mk-fig .mk-sig{fill:none;stroke:var(--arches);stroke-width:1.6}.mk-fig .mk-pair{stroke:var(--orange);stroke-width:3}.mk-fig .mk-bar{fill:var(--accent-soft);stroke:var(--orange);stroke-width:1}.mk-fig .mk-bar.sel{fill:var(--orange)}.mk-fig .mk-true{stroke:var(--text);stroke-width:1.2;stroke-dasharray:4 3}.mk-fig .mk-num{font-family:var(--mono);font-size:0.82rem;min-width:4.6rem;text-align:right}`}</style>
      <svg viewBox="0 0 400 222" role="img" aria-label={`Samples every ${dtMs} milliseconds with noise of ${noise} feet per second. The slope computed between samples ${k - 1} and ${k} is ${fmt(slope(k), 1)}; the true slope is 1.`}>
        <text x={X0} y={11} className="fig-label">measured speed, one dot per sample (every {dtMs} ms)</text>
        <path d={Array.from({ length: N }, (_, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${vy(val(i)).toFixed(1)}`).join("")} className="mk-sig" />
        <line x1={sx(k - 1)} y1={vy(val(k - 1))} x2={sx(k)} y2={vy(val(k))} className="mk-pair" />
        {Array.from({ length: N }, (_, i) => (
          <circle key={i} cx={sx(i)} cy={vy(val(i))} r={i === k || i === k - 1 ? 4 : 2.6} style={{ fill: i === k || i === k - 1 ? "var(--orange)" : "var(--arches)" }} />
        ))}
        <text x={X0} y={116} className="fig-label">slope = (this sample - previous sample) / time step = <tspan className="fig-value small">{fmt(slope(k), 1)}</tspan></text>
        <line x1={X0} x2={X1} y1={dy(0)} y2={dy(0)} className="mk-axis" />
        <line x1={X0} x2={X1} y1={dy(TRUE_SLOPE)} y2={dy(TRUE_SLOPE)} className="mk-true" />
        <text x={X0 - 4} y={dy(0) + 3} textAnchor="end" className="fig-label dim">0</text>
        <text x={X0 - 4} y={dy(top / 1.1) + 3} textAnchor="end" className="fig-label dim">{fmt(top / 1.1, 0)}</text>
        <text x={X0 - 4} y={dy(-top / 1.1) + 3} textAnchor="end" className="fig-label dim">-{fmt(top / 1.1, 0)}</text>
        {slopes.map((s, i) => (
          <rect key={i} x={sx(i) + 6} width={sx(1) - X0 - 12} y={Math.min(dy(s), dy(0))} height={Math.max(Math.abs(dy(s) - dy(0)), 1)} className={`mk-bar ${i + 1 === k ? "sel" : ""}`} />
        ))}
        <text x={X1} y={218} textAnchor="end" className="fig-label dim">dashed: the true slope, 1 ft/s per second</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Noise</span>
          {[0, 0.001, 0.01].map((v) => (
            <button key={v} className="fig-opt" aria-pressed={noise === v} onClick={() => setNoise(v)}>{v === 0 ? "none" : `${v} ft/s`}</button>
          ))}
        </div>
        <div>
          <span>Time step</span>
          {[10, 1].map((v) => (
            <button key={v} className="fig-opt" aria-pressed={dtMs === v} onClick={() => setDtMs(v)}>{v} ms</button>
          ))}
        </div>
        <div>
          <span>Look at</span>
          <input className="mk-range" type="range" aria-label="Which pair of samples to look at" min={1} max={N - 1} step={1} value={k} onChange={(e) => setK(+e.target.value)} />
          <span className="mk-num">sample {k}</span>
        </div>
      </div>
      <div className="fig-step">
        <pre><code>{`// DT = ${dt} s\nslope = (e - e_old) / DT;   // ${fmt(slope(k), 1)}\ne_old = e;`}</code></pre>
      </div>
      <figcaption>A rate of change (a derivative) is a difference divided by a time. The speed here really rises by 1 ft/s every second. The bars are the slope the code computes from each pair of neighbouring samples.</figcaption>
    </figure>
  );
}

export const figure = { id: "math-slope", Component: MathSlope };
