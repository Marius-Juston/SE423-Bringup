import { useState } from "react";
import { CodePre } from "../CopyButton";

// One LIDAR beam: a distance d along a direction alpha becomes a point
// (x, y) in the sensor's own frame, x = d cos(alpha) ahead and
// y = d sin(alpha) to the left. Angle convention of the course code
// (lecture 16, HW4): 0 is straight ahead, positive is to the left, the scan
// covers -120 to +120 degrees. C's sin() and cos() take radians.
const OX = 150;
const OY = 150;
const PX_PER_FT = 26;
const RAD_PER_DEG = Math.PI / 180;
const PRESETS = [0, 30, 90, -90, 120];
const f2 = (v: number) => (Math.abs(v) < 0.005 ? "0.00" : v.toFixed(2));

function MathPolar() {
  const [deg, setDeg] = useState(30);
  const [d, setD] = useState(3);

  const rad = deg * RAD_PER_DEG;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const x = d * c;
  const y = d * s;
  // x (ahead) is drawn to the right, y (the robot's left) is drawn upwards
  const px = OX + x * PX_PER_FT;
  const py = OY - y * PX_PER_FT;
  const R = 5 * PX_PER_FT;
  const edge = (a: number) => `${OX + R * Math.cos(a * RAD_PER_DEG)},${OY - R * Math.sin(a * RAD_PER_DEG)}`;
  const arcR = 24;
  const arcEnd = `${OX + arcR * c},${OY - arcR * s}`;

  const side = Math.abs(y) < 0.005 ? "neither left nor right" : y > 0 ? `${f2(y)} ft to its left` : `${f2(-y)} ft to its right`;
  const ahead = Math.abs(x) < 0.005 ? "level with the sensor" : x > 0 ? `${f2(x)} ft ahead of the sensor` : `${f2(-x)} ft behind the sensor`;
  const why =
    `The beam looks ${deg === 0 ? "straight ahead" : `${Math.abs(deg)} degrees to the ${deg > 0 ? "left" : "right"}`} and hits something ${d.toFixed(1)} ft away. ` +
    `That point is ${ahead} and ${side}.` +
    (deg === 0 ? " Straight ahead, all of the distance is x." : Math.abs(deg) === 90 ? " Exactly sideways, all of the distance is y." : x < 0 ? " Past 90 degrees the cosine is negative: x points backwards." : y < 0 ? " A negative angle gives a negative sine: y points to the right." : "");

  return (
    <figure className="figure mpolar" aria-label="Interactive picture: one LIDAR beam, from distance and angle to x and y">
      <style>{`
        .mpolar-slider { display: flex; align-items: center; gap: 0.5rem; flex: 1 1 12rem; }
        .mpolar-slider input { flex: 1; min-width: 6rem; accent-color: var(--orange); }
        .mpolar-slider output { font-family: var(--mono); color: var(--harvest); font-weight: 700; min-width: 4.2rem; }
        .mpolar-fan { fill: var(--accent-soft); stroke: var(--border-strong); stroke-dasharray: 4 3; }
        .mpolar-axis { stroke: var(--dim); stroke-width: 1; }
        .mpolar-beam { stroke: var(--harvest); stroke-width: 2.4; }
        .mpolar-x { stroke: var(--orange); stroke-width: 3; }
        .mpolar-y { stroke: var(--arches); stroke-width: 3; stroke-dasharray: 6 3; }
        .mpolar-arc { stroke: var(--text); stroke-width: 1.2; fill: none; }
        .mpolar-hit { fill: var(--harvest); stroke: var(--text); stroke-width: 1; }
        .mpolar-robot { fill: var(--surface); stroke: var(--text); stroke-width: 1.4; }
      `}</style>
      <svg
        viewBox="0 0 420 300"
        role="img"
        aria-label={`Beam at ${deg} degrees, which is ${rad.toFixed(3)} radians, distance ${d.toFixed(1)} feet. x, ahead, is ${f2(x)} feet. y, to the left, is ${f2(y)} feet.`}
      >
        {/* the 240 degree field of view */}
        <path d={`M${OX},${OY} L${edge(-120)} A${R},${R} 0 1 0 ${edge(120)} Z`} className="mpolar-fan" />
        {/* axes of the sensor's frame */}
        <line x1={OX - 78} x2={OX + R + 14} y1={OY} y2={OY} className="mpolar-axis" />
        <line x1={OX} x2={OX} y1={OY + R + 4} y2={OY - R - 4} className="mpolar-axis" />
        <text x={OX + R + 16} y={OY + 3} className="fig-label">x: ahead</text>
        <text x={OX + 4} y={OY - R - 6} className="fig-label">y: left</text>
        <text x={OX + 4} y={OY + R + 12} className="fig-label dim">right</text>
        {/* robot, looking along x */}
        <rect x={OX - 26} y={OY - 10} width="26" height="20" rx="4" className="mpolar-robot" />
        {/* the two legs */}
        <line x1={OX} x2={px} y1={OY} y2={OY} className="mpolar-x" />
        <line x1={px} x2={px} y1={OY} y2={py} className="mpolar-y" />
        {/* the beam */}
        <line x1={OX} x2={px} y1={OY} y2={py} className="mpolar-beam" />
        <circle cx={px} cy={py} r="4" className="mpolar-hit" />
        {deg !== 0 && <path d={`M${OX + arcR},${OY} A${arcR},${arcR} 0 0 ${deg > 0 ? 0 : 1} ${arcEnd}`} className="mpolar-arc" />}
        <text x={OX + 30 * Math.cos(rad / 2) + 2} y={OY - 30 * Math.sin(rad / 2) + 3} className="fig-label">{deg}°</text>
        <text x={(OX + px) / 2 - (deg > 0 ? 8 : -8) * s - 4} y={(OY + py) / 2 - 7 * Math.abs(c) - 3} textAnchor="middle" className="fig-value small">d</text>
        {Math.abs(x) > 0.4 && <text x={(OX + px) / 2} y={OY + (x < 0 ? (y >= 0 ? 22 : -15) : y >= 0 ? 12 : -5)} textAnchor="middle" className="fig-label">x</text>}
        {Math.abs(y) > 0.4 && <text x={px + (x >= 0 ? 5 : -5)} y={(OY + py) / 2 + 3} textAnchor={x >= 0 ? "start" : "end"} className="fig-label">y</text>}
        {/* the numbers */}
        <text x="298" y="16" className="fig-label dim">distance d</text>
        <text x="298" y="29" className="fig-value small">{d.toFixed(1)} ft</text>
        <text x="298" y="48" className="fig-label dim">angle</text>
        <text x="298" y="61" className="fig-value small">{deg}° = {rad.toFixed(3)} rad</text>
        <text x="298" y="80" className="fig-label dim">x = d cos(angle)</text>
        <text x="298" y="93" className="fig-value small">{f2(x)} ft</text>
        <text x="298" y="112" className="fig-label dim">y = d sin(angle)</text>
        <text x="298" y="125" className="fig-value small">{f2(y)} ft</text>
      </svg>
      <div className="fig-step" role="status">
        <p>{why}</p>
        <CodePre><code>{`alpha = ${deg}*0.01745329;  // ${rad.toFixed(3)} rad
x = d*cos(alpha);  // ${d.toFixed(1)} * ${f2(c)} = ${f2(x)}
y = d*sin(alpha);  // ${d.toFixed(1)} * ${f2(s)} = ${f2(y)}`}</code></CodePre>
      </div>
      <div className="fig-controls">
        <div>
          <span>Angle</span>
          <label className="mpolar-slider">
            <input type="range" min={-120} max={120} step={5} value={deg} onChange={(e) => setDeg(+e.target.value)} aria-label="Angle of the beam in degrees, positive to the left" />
            <output>{deg}°</output>
          </label>
        </div>
        <div>
          <span>Distance</span>
          <label className="mpolar-slider">
            <input type="range" min={1} max={5} step={0.5} value={d} onChange={(e) => setD(+e.target.value)} aria-label="Measured distance in feet" />
            <output>{d.toFixed(1)} ft</output>
          </label>
        </div>
        <div>
          <span>Try</span>
          {PRESETS.map((p) => (
            <button key={p} className="fig-opt" aria-pressed={deg === p} onClick={() => setDeg(p)}>{p}°</button>
          ))}
        </div>
      </div>
      <figcaption>Seen from above, with the robot looking to the right of the picture. The yellow beam is what the LIDAR measures. The orange leg (x) is how far ahead the point is, the dashed blue leg (y) how far to the left. The shaded fan is the 240° the sensor scans.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "math-polar",
  title: "LIDAR beam: distance and angle to x and y",
  description: "Change the angle and distance of one beam to see how far ahead and how far to the side the point it hits lies.",
  Component: MathPolar,
};
