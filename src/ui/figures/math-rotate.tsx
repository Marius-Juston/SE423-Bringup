import { useState } from "react";
import { CodePre } from "../CopyButton";

// Maths you need: rotating a point, and the 2 x 2 rotation matrix as
// shorthand for the two lines. Not a chip peripheral: no TRM section
// applies. Formulas of Lecture 15 and HW4:
//   x' = x cos(theta) - y sin(theta),  y' = x sin(theta) + y cos(theta).

const CX = 136;
const CY = 124;
const S = 44; // px per unit
const fmt = (v: number, d = 2) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);

function MathRotate() {
  const [x, setX] = useState(2);
  const [y, setY] = useState(1);
  const [deg, setDeg] = useState(30);
  const [matrix, setMatrix] = useState(false);

  const th = (deg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const ax = { x: x * c, y: x * s }; // the "ahead" leg after the turn
  const ly = { x: -y * s, y: y * c }; // the "left" leg after the turn
  const p = { x: ax.x + ly.x, y: ax.y + ly.y };
  const px = (v: number) => CX + v * S;
  const py = (v: number) => CY - v * S;
  const why =
    deg === 0
      ? "Angle 0: nothing turns. cos 0 = 1 and sin 0 = 0, so the formulas give back x and y unchanged. Move the angle slider."
      : `Turn the two legs by ${deg} degrees, then walk them one after the other. The blue leg (${fmt(x, 1)} long) now reaches ${fmt(ax.x)} across and ${fmt(ax.y)} up. The orange leg (${fmt(Math.abs(y), 1)} long) points a quarter turn further ${y < 0 ? "right" : "left"}, so it reaches ${fmt(ly.x)} across and ${fmt(ly.y)} up. Add them: (${fmt(p.x)}, ${fmt(p.y)}).`;

  return (
    <figure className="figure mr-fig" aria-label="Interactive figure: rotating a point by turning its two legs">
      <style>{`.mr-fig .mr-range{flex:1;min-width:110px;accent-color:var(--orange)}.mr-fig .mr-axis{stroke:var(--dim);stroke-width:1}.mr-fig .mr-grid{stroke:var(--border);stroke-width:1}.mr-fig .mr-old{stroke:var(--dim);stroke-width:1.4;stroke-dasharray:4 3;fill:none}.mr-fig .mr-a{stroke:var(--arches);stroke-width:3}.mr-fig .mr-l{stroke:var(--orange);stroke-width:3}.mr-fig .mr-arc{fill:none;stroke:var(--harvest);stroke-width:1.6}.mr-fig .mr-num{font-family:var(--mono);font-size:0.82rem;min-width:4.6rem;text-align:right}`}</style>
      <svg viewBox="0 0 400 246" role="img" aria-label={`The point ${fmt(x, 1)}, ${fmt(y, 1)} rotated by ${deg} degrees lands at ${fmt(p.x)}, ${fmt(p.y)}.`}>
        {[-2, -1, 1, 2].map((g) => (
          <g key={g}>
            <line x1={px(g)} x2={px(g)} y1={py(2.6)} y2={py(-2.6)} className="mr-grid" />
            <line x1={px(-2.9)} x2={px(2.9)} y1={py(g)} y2={py(g)} className="mr-grid" />
          </g>
        ))}
        <line x1={px(-2.9)} x2={px(2.9)} y1={CY} y2={CY} className="mr-axis" />
        <line x1={CX} x2={CX} y1={py(2.6)} y2={py(-2.6)} className="mr-axis" />
        <text x={px(2.9)} y={CY + 11} textAnchor="end" className="fig-label dim">x</text>
        <text x={CX + 4} y={py(2.6) + 8} className="fig-label dim">y</text>
        {/* before the turn */}
        <path d={`M${CX},${CY} L${px(x)},${CY} L${px(x)},${py(y)}`} className="mr-old" />
        <circle cx={px(x)} cy={py(y)} r={3.5} style={{ fill: "var(--dim)" }} />
        {deg !== 0 && <text x={px(x) + 6} y={py(y) + (y >= 0 ? -5 : 12)} className="fig-label dim">before</text>}
        {/* after the turn */}
        <line x1={CX} y1={CY} x2={px(ax.x)} y2={py(ax.y)} className="mr-a" />
        <line x1={px(ax.x)} y1={py(ax.y)} x2={px(p.x)} y2={py(p.y)} className="mr-l" />
        {deg !== 0 && <path d={`M${CX + 18},${CY} A18,18 0 0 ${deg > 0 ? 0 : 1} ${(CX + 18 * c).toFixed(1)},${(CY - 18 * s).toFixed(1)}`} className="mr-arc" />}
        <circle cx={px(p.x)} cy={py(p.y)} r={4.5} style={{ fill: "var(--text)" }} />
        <text x={px(p.x) > 222 ? px(p.x) - 7 : px(p.x) + 7} y={py(p.y) - 6} textAnchor={px(p.x) > 222 ? "end" : "start"} className="fig-label">{deg === 0 ? "before = after" : "after"}</text>
        <circle cx={CX} cy={CY} r={2.5} className="fig-dot" />

        <text x={272} y={14} className="fig-label">cos = <tspan className="fig-value small">{fmt(c, 3)}</tspan></text>
        <text x={272} y={27} className="fig-label">sin = <tspan className="fig-value small">{fmt(s, 3)}</tspan></text>
        <text x={272} y={48} className="fig-label">new x = x cos - y sin</text>
        <text x={272} y={62} className="fig-value small">{fmt(x, 1)} x {c < 0 ? `(${fmt(c, 3)})` : fmt(c, 3)}</text>
        <text x={272} y={75} className="fig-value small">- {y < 0 ? `(${fmt(y, 1)})` : fmt(y, 1)} x {s < 0 ? `(${fmt(s, 3)})` : fmt(s, 3)}</text>
        <text x={272} y={91} className="fig-value">= {fmt(p.x)}</text>
        <text x={272} y={122} className="fig-label">new y = x sin + y cos</text>
        <text x={272} y={136} className="fig-value small">{fmt(x, 1)} x {s < 0 ? `(${fmt(s, 3)})` : fmt(s, 3)}</text>
        <text x={272} y={149} className="fig-value small">+ {y < 0 ? `(${fmt(y, 1)})` : fmt(y, 1)} x {c < 0 ? `(${fmt(c, 3)})` : fmt(c, 3)}</text>
        <text x={272} y={165} className="fig-value">= {fmt(p.y)}</text>
        <text x={272} y={196} className="fig-label dim">blue: the x leg, turned</text>
        <text x={272} y={210} className="fig-label dim">orange: the y leg, turned</text>
        <text x={272} y={224} className="fig-label dim">dashed: before the turn</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Angle</span>
          <input className="mr-range" type="range" aria-label="Rotation angle in degrees" min={-180} max={180} step={15} value={deg} onChange={(e) => setDeg(+e.target.value)} />
          <span className="mr-num">{deg} deg</span>
        </div>
        <div>
          <span>x</span>
          <input className="mr-range" type="range" aria-label="x of the point before the turn" min={0} max={2} step={0.1} value={x} onChange={(e) => setX(+e.target.value)} />
          <span className="mr-num">{fmt(x, 1)}</span>
        </div>
        <div>
          <span>y</span>
          <input className="mr-range" type="range" aria-label="y of the point before the turn" min={-1.5} max={1.5} step={0.1} value={y} onChange={(e) => setY(+e.target.value)} />
          <span className="mr-num">{fmt(y, 1)}</span>
        </div>
        <div>
          <span>Write it as</span>
          <button className="fig-opt" aria-pressed={!matrix} onClick={() => setMatrix(false)}>two lines of C</button>
          <button className="fig-opt" aria-pressed={matrix} onClick={() => setMatrix(true)}>a matrix</button>
        </div>
      </div>
      <div className="fig-step">
        {matrix ? (
          <CodePre><code>{`[xn]   [${fmt(c).padStart(5)} ${fmt(-s).padStart(5)}] [${fmt(x, 1).padStart(4)}]   [${fmt(p.x).padStart(5)}]\n[yn] = [${fmt(s).padStart(5)} ${fmt(c).padStart(5)}] [${fmt(y, 1).padStart(4)}] = [${fmt(p.y).padStart(5)}]\n\nrow 1: ${fmt(c)} x ${fmt(x, 1)} + ${fmt(-s)} x ${fmt(y, 1)} = ${fmt(p.x)}\nrow 2: ${fmt(s)} x ${fmt(x, 1)} + ${fmt(c)} x ${fmt(y, 1)} = ${fmt(p.y)}`}</code></CodePre>
        ) : (
          <CodePre><code>{`// th = ${fmt(th, 3)} rad\nxn = x * cos(th) - y * sin(th);  // ${fmt(p.x)}\nyn = x * sin(th) + y * cos(th);  // ${fmt(p.y)}`}</code></CodePre>
        )}
      </div>
      <figcaption>A point is "x across, then y up". Turning the point turns both legs by the same angle. The matrix is the same two lines written as a table: each row is multiplied by (x, y), entry by entry, and added.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "math-rotate",
  title: "Rotating a point",
  description: "Turn a point by an angle and move it to see where it lands and the two lines of arithmetic that take it there.",
  Component: MathRotate,
};
