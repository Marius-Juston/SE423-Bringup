import { useEffect, useReducer, useRef, useState } from "react";
import { COULOMB, GAIN, MAX_EFFORT, stepWheel } from "../../sim/plugins/plant";

// The feedback loop of chapter 16 with live numbers. Not a chip peripheral,
// so no TRM section applies: the wheel is the test bench model of
// src/sim/plugins/plant.ts (stepWheel is imported from it), the controller is
// the chapter's PI code (Kp = 8, Ki = 100, 1 ms, clamping), and "load" is the
// bench's TB_LOAD input, in effort units.

const KP = 8;
const KI = 100;
const LOAD = 3;
const HIST = 1200; // ms of history drawn
const fmt = (v: number, d = 2) => {
  const s = v.toFixed(d);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
};

interface Sim {
  t: number;
  v: number;
  I: number;
  e: number;
  uRaw: number;
  u: number;
  hist: { v: number; r: number }[];
}

function FeedbackLoop() {
  const [r, setR] = useState(1);
  const [closed, setClosed] = useState(true);
  const [load, setLoad] = useState(false);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const sim = useRef<Sim>({ t: 0, v: 1, I: 0.048, e: 0, uRaw: 4.8, u: 4.8, hist: Array.from({ length: HIST }, () => ({ v: 1, r: 1 })) });
  const params = useRef({ r, closed, load });
  params.current = { r, closed, load };
  const first = useRef(true);

  /** One pass of the 1 ms interrupt, then 1 ms of wheel. */
  const step = () => {
    const s = sim.current;
    const p = params.current;
    const w = { v: s.v };
    if (p.closed) {
      s.e = p.r - s.v;
      s.uRaw = KP * s.e + KI * (s.I + s.e * 0.001);
      if (s.uRaw > MAX_EFFORT) s.u = MAX_EFFORT;
      else if (s.uRaw < -MAX_EFFORT) s.u = -MAX_EFFORT;
      else {
        s.u = s.uRaw;
        s.I += s.e * 0.001;
      }
    } else {
      // Open loop: the effort the wheel's own line says this speed needs.
      s.e = p.r - s.v;
      s.uRaw = p.r > 0 ? p.r / GAIN + COULOMB : 0;
      s.u = Math.min(MAX_EFFORT, s.uRaw);
      s.I = 0;
    }
    stepWheel(w, s.u - (p.load ? LOAD : 0), 0.001);
    s.v = w.v;
    s.t++;
    s.hist.push({ v: s.v, r: p.r });
    if (s.hist.length > HIST) s.hist.shift();
  };
  const settled = () => {
    const h = sim.current.hist;
    if (h.length < 120) return false;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = h.length - 120; i < h.length; i++) {
      lo = Math.min(lo, h[i].v);
      hi = Math.max(hi, h[i].v);
    }
    return hi - lo < 0.0005 && h[h.length - 120].r === params.current.r;
  };

  // The loop only runs after the student changed something, and stops once the wheel has settled.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      for (let i = 0; i < 4000 && !(i > 150 && settled()); i++) step();
      redraw();
      return;
    }
    let raf = 0;
    let n = 0;
    const frame = () => {
      for (let i = 0; i < 4; i++) step();
      n += 4;
      redraw();
      if (n < 6000 && !(n > 150 && settled())) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [r, closed, load]);

  const s = sim.current;
  const sat = Math.abs(s.uRaw) > MAX_EFFORT;
  const off = Math.abs(r - s.v);
  const h = s.hist;
  const top = 2.4;
  const px = (i: number) => 40 + ((HIST - h.length + i) / HIST) * 372;
  const py = (v: number) => 206 - (Math.max(0, Math.min(top, v)) / top) * 52;
  const line = (f: (p: { v: number; r: number }) => number) => {
    let d = "";
    for (let i = 0; i < h.length; i += 3) d += `${d ? "L" : "M"}${px(i).toFixed(1)},${py(f(h[i])).toFixed(1)}`;
    return d + `L${px(h.length - 1).toFixed(1)},${py(f(h[h.length - 1])).toFixed(1)}`;
  };
  const fb = closed ? "fig-wire hot" : "fig-wire fb-off";

  const why = closed
    ? off < 0.01
      ? `Closed loop: the encoder reports ${fmt(s.v)} ft/s, the error is 0, and the integral holds the effort at ${fmt(s.u, 1)}${load ? `: ${fmt(LOAD, 0)} more than without the load. The controller found that by itself` : ""}.`
      : sat
        ? `Closed loop: the controller asks for ${fmt(s.uRaw, 1)} but the amplifier only takes ${MAX_EFFORT}. The wheel gives all it has: ${fmt(s.v)} ft/s.`
        : `Closed loop: the wheel is at ${fmt(s.v)} ft/s, ${s.v < r ? "too slow" : "too fast"} by ${fmt(off)}. The error ${s.v < r ? "raises" : "lowers"} the effort until it is gone.`
    : off < 0.01
      ? `Open loop: the effort ${fmt(s.u, 1)} comes from a table (4 x ${fmt(r, 1)} + 0.8). It happens to be right, because nothing has disturbed the wheel. Add the load.`
      : `Open loop: the effort stays at ${fmt(s.u, 1)} whatever the wheel does. ${load ? "With the load the wheel" : "The wheel"} ${Math.abs(s.v) < 0.005 ? "stands still" : `runs at ${fmt(s.v)} ft/s`} instead of ${fmt(r, 1)}, and nobody notices: the measurement is not used.`;

  return (
    <figure className="figure fb-fig" aria-label="Interactive block diagram of a speed control loop, open and closed">
      <style>{`.fb-fig .fb-range{flex:1;min-width:140px;accent-color:var(--orange)}.fb-fig .fb-off{stroke-dasharray:3 3;opacity:.5}.fb-fig .fb-ref{fill:none;stroke:var(--dim);stroke-width:1.3;stroke-dasharray:4 3}.fb-fig .fb-grid{stroke:var(--border);stroke-width:1}.fb-fig .fb-sat{fill:var(--bad)}`}</style>
      <svg viewBox="0 0 420 222" role="img" aria-label={`${closed ? "Closed" : "Open"} loop${load ? " with load" : ""}. Reference ${fmt(r, 1)}, speed ${fmt(s.v)} feet per second, effort ${fmt(s.u, 1)}.`}>
        <defs>
          <marker id="fb-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" className="fig-arrowhead" />
          </marker>
        </defs>
        {/* reference */}
        <text x={4} y={36} className="fig-label dim">reference r</text>
        <text x={4} y={49} className="fig-value">{fmt(r, 2)}</text>
        {closed && <path d="M38 52 H51" className="fig-wire" markerEnd="url(#fb-arrow)" />}
        {/* compare */}
        {closed && <circle cx={60} cy={52} r={8} className="fig-box" />}
        {closed && <text x={60} y={55} textAnchor="middle" className="fig-label">+</text>}
        {closed && <text x={67} y={73} className="fig-label">-</text>}
        <path d={closed ? "M68 52 H97" : "M38 52 H97"} className="fig-wire" markerEnd="url(#fb-arrow)" />
        <text x={83} y={36} textAnchor="middle" className="fig-label dim">{closed ? "error e" : ""}</text>
        <text x={83} y={47} textAnchor="middle" className="fig-value small">{closed ? fmt(s.e, 2) : ""}</text>
        {/* controller */}
        <rect x={99} y={32} width={78} height={40} rx={4} className={`fig-box ${closed ? "hot" : ""}`} />
        <text x={138} y={46} textAnchor="middle" className="fig-label">{closed ? "PI controller" : "table"}</text>
        <text x={138} y={58} textAnchor="middle" className="fig-label dim">{closed ? "8 e + 100 ∫e" : "u = 4 r + 0.8"}</text>
        {closed && <text x={138} y={68} textAnchor="middle" className="fig-label dim">∫e = <tspan className="fig-value small">{fmt(s.I, 3)}</tspan></text>}
        <path d="M177 52 H207" className="fig-wire" markerEnd="url(#fb-arrow)" />
        <text x={192} y={47} textAnchor="middle" className="fig-value small">{fmt(s.uRaw, 1)}</text>
        {/* saturation */}
        <rect x={209} y={32} width={50} height={40} rx={4} className={`fig-box ${sat ? "hot" : ""}`} />
        <path d="M216 62 H224 L244 42 H252" className="fig-trace" />
        <text x={234} y={28} textAnchor="middle" className="fig-label dim">limit ±10</text>
        <path d="M259 52 H295" className="fig-wire" markerEnd="url(#fb-arrow)" />
        <text x={277} y={36} textAnchor="middle" className="fig-label dim">effort u</text>
        <text x={277} y={47} textAnchor="middle" className="fig-value small">{fmt(s.u, 1)}</text>
        {/* motor and wheel */}
        <rect x={297} y={32} width={62} height={40} rx={4} className="fig-box" />
        <text x={328} y={49} textAnchor="middle" className="fig-label">motor</text>
        <text x={328} y={61} textAnchor="middle" className="fig-label">and wheel</text>
        <path d="M328 12 V30" className={load ? "fig-wire hot" : "fig-wire fb-off"} markerEnd="url(#fb-arrow)" />
        <text x={334} y={18} className="fig-label" opacity={load ? 1 : 0.5}>load {load ? `-${LOAD}` : "0"}</text>
        <path d="M359 52 H412" className="fig-wire" markerEnd="url(#fb-arrow)" />
        <text x={390} y={36} textAnchor="middle" className="fig-label dim">speed v</text>
        <text x={390} y={47} textAnchor="middle" className="fig-value">{fmt(s.v, 2)}</text>
        {/* feedback path */}
        <circle cx={376} cy={52} r={2.2} className="fig-dot" />
        <path d="M376 52 V102 H262" className={fb} />
        <rect x={190} y={88} width={72} height={28} rx={4} className={`fig-box ${closed ? "" : "off"}`} />
        <text x={226} y={100} textAnchor="middle" className="fig-label" opacity={closed ? 1 : 0.5}>encoder</text>
        <text x={226} y={111} textAnchor="middle" className="fig-label dim" opacity={closed ? 1 : 0.5}>{closed ? `measures ${fmt(s.v, 2)}` : "not used"}</text>
        <path d={closed ? "M190 102 H60 V62" : "M190 102 H60 V70"} className={fb} markerEnd={closed ? "url(#fb-arrow)" : undefined} />
        {!closed && <text x={60} y={66} textAnchor="middle" className="fig-label dim">not connected</text>}
        {/* speed over time */}
        <text x={40} y={146} className="fig-label">speed <tspan className="fig-label dim">and reference (dashed), last 1.2 s, slowed down 4 times</tspan></text>
        <line x1={40} x2={412} y1={206} y2={206} className="fb-grid" />
        <line x1={40} x2={412} y1={py(2)} y2={py(2)} className="fb-grid" />
        <line x1={40} x2={412} y1={py(1)} y2={py(1)} className="fb-grid" />
        <text x={36} y={209} textAnchor="end" className="fig-label dim">0</text>
        <text x={36} y={py(1) + 3} textAnchor="end" className="fig-label dim">1</text>
        <text x={36} y={py(2) + 3} textAnchor="end" className="fig-label dim">2 ft/s</text>
        <path d={line((p) => p.r)} className="fb-ref" />
        <path d={line((p) => p.v)} className="fig-trace data" />
        <text x={412} y={218} textAnchor="end" className="fig-label dim">now</text>
      </svg>
      <div className="fig-controls">
        <div>
          <span>Reference</span>
          <input className="fb-range" type="range" aria-label="Reference speed" min={0} max={2} step={0.1} value={r} onChange={(e) => setR(+e.target.value)} />
          <code>vref = {fmt(r, 1)};</code>
        </div>
        <div>
          <span>Loop</span>
          <button className="fig-opt" aria-pressed={closed} onClick={() => setClosed(true)}>closed loop</button>
          <button className="fig-opt" aria-pressed={!closed} onClick={() => setClosed(false)}>open loop</button>
        </div>
        <div>
          <span>Disturb</span>
          <button className="fig-opt" aria-pressed={load} onClick={() => setLoad(!load)}>load on the wheel (3 units of effort)</button>
        </div>
      </div>
      <div className="fig-why" role="status">{why}</div>
      <figcaption>One pass every millisecond: measure, compare, compute, saturate, actuate. Open loop sends the effort and hopes. Closed loop looks at what happened and corrects.</figcaption>
    </figure>
  );
}

export const figure = { id: "feedback-loop", Component: FeedbackLoop };
