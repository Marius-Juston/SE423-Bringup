import { useState } from "react";

// From encoder counts to feet. Course numbers (Lab 3, SE423Lib.c, and
// src/sim/plugins/eqep.ts): 500 slits x 4 edges = 2000 counts per motor turn
// (TRM 17.4.1, quadrature count mode), a 20:1 gear head, wheel radius
// 1.235 in. QPOSCNT is an unsigned 32-bit register (TRM 17.5, position
// counter); the left encoder counts down when the robot drives forward.

const PX_PER_FT = 355;
const X_ZERO = 70;
const FLOOR = 222;
const RADIUS_FT = 1.235 / 12;
const fmt = (v: number, d: number) => {
  const s = v.toFixed(d);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
};

function CountsToDistance() {
  const [fwd, setFwd] = useState(10000);
  const [left, setLeft] = useState(false);
  const raw = left ? -fwd : fwd;
  const motorTurns = raw / 2000;
  const wheelTurns = motorTurns / 20;
  const angle = fwd * ((2 * Math.PI) / (2000 * 20));
  const feet = angle * RADIUS_FT;
  const hex = `0x${(raw >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
  const deg = (angle * 180) / Math.PI;
  const wx = X_ZERO + feet * PX_PER_FT;
  const r = RADIUS_FT * PX_PER_FT;
  const wy = FLOOR - r;
  const boxes = [
    { label: "counts", value: String(raw) },
    { label: "motor turns", value: fmt(motorTurns, 2) },
    { label: "wheel turns", value: fmt(wheelTurns, 4) },
    { label: "wheel angle, rad", value: fmt(angle, 4) },
    { label: "distance, ft", value: fmt(feet, 4) },
  ];
  const ops = [
    { op: "÷ 2000", why: "500 slits x 4" },
    { op: "÷ 20", why: "gear head" },
    { op: left ? "x -2π" : "x 2π", why: left ? "mirrored motor" : "rad per turn" },
    { op: "x 1.235/12", why: "wheel radius, ft" },
  ];
  const spoke = (a: number, r0: number, r1: number, cx: number, cy: number) => {
    const c = Math.cos((a * Math.PI) / 180);
    const s = Math.sin((a * Math.PI) / 180);
    return `M${cx + r0 * c},${cy + r0 * s} L${cx + r1 * c},${cy + r1 * s}`;
  };
  const sign = left ? "-" : "";
  return (
    <figure className="figure cd-fig" aria-label="Interactive chain from encoder counts to feet travelled">
      <style>{`.cd-fig .cd-range{flex:1;min-width:140px;accent-color:var(--orange)}.cd-fig .cd-roll{stroke:var(--harvest);stroke-width:3;fill:none}.cd-fig .cd-tyre{fill:none;stroke:var(--text);stroke-width:3}`}</style>
      <svg viewBox="0 0 420 240" role="img" aria-label={`${raw} counts are ${fmt(motorTurns, 2)} motor turns, ${fmt(wheelTurns, 4)} wheel turns, ${fmt(angle, 4)} radians and ${fmt(feet, 4)} feet.`}>
        {/* the chain of numbers */}
        {boxes.map((b, i) => (
          <g key={i}>
            <rect x={2 + i * 86} y={6} width={72} height={34} rx={4} className={`fig-box ${i === 0 || i === 4 ? "hot" : ""}`} />
            <text x={38 + i * 86} y={18} textAnchor="middle" className="fig-label dim">{b.label}</text>
            <text x={38 + i * 86} y={33} textAnchor="middle" className="fig-value">{b.value}</text>
          </g>
        ))}
        {ops.map((o, i) => (
          <g key={i}>
            <path d={`M${75 + i * 86} 23 H${86 + i * 86}`} className="fig-wire" markerEnd="url(#cd-arrow)" />
            <text x={81 + i * 86} y={54} textAnchor="middle" className="fig-label">{o.op}</text>
            <text x={81 + i * 86} y={65} textAnchor="middle" className="fig-label dim">{o.why}</text>
          </g>
        ))}
        {/* motor shaft and gear head */}
        <circle cx={30} cy={104} r={19} className="fig-box" />
        <path d={spoke(motorTurns * 360 - 90, 0, 17, 30, 104)} className="fig-wire hot" />
        <circle cx={30} cy={104} r={2.5} className="fig-dot" />
        <text x={4} y={80} className="fig-label dim">encoder disc</text>
        <path d="M49 104 H66" className="fig-wire thick" />
        <rect x={66} y={88} width={56} height={32} rx={4} className="fig-box" />
        <text x={94} y={101} textAnchor="middle" className="fig-label">gear head</text>
        <text x={94} y={114} textAnchor="middle" className="fig-value small">20 : 1</text>
        <path d="M122 104 H144" className="fig-wire thick" markerEnd="url(#cd-arrow)" />
        <text x={150} y={101} className="fig-label">to the wheel:</text>
        <text x={150} y={113} className="fig-label dim">20 disc turns = 1 wheel turn</text>
        {/* the register */}
        <rect x={276} y={84} width={140} height={44} rx={4} className="fig-box" />
        <text x={283} y={97} className="fig-label dim">EQep{left ? 1 : 2}Regs.QPOSCNT reads</text>
        <text x={283} y={110} className="fig-value">{hex}</text>
        <text x={283} y={122} className="fig-label">as int32_t: <tspan className="fig-value small">{raw}</tspan></text>
        {/* floor and wheel */}
        <line x1={4} x2={416} y1={FLOOR} y2={FLOOR} className="fig-wire thick" />
        {Array.from({ length: 11 }, (_, i) => {
          const ft = (i - 1) / 10;
          const x = X_ZERO + ft * PX_PER_FT;
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={FLOOR} y2={FLOOR + (i % 2 ? 6 : 3)} className="fig-wire" />
              {i % 2 === 1 && <text x={x} y={FLOOR + 15} textAnchor="middle" className="fig-label dim">{ft.toFixed(1)} ft</text>}
            </g>
          );
        })}
        <path d={`M${X_ZERO} ${FLOOR} H${wx}`} className="cd-roll" />
        <circle cx={wx} cy={wy} r={r - 1.5} className="cd-tyre" />
        {[0, 90, 180, 270].map((a) => (
          <path key={a} d={spoke(deg + 90 + a, 4, r - 3, wx, wy)} className={a === 0 ? "fig-wire hot" : "fig-wire"} />
        ))}
        <circle cx={wx} cy={wy} r={3} className="fig-dot" />
        <path d={`M${wx} ${wy} H${wx + r - 3}`} className="fig-wire" strokeDasharray="2 2" />
        <text x={wx} y={wy - r - 5} textAnchor="middle" className="fig-label dim">radius 1.235 in</text>
        <defs>
          <marker id="cd-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" className="fig-arrowhead" />
          </marker>
        </defs>
      </svg>
      <div className="fig-controls">
        <div>
          <span>Roll</span>
          <input className="cd-range" type="range" aria-label="Distance rolled, in counts" min={-5000} max={50000} step={50} value={fwd} onChange={(e) => setFwd(+e.target.value)} />
          <code>QPOSCNT = {raw}</code>
        </div>
        <div>
          <span>Wheel</span>
          <button className="fig-opt" aria-pressed={!left} onClick={() => setLeft(false)}>right (eQEP2)</button>
          <button className="fig-opt" aria-pressed={left} onClick={() => setLeft(true)}>left (eQEP1), mirrored</button>
        </div>
      </div>
      <div className="fig-why" role="status">
        {fwd === 0
          ? "At 0 counts nothing has moved. Roll the wheel."
          : `The wheel rolled ${fwd < 0 ? "backward" : "forward"} ${fmt(Math.abs(feet), 3)} ft: the thick line on the floor is as long as the piece of tyre that touched it, angle x radius. ${left ? `The left motor is mounted mirrored, so its counter went ${fwd > 0 ? "down" : "up"}: QPOSCNT ${raw < 0 ? `reads ${hex}, which is ${raw} once it is stored in an int32_t` : `reads ${raw}`}. The minus sign in the scale factor makes forward positive again.` : fwd < 0 ? `Below zero the unsigned register reads ${hex}; stored in an int32_t the same bits are ${raw}.` : `One count is 2π / 40000 = 0.000157 rad of the wheel, or ${(RADIUS_FT * ((2 * Math.PI) / 40000) * 12 * 25.4 * 1000).toFixed(0)} thousandths of a millimetre on the floor.`}`}
      </div>
      <div className="fig-step">
        <pre><code>{[`int32_t raw = EQep${left ? 1 : 2}Regs.QPOSCNT;`.padEnd(36) + `// ${raw}`, `angle = raw*(${sign}2*PI/(2000.0*20.0));`.padEnd(36) + `// ${fmt(angle, 4)} rad`, "dist  = angle*(1.235/12.0);".padEnd(36) + `// ${fmt(feet, 4)} ft`].join("\n")}</code></pre>
      </div>
      <figcaption>Every box is the one before it times one factor. Two lines of C do the whole chain: counts to radians of the wheel, radians to feet.</figcaption>
    </figure>
  );
}

export const figure = { id: "counts-to-distance", Component: CountsToDistance };
