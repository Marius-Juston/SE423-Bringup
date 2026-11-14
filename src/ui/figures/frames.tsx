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
const par = (v: number, d = 2) => (fmt(v, d).startsWith("-") ? `(${fmt(v, d)})` : fmt(v, d));
// The robot stays one foot inside the drawing, so its axes are never cut off.
const X_MIN = 1;
const Y_MIN = 1;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Label placement. Every label has a box, and a label takes the first of its
// candidate places whose box is clear of the boxes placed before it and of
// every drawn line. The boxes are sized for the largest type a drawing gets
// (labels grow in a narrow column to stay 9 px tall), so what is apart here
// is apart at every width. A label that must show and finds no such place
// gets a plate in the background colour, so that a line never cuts its glyphs.
const VH = 296; // viewBox height
const F = 10.7; // largest label size, in viewBox units
const GAP = 3.2; // least distance between two labels
const ROW1 = OY + 11.8; // numbers under the world x axis
const ROW2 = OY + 29.7; // the name of the world x axis
interface Box { x0: number; x1: number; y0: number; y1: number }
interface Lab { x: number; y: number; anchor: "start" | "middle" | "end"; plate?: Box }
/** A drawn line from a to b; r is half its width and the room a label keeps from it. */
interface Seg { ax: number; ay: number; bx: number; by: number; r: number }
const seg = (ax: number, ay: number, bx: number, by: number, r: number): Seg => ({ ax, ay, bx, by, r });
/** True when the line passes through the box, or closer to it than r. */
const cuts = (b: Box, l: Seg) => {
  let t0 = 0;
  let t1 = 1;
  const dx = l.bx - l.ax;
  const dy = l.by - l.ay;
  for (const [p, q] of [[-dx, l.ax - b.x0 + l.r], [dx, b.x1 + l.r - l.ax], [-dy, l.ay - b.y0 + l.r], [dy, b.y1 + l.r - l.ay]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else if (p < 0) t0 = Math.max(t0, q / p);
    else t1 = Math.min(t1, q / p);
  }
  return t0 <= t1;
};
const monoW = (text: string) => text.length * 0.6 * F + 1;
const DIGIT_W = 7.3;
const LETTER_W = 7;
const textBox = (l: Lab, w: number): Box => {
  const x0 = l.anchor === "start" ? l.x : l.anchor === "end" ? l.x - w : l.x - w / 2;
  return { x0, x1: x0 + w, y0: l.y - F, y1: l.y + 0.35 * F };
};
const around = (x: number, y: number, r: number): Box => ({ x0: x - r, x1: x + r, y0: y - r, y1: y + r });
const hit = (a: Box, b: Box, gap: number) => a.x0 - b.x1 < gap && b.x0 - a.x1 < gap && a.y0 - b.y1 < gap && b.y0 - a.y1 < gap;
const inView = (b: Box) => b.x0 >= 0.5 && b.x1 <= 419.5 && b.y0 >= 0.5 && b.y1 <= VH - 0.5;
// Last places for the letter P, when its mark is in a crowded corner: a grid round the mark, nearest first.
const P_FAR = [-48, -40, -32, -24, 24, 32, 40, 48, 0]
  .flatMap((dx) => [-42, -35, -28, 28, 35, 42, 3.5].map((dy) => [dx, dy]))
  .filter(([dx, dy]) => dx !== 0 || dy !== 3.5)
  .sort((p, q) => Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]));
