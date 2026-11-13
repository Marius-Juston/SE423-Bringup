import { useState } from "react";

// The voltage divider (primer A): two parts in series between 3.3 V and
// ground, and the voltage at the point between them.
//   Vout = 3.3 V x R2 / (R1 + R2),  I = 3.3 V / (R1 + R2)
// The bottom part can also be a push button: released it is an open gap
// (infinite resistance: no current, so no voltage across R1, Vout = 3.3 V),
// pressed it is a plain wire (0 ohm: Vout = 0 V). That is the pull-up
// circuit of chapter 3. R1 is never below 1 kΩ, so nothing divides by zero.

const RS = [1000, 2200, 4700, 10000, 22000, 47000, 100000];
const VIN = 3.3;
type Bottom = "resistor" | "released" | "pressed";

const ohm = (r: number) => `${r / 1000} kΩ`;
const amp = (a: number) => (a === 0 ? "0 mA" : a >= 1e-3 ? `${+(a * 1e3).toFixed(2)} mA` : `${+(a * 1e6).toFixed(1)} µA`);

const CSS = `
.vd input[type=range] { flex: 1 1 7rem; min-width: 5rem; padding: 0; }
.vd-num { color: var(--value); font-family: var(--mono); min-width: 4.2em; text-align: right; font-size: 0.86rem; }
.vd-big { fill: var(--harvest); font-size: 14px; font-family: var(--mono); font-weight: 700; }
.vd-share1 { fill: var(--orange); opacity: 0.55; }
.vd-share2 { fill: var(--arches); opacity: 0.55; }
.vd-flow { fill: none; stroke: var(--harvest); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
`;

