// An RC servo reads the width of a pulse that repeats every 20 ms (HW4,
// SE423Lib.c; src/sim/plugins/actuators.ts): 0.8 ms (4 %) is -90 degrees,
// 1.6 ms (8 %) is 0 and 2.4 ms (12 %) is +90. The time base is the one of
// chapter 10 (ch10_actuators.ts, act-pwm-math and act-servo), not the
// homework's: CLKDIV = 5 (/32) so TBCLK = 50 MHz / 32 = 1.5625 MHz, 640 ns
// a count (TBCTL, TRM 15.15.2), and TBPRD = 31250 for 20 ms (15.4.3).
// CMPA: 1250 (-90), 2500 (0), 3750 (+90); the slider runs 625 to 4375
// (0.4 to 2.8 ms) in steps of 25 counts (16 us) to show the stops.
import { useRef, useState } from "react";
import type { PointerEvent as RPointerEvent } from "react";

const COUNT_MS = 0.00064;
const TBPRD = 31250;
const CENTRE = 2500;
const PER_90 = 1250;
const CMIN = 625;
const CMAX = 4375;
const STEP = 25;
const ZOOM_MS = 3.2;

const CSS = `
.srvp input[type=range] { flex: 1 1 8rem; min-width: 6rem; padding: 0; accent-color: var(--accent); }
.srvp-grab { cursor: ew-resize; touch-action: none; fill: transparent; }
.srvp-read { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.4rem 0; }
.srvp-read div { flex: 1 1 5.4rem; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 0.25rem 0.55rem; font-size: 0.78rem; color: var(--dim); }
.srvp-read b { display: block; font-family: var(--mono); color: var(--value); font-size: 0.95rem; }
.srvp pre { margin: 0.3rem 0 0; font-size: 0.78rem; background: var(--surface); border-radius: 6px; padding: 0.4rem 0.6rem; overflow-x: auto; }
`;

