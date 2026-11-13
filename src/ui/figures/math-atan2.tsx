import { useState } from "react";

// Maths you need: atan2(dy, dx), the angle of an arrow, and its length.
// Not a chip peripheral: no TRM section applies. This is the first step of
// the course's xy_control (user_xy.c): alpha = atan2(dy, dx), dist =
// sqrt(dx*dx + dy*dy). The result lies between -PI and PI.

const CX = 140;
const CY = 112;
const S = 44; // px per ft
const fmt = (v: number, d = 2) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);

function MathAtan2() {
  const [dx, setDx] = useState(1.5);
  const [dy, setDy] = useState(1);

  const zero = dx === 0 && dy === 0;
  const ang = Math.atan2(dy, dx);
  const deg = (ang * 180) / Math.PI;
  const len = Math.sqrt(dx * dx + dy * dy);
  const plain = dx === 0 ? null : Math.atan(dy / dx);
  const tx = CX + dx * S;
  const ty = CY - dy * S;
  const where = `${dx > 0 ? "ahead" : dx < 0 ? "behind" : ""}${dx !== 0 && dy !== 0 ? " and " : ""}${dy > 0 ? "to the left" : dy < 0 ? "to the right" : ""}`;
  const why = zero
    ? "Both parts are zero: the arrow has no length and no direction. Close to a target dx and dy are tiny and this angle swings wildly, which is why move-to-XY code stops steering when it is near."
    : dx < 0 && plain !== null
      ? `The target is ${where}: the arrow's angle is ${fmt(ang)} rad (${fmt(deg, 0)} degrees). The plain atan(dy / dx) would say ${fmt(plain)} rad, the opposite direction: dividing loses the two signs. atan2 gets both numbers and keeps them.${Math.abs(deg) > 150 ? " Note the jump: just above the backward line the angle is +3.14, just below it -3.14." : ""}`
      : `The target is ${where}: the arrow's angle is ${fmt(ang)} rad (${fmt(deg, 0)} degrees), measured from the x axis, counter-clockwise positive. Its length is ${fmt(len)} ft. Move the target behind the origin (dx negative) to see what the plain atan gets wrong.`;

  return (
    <figure className="figure mt-fig" aria-label="Interactive figure: atan2 gives the angle of an arrow from its two parts">
      <style>{`.mt-fig .mt-range{flex:1;min-width:110px;accent-color:var(--orange)}.mt-fig .mt-axis{stroke:var(--dim);stroke-width:1}.mt-fig .mt-grid{stroke:var(--border);stroke-width:1}.mt-fig .mt-arrow{stroke:var(--text);stroke-width:2.4}.mt-fig .mt-dx{stroke:var(--arches);stroke-width:2.4;stroke-dasharray:5 3}.mt-fig .mt-dy{stroke:var(--orange);stroke-width:2.4;stroke-dasharray:5 3}.mt-fig .mt-arc{fill:none;stroke:var(--harvest);stroke-width:2}.mt-fig .mt-seam{stroke:var(--bad);stroke-width:1.4;stroke-dasharray:2 3}.mt-fig .mt-num{font-family:var(--mono);font-size:0.82rem;min-width:4.6rem;text-align:right}`}</style>
      <svg viewBox="0 0 400 224" role="img" aria-label={zero ? "The arrow has zero length: no direction." : `Arrow with dx ${fmt(dx, 1)} and dy ${fmt(dy, 1)} feet. Angle ${fmt(ang)} radians, ${fmt(deg, 0)} degrees. Length ${fmt(len)} feet.`}>
        {[-2, -1, 1, 2].map((g) => (
          <g key={g}>
            <line x1={CX + g * S} x2={CX + g * S} y1={CY - 2.3 * S} y2={CY + 2.3 * S} className="mt-grid" />
            <line x1={CX - 2.9 * S} x2={CX + 2.9 * S} y1={CY - g * S} y2={CY - g * S} className="mt-grid" />
          </g>
        ))}
        <line x1={CX} x2={CX + 2.9 * S} y1={CY} y2={CY} className="mt-axis" />
        <line x1={CX - 2.9 * S} x2={CX} y1={CY} y2={CY} className="mt-seam" />
        <line x1={CX} x2={CX} y1={CY - 2.3 * S} y2={CY + 2.3 * S} className="mt-axis" />
        <text x={CX + 2.9 * S - 2} y={CY - 4} textAnchor="end" className="fig-label dim">x: angle 0</text>
        <text x={CX - 2.9 * S + 2} y={CY - 4} className="fig-label dim">+3.14</text>
        <text x={CX - 2.9 * S + 2} y={CY + 11} className="fig-label dim">-3.14</text>
        <text x={CX + 4} y={CY - 2.3 * S + 8} className="fig-label dim">y: +1.57</text>
        <text x={CX + 4} y={CY + 2.3 * S - 2} className="fig-label dim">-1.57</text>
        <line x1={CX} y1={CY} x2={tx} y2={CY} className="mt-dx" />
        <line x1={tx} y1={CY} x2={tx} y2={ty} className="mt-dy" />
        {!zero && <path d={`M${CX + 20},${CY} A20,20 0 0 ${ang > 0 ? 0 : 1} ${(CX + 20 * Math.cos(ang)).toFixed(1)},${(CY - 20 * Math.sin(ang)).toFixed(1)}`} className="mt-arc" />}
        <line x1={CX} y1={CY} x2={tx} y2={ty} className="mt-arrow" />
        <circle cx={tx} cy={ty} r={5} style={{ fill: "var(--orange)" }} />
        <text x={tx + (dx >= 0 ? 8 : -8)} y={ty - 6} textAnchor={dx >= 0 ? "start" : "end"} className="fig-label">target</text>
        <circle cx={CX} cy={CY} r={3} className="fig-dot" />

        <text x={282} y={24} className="fig-label">direction</text>
        <text x={282} y={38} className="fig-label dim">atan2(dy, dx)</text>
        <text x={282} y={54} className="fig-value">{zero ? "undefined" : `${fmt(ang)} rad`}</text>
        <text x={282} y={68} className="fig-label dim">{zero ? "" : `= ${fmt(deg, 0)} degrees`}</text>
        <text x={282} y={98} className="fig-label">distance</text>
        <text x={282} y={112} className="fig-label dim">sqrt(dx x dx + dy x dy)</text>
        <text x={282} y={128} className="fig-value">{fmt(len)} ft</text>
        <text x={282} y={158} className="fig-label">plain atan(dy / dx)</text>
        <text x={282} y={174} className="fig-value small" style={{ fill: dx < 0 ? "var(--bad)" : undefined }}>{plain === null ? "divides by zero" : `${fmt(plain)} rad${dx < 0 ? ": wrong way" : ""}`}</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>dx</span>
          <input className="mt-range" type="range" aria-label="dx: how far the target is along x, in feet" min={-2.5} max={2.5} step={0.1} value={dx} onChange={(e) => setDx(+e.target.value)} />
          <span className="mt-num">{fmt(dx, 1)} ft</span>
        </div>
        <div>
          <span>dy</span>
          <input className="mt-range" type="range" aria-label="dy: how far the target is along y, in feet" min={-2} max={2} step={0.1} value={dy} onChange={(e) => setDy(+e.target.value)} />
          <span className="mt-num">{fmt(dy, 1)} ft</span>
        </div>
      </div>
      <div className="fig-step">
        <pre><code>{`// dy comes first\nalpha = atan2(dy, dx);           // ${zero ? "no direction" : `${fmt(ang)} rad`}\ndist  = sqrt(dx * dx + dy * dy); // ${fmt(len)} ft`}</code></pre>
      </div>
      <figcaption>sin and cos turn an angle into "across and up". atan2 goes the other way: from across (dx) and up (dy) to the angle, anywhere round the circle, between -PI and PI. The dotted red line is where the result jumps from +3.14 to -3.14.</figcaption>
    </figure>
  );
}

export const figure = { id: "math-atan2", Component: MathAtan2 };
