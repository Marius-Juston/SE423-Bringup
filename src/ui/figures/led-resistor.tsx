import { useState } from "react";

// An LED and its current-limiting resistor (primer A). Model: a red LED
// keeps about 2.0 V across itself whenever it conducts, so the resistor
// gets the rest and sets the current: I = (Vsupply - 2.0 V) / R. Backwards
// the LED blocks: no current, the whole supply voltage sits across it.
// Limits shown: 20 mA is a typical maximum for a small indicator LED; a
// GPIO pin of the F28379D can deliver about 4 mA (datasheet SPRS880,
// electrical characteristics: output current -4 mA / 4 mA). R is never 0,
// so there is no division by zero.

const RS = [47, 68, 100, 150, 220, 330, 470, 680, 1000, 2200, 4700, 10000];
const VF = 2.0;
const LED_MAX = 20;
const PIN_MAX = 4;

const ohm = (r: number) => (r >= 1000 ? `${r / 1000} kΩ` : `${r} Ω`);

const CSS = `
.lr input[type=range] { flex: 1 1 7rem; min-width: 5rem; padding: 0; }
.lr-num { color: var(--value); font-family: var(--mono); min-width: 4.2em; text-align: right; font-size: 0.86rem; }
.lr-glow { fill: var(--orange); }
.lr-led { fill: var(--surface); stroke: var(--text); stroke-width: 1.6; stroke-linejoin: round; }
.lr-flow { fill: none; stroke: var(--harvest); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.lr-big { fill: var(--harvest); font-size: 14px; font-family: var(--mono); font-weight: 700; }
.lr-bad { fill: var(--bad); font-size: max(9.5px, calc(9px / var(--fig-k, 1))); font-family: var(--sans); font-weight: 700; }
`;

