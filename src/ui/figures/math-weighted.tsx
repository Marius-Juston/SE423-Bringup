import { useState } from "react";

// Maths you need before the Kalman filter (Lectures 20-21, HW6): blending
// two uncertain numbers with a weighted average, weighted by how much each
// is trusted. K = p / (p + r); blend = (1 - K) a + K z; the blend's
// variance is (1 - K) p. Not a chip peripheral: no TRM section applies.

const LO = 0;
const HI = 6;
const X0 = 14;
const X1 = 386;
const sx = (v: number) => X0 + ((v - LO) / (HI - LO)) * (X1 - X0);
const fmt = (v: number, d = 2) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);

function MathWeighted() {
  const [p, setP] = useState(0.6);
  const [r, setR] = useState(0.3);
  const [z, setZ] = useState(3.9);
  const a = 3.0; // the prediction

  const K = p / (p + r);
  const blend = a + K * (z - a);
  const pNew = (1 - K) * p;
  const row = (y: number, v: number, variance: number, cls: string, name: string) => {
    const half = Math.sqrt(variance);
    return (
      <g>
        <line x1={sx(Math.max(v - half, LO))} x2={sx(Math.min(v + half, HI))} y1={y} y2={y} className={`mw-bar ${cls}`} />
        <circle cx={sx(v)} cy={y} r={5} className={`mw-dot ${cls}`} />
        <text x={sx(v)} y={y - 9} textAnchor="middle" className="fig-label">{name}: {fmt(v)} ft</text>
      </g>
    );
  };
  const pct = Math.round(K * 100);
  const why =
    Math.abs(p - r) < 0.001
      ? `Both are equally unsure (variance ${fmt(p)}), so each gets half the weight: the blend lies exactly in the middle, at ${fmt(blend)} ft.`
      : p > r
        ? `The measurement is the surer one (variance ${fmt(r)} against ${fmt(p)}), so it gets ${pct} % of the weight: the blend moves ${pct} % of the way from the prediction to the measurement, to ${fmt(blend)} ft. Its own variance, ${fmt(pNew, 3)}, is smaller than either.`
        : `The prediction is the surer one (variance ${fmt(p)} against ${fmt(r)}), so the measurement gets only ${pct} % of the weight: the blend stays close to the prediction, at ${fmt(blend)} ft. Its own variance, ${fmt(pNew, 3)}, is still smaller than either.`;

  return (
    <figure className="figure mw-fig" aria-label="Interactive figure: a weighted average of a prediction and a measurement, weighted by trust">
      <style>{`.mw-fig .mw-range{flex:1;min-width:110px;accent-color:var(--orange)}.mw-fig .mw-axis{stroke:var(--dim);stroke-width:1}.mw-fig .mw-bar{stroke-width:5;stroke-linecap:round;opacity:0.55}.mw-fig .mw-bar.a,.mw-fig .mw-dot.a{stroke:var(--arches);fill:var(--arches)}.mw-fig .mw-bar.z,.mw-fig .mw-dot.z{stroke:var(--orange);fill:var(--orange)}.mw-fig .mw-bar.b,.mw-fig .mw-dot.b{stroke:var(--harvest);fill:var(--harvest)}.mw-fig .mw-link{stroke:var(--dim);stroke-width:1;stroke-dasharray:3 3}.mw-fig .mw-num{font-family:var(--mono);font-size:0.82rem;min-width:4.6rem;text-align:right}`}</style>
      <svg viewBox="0 0 400 196" role="img" aria-label={`Prediction ${fmt(a)} feet with variance ${fmt(p)}. Measurement ${fmt(z)} feet with variance ${fmt(r)}. Weight of the measurement ${fmt(K)}. Blend ${fmt(blend)} feet with variance ${fmt(pNew, 3)}.`}>
        <text x={X0} y={12} className="fig-label dim">the bars show how unsure each number is (wider = less sure)</text>
        {row(42, a, p, "a", "prediction")}
        {row(82, z, r, "z", "measurement")}
        {row(122, blend, pNew, "b", "blend")}
        <line x1={X0} x2={X1} y1={144} y2={144} className="mw-axis" />
        {[0, 1, 2, 3, 4, 5, 6].map((v) => (
          <g key={v}>
            <line x1={sx(v)} x2={sx(v)} y1={144} y2={148} className="mw-axis" />
            <text x={sx(v)} y={158} textAnchor="middle" className="fig-label dim">{v} ft</text>
          </g>
        ))}
        <text x={X0} y={176} className="fig-label">weight of the measurement K = {fmt(p)} / ({fmt(p)} + {fmt(r)}) = <tspan className="fig-value small">{fmt(K)}</tspan></text>
        <text x={X0} y={191} className="fig-label">blend = {fmt(a)} + {fmt(K)} x ({fmt(z)} - {fmt(a)}) = <tspan className="fig-value small">{fmt(blend)} ft</tspan></text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Prediction</span>
          <input className="mw-range" type="range" aria-label="Variance of the prediction" min={0.05} max={1.5} step={0.05} value={p} onChange={(e) => setP(+e.target.value)} />
          <span className="mw-num">var {fmt(p)}</span>
        </div>
        <div>
          <span>Measured</span>
          <input className="mw-range" type="range" aria-label="Variance of the measurement" min={0.05} max={1.5} step={0.05} value={r} onChange={(e) => setR(+e.target.value)} />
          <span className="mw-num">var {fmt(r)}</span>
        </div>
        <div>
          <span>It says</span>
          <input className="mw-range" type="range" aria-label="Measured position in feet" min={1.5} max={4.5} step={0.1} value={z} onChange={(e) => setZ(+e.target.value)} />
          <span className="mw-num">{fmt(z, 1)} ft</span>
        </div>
      </div>
      <div className="fig-step">
        <pre><code>{`K = p / (p + r);        // ${fmt(K)}: weight of z\nx = x + K * (z - x);    // ${fmt(blend)} ft\np = (1.0 - K) * p;      // ${fmt(pNew, 3)}: surer now`}</code></pre>
      </div>
      <figcaption>Two numbers that should be the same and are not. A plain average would trust both equally. A weighted average leans towards the one with the smaller variance. That is the whole update step of a Kalman filter.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "math-weighted",
  title: "Weighted average of two estimates",
  description: "Change how much each of two disagreeing numbers is trusted and see the combined value lean towards the more certain one.",
  Component: MathWeighted,
};
