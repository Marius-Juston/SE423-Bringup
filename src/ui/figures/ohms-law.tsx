import { useState } from "react";

// Ohm's law, I = V / R (primer A). Whole volts and whole ohms on purpose:
// this figure is used before unit prefixes are taught. R never goes below
// 2 ohm, so there is no division by zero; V = 0 gives exactly 0 A.

const CSS = `
.ol .fig-controls > div > span:first-child { width: 5.2rem; }
.ol input[type=range] { flex: 1 1 7rem; min-width: 5rem; padding: 0; }
.ol-num { color: var(--value); font-family: var(--mono); min-width: 3.4em; text-align: right; font-size: 0.86rem; }
.ol-bar { fill: var(--harvest); }
.ol-track { fill: var(--surface); stroke: var(--dim); stroke-width: 1; }
.ol-flow { fill: none; stroke: var(--harvest); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.ol-big { fill: var(--harvest); font-size: 15px; font-family: var(--mono); font-weight: 700; }
`;

const IMAX = 6;

function OhmsLaw() {
  const [v, setV] = useState(6);
  const [r, setR] = useState(3);
  const i = v / r;
  const amps = `${+i.toFixed(2)} A`;
  // One arrow per started ampere, so more current visibly means more arrows.
  const arrows = i === 0 ? 0 : Math.min(6, Math.max(1, Math.round(i)));
  const why =
    v === 0
      ? "With 0 V there is no push at all, so no current flows, whatever the resistance."
      : `${v} V pushes through ${r} Ω: the current is ${v} / ${r} = ${amps}. Double the voltage and the current doubles. Double the resistance and the current halves.`;
  return (
    <figure className="figure ol" aria-label="Interactive figure: Ohm's law with a voltage slider and a resistance slider">
      <style>{CSS}</style>
      <svg viewBox="0 0 400 150" role="img" aria-label={`A ${v} volt source across a ${r} ohm resistor. The current is ${amps}.`}>
        {/* source */}
        <rect x="20" y="46" width="44" height="52" rx="4" className="fig-box active" />
        <text x="42" y="62" textAnchor="middle" className="fig-label">source</text>
        <text x="42" y="80" textAnchor="middle" className="fig-value">{v} V</text>
        <text x="42" y="93" textAnchor="middle" className="fig-label dim">voltage V</text>
        {/* loop */}
        <path d="M42,46 V20 H222 V46" className="fig-wire thick" style={{ stroke: v ? "var(--orange)" : "var(--arches)" }} />
        <path d="M42,98 V124 H222 V98" className="fig-wire thick" style={{ stroke: "var(--arches)" }} />
        <rect x="204" y="46" width="36" height="52" className="fig-box active" />
        <text x="222" y="62" textAnchor="middle" className="fig-label">resistor</text>
        <text x="222" y="80" textAnchor="middle" className="fig-value">{r} Ω</text>
        <text x="222" y="93" textAnchor="middle" className="fig-label dim">R</text>
        {Array.from({ length: arrows }, (_, k) => {
          const x = 132 - ((arrows - 1) * 16) / 2 + k * 16;
          return <path key={k} d={`M${x - 3},15 l6,5 l-6,5`} className="ol-flow" />;
        })}
        <text x="132" y="36" textAnchor="middle" className="fig-label">{i === 0 ? "no current" : "current I"}</text>
        {/* result */}
        <text x="262" y="34" className="fig-label">I = V / R</text>
        <text x="262" y="50" className="fig-label dim">= {v} V / {r} Ω</text>
        <text x="262" y="72" className="ol-big">= {amps}</text>
        <rect x="262" y="88" width="126" height="12" rx="2" className="ol-track" />
        <rect x="262" y="88" width={(126 * Math.min(i, IMAX)) / IMAX} height="12" rx="2" className="ol-bar" />
        <text x="262" y="112" className="fig-label dim">0 A</text>
        <text x="388" y="112" textAnchor="end" className="fig-label dim">{IMAX} A</text>
        <text x="325" y="126" textAnchor="middle" className="fig-label dim">current</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Voltage</span>
          <input type="range" min={0} max={12} step={1} value={v} aria-label="Voltage in volts" onChange={(e) => setV(+e.target.value)} />
          <span className="ol-num">{v} V</span>
        </div>
        <div>
          <span>Resistance</span>
          <input type="range" min={2} max={24} step={1} value={r} aria-label="Resistance in ohms" onChange={(e) => setR(+e.target.value)} />
          <span className="ol-num">{r} Ω</span>
        </div>
      </div>
      <figcaption>Ohm's law: current = voltage / resistance. More push gives more current; more resistance gives less.</figcaption>
    </figure>
  );
}

export const figure = { id: "ohms-law", Component: OhmsLaw };
