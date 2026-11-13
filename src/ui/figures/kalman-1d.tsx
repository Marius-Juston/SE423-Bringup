import { useState } from "react";

// The one-number Kalman filter of Lectures 20-21 and HW6, drawn as bell
// curves: predict (the belief moves and widens), update (belief times
// measurement, renormalised). Not a chip peripheral: no TRM section applies.
// The equations are those of the levels loc-kf-calc and loc-kf-code.

const U = 1; // the robot moves 1 ft per round
const Q = 0.2; // variance one move adds
const X0 = 8;
const X1 = 412;
const BASE = 160;
const SPAN = 7; // ft shown
const fmt = (v: number, d = 2) => v.toFixed(d);

const STEPS = [
  {
    title: "1. A belief",
    text: "The robot cannot know exactly where it is. It keeps a best guess (the mean, the peak of the curve) and how unsure the guess is (the variance: a wide, low curve means unsure). Change the variance and watch the curve.",
  },
  {
    title: "2. Predict: the robot moves",
    text: "The wheels say: moved 1 ft. The whole belief slides 1 ft. The wheels are not perfect, so the curve also gets wider: moving always makes the robot less sure.",
  },
  {
    title: "3. A measurement arrives",
    text: "A sensor reports a position. It is a belief too: a best value z and a variance r that says how good the sensor is. Now there are two beliefs that disagree.",
  },
  {
    title: "4. Update: combine them",
    text: "Multiply the two curves: only places that both find likely stay likely. The result is again a bell curve. Its peak lies between the two, closer to the narrower one, and it is narrower than both. Next starts another round from this result.",
  },
];

