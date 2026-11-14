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
const R = 5 * PX_PER_FT; // the 5 ft the fan is drawn to
const ARC_R = 16; // the arc that marks the angle
const f2 = (v: number) => (Math.abs(v) < 0.005 ? "0.00" : v.toFixed(2));

// Where the four letters of the drawing (the angle, d, x and y) go. Each has
// a list of places, best first, and takes the first one where no line of the
// drawing and no other label crosses it. The boxes are sized for the largest
// label the wrapper draws (about 11 units), so they hold at every width.
interface Box { l: number; r: number; t: number; b: number }
type Seg = [number, number, number, number];
type Anchor = "start" | "middle" | "end";
interface Spot { x: number; y: number; anchor: Anchor }
const CHAR_W = 6.6;
const boxAt = (p: Spot, chars: number): Box => {
  const w = chars * CHAR_W;
  const l = p.anchor === "start" ? p.x : p.anchor === "middle" ? p.x - w / 2 : p.x - w;
  return { l: l - 1.5, r: l + w + 1.5, t: p.y - 11, b: p.y + 4 };
};
const boxesCross = (a: Box, b: Box) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
/** Does the segment pass through the box? (Liang-Barsky clipping.) */
const segCrosses = ([x1, y1, x2, y2]: Seg, b: Box) => {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const edges: [number, number][] = [[-dx, x1 - b.l], [dx, b.r - x1], [-dy, y1 - b.t], [dy, b.b - y1]];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
};
const arcSegs = (r: number, from: number, to: number): Seg[] => {
  const out: Seg[] = [];
  const n = Math.max(1, Math.ceil(Math.abs(to - from) / 5));
  for (let i = 0; i < n; i++) {
    const a = (from + ((to - from) * i) / n) * RAD_PER_DEG;
    const b = (from + ((to - from) * (i + 1)) / n) * RAD_PER_DEG;
    out.push([OX + r * Math.cos(a), OY - r * Math.sin(a), OX + r * Math.cos(b), OY - r * Math.sin(b)]);
  }
  return out;
};