function VoltageDivider() {
  const [i1, setI1] = useState(3);
  const [i2, setI2] = useState(3);
  const [bottom, setBottom] = useState<Bottom>("resistor");
  const r1 = RS[i1];
  const r2 = RS[i2];
  const vout = bottom === "released" ? VIN : bottom === "pressed" ? 0 : (VIN * r2) / (r1 + r2);
  const cur = bottom === "released" ? 0 : bottom === "pressed" ? VIN / r1 : VIN / (r1 + r2);
  const v1 = VIN - vout;
  const vText = `${vout.toFixed(2)} V`;
  const cx = 110;
  const midCol = bottom === "released" ? "var(--orange)" : bottom === "pressed" ? "var(--arches)" : "var(--harvest)";
  const barY = 24;
  const barH = 120;
  const split = barY + (barH * v1) / VIN;
  const why =
    bottom === "released"
      ? `Button released: the bottom path is an open gap, so no current flows. With no current there is no voltage across the top resistor (V = I x R = 0), so the middle point sits at the full 3.3 V. The top resistor "pulls it up".`
      : bottom === "pressed"
        ? `Button pressed: the bottom path is a plain wire to ground, so the middle point is at 0 V. All 3.3 V is across the top resistor, which limits the current to ${amp(cur)}. Without that resistor this would be a short circuit.`
        : r1 === r2
          ? `Two equal resistors share the voltage equally: the middle point is at half, ${vText}. The same current, ${amp(cur)}, flows through both.`
          : `The bottom resistor is ${ohm(r2)} out of ${ohm(r1 + r2)} in total, so it gets that share of 3.3 V: ${vText}. The ${r2 > r1 ? "bottom" : "top"} resistor is larger, so it takes the larger share. Current: ${amp(cur)}.`;
  return (
    <figure className="figure vd" aria-label="Interactive circuit: a voltage divider between 3.3 volts and ground">
      <style>{CSS}</style>
      <svg viewBox="0 0 400 176" role="img" aria-label={`Top resistor ${ohm(r1)}. Bottom part: ${bottom === "resistor" ? `resistor ${ohm(r2)}` : `push button, ${bottom}`}. The middle point is at ${vText}. Current ${amp(cur)}.`}>
        <text x={cx} y="14" textAnchor="middle" className="fig-value">3.3 V</text>
        <line x1={cx - 12} y1="20" x2={cx + 12} y2="20" className="fig-wire thick" style={{ stroke: "var(--orange)" }} />
        <line x1={cx} y1="20" x2={cx} y2="34" className="fig-wire thick" style={{ stroke: "var(--orange)" }} />
        <rect x={cx - 7} y="34" width="14" height="34" className="fig-box active" />
        <text x={cx - 14} y="48" textAnchor="end" className="fig-label">R1 (top)</text>
        <text x={cx - 14} y="60" textAnchor="end" className="fig-value small">{ohm(r1)}</text>
        <line x1={cx} y1="68" x2={cx} y2="100" className="fig-wire thick" style={{ stroke: midCol }} />
        {/* middle point */}
        <circle cx={cx} cy="84" r="3.2" className="fig-dot" />
        <line x1={cx} y1="84" x2={cx + 56} y2="84" className="fig-wire thick" style={{ stroke: midCol }} />
        <text x={cx + 62} y="80" className="fig-label">middle point</text>
        <text x={cx + 62} y="96" className="vd-big">{vText}</text>
        {/* bottom part */}
        {bottom === "resistor" ? (
          <>
            <rect x={cx - 7} y="100" width="14" height="34" className="fig-box active" />
            <text x={cx - 14} y="114" textAnchor="end" className="fig-label">R2 (bottom)</text>
            <text x={cx - 14} y="126" textAnchor="end" className="fig-value small">{ohm(r2)}</text>
          </>
        ) : (
          <>
            <circle cx={cx} cy="103" r="2.6" className="fig-dot" />
            <circle cx={cx} cy="131" r="2.6" className="fig-dot" />
            <line x1={bottom === "pressed" ? cx - 3 : cx - 14} y1="100" x2={bottom === "pressed" ? cx - 3 : cx - 14} y2="134" className="fig-wire thick" />
            <text x={cx - 22} y="114" textAnchor="end" className="fig-label">push button</text>
            <text x={cx - 22} y="126" textAnchor="end" className="fig-label dim">{bottom}</text>
          </>
        )}
        <line x1={cx} y1="134" x2={cx} y2="150" className="fig-wire thick" style={{ stroke: "var(--arches)" }} />
        <line x1={cx - 12} y1="150" x2={cx + 12} y2="150" className="fig-wire thick" />
        <line x1={cx - 7} y1="155" x2={cx + 7} y2="155" className="fig-wire thick" />
        <line x1={cx - 3} y1="160" x2={cx + 3} y2="160" className="fig-wire thick" />
        <text x={cx + 18} y="158" className="fig-label">ground, 0 V</text>
        {cur > 0 && <path d={`M${cx + 14},22 v9 m-3.5,-4 l3.5,4.5 l3.5,-4.5`} className="vd-flow" />}
        <text x={cx + 24} y="31" className="fig-label dim">{cur > 0 ? `current ${amp(cur)}` : "no current"}</text>
        {/* how the 3.3 V is shared */}
        <text x="330" y="14" textAnchor="middle" className="fig-label">how 3.3 V is shared</text>
        <rect x="316" y={barY} width="28" height={barH} className="fig-box" />
        <rect x="316" y={barY} width="28" height={split - barY} className="vd-share1" />
        <rect x="316" y={split} width="28" height={barY + barH - split} className="vd-share2" />
        <line x1="310" y1={split} x2="350" y2={split} stroke="var(--text)" strokeWidth="1.6" />
        {v1 > 0.25 && <text x="354" y={(barY + split) / 2 + 3} className="fig-label">{v1.toFixed(2)} V</text>}
        {vout > 0.25 && <text x="354" y={(split + barY + barH) / 2 + 3} className="fig-label">{vout.toFixed(2)} V</text>}
        <text x="310" y={barY + 6} textAnchor="end" className="fig-label dim">top part</text>
        <text x="310" y={barY + barH - 1} textAnchor="end" className="fig-label dim">bottom part</text>
        <text x="330" y="158" textAnchor="middle" className="fig-label dim">0 V</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>R1 (top)</span>
          <input type="range" min={0} max={RS.length - 1} step={1} value={i1} aria-label="Top resistor R1" aria-valuetext={ohm(r1)} onChange={(e) => setI1(+e.target.value)} />
          <span className="vd-num">{ohm(r1)}</span>
        </div>
        <div>
          <span>Bottom part</span>
          <button className="fig-opt" aria-pressed={bottom === "resistor"} onClick={() => setBottom("resistor")}>resistor R2</button>
          <button className="fig-opt" aria-pressed={bottom === "released"} onClick={() => setBottom("released")}>button, released</button>
          <button className="fig-opt" aria-pressed={bottom === "pressed"} onClick={() => setBottom("pressed")}>button, pressed</button>
        </div>
        {bottom === "resistor" && (
          <div>
            <span>R2 (bottom)</span>
            <input type="range" min={0} max={RS.length - 1} step={1} value={i2} aria-label="Bottom resistor R2" aria-valuetext={ohm(r2)} onChange={(e) => setI2(+e.target.value)} />
            <span className="vd-num">{ohm(r2)}</span>
          </div>
        )}
      </div>
      <figcaption>Two parts in series share the supply voltage in proportion to their resistance: middle voltage = 3.3 V x R2 / (R1 + R2).</figcaption>
    </figure>
  );
}

export const figure = {
  id: "voltage-divider",
  title: "Voltage divider",
  description: "Change the two resistors, or swap the bottom one for a push button, to see how the middle voltage divides.",
  Component: VoltageDivider,
};
