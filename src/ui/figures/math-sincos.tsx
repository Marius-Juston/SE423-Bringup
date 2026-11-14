import { useState } from "react";
import { CodePre } from "../CopyButton";

// Maths you need: sine and cosine as "how far across and how far up".
// Not a chip peripheral: no TRM section applies. Convention of Lecture 15
// and HW4: angle from the x axis, counter-clockwise positive, radians in C.

const CX = 150;
const CY = 118;
const S = 48; // px per ft
const fmt = (v: number, d = 2) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);

function MathSinCos() {
  const [deg, setDeg] = useState(30);
  const [len, setLen] = useState(2);

  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const dx = len * c;
  const dy = len * s;
  const tx = CX + dx * S;
  const ty = CY - dy * S;
  const side = Math.abs(dx) < 0.005 ? "neither left nor right" : dx > 0 ? "to the right (across is positive)" : "to the left (across is negative)";
  const vert = Math.abs(dy) < 0.005 ? "neither up nor down" : dy > 0 ? "up (up is positive)" : "down (up is negative)";
  const special =
    deg === 0
      ? " At 0 the whole length goes across: cos 0 = 1, sin 0 = 0."
      : Math.abs(deg) === 90
        ? " At a quarter turn nothing goes across: cos = 0, and sin = 1 or -1."
        : Math.abs(deg) === 180
          ? " At a half turn the arrow points backwards: cos = -1, sin = 0."
          : deg === 45
            ? " At 45 degrees across and up are equal: cos and sin are both 0.707."
            : deg === -45
              ? " At -45 degrees across and down are equal: cos is 0.707 and sin is -0.707."
              : "";
  const why = `An arrow ${fmt(len, 1)} ft long at ${deg} degrees reaches ${fmt(Math.abs(dx))} ft ${side} and ${fmt(Math.abs(dy))} ft ${vert}. cos is the share of the length that goes across, sin the share that goes up.${special}`;

  return (
    <figure className="figure ms-fig" aria-label="Interactive figure: sine and cosine as how far across and how far up an arrow reaches">
      <style>{`.ms-fig .ms-range{flex:1;min-width:110px;accent-color:var(--orange)}.ms-fig .ms-axis{stroke:var(--dim);stroke-width:1}.ms-fig .ms-grid{stroke:var(--border);stroke-width:1}.ms-fig .ms-arrow{stroke:var(--text);stroke-width:2.4}.ms-fig .ms-across{stroke:var(--arches);stroke-width:3}.ms-fig .ms-up{stroke:var(--orange);stroke-width:3}.ms-fig .ms-arc{fill:none;stroke:var(--harvest);stroke-width:1.6}.ms-fig .ms-num{font-family:var(--mono);font-size:0.82rem;min-width:5.2rem;text-align:right}.ms-fig .ms-a{fill:var(--arches)}.ms-fig .ms-u{fill:var(--orange)}`}</style>
      <svg viewBox="0 0 400 236" role="img" aria-label={`Arrow of length ${fmt(len, 1)} feet at ${deg} degrees. Across: ${fmt(dx)} feet. Up: ${fmt(dy)} feet. Cosine ${fmt(c, 3)}, sine ${fmt(s, 3)}.`}>
        {[-2, -1, 1, 2].map((g) => (
          <g key={g}>
            <line x1={CX + g * S} x2={CX + g * S} y1={CY - 2.2 * S} y2={CY + 2.2 * S} className="ms-grid" />
            <line x1={CX - 2.6 * S} x2={CX + 2.6 * S} y1={CY - g * S} y2={CY - g * S} className="ms-grid" />
          </g>
        ))}
        <line x1={CX - 2.6 * S} x2={CX + 2.6 * S} y1={CY} y2={CY} className="ms-axis" />
        <line x1={CX} x2={CX} y1={CY - 2.2 * S} y2={CY + 2.2 * S} className="ms-axis" />
        <text x={CX + 2.6 * S + 3} y={CY + 3} className="fig-label dim">x</text>
        <text x={CX + 4} y={CY - 2.2 * S + 8} className="fig-label dim">y</text>
        <text x={CX + S} y={CY + 11} textAnchor="middle" className="fig-label dim">1 ft</text>
        {/* across, then up */}
        <line x1={CX} y1={CY} x2={tx} y2={CY} className="ms-across" />
        <line x1={tx} y1={CY} x2={tx} y2={ty} className="ms-up" />
        <line x1={CX} y1={CY} x2={tx} y2={ty} className="ms-arrow" />
        <circle cx={tx} cy={ty} r={4} style={{ fill: "var(--text)" }} />
        {deg !== 0 && <path d={`M${CX + 16},${CY} A16,16 0 ${Math.abs(deg) > 180 ? 1 : 0} ${deg > 0 ? 0 : 1} ${(CX + 16 * c).toFixed(1)},${(CY - 16 * s).toFixed(1)}`} className="ms-arc" />}

        <text x={292} y={24} className="fig-label">cos({deg}°) = <tspan className="fig-value small">{fmt(c, 3)}</tspan></text>
        <text x={292} y={40} className="fig-label">sin({deg}°) = <tspan className="fig-value small">{fmt(s, 3)}</tspan></text>
        <text x={292} y={70} className="fig-label ms-a">across (blue)</text>
        <text x={292} y={84} className="fig-label">= length x cos</text>
        <text x={292} y={99} className="fig-value small">{fmt(len, 1)} x {fmt(c, 3)}</text>
        <text x={292} y={114} className="fig-value">= {fmt(dx)} ft</text>
        <text x={292} y={144} className="fig-label ms-u">up (orange)</text>
        <text x={292} y={158} className="fig-label">= length x sin</text>
        <text x={292} y={173} className="fig-value small">{fmt(len, 1)} x {fmt(s, 3)}</text>
        <text x={292} y={188} className="fig-value">= {fmt(dy)} ft</text>
        <text x={292} y={214} className="fig-label dim">in radians: {fmt(rad, 3)}</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Angle</span>
          <input className="ms-range" type="range" aria-label="Angle of the arrow in degrees" min={-180} max={180} step={5} value={deg} onChange={(e) => setDeg(+e.target.value)} />
          <span className="ms-num">{deg} deg</span>
        </div>
        <div>
          <span>Length</span>
          <input className="ms-range" type="range" aria-label="Length of the arrow in feet" min={0.5} max={2} step={0.1} value={len} onChange={(e) => setLen(+e.target.value)} />
          <span className="ms-num">{fmt(len, 1)} ft</span>
        </div>
      </div>
      <div className="fig-step">
        <CodePre><code>{`// C wants radians:\n// theta = ${fmt(rad, 3)} rad (${deg} degrees)\ndx = L * cos(theta);  // ${fmt(dx)} ft across\ndy = L * sin(theta);  // ${fmt(dy)} ft up`}</code></CodePre>
      </div>
      <figcaption>Any arrow can be replaced by two moves: across, then up. Cosine and sine are the two shares for an arrow of length 1; multiply by the length for a longer one. Both are always between -1 and 1.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "math-sincos",
  title: "Sine and cosine: across and up",
  description: "Change the angle and length of an arrow to see how far across and how far up it reaches, and the cos and sin that give those two parts.",
  Component: MathSinCos,
};
