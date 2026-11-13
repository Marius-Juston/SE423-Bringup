import { useRef, useState } from "react";
import { FRONT_STEP, G_CLUSTER, G_START, LIDAR_POINTS, MIN_MM, ROOMS, STEP_DEG, castRay, pointDeg, reading } from "../../sim/plugins/lidar";

// The scan of the Hokuyo URG-04LX as the course asks for it (lectures 14 and
// 16, HW4): command G04472503, steps 44 to 725 in groups of 3, 228 points,
// angle of point i = (3 i + 44) x 0.3515625 - 135 degrees, 0 straight ahead,
// positive to the left. All numbers come from the simulator's LIDAR model
// (src/sim/plugins/lidar.ts).
const CX = 210;
const CY = 158;
const R = 116;
const MARKS = [
  { i: 28, name: "right" },
  { i: 113, name: "ahead" },
  { i: 199, name: "left" },
];
const ROOM = ROOMS[3]; // 10 ft box with a 1 ft obstacle
const FT_SCALE = R / 7.3; // px per foot in the room picture
const rad = (deg: number) => (deg * Math.PI) / 180;
/** Screen point at `deg` (0 = up = ahead, positive = left) and radius r. */
const at = (deg: number, r: number): [number, number] => [CX - r * Math.sin(rad(deg)), CY - r * Math.cos(rad(deg))];
const f1 = (v: number) => v.toFixed(1);
const signed = (deg: number, digits = 2) => `${deg < 0 ? "−" : "+"}${Math.abs(deg).toFixed(digits)}°`;