function ServoPulse() {
  const [cmpa, setCmpaRaw] = useState(CENTRE);
  const svg = useRef<SVGSVGElement>(null);
  const setCmpa = (v: number) => setCmpaRaw(Math.max(CMIN, Math.min(CMAX, Math.round(v / STEP) * STEP)));
  const ms = cmpa * COUNT_MS;
  // In counts, so that 1250 and 3750 are exactly -90 and +90 degrees.
  const raw = ((cmpa - CENTRE) * 90) / PER_90;
  const angle = Math.max(-90, Math.min(90, raw));
  const over = cmpa < CENTRE - PER_90 || cmpa > CENTRE + PER_90;
  const duty = (cmpa / TBPRD) * 100;

  const X0 = 44;
  const X1 = 284;
  const FH = 26;
  const FL = 46;
  const ZH = 96;
  const ZL = 132;
  const xf = (t: number) => X0 + (t / 24) * (X1 - X0);
  const xz = (t: number) => X0 + (t / ZOOM_MS) * (X1 - X0);
  const frame = `M${X0},${FL} V${FH} H${xf(ms)} V${FL} H${xf(20)} V${FH} H${xf(20 + ms)} V${FL} H${X1}`;
  const zoom = `M${X0},${ZL} V${ZH} H${xz(ms)} V${ZL} H${X1}`;

  // Dial: 0 degrees points up, positive angles turn counter-clockwise.
  const DX = 354;
  const DY = 92;
  const R = 34;
  const tip = (deg: number, r: number) => {
    const a = ((90 + deg) * Math.PI) / 180;
    return [DX + r * Math.cos(a), DY - r * Math.sin(a)];
  };
  const [hx, hy] = tip(angle, R - 6);

  const drag = {
    onPointerDown: (e: RPointerEvent<SVGRectElement>) => e.currentTarget.setPointerCapture(e.pointerId),
    onPointerMove: (e: RPointerEvent<SVGRectElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId) || !svg.current) return;
      const r = svg.current.getBoundingClientRect();
      const xs = ((e.clientX - r.left) * 420) / r.width;
      setCmpa((((xs - X0) / (X1 - X0)) * ZOOM_MS) / COUNT_MS);
    },
  };

  const why = over
    ? `${ms.toFixed(2)} ms is ${raw > 0 ? "wider than the 2.4 ms for +90" : "narrower than the 0.8 ms for -90"} degrees. The arm is already at its mechanical stop and the servo strains against it. The course's function saturates the angle first, so CMPA stays between ${CENTRE - PER_90} and ${CENTRE + PER_90}.`
    : `A pulse ${ms.toFixed(2)} ms wide, repeated every 20 ms, means ${angle > 0 ? "+" : ""}${angle.toFixed(1).replace(/\.0$/, "")} degrees. Only the width counts: the other ${(20 - ms).toFixed(2)} ms of the frame carry no information, which is why the duty cycle only runs from 4 % to 12 %.`;

  return (
    <figure className="figure srvp" aria-label="Interactive RC servo pulse: pulse width against arm angle">
      <style>{CSS}</style>
      <svg ref={svg} viewBox="0 0 420 168" role="img" aria-label={`Pulse width ${ms.toFixed(2)} milliseconds in a 20 millisecond frame, CMPA ${cmpa}: servo arm at ${angle.toFixed(1)} degrees${over ? ", at its mechanical stop" : ""}.`}>
        {/* whole frame */}
        <text x="4" y={FH + 8} className="fig-label">EPWM8A</text>
        <text x="4" y={FH + 19} className="fig-label dim">GPIO14</text>
        <path d={`M${X0},${FL} V${FH} H${xf(ms)} V${FL} Z M${xf(20)},${FL} V${FH} H${xf(20 + ms)} V${FL} Z`} fill="var(--accent-soft)" />
        <path d={frame} className="fig-trace" style={{ stroke: "var(--hi)" }} />
        <path d={`M${X0},14 V10 H${xf(20)} V14`} className="fig-wire" />
        <text x={(X0 + xf(20)) / 2} y="8" textAnchor="middle" className="fig-label dim">one frame: 20 ms = {TBPRD} counts (50 Hz)</text>
        <text x={xf(20)} y={FL + 11} textAnchor="middle" className="fig-label dim">20 ms</text>
        {/* zoom guides */}
        <path d={`M${X0},${FL + 2} V${ZH - 22} M${xf(ZOOM_MS)},${FL + 2} L${X1},${ZH - 22}`} className="fig-wire" strokeDasharray="2 3" />
        <text x={X0 + 8} y={FL + 23} className="fig-label dim">the first 3.2 ms, enlarged</text>
        {/* zoomed pulse */}
        <rect x={xz(0.8)} y={ZH - 6} width={xz(2.4) - xz(0.8)} height={ZL - ZH + 6} fill="var(--value)" fillOpacity="0.1" />
        {[
          [0.8, "-90°"],
          [1.6, "0°"],
          [2.4, "+90°"],
        ].map(([t, name]) => (
          <g key={name}>
            <line x1={xz(+t)} x2={xz(+t)} y1={ZH - 6} y2={ZL + 3} className="fig-wire" strokeDasharray="3 3" />
            <text x={xz(+t)} y={ZH - 10} textAnchor="middle" className="fig-value small">{name}</text>
            <text x={xz(+t)} y={ZL + 13} textAnchor="middle" className="fig-label dim">{t} ms</text>
          </g>
        ))}
        <text x="4" y={ZH + 16} className="fig-label">pulse</text>
        <text x="4" y={ZH + 27} className="fig-label dim">width</text>
        <path d={`M${X0},${ZL} V${ZH} H${xz(ms)} V${ZL} Z`} fill="var(--accent-soft)" />
        <path d={zoom} className="fig-trace" style={{ stroke: "var(--hi)" }} />
        <path d={`M${xz(ms) - 5},${(ZH + ZL) / 2} h-5 l3,-3 m-3,3 l3,3 M${xz(ms) + 5},${(ZH + ZL) / 2} h5 l-3,-3 m3,3 l-3,3`} className="fig-sample-arrow" style={{ strokeWidth: 1.4 }} />
        <text x={Math.min(xz(ms), X1 - 20)} y={ZL + 26} textAnchor="middle" className="fig-value small">{ms.toFixed(2)} ms</text>
        <rect x={xz(ms) - 12} y={ZH - 4} width="24" height={ZL - ZH + 8} className="srvp-grab" {...drag}><title>Drag to change the pulse width</title></rect>
        {/* servo */}
        <rect x={DX - 30} y={DY - 6} width="60" height="46" rx="5" className="fig-box" />
        <path d={`M${DX - R},${DY} A${R},${R} 0 0 1 ${DX + R},${DY}`} className="fig-wire" strokeDasharray="2 3" />
        {[-90, -45, 0, 45, 90].map((d) => {
          const [ax, ay] = tip(d, R);
          const [bx, by] = tip(d, R + 4);
          const [lx, ly] = tip(d, R + 11);
          return (
            <g key={d}>
              <line x1={ax} y1={ay} x2={bx} y2={by} className="fig-wire" />
              {d % 90 === 0 && <text x={d === 0 ? lx : DX - Math.sign(d) * (R + 5)} y={d === 0 ? ly : DY - 8} textAnchor={d === 0 ? "middle" : d > 0 ? "end" : "start"} className="fig-label dim">{d > 0 ? "+" : ""}{d}°</text>}
            </g>
          );
        })}
        <line x1={DX} y1={DY} x2={hx} y2={hy} stroke={over ? "var(--bad)" : "var(--accent)"} strokeWidth="6" strokeLinecap="round" />
        <circle cx={DX} cy={DY} r="6" className="fig-box" />
        <circle cx={DX} cy={DY} r="1.8" className="fig-dot" />
        <text x={DX} y={DY + 26} textAnchor="middle" className="fig-value">{angle.toFixed(1).replace(/\.0$/, "")}°</text>
        <text x={DX} y={DY + 54} textAnchor="middle" className="fig-label" style={over ? { fill: "var(--bad)" } : undefined}>{over ? "! at the stop" : "servo arm"}</text>
      </svg>
      <div className="srvp-read">
        <div>Pulse width<b>{ms.toFixed(2)} ms</b>{cmpa} x 640 ns</div>
        <div>Duty cycle<b>{duty.toFixed(2).replace(/\.?0+$/, "")} %</b>{cmpa} / {TBPRD}</div>
        <div>Angle<b>{angle.toFixed(1).replace(/\.0$/, "")}°</b>{over ? "limited by the stop" : "90° per 0.8 ms"}</div>
      </div>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Pulse</span>
          <input type="range" min={CMIN} max={CMAX} step={STEP} value={cmpa} aria-label="CMPA, the pulse width in counts" onChange={(e) => setCmpa(+e.target.value)} />
          <code>CMPA = {cmpa}</code>
        </div>
        <div>
          <span>Angle</span>
          {[-90, -45, 0, 45, 90].map((d) => (
            <button key={d} className="fig-opt" aria-pressed={cmpa === CENTRE + (d * PER_90) / 90} aria-label={`${d} degrees`} onClick={() => setCmpa(CENTRE + (d * PER_90) / 90)}>{d > 0 ? "+" : ""}{d}°</button>
          ))}
        </div>
      </div>
      <pre><code>{`EPwm8Regs.TBCTL.bit.CLKDIV = 5;  // /32: 640 ns a count\nEPwm8Regs.TBPRD = ${TBPRD};         // 20 ms\nEPwm8Regs.CMPA.bit.CMPA = ${cmpa};  // ${ms.toFixed(2)} ms${over ? "" : `\n// = ${CENTRE} + (${angle.toFixed(1).replace(/\.0$/, "")}) * ${PER_90}.0 / 90.0`}`}</code></pre>
      <figcaption>Top: the whole 20 ms frame, in which the pulse is only a sliver. Below: the first 3.2 ms enlarged; the falling edge can be dragged. At 50 MHz a 20 ms frame would be a million counts, too many for the 16-bit TBPRD, so the clock is divided, here by 32.</figcaption>
    </figure>
  );
}

export const figure = { id: "servo-pulse", Component: ServoPulse };
