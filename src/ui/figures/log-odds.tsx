import { useState } from "react";

// One cell of an occupancy grid in log-odds (lectures 24-25), with the
// numbers of the level "Log-odds":
//   l = ln(p / (1 - p)),  p = 1 - 1 / (1 + e^l)
//   l_new = l_old + l_sensor - l_0,  prior 0.5 so l_0 = 0
//   beam ends in the cell: p = 0.8, l_sensor = ln 4 = +1.386
//   beam passes through:   p = 0.3, l_sensor = ln(3/7) = -0.847
// The limit (clamp) is not in the course's level: it is the usual
// addition in real mapping code, so that a cell that has been seen
// occupied a hundred times can still be cleared by a few beams.

const P_HIT = 0.8;
const P_PASS = 0.3;
const L_HIT = Math.log(P_HIT / (1 - P_HIT));
const L_PASS = Math.log(P_PASS / (1 - P_PASS));
const L_LIMIT = 4;
const AXIS = 6; // the drawn log-odds axis runs from -AXIS to +AXIS

const prob = (l: number) => 1 - 1 / (1 + Math.exp(l));
const f3 = (v: number) => v.toFixed(3);
/** A probability: more digits near 0 and 1, so it never reads as exactly certain. */
const fp = (v: number) => (v > 0.9999995 ? "0.999999..." : v < 0.0000005 ? "0.000000..." : v > 0.9995 || v < 0.0005 ? v.toFixed(6) : v.toFixed(3));
const signed = (v: number) => (v < 0 ? "- " : "+ ") + Math.abs(v).toFixed(3);