function LidarFan() {
  const [i, setI] = useState(28);
  const [room, setRoom] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const deg = pointDeg(i);
  const step = G_CLUSTER * i + G_START;
  const [sx, sy, sth] = ROOM.start;
  // Reading of every point in the room (mm, or an error code below 20).
  const mm = Array.from({ length: LIDAR_POINTS }, (_, k) => reading(castRay(ROOM, sx, sy, sth + rad(pointDeg(k)))));
  const len = (k: number) => (room ? (mm[k] >= MIN_MM ? (mm[k] / 304.8) * FT_SCALE : R) : R);
  let rays = "";
  for (let k = 0; k < LIDAR_POINTS; k++) {
    const [x, y] = at(pointDeg(k), len(k));
    rays += `M${CX},${CY}L${f1(x)},${f1(y)}`;
  }
  const [tx, ty] = at(deg, len(i));
  const side = Math.abs(deg) < 0.6 ? "straight ahead" : deg < 0 ? "to the right" : "to the left";
  // World (feet) to screen for the room: the robot looks along +x, drawn upwards.
  const w = (x: number, y: number): [number, number] => [CX - (y - sy) * FT_SCALE, CY - (x - sx) * FT_SCALE];
  const pick = (e: React.PointerEvent) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((e.clientX - box.left) / box.width) * 420;
    const py = ((e.clientY - box.top) / box.height) * 250;
    const a = (Math.atan2(CX - px, CY - py) * 180) / Math.PI;
    const k = Math.round(((a + 135) / STEP_DEG - G_START) / G_CLUSTER);
    setI(Math.max(0, Math.min(LIDAR_POINTS - 1, k)));
  };
  const [bl] = [at(120, R * 0.5)];
  const [br] = [at(-120, R * 0.5)];
  return (
    <figure className="figure lfan" aria-label="Interactive top view of the LIDAR scan: 228 points over 240 degrees">
      <style>{`
        .lfan-slider { display: flex; align-items: center; gap: 0.5rem; flex: 1 1 12rem; }
        .lfan-slider input { flex: 1; min-width: 6rem; accent-color: var(--orange); }
        .lfan-slider output { font-family: var(--mono); color: var(--harvest); font-weight: 700; min-width: 3.6rem; }
        .lfan svg { touch-action: none; cursor: crosshair; }
        .lfan-rays { stroke: var(--arches); stroke-width: 0.5; opacity: 0.55; fill: none; }
        .lfan-pick { stroke: var(--orange); stroke-width: 2.4; }
        .lfan-tip { fill: var(--orange); }
        .lfan-mark { stroke: var(--text); stroke-width: 1.1; stroke-dasharray: 3 2; }
        .lfan-blind { fill: none; stroke: var(--dim); stroke-width: 1.2; stroke-dasharray: 4 3; }
        .lfan-wall { stroke: var(--text); stroke-width: 2; fill: none; }
        .lfan-robot { fill: var(--surface); stroke: var(--text); stroke-width: 1.4; }
        .lfan-nose { fill: var(--text); }
        .lfan pre { font-size: 0.76rem; white-space: pre-wrap; overflow-wrap: anywhere; }
      `}</style>
      <svg
        ref={svg}
        viewBox="0 0 420 250"
        role="img"
        aria-label={`Point ${i} of 228 is step ${step} and looks ${Math.abs(deg).toFixed(2)} degrees ${side}.${room ? ` It measures ${mm[i] >= MIN_MM ? `${mm[i]} millimetres` : "nothing in range"}.` : ""} The 120 degrees behind the robot are not scanned.`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pick(e);
        }}
        onPointerMove={(e) => e.buttons > 0 && pick(e)}
      >
        <path d={rays} className="lfan-rays" />
        {room && ROOM.walls.map(([x1, y1, x2, y2], k) => {
          const [ax, ay] = w(x1, y1);
          const [bx, by] = w(x2, y2);
          return <line key={k} x1={ax} y1={ay} x2={bx} y2={by} className="lfan-wall" />;
        })}
        {/* blind sector */}
        <path d={`M${CX},${CY} L${f1(bl[0])},${f1(bl[1])} A${R * 0.5},${R * 0.5} 0 0 0 ${f1(br[0])},${f1(br[1])} Z`} className="lfan-blind" />
        <text x={CX} y={CY + 34} textAnchor="middle" className="fig-label dim">blind: 120°</text>
        <text x={CX} y={CY + 45} textAnchor="middle" className="fig-label dim">behind</text>
        {/* fixed directions */}
        {MARKS.map((m) => {
          const [x, y] = at(pointDeg(m.i), room ? len(m.i) : R + 4);
          return <line key={m.i} x1={CX} y1={CY} x2={x} y2={y} className="lfan-mark" />;
        })}
        <text x={CX} y="14" textAnchor="middle" className="fig-label">i = 113: ahead</text>
        <text x={CX} y="25" textAnchor="middle" className="fig-label dim">{signed(pointDeg(113))}</text>
        <text x={CX + R + 10} y={CY - 2} className="fig-label">i = 28: right</text>
        <text x={CX + R + 10} y={CY + 9} className="fig-label dim">{signed(pointDeg(28))}</text>
        <text x={CX - R - 10} y={CY - 2} textAnchor="end" className="fig-label">i = 199: left</text>
        <text x={CX - R - 10} y={CY + 9} textAnchor="end" className="fig-label dim">{signed(pointDeg(199))}</text>
        <text x={CX + R * 0.87 + 8} y={CY + R * 0.5 + 14} className="fig-label dim">i = 0</text>
        <text x={CX + R * 0.87 + 8} y={CY + R * 0.5 + 25} className="fig-label dim">{signed(pointDeg(0))}</text>
        <text x={CX - R * 0.87 - 8} y={CY + R * 0.5 + 14} textAnchor="end" className="fig-label dim">i = 227</text>
        <text x={CX - R * 0.87 - 8} y={CY + R * 0.5 + 25} textAnchor="end" className="fig-label dim">{signed(pointDeg(LIDAR_POINTS - 1))}</text>
        {/* the chosen point */}
        <line x1={CX} y1={CY} x2={tx} y2={ty} className="lfan-pick" />
        <circle cx={tx} cy={ty} r="3.2" className="lfan-tip" />
        {/* robot */}
        <circle cx={CX} cy={CY} r="9" className="lfan-robot" />
        <path d={`M${CX},${CY - 7} L${CX - 4},${CY + 2} L${CX + 4},${CY + 2} Z`} className="lfan-nose" />
        {/* readout */}
        <text x="6" y="14" className="fig-label dim">point</text>
        <text x="44" y="14" className="fig-value small">i = {i}</text>
        <text x="6" y="26" className="fig-label dim">step</text>
        <text x="44" y="26" className="fig-value small">{step}</text>
        <text x="6" y="38" className="fig-label dim">angle</text>
        <text x="44" y="38" className="fig-value small">{signed(deg)}</text>
        {room && (
          <>
            <text x="6" y="50" className="fig-label dim">reads</text>
            <text x="44" y="50" className="fig-value small">{mm[i] >= MIN_MM ? `${mm[i]} mm` : "no echo"}</text>
          </>
        )}
        <text x="414" y="14" textAnchor="end" className="fig-label dim">seen from above</text>
        <text x="414" y="25" textAnchor="end" className="fig-label dim">− right, + left</text>
      </svg>
      <div className="fig-step" role="status">
        <p>
          Point <strong>{i}</strong> is step 3 × {i} + 44 = <strong>{step}</strong> of the mirror. Step {FRONT_STEP} looks straight ahead, so this point looks {Math.abs(deg) < 0.6 ? "almost straight ahead: " : ""}<strong>{Math.abs(deg).toFixed(2)}°</strong> {deg < 0 ? "to the right (a negative angle)" : "to the left (a positive angle)"}.
          {room ? (mm[i] >= MIN_MM ? ` In this room it hits something ${mm[i]} mm (${(mm[i] / 304.8).toFixed(2)} ft) away.` : " Nothing is within 4095 mm in this direction.") : ""}
          {i === 113 ? " No point looks exactly ahead: 113 is the closest." : ""}
        </p>
        <pre><code>{`angle = (3*${i} + 44)*0.3515625 - 135;  // ${deg.toFixed(2)}`}</code></pre>
      </div>
      <div className="fig-controls">
        <div>
          <span>Point i</span>
          <label className="lfan-slider">
            <input type="range" min={0} max={LIDAR_POINTS - 1} step={1} value={i} onChange={(e) => setI(+e.target.value)} aria-label="Index of the point in the scan, 0 to 227" />
            <output>i = {i}</output>
          </label>
        </div>
        <div>
          <span>Jump to</span>
          <button className="fig-opt" aria-pressed={i === 0} onClick={() => setI(0)}>first 0</button>
          {MARKS.map((m) => (
            <button key={m.i} className="fig-opt" aria-pressed={i === m.i} onClick={() => setI(m.i)}>{m.name} {m.i}</button>
          ))}
          <button className="fig-opt" aria-pressed={i === LIDAR_POINTS - 1} onClick={() => setI(LIDAR_POINTS - 1)}>last {LIDAR_POINTS - 1}</button>
        </div>
        <div>
          <span>Rays</span>
          <button className="fig-opt" aria-pressed={!room} onClick={() => setRoom(false)}>directions only</button>
          <button className="fig-opt" aria-pressed={room} onClick={() => setRoom(true)}>in a room</button>
        </div>
      </div>
      <figcaption>One scan seen from above: 228 points, 1.05° apart, counted from the far right (i = 0) round to the far left (i = 227). Nothing is measured in the 120° behind the robot. Pick a point with the slider (with the keyboard: Tab to it, then the arrow keys), with the Jump buttons, or by dragging in the picture.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "lidar-fan",
  title: "LIDAR scan: which point looks where",
  description: "Pick one of the 228 points of a scan and see which direction it looks in, the angle the code computes for it and what it measures in a room.",
  Component: LidarFan,
};
