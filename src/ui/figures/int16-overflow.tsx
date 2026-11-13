import { useState } from "react";

// A 16-bit int holds -32768 to 32767 and wraps around (course L4, HW1; on
// the C28x compiler int is 16 bits and long is 32). Arithmetic between two
// ints is done in 16 bits whatever the result is stored in; if one operand
// is long, C converts the other to long and works in 32 bits.

type Op = "+" | "-" | "*";

const CSS = `
.io-row { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
.io-row label { color: var(--dim); font-size: 0.82rem; width: 4.6rem; }
.io-row input[type="number"] { width: 5.6rem; font-family: var(--mono); font-size: 0.85rem; background: var(--bg); color: var(--harvest); border: 1px solid var(--dim); border-radius: 4px; padding: 0.1em 0.3em; }
.io-row input[type="range"] { flex: 1; min-width: 7rem; accent-color: var(--orange); }
.io-code { display: block; margin: 0.5rem 0 0; padding: 0.4rem 0.6rem; background: var(--inset, var(--bg)); border-radius: 6px; font-size: 0.85rem; white-space: pre-wrap; }
.io-ring { fill: none; stroke: var(--dim); stroke-width: 7; opacity: 0.45; }
.io-path { fill: none; stroke: var(--harvest); stroke-width: 2; }
.io-seam { stroke: var(--bad); stroke-width: 2.5; }
.io-big { fill: var(--harvest); font-family: var(--mono); font-weight: 700; font-size: 15px; }
.io-bad { fill: var(--bad); }
.io-ok { fill: var(--ok); }
`;

const CX = 110;
const CY = 101;
const R = 70;
const pt = (v: number, r: number) => {
  const a = (v / 65536) * 2 * Math.PI;
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
};
const clamp = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v) || 0));
const PRESETS: [string, number, Op, number][] = [
  ["32767 + 1", 32767, "+", 1],
  ["200 * 1000", 200, "*", 1000],
  ["30000 + 10000", 30000, "+", 10000],
  ["-32768 - 1", -32768, "-", 1],
];