function LedResistor() {
  const [vs, setVs] = useState(3.3);
  const [ri, setRi] = useState(5);
  const [fwd, setFwd] = useState(true);
  const r = RS[ri];
  const vr = fwd ? vs - VF : 0;
  const ma = (vr / r) * 1000;
  const maText = `${+ma.toFixed(ma < 1 ? 2 : 1)} mA`;
  const tooMuch = ma > LED_MAX;
  const bright = Math.min(1, Math.sqrt(ma / LED_MAX));
  const cx = 150;
  const why = !fwd
    ? "The LED is in backwards. It blocks: no current flows, the LED stays dark, and nothing is damaged at these voltages. Turn it round."
    : tooMuch
      ? `${maText} is more than the 20 mA this LED can take. It would run hot and die early. Use a larger resistor.`
      : ma > PIN_MAX
        ? `${maText}: fine for the LED (not over 20 mA). It is more than one pin of the microcontroller can deliver (about 4 mA), so this resistor suits an LED fed from a power supply, not straight from a pin.`
        : ma < 0.5
          ? `Only ${maText}: the LED is safe but barely glows. A smaller resistor lets more current through.`
          : `${maText}: safe for the LED, and little enough for one microcontroller pin (about 4 mA) to deliver.`;
  return (
    <figure className="figure lr" aria-label="Interactive circuit: a supply, a resistor and an LED">
      <style>{CSS}</style>
      <svg viewBox="0 0 400 176" role="img" aria-label={`${vs} volt supply, ${ohm(r)} resistor, LED ${fwd ? "the right way round" : "backwards"}. Current ${maText}. ${!fwd ? "The LED is dark." : tooMuch ? "Too much current for the LED." : "The LED is lit."}`}>
        <text x={cx} y="14" textAnchor="middle" className="fig-value">{vs} V</text>
        <line x1={cx - 12} y1="20" x2={cx + 12} y2="20" className="fig-wire thick" style={{ stroke: "var(--orange)" }} />
        <line x1={cx} y1="20" x2={cx} y2="40" className="fig-wire thick" style={{ stroke: "var(--orange)" }} />
        {/* resistor */}
        <rect x={cx - 7} y="40" width="14" height="32" className="fig-box active" />
        <text x={cx - 14} y="54" textAnchor="end" className="fig-label">resistor</text>
        <text x={cx - 14} y="66" textAnchor="end" className="fig-value small">{ohm(r)}</text>
        <line x1={cx} y1="72" x2={cx} y2="98" className="fig-wire thick" style={{ stroke: fwd ? undefined : "var(--orange)" }} />
        {/* LED: the triangle points the way current can flow */}
        {fwd && ma > 0 && <circle cx={cx} cy="108" r="24" className="lr-glow" opacity={0.3 * bright} />}
        {fwd ? (
          <>
            <polygon points={`${cx - 11},98 ${cx + 11},98 ${cx},117`} className="lr-led" style={{ fill: `color-mix(in srgb, var(--orange) ${Math.round(bright * 100)}%, var(--surface))` }} />
            <line x1={cx - 11} y1="117" x2={cx + 11} y2="117" className="fig-wire thick" />
          </>
        ) : (
          <>
            <polygon points={`${cx - 11},117 ${cx + 11},117 ${cx},98`} className="lr-led" />
            <line x1={cx - 11} y1="98" x2={cx + 11} y2="98" className="fig-wire thick" />
          </>
        )}
        <text x={cx - 18} y="106" textAnchor="end" className="fig-label">LED</text>
        <text x={cx - 18} y="118" textAnchor="end" className="fig-label dim">{fwd ? "arrow points down" : "arrow points up"}</text>
        <line x1={cx} y1="117" x2={cx} y2="150" className="fig-wire thick" style={{ stroke: "var(--arches)" }} />
        <line x1={cx - 12} y1="150" x2={cx + 12} y2="150" className="fig-wire thick" />
        <line x1={cx - 7} y1="155" x2={cx + 7} y2="155" className="fig-wire thick" />
        <line x1={cx - 3} y1="160" x2={cx + 3} y2="160" className="fig-wire thick" />
        <text x={cx + 18} y="158" className="fig-label">ground, 0 V</text>
        {fwd && <path d={`M${cx + 14},26 v9 m-3.5,-4 l3.5,4.5 l3.5,-4.5 M${cx + 14},128 v9 m-3.5,-4 l3.5,4.5 l3.5,-4.5`} className="lr-flow" />}
        {/* voltages across each part */}
        <text x={cx + 16} y="54" className="fig-label dim">across the resistor</text>
        <text x={cx + 16} y="66" className="fig-value small">{vr.toFixed(1)} V</text>
        <text x={cx + 16} y="104" className="fig-label dim">across the LED</text>
        <text x={cx + 16} y="116" className="fig-value small">{fwd ? `about ${VF.toFixed(1)} V` : `${vs} V (blocks)`}</text>
        {/* result */}
        <text x="270" y="36" className="fig-label">current</text>
        <text x="270" y="54" className="lr-big" style={{ fill: tooMuch ? "var(--bad)" : undefined }}>{maText}</text>
        {fwd && <text x="270" y="68" className="fig-label dim">= {vr.toFixed(1)} V / {ohm(r)}</text>}
        {tooMuch && <text x="270" y="84" className="lr-bad">TOO MUCH for the LED</text>}
        <text x="270" y="104" className="fig-label dim">LED limit: {LED_MAX} mA</text>
        <text x="270" y="116" className="fig-label dim">one pin gives: about {PIN_MAX} mA</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Supply</span>
          <button className="fig-opt" aria-pressed={vs === 3.3} onClick={() => setVs(3.3)}>3.3 V</button>
          <button className="fig-opt" aria-pressed={vs === 5} onClick={() => setVs(5)}>5 V</button>
        </div>
        <div>
          <span>Resistor</span>
          <input type="range" min={0} max={RS.length - 1} step={1} value={ri} aria-label="Resistor value" aria-valuetext={ohm(r)} onChange={(e) => setRi(+e.target.value)} />
          <span className="lr-num">{ohm(r)}</span>
        </div>
        <div>
          <span>LED</span>
          <button className="fig-opt" aria-pressed={fwd} onClick={() => setFwd(true)}>right way round</button>
          <button className="fig-opt" aria-pressed={!fwd} onClick={() => setFwd(false)}>backwards</button>
        </div>
      </div>
      <figcaption>The LED keeps about 2 V for itself. The resistor takes the rest of the supply voltage, and Ohm's law on the resistor sets the current for both.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "led-resistor",
  title: "LED and series resistor",
  description: "Change the supply, the resistor and the LED's direction to see the voltage each part takes and the current that flows.",
  Component: LedResistor,
};