function LogOdds() {
  // true = the beam ended in the cell (hit), false = it passed through.
  const [events, setEvents] = useState<boolean[]>([]);
  const [clamp, setClamp] = useState(true);
  // The history is kept so the limit can be switched afterwards; 300 beams are plenty.
  const add = (more: boolean[]) => setEvents((ev) => [...ev, ...more].slice(-300));

  let l = 0;
  let before = 0;
  let limited = false;
  for (const hit of events) {
    before = l;
    const raw = l + (hit ? L_HIT : L_PASS);
    l = clamp ? Math.max(-L_LIMIT, Math.min(L_LIMIT, raw)) : raw;
    limited = l !== raw;
  }
  const p = prob(l);
  const last = events.length ? events[events.length - 1] : null;
  const hits = events.filter(Boolean).length;
  const passes = events.length - hits;
  // How many opposite beams until the belief crosses p = 0.5 again.
  const toFlip = l > 0 ? Math.floor(l / -L_PASS) + 1 : l < 0 ? Math.floor(-l / L_HIT) + 1 : 0;

  const X0 = 76;
  const X1 = 404;
  const xl = (v: number) => X0 + ((Math.max(-AXIS, Math.min(AXIS, v)) + AXIS) / (2 * AXIS)) * (X1 - X0);
  const xp = (v: number) => X0 + v * (X1 - X0);
  const off = Math.abs(l) > AXIS;
  const verdict = p > 0.65 ? "probably occupied" : p < 0.35 ? "probably free" : events.length ? "undecided" : "no idea yet";

  const shown = events.slice(-3);
  const sum = `${events.length > shown.length ? "... " : "0 "}${shown.map((h) => signed(h ? L_HIT : L_PASS)).join(" ")}`;
  const status =
    last === null
      ? "Nothing has been measured: p = 0.5, which is log-odds 0. Send beams. Every hit adds the same amount of log-odds, but the probability moves less and less as it nears 0 or 1."
      : `${last ? "The beam ended in this cell: evidence for occupied, add 1.386." : "The beam passed through this cell: evidence for free, add -0.847."} ${hits} hit${hits === 1 ? "" : "s"} and ${passes} pass-through${passes === 1 ? "" : "s"} so far give l = ${f3(l)}, p = ${fp(p)}: ${verdict}.${limited ? ` The sum would be ${f3(before + (last ? L_HIT : L_PASS))}, but the limit holds it at ${l > 0 ? "+" : "-"}${L_LIMIT.toFixed(1)}.` : ""}${toFlip ? ` It would now take ${toFlip} ${l > 0 ? "pass-through" : "hit"}${toFlip === 1 ? "" : "s"} in a row to bring it back across p = 0.5.` : ""}${!clamp && Math.abs(l) > L_LIMIT ? " Without a limit every further beam makes the cell harder to change: a door that was closed for a minute stays in the map as a wall long after it opens." : ""}`;

  return (
    <figure className="figure" aria-label="One occupancy-grid cell updated in log-odds by LIDAR beams">
      <style>{`
        .lodd-cell { stroke: var(--text); stroke-width: 1.5; fill: var(--surface); }
        .lodd-fill { fill: var(--orange); }
        .lodd-beam { stroke: var(--bad); stroke-width: 2; fill: none; }
        .lodd-beam.idle { stroke: var(--dim); stroke-dasharray: 3 3; stroke-width: 1.2; }
        .lodd-beamhead { fill: var(--bad); }
        .lodd-axis { stroke: var(--dim); stroke-width: 1.2; }
        .lodd-limit { stroke: var(--text); stroke-width: 1.2; stroke-dasharray: 3 2; }
        .lodd-track { fill: var(--surface); stroke: var(--dim); stroke-width: 1; }
        .lodd-mark { fill: var(--harvest); stroke: var(--text); stroke-width: 1; }
        .lodd-bar { fill: var(--orange); }
        .lodd-barneg { fill: var(--arches); }
      `}</style>
      <svg viewBox="0 0 420 178" role="img" aria-label={`${hits} hit${hits === 1 ? "" : "s"} and ${passes} pass-through${passes === 1 ? "" : "s"}. Log-odds ${f3(l)}, probability occupied ${fp(p)}: ${verdict}.${limited ? " Held at the limit." : ""}`}>
        {/* the beam and the cell */}
        <rect x="6" y="22" width="46" height="26" rx="4" className="fig-box" />
        <text x="29" y="38" textAnchor="middle" className="fig-label">LIDAR</text>
        <rect x="150" y="12" width="46" height="46" className="lodd-cell" />
        <rect x="150" y={12 + 46 * (1 - p)} width="46" height={46 * p} className="lodd-fill" />
        <rect x="150" y="12" width="46" height="46" fill="none" className="lodd-cell" style={{ fill: "none" }} />
        <text x="173" y="70" textAnchor="middle" className="fig-label dim">the cell</text>
        {last === null ? (
          <path d="M52 35 H148" className="lodd-beam idle" />
        ) : last ? (
          <>
            <path d="M52 35 H146" className="lodd-beam" />
            <path d="M149 35 l-8,-4.5 v9 Z" className="lodd-beamhead" />
            <text x="100" y="28" textAnchor="middle" className="fig-label">beam ends here: hit</text>
          </>
        ) : (
          <>
            <path d="M52 35 H262" className="lodd-beam" />
            <path d="M266 35 l-8,-4.5 v9 Z" className="lodd-beamhead" />
            <rect x="270" y="14" width="6" height="42" className="fig-box" />
            <text x="100" y="28" textAnchor="middle" className="fig-label">beam passes through</text>
            <text x="282" y="38" className="fig-label dim">it ends further on</text>
          </>
        )}
        <text x="206" y={last === false ? 68 : 30} className="fig-value">p = {fp(p)}</text>
        <text x="206" y={last === false ? 80 : 44} className="fig-label">{verdict}</text>
        {/* log-odds axis */}
        <text x="4" y="110" className="fig-label">log-odds l</text>
        <line x1={X0} x2={X1} y1="106" y2="106" className="lodd-axis" />
        {[-6, -4, -2, 0, 2, 4, 6].map((v) => (
          <g key={v}>
            <line x1={xl(v)} x2={xl(v)} y1="102" y2="110" className="lodd-axis" />
            <text x={xl(v)} y="121" textAnchor="middle" className="fig-label dim">{v > 0 ? `+${v}` : v}</text>
          </g>
        ))}
        <rect x={Math.min(xl(0), xl(l))} y="103" width={Math.abs(xl(l) - xl(0))} height="6" className={l >= 0 ? "lodd-bar" : "lodd-barneg"} />
        {clamp && [-L_LIMIT, L_LIMIT].map((v) => <line key={v} x1={xl(v)} x2={xl(v)} y1="97" y2="112" className="lodd-limit" />)}
        {clamp && <text x={xl(L_LIMIT)} y="132" textAnchor="middle" className="fig-label dim">limit</text>}
        {clamp && <text x={xl(-L_LIMIT)} y="132" textAnchor="middle" className="fig-label dim">limit</text>}
        <path d={`M${xl(l)},102 l-5,-8 h10 Z`} className="lodd-mark" />
        <text x={Math.max(X0 + 14, Math.min(X1 - 14, xl(l)))} y="90" textAnchor="middle" className="fig-value small">{off ? (l > 0 ? `${f3(l)} →` : `← ${f3(l)}`) : f3(l)}</text>
        <text x={X0} y="132" className="fig-label dim">free</text>
        <text x={xl(0)} y="132" textAnchor="middle" className="fig-label dim">no idea</text>
        <text x={X1} y="132" textAnchor="end" className="fig-label dim">occupied</text>
        {/* probability bar */}
        <text x="4" y="156" className="fig-label">probability p</text>
        <rect x={X0} y="146" width={X1 - X0} height="12" rx="2" className="lodd-track" />
        <rect x={X0} y="146" width={Math.max(0.5, xp(p) - X0)} height="12" rx="2" className="lodd-bar" />
        <line x1={xp(0.5)} x2={xp(0.5)} y1="143" y2="161" className="lodd-limit" />
        {[0, 0.5, 1].map((v) => (
          <text key={v} x={xp(v)} y="172" textAnchor={v === 0 ? "start" : v === 1 ? "end" : "middle"} className="fig-label dim">{v}</text>
        ))}
        <text x={Math.max(X0 + 40, Math.min(X1 - 40, xp(p)))} y="172" textAnchor="middle" className="fig-value small">{Math.abs(p - 0.5) < 0.08 ? "" : fp(p)}</text>
      </svg>
      <div className="fig-controls">
        <div>
          <span>Beam</span>
          <button className="btn small primary" onClick={() => add([true])}>Beam hit</button>
          <button className="btn small" onClick={() => add([false])}>Beam passed through</button>
          <button className="btn small" onClick={() => add(new Array<boolean>(10).fill(true))}>10 hits</button>
          <button className="btn small ghost" onClick={() => setEvents([])} disabled={!events.length}>Reset</button>
        </div>
        <div>
          <span>Limit</span>
          <button className="fig-opt" aria-pressed={clamp} onClick={() => setClamp(!clamp)}>Limit l to ±{L_LIMIT}</button>
        </div>
      </div>
      <div className="fig-step" role="status">
        <p>{status}</p>
        <pre><code>{`// l: ${sum} = ${f3(l)}${limited ? " (limited)" : ""}
logodds = logodds + l_sensor - L_0;   // L_0 = 0
${clamp ? `if (logodds > ${L_LIMIT}.0f) logodds = ${L_LIMIT}.0f;\nif (logodds < -${L_LIMIT}.0f) logodds = -${L_LIMIT}.0f;\n` : ""}p = 1 - 1 / (1 + exp(logodds));       // ${fp(p)}`}</code></pre>
      </div>
      <figcaption>A hit says "occupied with p = 0.8" (l_sensor = +1.386), a pass-through says "occupied with p = 0.3" (l_sensor = -0.847). In log-odds, each new piece of evidence is one addition. Mapping code usually also limits l (here to ±{L_LIMIT}, p = {f3(prob(-L_LIMIT))} to {f3(prob(L_LIMIT))}) so that a few beams can still change a cell when the world changes.</figcaption>
    </figure>
  );
}

export const figure = { id: "log-odds", Component: LogOdds };
