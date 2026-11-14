import { useState } from "react";
import { CodePre } from "../CopyButton";

// Time of flight (lecture 14): d = c t / 2 with c = 3.0e8 m/s, compared with
// the 200 MHz system clock of the F28379D (5 ns period, TRM section 3.7
// "Clocking"). The space and time axes share one scale: 1 m is 80 px and
// 1 ns of round trip is 0.15 m, so 12 px. The end of the time bar therefore
// sits exactly under the wall.
const C = 3.0e8;
const CLK_NS = 5;
const X0 = 50;
const PX_PER_M = 80;
const PX_PER_NS = 12;
const M_PER_CLK = (C * CLK_NS * 1e-9) / 2; // 0.75 m

const PRESETS = [0.3, 0.75, 1.5, 3];

function TimeOfFlight() {
  const [d, setD] = useState(3);
  const tNs = ((2 * d) / C) * 1e9;
  const wall = X0 + d * PX_PER_M;
  const count = Math.floor(tNs / CLK_NS + 1e-9);
  const x = (ns: number) => X0 + ns * PX_PER_NS;
  const periods = 6;
  const HI = 106;
  const LO = 122;
  let clk = `M${x(0)},${LO}`;
  for (let k = 0; k < periods; k++) clk += ` V${HI} H${x(k * CLK_NS + CLK_NS / 2)} V${LO} H${x((k + 1) * CLK_NS)}`;
  const lo = (count * M_PER_CLK).toFixed(2);
  const hi = ((count + 1) * M_PER_CLK).toFixed(2);
  return (
    <figure className="figure tof" aria-label="Interactive time-of-flight diagram: a laser pulse to a wall and back, compared with the CPU clock">
      <style>{`
        .tof-slider { display: flex; align-items: center; gap: 0.5rem; flex: 1 1 12rem; }
        .tof-slider input { flex: 1; min-width: 6rem; accent-color: var(--orange); }
        .tof-slider output { font-family: var(--mono); color: var(--harvest); font-weight: 700; min-width: 4.2rem; }
        .tof-pulse { stroke: var(--orange); stroke-width: 2.2; fill: none; }
        .tof-echo { stroke: var(--orange); stroke-width: 1.6; fill: none; stroke-dasharray: 5 3; }
        .tof-head { fill: var(--orange); }
        .tof-wall { fill: var(--dim); }
        .tof-bar { fill: var(--harvest); }
        .tof-count { fill: var(--orange); opacity: 0.25; }
        .tof-drop { stroke: var(--harvest); stroke-width: 1; stroke-dasharray: 2 3; }
        .tof-axis { stroke: var(--dim); stroke-width: 1; }
      `}</style>
      <svg viewBox="0 0 420 170" role="img" aria-label={`Wall ${d.toFixed(2)} metres away. The echo returns after ${tNs.toFixed(1)} nanoseconds, during which the 5 nanosecond CPU clock ticks ${count} time${count === 1 ? "" : "s"}.`}>
        <defs>
          <marker id="tof-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" className="tof-head" />
          </marker>
        </defs>
        {/* space */}
        <rect x="6" y="22" width="44" height="34" rx="4" className="fig-box hot" />
        <text x="28" y="37" textAnchor="middle" className="fig-label">LIDAR</text>
        <text x="28" y="49" textAnchor="middle" className="fig-label dim">laser</text>
        <rect x={wall} y="14" width="5" height="50" className="tof-wall" />
        <text x={Math.min(wall + 2, 398)} y="10" textAnchor="middle" className="fig-label dim">wall</text>
        <path d={`M${X0},32 H${wall - 1}`} className="tof-pulse" markerEnd="url(#tof-arrow)" />
        <path d={`M${wall - 1},46 H${X0 + 1}`} className="tof-echo" markerEnd="url(#tof-arrow)" />
        {d >= 1 && (
          <>
            <text x={(X0 + wall) / 2} y="27" textAnchor="middle" className="fig-label">pulse out</text>
            <text x={(X0 + wall) / 2} y="58" textAnchor="middle" className="fig-label">echo back</text>
          </>
        )}
        <line x1={wall} x2={wall} y1="64" y2="140" className="tof-drop" />
        {/* time */}
        <text x={wall >= 215 ? wall - 6 : wall + 8} y={wall >= 215 ? 80 : 93} textAnchor={wall >= 215 ? "end" : "start"} className="fig-label">
          round trip t = 2 d / c = <tspan className="fig-value small">{tNs.toFixed(tNs < 10 ? 2 : 1)} ns</tspan>
        </text>
        <rect x={X0} y="85" width={wall - X0} height="9" className="tof-bar" />
        <text x="4" y="112" className="fig-label">CPU clock</text>
        <text x="4" y="123" className="fig-label dim">5 ns</text>
        {Array.from({ length: count }, (_, k) => (
          <rect key={k} x={x(k * CLK_NS)} y={HI - 3} width={CLK_NS * PX_PER_NS} height={LO - HI + 6} className="tof-count" />
        ))}
        <path d={clk} className="fig-trace" />
        {Array.from({ length: periods }, (_, k) => (
          <text key={k} x={x(k * CLK_NS + CLK_NS * 0.75)} y={HI + 9} textAnchor="middle" className={k < count ? "fig-value small" : "fig-label dim"}>{k + 1}</text>
        ))}
        <line x1={X0} x2={x(periods * CLK_NS)} y1="140" y2="140" className="tof-axis" />
        {Array.from({ length: periods + 1 }, (_, k) => (
          <g key={k}>
            <line x1={x(k * CLK_NS)} x2={x(k * CLK_NS)} y1="137" y2="143" className="tof-axis" />
            <text x={x(k * CLK_NS) + (k === periods ? 8 : 0)} y="153" textAnchor={k === periods ? "end" : "middle"} className="fig-label dim">{k * CLK_NS} ns</text>
            <text x={x(k * CLK_NS) + (k === periods ? 8 : 0)} y="166" textAnchor={k === periods ? "end" : "middle"} className="fig-label dim">{(k * M_PER_CLK).toFixed(2)} m</text>
          </g>
        ))}
      </svg>
      <div className="fig-step" role="status">
        <p>
          A wall <strong>{d.toFixed(2)} m</strong> away sends the echo back after <strong>{tNs.toFixed(tNs < 10 ? 2 : 1)} ns</strong>. In that time the 200 MHz clock has finished <strong>{count}</strong> {count === 1 ? "period" : "periods"}.{" "}
          {count === 0
            ? "The echo is back before the first clock period is over: a counter of clock periods still reads 0."
            : `A counter of clock periods reads ${count}.`}{" "}
          A count of {count} fits every wall from {lo} m to {hi} m, because one clock period is 0.75 m of distance.
        </p>
        <CodePre><code>{`d = c * t / 2;   // 3.0e8 * ${tNs.toFixed(2)}e-9 / 2 = ${d.toFixed(2)} m`}</code></CodePre>
      </div>
      <div className="fig-controls">
        <div>
          <span>Distance</span>
          <label className="tof-slider">
            <input type="range" min={0.15} max={4} step={0.05} value={d} onChange={(e) => setD(+e.target.value)} aria-label="Distance to the wall in metres" />
            <output>{d.toFixed(2)} m</output>
          </label>
        </div>
        <div>
          <span>Try</span>
          {PRESETS.map((p) => (
            <button key={p} className="fig-opt" aria-pressed={Math.abs(d - p) < 1e-6} onClick={() => setD(p)}>{p} m</button>
          ))}
        </div>
      </div>
      <figcaption>Distance and time are drawn to the same scale, so the round-trip bar ends exactly under the wall. To tell walls 1 mm apart the sensor has to resolve 6.67 ps, 750 times finer than the CPU clock. It does that in its own circuit and sends the finished distance.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "time-of-flight",
  title: "LIDAR time of flight",
  description: "Move the wall to see how long the laser pulse takes to return and how few CPU clock ticks fit in that time.",
  Component: TimeOfFlight,
};