/** Places for the letters y, x and d and for the angle, for a beam at `deg` degrees and `d` feet. */
function placeLabels(deg: number, d: number) {
  const rad = deg * RAD_PER_DEG;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const x = d * c;
  const y = d * s;
  const px = OX + x * PX_PER_FT;
  const py = OY - y * PX_PER_FT;

  // Everything a label must stay clear of: the lines of the drawing...
  const R120 = 120 * RAD_PER_DEG;
  const segs: Seg[] = [
    [OX - 78, OY, OX + R + 14, OY],
    [OX, OY + R + 4, OX, OY - R - 4],
    [OX, OY, OX + R * Math.cos(R120), OY - R * Math.sin(R120)],
    [OX, OY, OX + R * Math.cos(R120), OY + R * Math.sin(R120)],
    ...arcSegs(R, -120, 120),
    [OX - 26, OY - 10, OX, OY - 10],
    [OX - 26, OY + 10, OX, OY + 10],
    [OX - 26, OY - 10, OX - 26, OY + 10],
    [OX, OY, px, OY],
    [px, OY, px, py],
    [OX, OY, px, py],
    ...(deg !== 0 ? arcSegs(ARC_R, 0, deg) : []),
  ];
  // ...the fixed labels, the numbers on the right, the point the beam hits, and the labels placed so far.
  const taken: Box[] = [
    { l: OX + R + 14, r: 420, t: OY - 10, b: OY + 8 },
    { l: OX + 2, r: OX + 44, t: OY - R - 18, b: OY - R },
    { l: OX + 2, r: OX + 40, t: OY + R, b: 300 },
    { l: 292, r: 420, t: 0, b: 132 },
    { l: px - 4.5, r: px + 4.5, t: py - 4.5, b: py + 4.5 },
  ];
  const place = (chars: number, spots: Spot[], must: boolean): Spot | null => {
    for (const p of spots) {
      const b = boxAt(p, chars);
      if (b.l < 1 || b.r > 419 || b.t < 1 || b.b > 299) continue;
      if (taken.some((o) => boxesCross(o, b)) || segs.some((g) => segCrosses(g, b))) continue;
      taken.push(b);
      return p;
    }
    return must && spots.length ? spots[0] : null;
  };

  // y: beside the dashed leg, outside the triangle, half way up if that is free.
  const yOut = px >= OX - 1e-6 ? 1 : -1;
  const ySpots: Spot[] = [];
  if (Math.abs(y) > 0.4)
    for (const out of [yOut, -yOut])
      for (const f of [0.5, 0.6, 0.4, 0.7, 0.3, 0.85, 1]) ySpots.push({ x: px + out * 6, y: OY + f * (py - OY) + 3.5, anchor: out > 0 ? "start" : "end" });
  // A short leg just left of the y axis has the fan's edge and the robot beside it: then across the axis.
  if (Math.abs(y) > 0.4 && px < OX && px > OX - 14) for (const f of [0.7, 0.85, 1, 1.2]) ySpots.push({ x: OX + 3, y: OY + f * (py - OY) + 3.5, anchor: "start" });
  const yAt = place(1, ySpots, false);

  // x: beside the solid leg, on the side away from the beam if there is room, else inside the triangle.
  const xSpots: Spot[] = [];
  if (Math.abs(x) > 0.4)
    for (const row of y >= 0 ? [13, 25, -6, -16] : [-6, -18, 13, 23])
      for (const f of [0.5, 0.6, 0.4, 0.7, 0.3, 0.8, 0.2, 0.9]) xSpots.push({ x: OX + f * (px - OX), y: OY + row, anchor: "middle" });
  // A short leg that points backwards lies over the robot, between the fan's edges: then just past its end.
  if (x < -0.4) xSpots.push({ x: Math.min(OX + 0.9 * (px - OX), OX - 23), y: OY + (y >= 0 ? 25 : -18), anchor: "middle" });
  const xAt = place(1, xSpots, false);

  // d: beside the beam, first on the side away from the two legs.
  const dSide = Math.abs(c) < 1e-9 ? (s > 0 ? 1 : -1) : s * c < 0 ? -1 : 1;
  const dSpots: Spot[] = [];
  for (const off of [10, 15])
    for (const side of [dSide, -dSide])
      for (const f of [0.5, 0.65, 0.35, 0.8, 0.2]) dSpots.push({ x: OX + f * (px - OX) + side * -s * off, y: OY + f * (py - OY) + side * -c * off + 3.5, anchor: "middle" });
  // Last, around the point the beam hits.
  for (const far of [14, 20])
    for (const turn of [0, 45, -45, 90, -90, 135, -135]) {
      const a = rad + turn * RAD_PER_DEG;
      dSpots.push({ x: px + Math.cos(a) * far, y: py - Math.sin(a) * far + 3.5, anchor: "middle" });
    }
  const dAt = place(1, dSpots, true)!;

  // The angle: on the bisector just outside the arc. A narrow angle has no
  // room there, so its label goes beside the corner, across the x axis.
  const degChars = String(deg).length + 0.6;
  const degSpots: Spot[] = [];
  for (const r of [30, 36, 44, 54]) degSpots.push({ x: OX + r * Math.cos(rad / 2) + 2, y: OY - r * Math.sin(rad / 2) + 3, anchor: "start" });
  for (const row of deg >= 0 ? [13, 25, 37] : [-6, -18, -30]) degSpots.push({ x: OX + 3, y: OY + row, anchor: "start" });
  const degAt = place(degChars, degSpots, true)!;
  return { yAt, xAt, dAt, degAt };
}

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
  const edge = (a: number) => `${OX + R * Math.cos(a * RAD_PER_DEG)},${OY - R * Math.sin(a * RAD_PER_DEG)}`;
  const arcEnd = `${OX + ARC_R * c},${OY - ARC_R * s}`;

  const { yAt, xAt, dAt, degAt } = placeLabels(deg, d);

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
        .mpolar-fan { fill: var(--accent-soft); stroke: var(--control); stroke-dasharray: 4 3; }
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
        {deg !== 0 && <path d={`M${OX + ARC_R},${OY} A${ARC_R},${ARC_R} 0 0 ${deg > 0 ? 0 : 1} ${arcEnd}`} className="mpolar-arc" />}
        <text x={degAt.x} y={degAt.y} textAnchor={degAt.anchor} className="fig-label">{deg}°</text>
        <text x={dAt.x} y={dAt.y} textAnchor={dAt.anchor} className="fig-value small">d</text>
        {xAt && <text x={xAt.x} y={xAt.y} textAnchor={xAt.anchor} className="fig-label">x</text>}
        {yAt && <text x={yAt.x} y={yAt.y} textAnchor={yAt.anchor} className="fig-label">y</text>}
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
            <input type="range" min={-120} max={120} step={5} value={deg} onChange={(e) => setDeg(+e.target.value)} aria-label="Angle of the beam in degrees, positive to the left" aria-valuetext={`${deg} degrees`} />
            <output>{deg}°</output>
          </label>
        </div>
        <div>
          <span>Distance</span>
          <label className="mpolar-slider">
            <input type="range" min={1} max={5} step={0.5} value={d} onChange={(e) => setD(+e.target.value)} aria-label="Measured distance in feet" aria-valuetext={`${d.toFixed(1)} feet`} />
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