function Kalman1d() {
  const [prior, setPrior] = useState({ m: 1, p: 0.4 });
  const [step, setStep] = useState(0);
  const [r, setR] = useState(0.3);
  const [off, setOff] = useState(1); // z minus the predicted mean
  const [round, setRound] = useState(1);

  const pred = { m: prior.m + U, p: prior.p + Q };
  const z = pred.m + off;
  const K = pred.p / (pred.p + r);
  const post = { m: pred.m + K * (z - pred.m), p: (1 - K) * pred.p };
  const centre = Math.round(pred.m);
  const lo = centre - SPAN / 2;
  const sx = (x: number) => X0 + ((x - lo) / SPAN) * (X1 - X0);
  const sy = (pdf: number) => BASE - Math.min(pdf, 1.5) * 80;
  const bell = (m: number, p: number) => {
    let d = "";
    for (let i = 0; i <= 160; i++) {
      const x = lo + (i / 160) * SPAN;
      const pdf = Math.exp(-((x - m) ** 2) / (2 * p)) / Math.sqrt(2 * Math.PI * p);
      d += `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(pdf).toFixed(1)}`;
    }
    return d;
  };
  const peak = (m: number, p: number) => sy(1 / Math.sqrt(2 * Math.PI * p));
  const shown = step === 0 ? prior : pred;
  // Labels sit in fixed rows above the curves, each over its own peak, with a leader down to it.
  const label = (m: number, p: number, text: string, cls: string, row: number) => {
    const half = text.length * 2.2 + 4;
    const x = Math.max(X0 + half, Math.min(X1 - half, sx(m)));
    const y = 10 + row * 11;
    return (
      <g>
        <path d={`M${x},${y + 3} L${sx(m)},${Math.max(y + 3, peak(m, p) - 2)}`} className={`kf-lead ${cls}`} />
        <text x={x} y={y} textAnchor="middle" className={`fig-label kf-halo ${cls}`}>{text}</text>
      </g>
    );
  };
  const trust = K > 0.75 ? "the sensor is much better than the prediction, so the estimate goes almost all the way to the measurement" : K < 0.25 ? "the prediction is much better than the sensor, so the estimate hardly moves" : K > 0.45 && K < 0.55 ? "both are about equally good, so the estimate lands about halfway" : K >= 0.55 ? "the sensor is the better of the two, so the estimate lands closer to the measurement" : "the prediction is the better of the two, so the estimate stays closer to it";

  const reset = () => {
    setPrior({ m: 1, p: 0.4 });
    setStep(0);
    setR(0.3);
    setOff(1);
    setRound(1);
  };
  const next = () => {
    if (step < 3) setStep(step + 1);
    else {
      // Next round: the updated belief is the new starting point.
      setPrior({ m: post.m, p: post.p });
      setOff(-off * 0.7);
      setRound(round + 1);
      setStep(1);
    }
  };

  return (
    <figure className="figure kf-fig" aria-label="Step-through drawing of a one-dimensional Kalman filter">
      <style>{`.kf-fig .kf-range{flex:1;min-width:110px;accent-color:var(--orange)}.kf-fig .kf-bel{fill:none;stroke:var(--arches);stroke-width:2.2}.kf-fig .kf-old{fill:none;stroke:var(--dim);stroke-width:1.3;stroke-dasharray:3 3}.kf-fig .kf-z{fill:none;stroke:var(--orange);stroke-width:2.2}.kf-fig .kf-post{fill:var(--harvest);fill-opacity:.25;stroke:var(--harvest);stroke-width:2.4}.kf-fig .kf-tb{fill:var(--arches)}.kf-fig .kf-tz{fill:var(--orange)}.kf-fig .kf-tp{fill:var(--harvest)}.kf-fig .kf-num{width:3rem;font-family:var(--mono);font-size:.8rem;color:var(--harvest)}.kf-fig .kf-bar{stroke:var(--text);stroke-width:3}.kf-fig .kf-halo{paint-order:stroke;stroke:var(--inset);stroke-width:3px;stroke-linejoin:round}.kf-fig .kf-lead{fill:none;stroke-width:1;stroke-dasharray:1.5 2.5}.kf-fig .kf-lead.kf-tb{stroke:var(--arches)}.kf-fig .kf-lead.kf-tz{stroke:var(--orange)}.kf-fig .kf-lead.kf-tp{stroke:var(--harvest)}.kf-fig .fig-controls>div>span:first-child{width:8.4rem}.kf-fig .kf-next{color:var(--dim);font-size:.82rem}`}</style>
      <svg viewBox="0 0 420 206" role="img" aria-label={step === 0 ? `Belief: mean ${fmt(prior.m)} feet, variance ${fmt(prior.p)}.` : step < 3 ? `Predicted belief: mean ${fmt(pred.m)}, variance ${fmt(pred.p)}.${step === 2 ? ` Measurement ${fmt(z)}, variance ${fmt(r)}.` : ""}` : `Prediction ${fmt(pred.m)} with variance ${fmt(pred.p)}, measurement ${fmt(z)} with variance ${fmt(r)}, gain ${fmt(K)}, updated mean ${fmt(post.m)}, variance ${fmt(post.p)}.`}>
        <defs>
          <marker id="kf-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" className="fig-arrowhead" />
          </marker>
        </defs>
        {/* axis */}
        <line x1={X0} x2={X1} y1={BASE} y2={BASE} className="fig-wire" />
        {Array.from({ length: SPAN }, (_, i) => {
          const x = Math.ceil(lo) + i;
          return (
            <g key={x}>
              <line x1={sx(x)} x2={sx(x)} y1={BASE} y2={BASE + 4} className="fig-wire" />
              <text x={sx(x)} y={BASE + 14} textAnchor="middle" className="fig-label dim">{x} ft</text>
            </g>
          );
        })}
        {step >= 1 && step < 3 && <path d={bell(prior.m, prior.p)} className="kf-old" />}
        {step === 1 && (
          <g>
            <path d={`M${sx(prior.m)},${BASE + 26} H${sx(pred.m) - 1}`} className="fig-wire" markerEnd="url(#kf-arrow)" />
            <line x1={sx(prior.m)} x2={sx(prior.m)} y1={BASE + 21} y2={BASE + 31} className="fig-wire" />
            <text x={sx(pred.m) + 8} y={BASE + 29} className="fig-label">the robot moved {U} ft</text>
            <text x={sx(prior.m)} y={Math.max(10, peak(prior.m, prior.p) - 5)} textAnchor="end" className="fig-label dim kf-halo">before</text>
          </g>
        )}
        {step === 3 && <path d={bell(post.m, post.p)} className="kf-post" />}
        <path d={bell(shown.m, shown.p)} className="kf-bel" />
        {step >= 2 && <path d={bell(z, r)} className="kf-z" />}
        {label(shown.m, shown.p, step === 0 ? `belief: mean ${fmt(prior.m)}, variance ${fmt(prior.p)}` : `prediction: ${fmt(pred.m)}, variance ${fmt(pred.p)}`, "kf-tb", 2)}
        {step >= 2 && label(z, r, `measurement: z = ${fmt(z)}, variance r = ${fmt(r)}`, "kf-tz", 1)}
        {step === 3 && label(post.m, post.p, `updated: ${fmt(post.m)}, variance ${fmt(post.p)}`, "kf-tp", 0)}
        {step === 3 && (
          <g>
            {/* how far the estimate moves: K of the way from the prediction to the measurement */}
            <line x1={sx(pred.m)} x2={sx(z)} y1={186} y2={186} className="fig-wire" />
            <line x1={sx(pred.m)} x2={sx(post.m)} y1={186} y2={186} className="kf-bar" />
            <line x1={sx(pred.m)} x2={sx(pred.m)} y1={181} y2={191} className="kf-bel" />
            <line x1={sx(z)} x2={sx(z)} y1={181} y2={191} className="kf-z" />
            <circle cx={sx(post.m)} cy={186} r={4} className="kf-tp" />
            <line x1={sx(post.m)} x2={sx(post.m)} y1={BASE} y2={182} className="fig-sample" />
            <text x={Math.max(X0 + 70, Math.min(X1 - 70, sx((pred.m + z) / 2)))} y={203} textAnchor="middle" className="fig-label">K = <tspan className="fig-value small">{fmt(K)}</tspan>: the estimate moves {Math.round(K * 100)} % of the way</text>
          </g>
        )}
      </svg>
      <div className="fig-step" role="status">
        <strong>{STEPS[step].title}{round > 1 ? ` (round ${round})` : ""}</strong>
        <p>{STEPS[step].text}{step === 3 ? ` Here K = ${fmt(K)}: ${trust}.` : ""}</p>
        <pre><code>{step === 0
          ? `kf_x = ${fmt(prior.m)};   // mean, ft\nkf_p = ${fmt(prior.p)};   // variance`
          : step === 1
            ? `kf_x = kf_x + u;   // ${fmt(prior.m)} + ${fmt(U, 1)} = ${fmt(pred.m)}\nkf_p = kf_p + q;   // ${fmt(prior.p)} + ${fmt(Q, 1)} = ${fmt(pred.p)}`
            : step === 2
              ? `z = ${fmt(z)};   // what the sensor says\nr = ${fmt(r)};   // its variance`
              : `kf_k = kf_p / (kf_p + r);\n  //  = ${fmt(pred.p)} / (${fmt(pred.p)} + ${fmt(r)}) = ${fmt(K)}\nkf_x = kf_x + kf_k * (z - kf_x);\n  //  = ${fmt(pred.m)} + ${fmt(K)} * ${z - pred.m < 0 ? `(${fmt(z - pred.m)})` : fmt(z - pred.m)} = ${fmt(post.m)}\nkf_p = (1.0 - kf_k) * kf_p;\n  //  = ${fmt(1 - K)} * ${fmt(pred.p)} = ${fmt(post.p)}`}</code></pre>
      </div>
      <div className="fig-controls">
        <div>
          <span>{step === 0 ? "Belief variance" : "Predicted variance"}</span>
          <input className="kf-range" type="range" aria-label={step === 0 ? "Variance of the belief" : "Variance of the prediction"} min={step === 0 ? 0.1 : 0.05 + Q} max={step === 0 ? 1.5 : 1.5 + Q} step={0.05} value={step === 0 ? prior.p : pred.p} onChange={(e) => setPrior({ ...prior, p: Math.round((+e.target.value - (step === 0 ? 0 : Q)) * 100) / 100 })} />
          <span className="kf-num">{fmt(step === 0 ? prior.p : pred.p)}</span>
        </div>
        {step >= 2 && (
          <div>
            <span>Sensor variance r</span>
            <input className="kf-range" type="range" aria-label="Variance of the measurement" min={0.1} max={1.5} step={0.05} value={r} onChange={(e) => setR(+e.target.value)} />
            <span className="kf-num">{fmt(r)}</span>
          </div>
        )}
        {step >= 2 && (
          <div>
            <span>Measurement z</span>
            <input className="kf-range" type="range" aria-label="Measured position" min={-2} max={2} step={0.1} value={off} onChange={(e) => setOff(+e.target.value)} />
            <span className="kf-num">{fmt(z)}</span>
          </div>
        )}
      </div>
      <div className="fig-controls row">
        <button className="btn small" onClick={() => setStep(step - 1)} disabled={step === 0 || (step === 1 && round > 1)}>Back</button>
        <button className="btn small primary" onClick={next} aria-label={`Next: ${["predict, the robot moves 1 foot", "a measurement arrives", "update", "next round, predict again"][step]}`}>Next</button>
        <button className="btn small" onClick={reset} disabled={step === 0 && round === 1}>Reset</button>
        <span className="kf-next">next: {["predict (move 1 ft)", "a measurement arrives", "update", "round " + (round + 1)][step]}</span>
        <span className="fig-dots" aria-hidden="true">{STEPS.map((_, k) => (<i key={k} className={k === step ? "on" : ""} />))}</span>
      </div>
      <figcaption>One round of the one-number Kalman filter as bell curves: the belief, the measurement, and the two combined. The gain K = predicted variance / (predicted variance + sensor variance) says how far the estimate moves towards the measurement. The belief widens with every move and narrows with every measurement.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "kalman-1d",
  title: "One step of the Kalman filter",
  description: "Step through predict and correct with bell curves, and change how much you trust the prediction or the measurement to see where the new estimate lands.",
  Component: Kalman1d,
};