/** The part of the segment a to b that is inside the drawing, or null. */
function clip(a: { x: number; y: number }, b: { x: number; y: number }): [{ x: number; y: number }, { x: number; y: number }] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - OX], [dx, 416 - a.x], [-dy, a.y - 4], [dy, OY - a.y]]) {
    if (p === 0) {
      if (q < 0) return null;
    } else if (p < 0) t0 = Math.max(t0, q / p);
    else t1 = Math.min(t1, q / p);
  }
  return t0 < t1 ? [{ x: a.x + t0 * dx, y: a.y + t0 * dy }, { x: a.x + t1 * dx, y: a.y + t1 * dy }] : null;
}

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
  // To one decimal and into a slider's range, so the thumb and the read-out agree after a switch.
  const round = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v * 10) / 10));

  // corner of the path "xb ahead, then yb to the left"
  const knee = { x: pose.x + pb.x * c, y: pose.y + pb.x * s };
  const arrow = (x0: number, y0: number, x1: number, y1: number, cls: string, id: string) => <path d={`M${wx(x0)},${wy(y0)} L${wx(x1)},${wy(y1)}`} className={cls} markerEnd={`url(#${id})`} />;
  const where = (x: number, y: number, d: number) =>
    Math.abs(x) < 0.005 && Math.abs(y) < 0.005
      ? "at the robot's centre"
      : `${fmt(Math.abs(x), d)} ft ${x >= 0 ? "ahead" : "behind"} and ${Math.abs(y) < 0.005 ? "neither left nor right" : `${fmt(Math.abs(y), d)} ft to its ${y > 0 ? "left" : "right"}`}`;
  // P can ride out of the drawing. Its mark then stops at the edge and
  // becomes an arrowhead that points to where P really is.
  const pX = clamp(wx(pw.x), 8, 412);
  const pY = clamp(wy(pw.y), 8, VH - 8);
  const outside = pX !== wx(pw.x) || pY !== wy(pw.y);

  const rx = wx(pose.x);
  const ry = wy(pose.y);
  const kneeAt = { x: wx(knee.x), y: wy(knee.y) };
  const pAt = { x: wx(pw.x), y: wy(pw.y) };

  // ---- labels, placed in this order; each keeps clear of the ones before it ----
  const taken: Box[] = []; // labels
  const pMark = around(pX, pY, 7);
  const shapes: Box[] = [pMark, around(rx, ry, 17)]; // marks a label should not cover: P and the robot's body
  // Every line of the drawing, as drawn: the world axes, T, the lines from P to the axes, the dashed path, the robot's axes.
  const lines: Seg[] = [
    seg(OX, OY, wx(7.9) + 2, OY, 1.05),
    seg(OX, OY, OX, wy(5.45) - 2, 1.05),
    seg(OX, OY, rx, ry, 1),
    seg(pAt.x, pAt.y, pAt.x, OY, 1),
    seg(pAt.x, pAt.y, OX, pAt.y, 1),
    seg(rx, ry, kneeAt.x, kneeAt.y, 1.3),
    seg(kneeAt.x, kneeAt.y, pAt.x, pAt.y, 1.3),
    seg(rx, ry, rx + 40 * c, ry - 40 * s, 1.2),
    seg(rx, ry, rx - 36 * s, ry - 36 * c, 1.2),
  ];
  const offShapes = (b: Box) => shapes.every((o) => !hit(b, o, 0));
  /**
   * The first candidate that is free: clear of the labels, the lines and the marks (`soft`).
   * A label that must show may then cover a mark, then stand on a line with a plate under it,
   * and at worst takes its first place.
   */
  const put = (w: number, cands: Lab[], must: boolean, soft = offShapes): Lab | null => {
    for (const pass of must ? [0, 1, 2, 3] : [0]) {
      for (const l of cands) {
        const b = textBox(l, w);
        if (!inView(b) || taken.some((t) => hit(b, t, GAP))) continue;
        if (pass < 2 && lines.some((n) => cuts(b, n))) continue;
        if (pass % 2 === 0 && !soft(b)) continue;
        taken.push(b);
        return pass < 2 ? l : { ...l, plate: b };
      }
    }
    if (!must) return null;
    const b = textBox(cands[0], w);
    taken.push(b);
    return lines.some((n) => cuts(b, n)) ? { ...cands[0], plate: b } : cands[0];
  };
  // The axis names make room when P's mark, the robot or a line is where they stand.
  const offMarks = (b: Box) => !hit(b, pMark, 12) && !hit(b, shapes[1], 0);
  const nameX = put(47, [ROW2, ROW1].flatMap((y) => ([
    { x: wx(7.9), y, anchor: "end" },
    { x: wx(1), y, anchor: "start" },
    { x: wx(2.5), y, anchor: "start" },
    { x: wx(4), y, anchor: "start" },
    { x: wx(5.5), y, anchor: "start" },
    { x: 2, y, anchor: "start" },
  ] satisfies Lab[])), true, offMarks)!;
  // "world y" stands at the top of its axis, on the right or else the left, or lower down.
  const nameYAt = (i: number): Lab[] => [{ x: OX + 5, y: wy(5.4) + 4 + 14 * i, anchor: "start" }, { x: OX - 5, y: wy(5.4) + 4 + 14 * i, anchor: "end" }];
  const nameY = put(34, Array.from({ length: 16 }, (_, i) => nameYAt(i)).flat(), true, offMarks)!;
  // P's world coordinates: y beside the world y axis at P's height, x under the world x axis below P.
  // Where P's mark, a line or the other number is in the way, the number moves beside it, or along its axis.
  const slide = [16, 24, 32, 40, 48, 56].flatMap((d) => [d, -d]);
  const yText = fmt(pw.y);
  const yLab = put(monoW(yText), [
    { x: OX - 5, y: pY + 3.5, anchor: "end" },
    { x: OX - 5, y: pY - 11.5, anchor: "end" },
    { x: OX - 5, y: pY + 18.5, anchor: "end" },
    { x: pX + 10, y: pY + 3.5, anchor: "start" },
    ...slide.map((d): Lab => ({ x: OX - 5, y: pY + 3.5 - d, anchor: "end" })),
    ...[0, -15, 15, ...slide].map((d): Lab => ({ x: OX + 5, y: pY + 3.5 - d, anchor: "start" })),
  ], true)!;
  const xText = fmt(pw.x);
  const xW = monoW(xText);
  const xMid = clamp(wx(pw.x), xW / 2 + 1, 419 - xW / 2);
  const xLab = put(xW, [ROW1, ROW2].flatMap((y): Lab[] => [
    { x: xMid, y, anchor: "middle" },
    { x: pX + 10, y, anchor: "start" },
    { x: pX - 10, y, anchor: "end" },
    ...[...slide, 64, -64, 72, -72, 80, -80, 88, -88].map((d): Lab => ({ x: xMid + d, y, anchor: "middle" })),
  ]), true)!;
  // The letter P: beside its mark, then further out.
  const pLab = put(LETTER_W, [
    [7, -6], [-7, -6], [10, 3.5], [-10, 3.5], [7, 14], [-7, 14], [0, -11], [0, 18.5],
    [17, 3.5], [-17, 3.5], [17, -6], [-17, -6], [17, 14], [-17, 14], [0, -24], [0, 31],
    [26, 3.5], [-26, 3.5], [26, -14], [-26, -14], [26, 22], [-26, 22],
    ...P_FAR,
  ].map(([dx, dy]): Lab => ({ x: pX + dx, y: pY + dy, anchor: dx > 0 ? "start" : dx < 0 ? "end" : "middle" })), true)!;
  // The numbers on the world axes: one is left out where P's labels, P's mark or a line stand.
  const xTicks = [2, 4, 6].filter((i) => put(DIGIT_W, [{ x: wx(i), y: ROW1, anchor: "middle" }], false));
  const yTicks = [2, 4].filter((i) => put(DIGIT_W, [{ x: OX - 5, y: wy(i) + 3, anchor: "end" }], false));
  // The robot: the letters at the tips of its axes, on either side of the tip or beyond it.
  /** A point `ahead` px along the robot's x axis and `left` px along its y axis, as the middle of a label. */
  const onRobot = (ahead: number, left: number): Lab => ({ x: rx + ahead * c - left * s, y: ry - ahead * s - left * c + 3.5, anchor: "middle" });
  const bxLab = put(LETTER_W, [onRobot(36, 9), onRobot(36, -9), onRobot(49, 0), onRobot(25, 10), onRobot(25, -10), onRobot(58, 0), onRobot(36, 15), onRobot(36, -15), onRobot(49, 9), onRobot(49, -9), onRobot(25, 17), onRobot(25, -17), onRobot(36, 22), onRobot(36, -22), onRobot(49, 17), onRobot(49, -17)], true)!;
  const byLab = put(LETTER_W, [onRobot(-9, 32), onRobot(9, 32), onRobot(0, 45), onRobot(-10, 22), onRobot(10, 22), onRobot(0, 54), onRobot(-15, 32), onRobot(15, 32), onRobot(-9, 45), onRobot(9, 45), onRobot(-17, 22), onRobot(17, 22), onRobot(-22, 32), onRobot(22, 32), onRobot(-17, 45), onRobot(17, 45)], true)!;
  /** Places beside the segment a to b for a label w wide: along it from the middle outwards, the side of (nx, ny) first, then further off. */
  const beside = (a: { x: number; y: number }, b: { x: number; y: number }, w: number, nx: number, ny: number, at: number[], far: number[] = [0, 8]): Lab[] => {
    const off = (w / 2) * Math.abs(nx) + 0.68 * F * Math.abs(ny) + 2.5;
    return far.flatMap((d) => at.flatMap((f) => [1, -1].map((side): Lab => ({ x: a.x + f * (b.x - a.x) + side * (off + d) * nx, y: a.y + f * (b.y - a.y) + side * (off + d) * ny + 3.5, anchor: "middle" }))));
  };
  // T, beside the dotted line from the world origin to the robot.
  const tLen = Math.hypot(pose.x, pose.y);
  const tLab = put(LETTER_W, beside({ x: OX, y: OY }, { x: rx, y: ry }, LETTER_W, pose.y / tLen, pose.x / tLen, [0.5, 0.38, 0.62, 0.26, 0.74, 0.14, 0.86], [0, 8, 16]), true)!;
  // The two numbers on the dashed path, beside the part of it that is inside the drawing.
  // One is left out where there is no free place for it.
  const pathLab = (from: { x: number; y: number }, to: { x: number; y: number }, text: string, nx: number, ny: number) => {
    const part = clip(from, to);
    return part && Math.hypot(part[1].x - part[0].x, part[1].y - part[0].y) > 18 ? put(monoW(text), beside(part[0], part[1], monoW(text), nx, ny, [0.5, 0.35, 0.65, 0.2, 0.8]), false) : null;
  };
  const turn = Math.sign(pb.x || 1);
  const aheadLab = Math.abs(pb.x) >= 0.45 ? pathLab({ x: rx, y: ry }, kneeAt, fmt(pb.x), s, c) : null;
  const leftLab = Math.abs(pb.y) >= 0.45 ? pathLab(kneeAt, pAt, fmt(pb.y), c * turn, -s * turn) : null;
  /** A label, on its plate when it has one. */
  const label = (l: Lab, text: string, cls: string) => (
    <>
      {l.plate && <rect className="fr-plate" x={l.plate.x0 - 1} y={l.plate.y0 + 1} width={l.plate.x1 - l.plate.x0 + 2} height={l.plate.y1 - l.plate.y0 - 2} rx={2} />}
      <text x={l.x} y={l.y} textAnchor={l.anchor} className={cls}>{text}</text>
    </>
  );
  const pTurn = (Math.atan2(wy(pw.y) - pY, wx(pw.x) - pX) * 180) / Math.PI;

  return (
    <figure className="figure fr-fig" aria-label="Interactive drawing of the world frame, the robot frame and a point in both">
      <style>{`.fr-fig .fr-range{flex:1;min-width:70px;accent-color:var(--orange)}.fr-fig .fr-lab{flex:1;display:flex;align-items:center;gap:.3rem;color:var(--dim);font-size:.82rem;min-width:110px}.fr-fig .fr-grid{stroke:var(--border);stroke-width:1}.fr-fig .fr-w{stroke:var(--arches);stroke-width:2;fill:none}.fr-fig .fr-b{stroke:var(--orange);stroke-width:2;fill:none}.fr-fig .fr-wd{stroke:var(--arches);stroke-width:1.2;fill:none;stroke-dasharray:3 3}.fr-fig .fr-bd{stroke:var(--orange);stroke-width:1.6;fill:none;stroke-dasharray:5 3}.fr-fig .fr-t{stroke:var(--dim);stroke-width:1.2;fill:none;stroke-dasharray:2 3}.fr-fig .fr-robot{cursor:grab;touch-action:none}.fr-fig .fr-wt{fill:var(--arches)}.fr-fig .fr-bt{fill:var(--orange)}.fr-fig .fr-eq{white-space:pre}.fr-fig .fr-plate{fill:var(--inset)}.fr-fig .fr-labels{pointer-events:none}.fr-fig .fr-halo{paint-order:stroke;stroke:var(--inset);stroke-width:3px;stroke-linejoin:round}.fr-fig .fr-num{width:4.6rem;white-space:nowrap;text-align:right;font-family:var(--mono);font-size:.8rem;color:var(--harvest)}`}</style>
      <svg ref={svg} viewBox={`0 0 420 ${VH}`} role="img" aria-label={`Robot at ${fmt(pose.x, 1)}, ${fmt(pose.y, 1)} feet, heading ${pose.deg} degrees. Point: ${fmt(pb.x)} ahead and ${fmt(pb.y)} to the left in the robot frame, ${fmt(pw.x)}, ${fmt(pw.y)} in the world frame.`}>
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
        {/* world frame */}
        {arrow(0, 0, 7.9, 0, "fr-w", "fr-aw")}
        {arrow(0, 0, 0, 5.45, "fr-w", "fr-aw")}
        {/* T: where the robot is */}
        <path d={`M${wx(0)},${wy(0)} L${rx},${ry}`} className="fr-t" />
        {/* world coordinates of the point */}
        <path d={`M${pAt.x},${pAt.y} V${wy(0)}`} className="fr-wd" />
        <path d={`M${pAt.x},${pAt.y} H${wx(0)}`} className="fr-wd" />
        {/* robot coordinates of the point: ahead, then left */}
        <path d={`M${rx},${ry} L${kneeAt.x},${kneeAt.y} L${pAt.x},${pAt.y}`} className="fr-bd" />
        {/* robot */}
        <g
          className="fr-robot"
          transform={`translate(${rx},${ry}) rotate(${-pose.deg})`}
          onPointerDown={(e) => {
            const p = at(e);
            drag.current = { dx: pose.x - p.x, dy: pose.y - p.y };
            (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const p = at(e);
            setPose({ ...pose, x: round(p.x + drag.current.dx, X_MIN, 6), y: round(p.y + drag.current.dy, Y_MIN, 4) });
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
        {/* the labels, above every line */}
        <g className="fr-labels">
          {xTicks.map((i) => (
            <text key={i} x={wx(i)} y={ROW1} textAnchor="middle" className="fig-label dim">{i}</text>
          ))}
          {yTicks.map((i) => (
            <text key={i} x={OX - 5} y={wy(i) + 3} textAnchor="end" className="fig-label dim">{i}</text>
          ))}
          {label(nameX, "world x, ft", "fig-label fr-wt")}
          {label(nameY, "world y", "fig-label fr-wt")}
          {label(tLab, "T", "fig-label dim fr-halo")}
          {label(xLab, xText, "fig-value small fr-halo")}
          {label(yLab, yText, "fig-value small fr-halo")}
          {aheadLab && label(aheadLab, fmt(pb.x), "fig-value small fr-halo")}
          {leftLab && label(leftLab, fmt(pb.y), "fig-value small fr-halo")}
          {label(bxLab, "x", "fig-label fr-bt")}
          {label(byLab, "y", "fig-label fr-bt")}
        </g>
        {/* the point */}
        {outside
          ? <path d="M6,0 L-5,-5 L-5,5 Z" transform={`translate(${pX},${pY}) rotate(${pTurn})`} fill="var(--harvest)" stroke="var(--inset)" strokeWidth={1} />
          : <circle cx={pX} cy={pY} r={4.5} fill="var(--harvest)" stroke="var(--inset)" strokeWidth={1} />}
        <g className="fr-labels">{label(pLab, "P", "fig-label fr-halo")}</g>
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
              if (inverse) setBody({ x: round(pb.x, -1, 3), y: round(pb.y, -2, 2) });
              setWorld(null);
            }}
          >
            rides on the robot
          </button>
          <button className="fig-opt" aria-pressed={inverse} onClick={() => setWorld({ x: round(pw.x, 0, 7.5), y: round(pw.y, 0, 5) })}>stays in the room</button>
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
          ? `dx = ${fmt(pw.x)} - ${fmt(pose.x)} = ${fmt(dx)}\ndy = ${fmt(pw.y)} - ${fmt(pose.y)} = ${fmt(dy)}\nx_robot = dx cos(${pose.deg}°) + dy sin(${pose.deg}°)\n  = ${par(dx)}*${par(c, 3)} + ${par(dy)}*${par(s, 3)} = ${fmt(pb.x)}\ny_robot = -dx sin(${pose.deg}°) + dy cos(${pose.deg}°)\n  = -${par(dx)}*${par(s, 3)} + ${par(dy)}*${par(c, 3)} = ${fmt(pb.y)}`
          : `x_world = x cos(${pose.deg}°) - y sin(${pose.deg}°) + Tx\n  = ${par(pb.x)}*${par(c, 3)} - ${par(pb.y)}*${par(s, 3)} + ${fmt(pose.x)} = ${fmt(pw.x)}\ny_world = x sin(${pose.deg}°) + y cos(${pose.deg}°) + Ty\n  = ${par(pb.x)}*${par(s, 3)} + ${par(pb.y)}*${par(c, 3)} + ${fmt(pose.y)} = ${fmt(pw.y)}`}</code></pre>
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
