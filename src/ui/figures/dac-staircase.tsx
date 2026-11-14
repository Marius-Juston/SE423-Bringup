// The DAC's transfer curve, TRM section 12.1.2 (block diagram) and 12.4.2
// (DACVALS is a 12-bit field): DACOUT = DACVALA * DACREF / 4096. With the
// course's 3.0 V reference, one step is 3.0 V / 4096 = 0.732 mV. A number
// that does not fit in the field loses its upper bits: the output wraps.
import { useState } from "react";

const VREF = 3.0;
const CSS = `
.dacst input[type=range] { flex: 1 1 8rem; min-width: 6rem; padding: 0; accent-color: var(--orange); }
.dacst .dacst-num { font-family: var(--mono); color: var(--harvest); min-width: 3.2em; text-align: right; }
.dacst .dacst-bits { font-family: var(--mono); letter-spacing: 0.05em; }
.dacst .dacst-bits s { color: var(--bad); }
.dacst .dacst-bits b { color: var(--harvest); }
.dacst .dacst-halo { paint-order: stroke; stroke: var(--inset); stroke-width: 3px; stroke-linejoin: round; }
`;

function DacStaircase() {
  const [bits, setBits] = useState(12);
  const [asked, setAsked] = useState(1365);
  const [limit, setLimit] = useState(false);
  const levels = 1 << bits;
  const top = levels - 1;
  const xMax = 2 * levels - 1;
  const kept = limit ? Math.min(asked, top) : asked & top;
  const vout = (kept * VREF) / levels;
  const lsb = VREF / levels;
  const over = asked > top;

  const X0 = 40;
  const X1 = 408;
  const Y0 = 150;
  const Y1 = 22;
  const x = (n: number) => X0 + (n / (xMax + 1)) * (X1 - X0);
  const y = (v: number) => Y0 - (v / VREF) * (Y0 - Y1);
  const out = (n: number) => ((limit ? Math.min(n, top) : n & top) * VREF) / levels;
  let d = "";
  if (bits <= 4) {
    for (let n = 0; n <= xMax; n++) d += `${n ? "V" : `M${x(0)},`}${y(out(n))} H${x(n + 1)}`;
  } else {
    d = `M${x(0)},${y(0)} L${x(levels)},${y(out(top))}`;
    d += limit ? ` H${x(xMax + 1)}` : ` V${y(0)} L${x(xMax + 1)},${y(out(top))}`;
  }
  const mx = x(asked + (bits <= 4 ? 0.5 : 0));
  const my = y(vout);
  const fmtV = (v: number) => `${v.toFixed(bits <= 4 ? 4 : 5).replace(/0+$/, "").replace(/\.$/, "")} V`;
  // Value label: beside the marker, moved off the axis labels, the top labels and the wrap line.
  const vText = fmtV(vout);
  const vW = vText.length * 6.7;
  const xL = x(levels);
  let vEnd = mx >= 110;
  if (vEnd && mx - 7 - vW < xL + 2 && mx - 7 > xL - 2 && mx + 8 + vW < X1) vEnd = false;
  if (!vEnd && mx + 8 < xL - 2 && mx + 8 + vW > xL - 2) vEnd = true;
  const vX = vEnd ? mx - 7 : mx + 8;
  const vY = my < Y1 + 16 ? my + 16 : my - 7;
  const bin = asked.toString(2).padStart(bits + 1, "0");
  const setBitsKeep = (b: number) => {
    setAsked(Math.min((2 << b) - 1, Math.round((asked / (xMax + 1)) * (2 << b))));
    setBits(b);
  };
  const why = !over
    ? `${asked} fits in ${bits} bits. The output is ${asked} step${asked === 1 ? "" : "s"} of ${bits === 12 ? "0.732 mV" : fmtV(lsb)}: ${asked} x 3.0 / ${levels} = ${fmtV(vout)}.${asked === top ? " This is the top: 3.0 V itself is never reached." : ""}`
    : limit
      ? `${asked} does not fit in ${bits} bits, but the code limits it to ${top} first. The output stays at the top, ${fmtV(vout)}, which is the closest the DAC can get.`
      : `${asked} needs ${bits + 1} bits. The register keeps only the lower ${bits}: the top bit, worth ${levels}, is lost. ${asked} - ${levels} = ${kept}, so the output falls to ${fmtV(vout)} instead of staying at the top.`;

  return (
    <figure className="figure dacst" aria-label="Interactive DAC transfer curve: number written against output voltage">
      <style>{CSS}</style>
      <svg viewBox="0 0 420 182" role="img" aria-label={`Number written ${asked}, number kept ${kept}, output ${fmtV(vout)}.`}>
        {/* region that does not fit */}
        <rect x={x(levels)} y={Y1 - 8} width={X1 - x(levels)} height={Y0 - Y1 + 8} fill="var(--bad)" fillOpacity="0.1" />
        <line x1={x(levels)} x2={x(levels)} y1={Y1 - 8} y2={Y0} className="fig-wire" strokeDasharray="3 3" />
        <text x={x(levels) - 4} y={Y1 - 10} textAnchor="end" className="fig-label dim">fits in {bits} bits</text>
        <text x={x(levels) + 4} y={Y1 - 10} className="fig-label" style={{ fill: "var(--bad)" }}>too big for {bits} bits</text>
        {/* axes */}
        <line x1={X0} x2={X1} y1={Y0} y2={Y0} className="fig-wire" />
        <line x1={X0} x2={X0} y1={Y0} y2={Y1 - 8} className="fig-wire" />
        {[0, 1.5, 3].map((v) => (
          <g key={v}>
            <line x1={X0 - 3} x2={X1} y1={y(v)} y2={y(v)} stroke="var(--border)" />
            <text x={X0 - 5} y={y(v) + 3} textAnchor="end" className="fig-label">{v.toFixed(1)} V</text>
          </g>
        ))}
        <text x={x(0)} y={Y0 + 11} textAnchor="middle" className="fig-label">0</text>
        <text x={x(levels) - 3} y={Y0 + 11} textAnchor="end" className="fig-label">{top}</text>
        <text x={x(levels) + 3} y={Y0 + 11} className="fig-label">{levels}</text>
        <text x={X1} y={Y0 + 11} textAnchor="end" className="fig-label">{xMax}</text>
        <text x={(X0 + X1) / 2} y={Y0 + 26} textAnchor="middle" className="fig-label dim">number your code writes to DACVALS</text>
        {/* curve */}
        <path d={d} className="fig-trace data" strokeLinejoin="round" style={{ strokeWidth: 1.8 }} />
        {/* marker */}
        <line x1={mx} x2={mx} y1={Y0} y2={my} className="fig-sample" />
        <line x1={X0} x2={mx} y1={my} y2={my} className="fig-sample" />
        <circle cx={mx} cy={my} r="4" fill="var(--orange)" stroke="var(--text)" strokeWidth="1" />
        <text x={vX} y={vY} textAnchor={vEnd ? "end" : "start"} className="fig-value dacst-halo">{vText}</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Bits</span>
          <button className="fig-opt" aria-pressed={bits === 3} onClick={() => setBitsKeep(3)}>3 bits</button>
          <button className="fig-opt" aria-pressed={bits === 4} onClick={() => setBitsKeep(4)}>4 bits</button>
          <button className="fig-opt" aria-pressed={bits === 12} onClick={() => setBitsKeep(12)}>12 bits (the chip)</button>
          <code>one step = 3.0 V / {levels} = {bits === 12 ? "0.732 mV" : fmtV(lsb)}</code>
        </div>
        <div>
          <span>Number</span>
          <input type="range" min={0} max={xMax} value={asked} aria-label="Number written to the DAC" onChange={(e) => setAsked(+e.target.value)} />
          <span className="dacst-num">{asked}</span>
          {bits === 12 && <button className="fig-opt" aria-label="Ask for 3.2 volts: 3.2 x 4095 / 3.0 = 4368" onClick={() => setAsked(4368)}>ask for 3.2 V (4368)</button>}
        </div>
        <div>
          <span>Too big?</span>
          <button className="fig-opt" aria-pressed={!limit} onClick={() => setLimit(false)}>write it anyway</button>
          <button className="fig-opt" aria-pressed={limit} onClick={() => setLimit(true)}>limit to {top} first</button>
          <code>{limit ? `if (value > ${top}) value = ${top};` : "no check"}</code>
        </div>
        <div>
          <span>In binary</span>
          <span className="dacst-bits" role="img" aria-label={`${asked} in binary is ${bin}; the register ${limit && over ? "gets" : "keeps"} ${kept}`}>
            {over && !limit ? <s>{bin[0]}</s> : <span style={{ color: "var(--dim)" }}>{limit && over ? "0" : bin[0]}</span>}
            <b>{limit && over ? top.toString(2) : bin.slice(1)}</b>
          </span>
          <code>kept: {kept} = {fmtV(vout)}</code>
        </div>
      </div>
      <figcaption>Vout = number x 3.0 V / 4096: each number is one step on a staircase from 0 V to just under 3.0 V. With 12 bits the 4096 steps are too fine to see. Past the last step, DACVALS drops the bit that does not fit and the staircase starts again from 0 V.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "dac-staircase",
  title: "DAC output staircase",
  description: "Slide the number written to the DAC and see the output voltage it gives, the size of one step and what happens past the largest number.",
  Component: DacStaircase,
};