function Int16Overflow() {
  const [a, setA] = useState(32767);
  const [b, setB] = useState(1);
  const [op, setOp] = useState<Op>("+");
  const [long, setLong] = useState(false);
  const truth = op === "+" ? a + b : op === "-" ? a - b : a * b;
  const wrapped = ((((truth + 32768) % 65536) + 65536) % 65536) - 32768;
  const laps = Math.round((truth - wrapped) / 65536); // signed number of 65536s lost
  const overflow = laps !== 0;
  const stored = long ? truth : wrapped;
  // The walk from the starting value to the true result, wound round the
  // wheel; each further lap is drawn a little further in. At most 4 laps.
  const from = op === "*" ? 0 : a;
  const span = truth - from;
  const shownSpan = Math.sign(span) * Math.min(Math.abs(span), 4 * 65536);
  const start = truth - shownSpan;
  const steps = Math.max(2, Math.ceil((Math.abs(shownSpan) / 65536) * 72));
  const R0 = R - 9;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const v = start + (shownSpan * i) / steps;
    const [px, py] = pt(v, R0 - (Math.abs(v - start) / 65536) * 9);
    d += `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)} `;
  }
  const [sx, sy] = pt(start, R0);
  const [tx, ty] = pt(truth, R0 - (Math.abs(shownSpan) / 65536) * 9);
  const [ex, ey] = pt(truth, R);
  const hex = "0x" + (wrapped & 0xffff).toString(16).toUpperCase().padStart(4, "0");
  const bText = b < 0 ? `(${b})` : String(b);
  const expr = `${a} ${op} ${bText}`;
  const lapText = `${Math.abs(laps)} x 65536`;
  const why = long
    ? `One operand is a long, so C converts the other to long as well and does the arithmetic in 32 bits (about plus or minus 2 billion). ${truth} fits${overflow ? "; in 16 bits it would not" : ""}.`
    : overflow
      ? `${expr} should be ${truth}, which is ${truth > 0 ? "above 32767" : "below -32768"}. The count runs off one end of the 16-bit range and comes back in at the other${Math.abs(laps) > 1 ? `, ${Math.abs(laps)} times` : ""}: the chip keeps ${truth} ${laps > 0 ? "-" : "+"} ${lapText} = ${wrapped}. No error, no warning. Storing the result in a 32-bit variable does not help: the damage is done before the assignment.`
      : `${expr} = ${truth} fits between -32768 and 32767, so 16-bit arithmetic gives the right answer.`;
  const num = (label: string, v: number, set: (v: number) => void) => (
    <div className="io-row">
      <label htmlFor={`io-${label}`}>{label}</label>
      <input id={`io-${label}`} type="number" min={-32768} max={32767} value={v} onChange={(e) => set(clamp(+e.target.value))} />
      <input type="range" aria-label={`${label}, slider`} min={-32768} max={32767} value={v} onChange={(e) => set(clamp(+e.target.value))} />
    </div>
  );
  return (
    <figure className="figure" aria-label="Interactive 16-bit integer overflow wheel">
      <style>{CSS}</style>
      <svg viewBox="0 0 400 208" role="img" aria-label={`${expr} is ${truth}. ${long ? "Computed in 32 bits" : "Computed in 16 bits"} the result is ${stored}${!long && overflow ? ", wrapped around" : ""}.`}>
        <text x={CX} y="9" textAnchor="middle" className="fig-label dim">every value a 16-bit int can hold</text>
        <circle cx={CX} cy={CY} r={R} className="io-ring" />
        {/* quarter marks */}
        <text x={CX} y={CY - R - 7} textAnchor="middle" className="fig-value small">0</text>
        <text x={CX + R + 7} y={CY + 3} className="fig-value small">16384</text>
        <text x={CX - R - 7} y={CY + 3} textAnchor="end" className="fig-value small">-16384</text>
        <line x1={CX} y1={CY + R - 9} x2={CX} y2={CY + R + 9} className="io-seam" />
        <text x={CX + 5} y={CY + R + 17} className="fig-value small">32767</text>
        <text x={CX - 5} y={CY + R + 17} textAnchor="end" className="fig-value small">-32768</text>
        <text x={CX} y={CY + R + 27} textAnchor="middle" className="fig-label io-bad">the two ends meet here</text>
        <text x={CX + 56} y={CY - 58} className="fig-label dim">positive</text>
        <text x={CX - 56} y={CY - 58} textAnchor="end" className="fig-label dim">negative</text>
        {/* the walk */}
        <path d={d} className="io-path" style={{ strokeDasharray: Math.abs(span) > 4 * 65536 ? "2 3" : undefined, opacity: long ? 0.45 : 1 }} />
        <line x1={tx} y1={ty} x2={ex} y2={ey} className="io-path" style={{ strokeDasharray: "2 2", opacity: long ? 0.45 : 1 }} />
        <circle cx={sx} cy={sy} r="3" className="fig-dot" />
        <circle cx={ex} cy={ey} r="5.5" style={{ fill: !long && overflow ? "var(--bad)" : "var(--ok)", stroke: "var(--bg)", strokeWidth: 1.5 }} />
        {/* results */}
        <rect x="216" y="14" width="180" height="48" rx="5" className="fig-box" />
        <text x="224" y="28" className="fig-label dim">true value of {expr}</text>
        <text x="224" y="50" className="io-big">{truth}</text>
        <text x="306" y="78" textAnchor="middle" className="fig-label">
          {long ? "32 bits wide: nothing is cut off" : overflow ? `only 16 bits kept: ${laps > 0 ? "-" : "+"} ${lapText}` : "fits in 16 bits: nothing is cut off"}
        </text>
        <path d="M306,83 V94 M301,89 L306,95 L311,89" className="fig-wire" />
        <rect x="216" y="100" width="180" height="62" rx="5" className={`fig-box ${!long && overflow ? "hot" : "active"}`} />
        <text x="224" y="114" className="fig-label dim">{long ? "what the chip computes (32-bit long)" : "what the chip computes (16-bit int)"}</text>
        <text x="224" y="137" className={`io-big ${!long && overflow ? "io-bad" : "io-ok"}`}>{stored}</text>
        <text x="224" y="153" className="fig-label">{long ? "correct" : overflow ? `WRONG: bits ${hex}, the low 16 bits` : `correct: bits ${hex}`}</text>
        <text x="216" y="178" className="fig-label dim">Small dot: where the walk starts.</text>
        <text x="216" y="189" className="fig-label dim">Large dot: where the result lands.</text>
      </svg>
      <code className="io-code">
        {`int32_t r = ${a} ${op} ${bText}${long ? "L" : ""};   // ${long ? "int and long: done in 32 bits" : "int and int: done in 16 bits"}\n// r = ${stored}`}
      </code>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        {num("First int", a, setA)}
        <div>
          <span>Operation</span>
          <button className="fig-opt" aria-pressed={op === "+"} onClick={() => setOp("+")}>add +</button>
          <button className="fig-opt" aria-pressed={op === "-"} onClick={() => setOp("-")}>subtract -</button>
          <button className="fig-opt" aria-pressed={op === "*"} onClick={() => setOp("*")}>multiply *</button>
        </div>
        {num("Second", b, setB)}
        <div>
          <span>Second is</span>
          <button className="fig-opt" aria-pressed={!long} onClick={() => setLong(false)}>an int</button>
          <button className="fig-opt" aria-pressed={long} onClick={() => setLong(true)}>a long (L)</button>
        </div>
        <div>
          <span>Examples</span>
          {PRESETS.map(([name, pa, po, pb]) => (
            <button key={name} className="fig-opt" onClick={() => { setA(pa); setOp(po); setB(pb); }}>{name}</button>
          ))}
        </div>
      </div>
      <figcaption>The 16-bit values form a circle, not a line: one step past 32767 is -32768. The line walks from the starting value to the true result, one lap further in each time round; every time it passes the mark at the bottom, the stored number is off by another 65536.</figcaption>
    </figure>
  );
}

export const figure = { id: "int16-overflow", Component: Int16Overflow };
