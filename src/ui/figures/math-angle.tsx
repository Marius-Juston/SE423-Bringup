import { useState } from "react";

// Maths you need: an angle in degrees and in radians. Not a chip
// peripheral: no TRM section applies. The convention is the course's
// (Lecture 15, HW4): counter-clockwise positive, radians in the code.
// One radian is the angle whose arc is as long as the radius, so
// arc = radius x angle; that is why (vRight - vLeft) / wheel base is a
// turn rate in rad/s.

const CX = 130;
const CY = 112;
const fmt = (v: number, d = 2) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);

function MathAngle() {
  const [deg, setDeg] = useState(60);
  const [radius, setRadius] = useState(1);

  const rad = (deg * Math.PI) / 180;
  const R = radius === 1 ? 50 : 90; // px
  const tip = { x: CX + R * Math.cos(rad), y: CY - R * Math.sin(rad) };
  const arcLen = radius * rad;
  // arc along the circle from angle 0 to the arrow; counter-clockwise is positive.
  // Drawn in two halves through the middle of the arc, so a full turn still shows.
  const sweep = deg >= 0 ? 0 : 1;
  const mid = { x: CX + R * Math.cos(rad / 2), y: CY - R * Math.sin(rad / 2) };
  const arc = deg === 0 ? "" : `M${CX + R},${CY} A${R},${R} 0 0 ${sweep} ${mid.x.toFixed(1)},${mid.y.toFixed(1)} A${R},${R} 0 0 ${sweep} ${tip.x.toFixed(1)},${tip.y.toFixed(1)}`;
  const dir = deg === 0 ? "not turned at all" : `turned ${Math.abs(deg)} degrees ${deg > 0 ? "counter-clockwise (to the left): a positive angle" : "clockwise (to the right): a negative angle"}`;
  const near1 = Math.abs(Math.abs(rad) - 1) < 0.03;
  const why =
    deg === 0
      ? "The arrow lies on the starting line: the angle is 0 in both units. Move the slider."
      : near1
        ? `The arrow is ${dir}. The orange arc is now as long as the radius (${fmt(Math.abs(arcLen))} ft against ${radius} ft). That angle is 1 radian, about 57.3 degrees.`
        : `The arrow is ${dir}. Its tip travelled ${fmt(Math.abs(arcLen))} ft along the circle of radius ${radius} ft. Arc divided by radius is ${fmt(Math.abs(rad), 3)}: that is the angle in radians, whatever the radius.`;

  return (
    <figure className="figure ma-fig" aria-label="Interactive figure: one angle measured in degrees and in radians">
      <style>{`.ma-fig .ma-range{flex:1;min-width:110px;accent-color:var(--orange)}.ma-fig .ma-circle{fill:none;stroke:var(--dim);stroke-width:1;stroke-dasharray:3 3}.ma-fig .ma-arc{fill:none;stroke:var(--orange);stroke-width:3}.ma-fig .ma-arrow{stroke:var(--text);stroke-width:2.2}.ma-fig .ma-base{stroke:var(--arches);stroke-width:2}.ma-fig .ma-num{font-family:var(--mono);font-size:0.82rem;min-width:5.2rem;text-align:right}`}</style>
      <svg viewBox="0 0 400 224" role="img" aria-label={`Angle ${deg} degrees, which is ${fmt(rad, 3)} radians. On a circle of radius ${radius} foot the arc is ${fmt(arcLen)} feet long.`}>
        <circle cx={CX} cy={CY} r={R} className="ma-circle" />
        <line x1={CX} y1={CY} x2={CX + 100} y2={CY} className="ma-base" />
        <text x={CX + 103} y={CY + 3} className="fig-label dim">0</text>
        {arc && <path d={arc} className="ma-arc" />}
        <line x1={CX} y1={CY} x2={tip.x} y2={tip.y} className="ma-arrow" />
        <circle cx={tip.x} cy={tip.y} r={4} style={{ fill: "var(--orange)" }} />
        <circle cx={CX} cy={CY} r={2.5} className="fig-dot" />
        <text x={CX} y={CY + 14} textAnchor="middle" className="fig-label dim">radius {radius} ft</text>
        <text x={8} y={14} className="fig-label dim">counter-clockwise is positive</text>

        <text x={254} y={36} className="fig-label">angle in degrees</text>
        <text x={254} y={52} className="fig-value">{deg}</text>
        <text x={254} y={78} className="fig-label">angle in radians</text>
        <text x={254} y={94} className="fig-value">{fmt(rad, 3)}</text>
        <text x={254} y={108} className="fig-label dim">= degrees x 3.14159 / 180</text>
        <text x={254} y={134} className="fig-label">arc (orange) = radius x radians</text>
        <text x={254} y={149} className="fig-value small">{radius} x {fmt(rad, 3)} = {fmt(arcLen)} ft</text>
        <text x={254} y={176} className="fig-label dim">full turn: 360 deg = 6.283 rad</text>
        <text x={254} y={190} className="fig-label dim">half turn: 180 deg = 3.142 rad</text>
        <text x={254} y={204} className="fig-label dim">1 rad = 57.3 deg</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Angle</span>
          <input className="ma-range" type="range" aria-label="Angle in degrees" min={-180} max={360} step={1} value={deg} onChange={(e) => setDeg(+e.target.value)} />
          <span className="ma-num">{deg} deg</span>
        </div>
        <div>
          <span>Jump to</span>
          {[
            ["a quarter turn", 90],
            ["a half turn", 180],
            ["1 radian", 57],
            ["a full turn", 360],
            ["-90", -90],
          ].map(([name, d]) => (
            <button key={name} className="fig-opt" aria-pressed={deg === d} onClick={() => setDeg(d as number)}>{name}</button>
          ))}
        </div>
        <div>
          <span>Radius</span>
          <button className="fig-opt" aria-pressed={radius === 1} onClick={() => setRadius(1)}>1 ft</button>
          <button className="fig-opt" aria-pressed={radius === 1.8} onClick={() => setRadius(1.8)}>1.8 ft</button>
          <code>rad = deg * PI / 180.0;  // {fmt(rad, 3)}</code>
        </div>
      </div>
      <figcaption>One angle, two units. Degrees cut a full turn into 360 parts. Radians measure how far the tip travels along the circle, counted in radii: a full turn is 2 PI = 6.283 of them. C's sin and cos, and all the robot code, use radians.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "math-angle",
  title: "Degrees and radians",
  description: "Turn the arrow to read the same angle in degrees and in radians, and see that the arc length is the radius times the angle.",
  Component: MathAngle,
};
