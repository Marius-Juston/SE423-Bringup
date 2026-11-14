import { useState } from "react";

// A capacitor charging or discharging through a resistor (primer A).
//   charging:    v(t) = 3.3 V x (1 - e^(-t / tau))
//   discharging: v(t) = 3.3 V x e^(-t / tau),   tau = R x C
// After one tau the voltage has covered 63 % of the way, after five tau
// more than 99 %. R and C are never 0, so tau is never 0.

const RS = [1000, 2200, 4700, 10000];
const CS = [100e-9, 220e-9, 470e-9, 1e-6];
const VIN = 3.3;
const WIN_MS = 10;

const ohm = (r: number) => `${r / 1000} kΩ`;
const farad = (c: number) => (c >= 1e-6 ? `${+(c * 1e6).toFixed(2)} µF` : `${Math.round(c * 1e9)} nF`);
const ms = (t: number) => `${+t.toPrecision(3)} ms`;

const CSS = `
.rc input[type=range] { flex: 1 1 7rem; min-width: 5rem; padding: 0; }
.rc-num { color: var(--value); font-family: var(--mono); min-width: 4.2em; text-align: right; font-size: 0.86rem; }
.rc-grid { stroke: var(--border); stroke-width: 1; }
.rc-step { fill: none; stroke: var(--dim); stroke-width: 1.4; stroke-dasharray: 4 3; }
.rc-tau { stroke: var(--harvest); stroke-width: 1.2; stroke-dasharray: 3 3; }
.rc-pt { fill: var(--harvest); }
`;

function RcCharge() {
  const [ri, setRi] = useState(3);
  const [ci, setCi] = useState(0);
  const [charge, setCharge] = useState(true);
  const r = RS[ri];
  const c = CS[ci];
  const tauMs = r * c * 1000;
  const v = (t: number) => (charge ? VIN * (1 - Math.exp(-t / tauMs)) : VIN * Math.exp(-t / tauMs));
  const X0 = 46;
  const X1 = 388;
  const HI = 26;
  const LO = 112;
  const x = (t: number) => X0 + (t / WIN_MS) * (X1 - X0);
  const y = (volts: number) => LO - (volts / VIN) * (LO - HI);
  let curve = "";
  for (let k = 0; k <= 200; k++) {
    const t = (k / 200) * WIN_MS;
    curve += `${k ? "L" : "M"}${x(t).toFixed(1)},${y(v(t)).toFixed(1)} `;
  }
  const vTau = v(tauMs);
  const settled = 5 * tauMs;
  const end = v(WIN_MS);
  const labelRight = x(tauMs) < 300;
  const why = `tau = R x C = ${ohm(r)} x ${farad(c)} = ${ms(tauMs)}. After one tau the capacitor has covered 63 % of the way: it is at ${vTau.toFixed(2)} V. ${settled <= WIN_MS ? `After about ${ms(settled)} (five tau) it has practically arrived.` : `It needs about ${ms(settled)} (five tau) to arrive, longer than this picture: at 10 ms it is only at ${end.toFixed(2)} V.`}`;
  return (
    <figure className="figure rc" aria-label="Interactive plot: the voltage of a capacitor charging or discharging through a resistor">
      <style>{CSS}</style>
      <svg viewBox="0 0 400 150" role="img" aria-label={`A capacitor ${charge ? "charging towards 3.3 volts" : "discharging towards 0 volts"} through ${ohm(r)}, capacitance ${farad(c)}. Time constant ${ms(tauMs)}. The voltage follows a curve that starts fast and flattens; after one time constant it is at ${vTau.toFixed(2)} volts.`}>
        <text x={X0 - 5} y={HI + 3} textAnchor="end" className="fig-label">3.3 V</text>
        <text x={X0 - 5} y={LO + 3} textAnchor="end" className="fig-label">0 V</text>
        <line x1={X0} y1={HI} x2={X1} y2={HI} className="rc-grid" />
        <line x1={X0} y1={LO} x2={X1} y2={LO} className="rc-grid" />
        {Array.from({ length: 11 }, (_, k) => (
          <line key={k} x1={x(k)} y1={HI} x2={x(k)} y2={LO + 4} className="rc-grid" />
        ))}
        {/* what the switch asks for: an instant jump */}
        <path d={`M${X0},${charge ? LO : HI} V${charge ? HI : LO} H${X1}`} className="rc-step" />
        <text x={tauMs > 5 ? X0 + 4 : X1} y={charge ? HI - 5 : LO - 20} textAnchor={tauMs > 5 ? "start" : "end"} className="fig-label dim">what the switch asks for</text>
        <path d={curve} className="fig-trace" style={{ stroke: "var(--hi)" }} strokeLinejoin="round" />
        <text x={X1} y={charge ? HI + 14 : LO - 7} textAnchor="end" className="fig-label">the capacitor's voltage</text>
        {/* one time constant */}
        <line x1={x(tauMs)} y1={HI - 8} x2={x(tauMs)} y2={LO + 4} className="rc-tau" />
        <circle cx={x(tauMs)} cy={y(vTau)} r="3" className="rc-pt" />
        <text x={labelRight ? x(tauMs) + 5 : x(tauMs) - 5} y={charge ? y(vTau) + (labelRight ? 12 : 20) : y(vTau) - (labelRight ? 6 : 14)} textAnchor={labelRight ? "start" : "end"} className="fig-value small">{vTau.toFixed(2)} V at t = tau</text>
        <text x={x(tauMs) > X1 - 34 ? X1 : x(tauMs)} y={HI - 11} textAnchor={x(tauMs) > X1 - 34 ? "end" : "middle"} className="fig-value small">tau = {ms(tauMs)}</text>
        {[0, 5, 10].map((t) => (
          <text key={t} x={x(t)} y="128" textAnchor={t === 0 ? "start" : t === 10 ? "end" : "middle"} className="fig-label dim">{t} ms</text>
        ))}
        <text x={x(7.5)} y="128" textAnchor="middle" className="fig-label dim">time</text>
        <text x={X0} y="144" className="fig-label dim">The switch flips at 0 ms.</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Switch to</span>
          <button className="fig-opt" aria-pressed={charge} onClick={() => setCharge(true)}>3.3 V (charge)</button>
          <button className="fig-opt" aria-pressed={!charge} onClick={() => setCharge(false)}>0 V (discharge)</button>
        </div>
        <div>
          <span>Resistor R</span>
          <input type="range" min={0} max={RS.length - 1} step={1} value={ri} aria-label="Resistor R" aria-valuetext={ohm(r)} onChange={(e) => setRi(+e.target.value)} />
          <span className="rc-num">{ohm(r)}</span>
        </div>
        <div>
          <span>Capacitor C</span>
          <input type="range" min={0} max={CS.length - 1} step={1} value={ci} aria-label="Capacitor C" aria-valuetext={farad(c)} onChange={(e) => setCi(+e.target.value)} />
          <span className="rc-num">{farad(c)}</span>
        </div>
      </div>
      <figcaption>The dashed line jumps instantly; the capacitor's voltage cannot. It follows with a curve whose speed is set by tau = R x C: a larger resistor or a larger capacitor makes it slower.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "rc-charge",
  title: "RC charging curve",
  description: "Change the resistor and the capacitor and switch between charging and discharging to see how fast the capacitor's voltage follows.",
  Component: RcCharge,
};
