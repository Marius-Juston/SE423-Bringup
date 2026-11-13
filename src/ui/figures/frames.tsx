import { useRef, useState } from "react";

// World frame and robot (body) frame, Lecture 15 and HW4: body x straight
// ahead, body y to the robot's left, heading counter-clockwise from the
// world x axis (the conventions of src/sim/plugins/plant.ts).
// Not a chip peripheral, so no TRM section applies.

const S = 46; // px per ft
const OX = 46;
const OY = 262;
const wx = (x: number) => OX + x * S;
const wy = (y: number) => OY - y * S;
const fmt = (v: number, d = 2) => {
  const s = v.toFixed(d);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
};
const par = (v: number) => (fmt(v).startsWith("-") ? `(${fmt(v)})` : fmt(v));
// The robot stays one foot inside the drawing, so its axes are never cut off.
const X_MIN = 1;
const Y_MIN = 1;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function Frames() {
  const [pose, setPose] = useState({ x: 2, y: 1, deg: 30 });
  // The point is stored in both frames; the mode says which one stays put when the robot moves.
  const [body, setBody] = useState({ x: 2, y: 1 });
  const [world, setWorld] = useState<{ x: number; y: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const th = (pose.deg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const toWorld = (b: { x: number; y: number }, p = pose) => {
    const t = (p.deg * Math.PI) / 180;
    return { x: b.x * Math.cos(t) - b.y * Math.sin(t) + p.x, y: b.x * Math.sin(t) + b.y * Math.cos(t) + p.y };
  };
  const inverse = world !== null;
  const pw = world ?? toWorld(body);
  const dx = pw.x - pose.x;
  const dy = pw.y - pose.y;
  const pb = inverse ? { x: dx * c + dy * s, y: -dx * s + dy * c } : body;

  const at = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const k = 420 / r.width;
    return { x: ((e.clientX - r.left) * k - OX) / S, y: (OY - (e.clientY - r.top) * k) / S };
  };
  const round = (v: number) => Math.round(v * 10) / 10;

  // corner of the path "xb ahead, then yb to the left"
  const knee = { x: pose.x + pb.x * c, y: pose.y + pb.x * s };
  const arrow = (x0: number, y0: number, x1: number, y1: number, cls: string, id: string) => <path d={`M${wx(x0)},${wy(y0)} L${wx(x1)},${wy(y1)}`} className={cls} markerEnd={`url(#${id})`} />;
  const where = (x: number, y: number, d: number) =>
    Math.abs(x) < 0.005 && Math.abs(y) < 0.005
      ? "at the robot's centre"
      : `${fmt(Math.abs(x), d)} ft ${x >= 0 ? "ahead" : "behind"} and ${Math.abs(y) < 0.005 ? "neither left nor right" : `${fmt(Math.abs(y), d)} ft to its ${y > 0 ? "left" : "right"}`}`;
  const near = (v: number, tick: number) => Math.abs(v - tick) < 0.5;
  const outside = pw.x < -0.9 || pw.x > 8 || pw.y < -0.5 || pw.y > 5.6;

  return (
    <figure className="figure fr-fig" aria-label="Interactive drawing of the world frame, the robot frame and a point in both">
      <style>{`.fr-fig .fr-range{flex:1;min-width:70px;accent-color:var(--orange)}.fr-fig .fr-lab{flex:1;display:flex;align-items:center;gap:.3rem;color:var(--dim);font-size:.82rem;min-width:110px}.fr-fig .fr-grid{stroke:var(--border);stroke-width:1}.fr-fig .fr-w{stroke:var(--arches);stroke-width:2;fill:none}.fr-fig .fr-b{stroke:var(--orange);stroke-width:2;fill:none}.fr-fig .fr-wd{stroke:var(--arches);stroke-width:1.2;fill:none;stroke-dasharray:3 3}.fr-fig .fr-bd{stroke:var(--orange);stroke-width:1.6;fill:none;stroke-dasharray:5 3}.fr-fig .fr-t{stroke:var(--dim);stroke-width:1.2;fill:none;stroke-dasharray:2 3}.fr-fig .fr-robot{cursor:grab;touch-action:none}.fr-fig .fr-wt{fill:var(--arches)}.fr-fig .fr-bt{fill:var(--orange)}.fr-fig .fr-eq{white-space:pre}.fr-fig .fr-halo{paint-order:stroke;stroke:var(--inset);stroke-width:3px;stroke-linejoin:round}.fr-fig .fr-num{width:4.6rem;white-space:nowrap;text-align:right;font-family:var(--mono);font-size:.8rem;color:var(--harvest)}`}</style>
      <svg ref={svg} viewBox="0 0 420 290" role="img" aria-label={`Robot at ${fmt(pose.x, 1)}, ${fmt(pose.y, 1)} feet, heading ${pose.deg} degrees. Point: ${fmt(pb.x)} ahead and ${fmt(pb.y)} to the left in the robot frame, ${fmt(pw.x)}, ${fmt(pw.y)} in the world frame.`}>
        <defs>
          {[
            ["fr-aw", "fr-wt"],
            ["fr-ab", "fr-bt"],
          ].map(([id, cls]) => (
            <marker key={id} id={id} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0 0 L8 4 L0 8 Z" className={cls} />
            </marker>
          ))}
        </defs>
        {Array.from({ length: 9 }, (_, i) => (
          <line key={`v${i}`} x1={wx(i)} x2={wx(i)} y1={wy(0)} y2={wy(5.5)} className="fr-grid" />
        ))}
        {Array.from({ length: 6 }, (_, i) => (
          <line key={`h${i}`} x1={wx(0)} x2={wx(8)} y1={wy(i)} y2={wy(i)} className="fr-grid" />
        ))}
        {[2, 4, 6].map((i) => !near(pw.x, i) && (
          <text key={i} x={wx(i)} y={OY + 11} textAnchor="middle" className="fig-label dim">{i}</text>
        ))}
        {[2, 4].map((i) => !near(pw.y, i) && (
          <text key={i} x={OX - 5} y={wy(i) + 3} textAnchor="end" className="fig-label dim">{i}</text>
        ))}
        {/* world frame */}
        {arrow(0, 0, 7.9, 0, "fr-w", "fr-aw")}
        {arrow(0, 0, 0, 5.45, "fr-w", "fr-aw")}
        <text x={wx(7.9)} y={OY + 22} textAnchor="end" className="fig-label fr-wt">world x, ft</text>
        <text x={OX + 5} y={wy(5.4) + 4} className="fig-label fr-wt">world y</text>
        {/* T: where the robot is */}
        <path d={`M${wx(0)},${wy(0)} L${wx(pose.x)},${wy(pose.y)}`} className="fr-t" />
        <text x={wx(pose.x / 2) + 4} y={wy(pose.y / 2) + 11} className="fig-label dim fr-halo">T</text>
        {/* world coordinates of the point */}
        <path d={`M${wx(pw.x)},${wy(pw.y)} V${wy(0)}`} className="fr-wd" />
        <path d={`M${wx(pw.x)},${wy(pw.y)} H${wx(0)}`} className="fr-wd" />
        <text x={clamp(wx(pw.x), 14, 406)} y={OY + 11} textAnchor="middle" className="fig-value small fr-halo">{fmt(pw.x)}</text>
        <text x={OX - 5} y={clamp(wy(pw.y), 6, 284) + 3} textAnchor="end" className="fig-value small fr-halo">{fmt(pw.y)}</text>
        {/* robot coordinates of the point: ahead, then left */}
        <path d={`M${wx(pose.x)},${wy(pose.y)} L${wx(knee.x)},${wy(knee.y)} L${wx(pw.x)},${wy(pw.y)}`} className="fr-bd" />
        {Math.abs(pb.x) >= 0.45 && <text x={wx((pose.x + knee.x) / 2) + 11 * s} y={wy((pose.y + knee.y) / 2) + 11 * c + 3} textAnchor="middle" className="fig-value small fr-halo">{fmt(pb.x)}</text>}
        {Math.abs(pb.y) >= 0.45 && <text x={wx((knee.x + pw.x) / 2) + 14 * c * Math.sign(pb.x || 1)} y={wy((knee.y + pw.y) / 2) - 14 * s * Math.sign(pb.x || 1) + 3} textAnchor="middle" className="fig-value small fr-halo">{fmt(pb.y)}</text>}
        {/* robot */}
        <g
          className="fr-robot"
          transform={`translate(${wx(pose.x)},${wy(pose.y)}) rotate(${-pose.deg})`}
          onPointerDown={(e) => {
            const p = at(e);
            drag.current = { dx: pose.x - p.x, dy: pose.y - p.y };
            (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const p = at(e);
            setPose({ ...pose, x: clamp(round(p.x + drag.current.dx), X_MIN, 6), y: clamp(round(p.y + drag.current.dy), Y_MIN, 4) });
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          <rect x={-13} y={-13} width={30} height={26} rx={5} className="fig-box active" />
          <rect x={-8} y={-17} width={16} height={5} rx={2} className="fig-dot" />
          <rect x={-8} y={12} width={16} height={5} rx={2} className="fig-dot" />
          <path d="M0 0 H38" className="fr-b" markerEnd="url(#fr-ab)" />
          <path d="M0 0 V-34" className="fr-b" markerEnd="url(#fr-ab)" />
        </g>
        <text x={wx(pose.x) + 36 * c - 9 * s} y={wy(pose.y) - 36 * s - 9 * c + 3} textAnchor="middle" className="fig-label fr-bt">x</text>
        <text x={wx(pose.x) - 32 * s - 9 * c} y={wy(pose.y) - 32 * c + 9 * s + 3} textAnchor="middle" className="fig-label fr-bt">y</text>
        {/* the point */}
        <circle cx={wx(pw.x)} cy={wy(pw.y)} r={4.5} fill="var(--harvest)" stroke="var(--inset)" strokeWidth={1} />
        <text x={wx(pw.x) + 7} y={wy(pw.y) - 6} className="fig-label fr-halo">P</text>
      </svg>
      <div className="fig-why" role="status">
        {inverse
          ? `P stays in the room at (${fmt(pw.x)}, ${fmt(pw.y)}). Seen from the robot it is ${where(pb.x, pb.y, 2)}. Move or turn the robot: only these robot-frame numbers change.${outside ? " P is outside the drawing." : ""}`
          : `P rides on the robot: it is ${where(body.x, body.y, 1)}. Move or turn the robot: only P's world coordinates change. They are now (${fmt(pw.x)}, ${fmt(pw.y)}).${outside ? " That is outside the drawing." : ""}`}
      </div>
      <div className="fig-controls">
        <div>
          <span>Robot at</span>
          <label className="fr-lab">x <input className="fr-range" type="range" aria-label="Robot x in feet" min={X_MIN} max={6} step={0.1} value={pose.x} onChange={(e) => setPose({ ...pose, x: +e.target.value })} /></label>
          <label className="fr-lab">y <input className="fr-range" type="range" aria-label="Robot y in feet" min={Y_MIN} max={4} step={0.1} value={pose.y} onChange={(e) => setPose({ ...pose, y: +e.target.value })} /></label>
          <span className="fr-num">{fmt(pose.x, 1)}, {fmt(pose.y, 1)}</span>
        </div>
        <div>
          <span>Heading</span>
          <input className="fr-range" type="range" aria-label="Robot heading in degrees" min={-180} max={180} step={15} value={pose.deg} onChange={(e) => setPose({ ...pose, deg: +e.target.value })} />
          <span className="fr-num">{pose.deg}°</span>
        </div>
        <div>
          <span>Point P</span>
          <button
            className="fig-opt"
            aria-pressed={!inverse}
            onClick={() => {
              if (inverse) setBody({ x: round(pb.x), y: round(pb.y) });
              setWorld(null);
            }}
          >
            rides on the robot
          </button>
          <button className="fig-opt" aria-pressed={inverse} onClick={() => setWorld({ x: round(pw.x), y: round(pw.y) })}>stays in the room</button>
        </div>
        {inverse ? (
          <div>
            <span>P in world</span>
            <label className="fr-lab">x <input className="fr-range" type="range" aria-label="Point world x" min={0} max={7.5} step={0.1} value={pw.x} onChange={(e) => setWorld({ x: +e.target.value, y: pw.y })} /></label>
            <label className="fr-lab">y <input className="fr-range" type="range" aria-label="Point world y" min={0} max={5} step={0.1} value={pw.y} onChange={(e) => setWorld({ x: pw.x, y: +e.target.value })} /></label>
            <span className="fr-num">{fmt(pw.x, 1)}, {fmt(pw.y, 1)}</span>
          </div>
        ) : (
          <div>
            <span>P in robot</span>
            <label className="fr-lab">ahead <input className="fr-range" type="range" aria-label="Point ahead of the robot" min={-1} max={3} step={0.1} value={body.x} onChange={(e) => setBody({ ...body, x: +e.target.value })} /></label>
            <label className="fr-lab">left <input className="fr-range" type="range" aria-label="Point to the left of the robot" min={-2} max={2} step={0.1} value={body.y} onChange={(e) => setBody({ ...body, y: +e.target.value })} /></label>
            <span className="fr-num">{fmt(body.x, 1)}, {fmt(body.y, 1)}</span>
          </div>
        )}
      </div>
      <div className="fig-step">
        <strong>{inverse ? "World to robot: subtract T, then rotate back" : "Robot to world: rotate by the heading, then add T"}</strong>
        <pre><code className="fr-eq">{inverse
          ? `dx = ${fmt(pw.x)} - ${fmt(pose.x)} = ${fmt(dx)}\ndy = ${fmt(pw.y)} - ${fmt(pose.y)} = ${fmt(dy)}\nx_robot = dx cos(${pose.deg}°) + dy sin(${pose.deg}°)\n  = ${par(dx)}*${par(c)} + ${par(dy)}*${par(s)} = ${fmt(pb.x)}\ny_robot = -dx sin(${pose.deg}°) + dy cos(${pose.deg}°)\n  = -${par(dx)}*${par(s)} + ${par(dy)}*${par(c)} = ${fmt(pb.y)}`
          : `x_world = x cos(${pose.deg}°) - y sin(${pose.deg}°) + Tx\n  = ${par(pb.x)}*${par(c)} - ${par(pb.y)}*${par(s)} + ${fmt(pose.x)} = ${fmt(pw.x)}\ny_world = x sin(${pose.deg}°) + y cos(${pose.deg}°) + Ty\n  = ${par(pb.x)}*${par(s)} + ${par(pb.y)}*${par(c)} + ${fmt(pose.y)} = ${fmt(pw.y)}`}</code></pre>
      </div>
      <figcaption>The same point P in two frames. Blue is the world frame. Orange is the robot frame: x straight ahead, y to the robot's left, and the dashed orange path is P's robot coordinates (ahead, then left). T is the robot's position. Move the robot and P with the sliders (with the keyboard: Tab to one, then the arrow keys); the robot can also be dragged in the picture.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "frames",
  title: "World frame and robot frame",
  description: "Move and turn the robot and see the coordinates of one point in the room's frame and in the robot's own frame, with the arithmetic that converts one into the other.",
  Component: Frames,
};
