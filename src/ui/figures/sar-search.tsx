// Successive approximation: how the chip's ADC turns the held voltage into
// a number. TRM chapter 11 introduction (11.1: "successive approximation
// (SAR) type ADCs"), result formula of section 11.4.5 (the search ends on
// floor(2^N * Vin / 3.0)), one comparison per bit as in the conversion
// timings of section 11.14. Shown for 4, 8 and 12 bits with the course's
// 3.0 V reference.
import { useState } from "react";

const VREF = 3.0;
const trim = (v: number) => v.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
const CSS = `
.sar input[type=range] { flex: 1 1 8rem; min-width: 6rem; padding: 0; accent-color: var(--orange); }
.sar .sar-num { font-family: var(--mono); color: var(--orange); min-width: 3.6em; text-align: right; font-weight: 700; }
.sar .sar-yes { fill: var(--ok); font-weight: 700; font-size: 13px; font-family: var(--sans); }
.sar .sar-no { fill: var(--bad); font-weight: 700; font-size: 13px; font-family: var(--sans); }
`;

interface Round {
  bit: number;
  weight: number;
  keptBefore: number;
  trial: number;
  yes: boolean;
  lo: number;
  hi: number;
}

function rounds(vin: number, n: number): Round[] {
  const out: Round[] = [];
  let kept = 0;
  let hi = VREF;
  for (let r = 0; r < n; r++) {
    const weight = VREF / 2 ** (r + 1);
    const trial = kept + weight;
    const yes = vin >= trial - 1e-12;
    const before = kept;
    if (yes) kept = trial;
    else hi = trial;
    out.push({ bit: n - 1 - r, weight, keptBefore: before, trial, yes, lo: kept, hi });
  }
  return out;
}

function SarSearch() {
  const [bits, setBits] = useState(4);
  const [vin, setVin] = useState(2.2);
  const [step, setStep] = useState(0);
  const rs = rounds(vin, bits);
  const cur = step > 0 ? rs[step - 1] : null;
  const done = step === bits;
  const code = rs.reduce((c, r) => (c << 1) | (r.yes ? 1 : 0), 0);
  const binary = rs.map((r) => (r.yes ? "1" : "0")).join("").replace(/(.{4})(?=.)/g, "$1 ");

  const X0 = 34;
  const X1 = 300;
  const Y1 = 18;
  const Y0 = 140;
  const cw = (X1 - X0) / bits;
  const y = (v: number) => Y0 - (v / VREF) * (Y0 - Y1);
  const PX = 312;
  const width = cur ? cur.hi - cur.lo : VREF;

  let why: string;
  if (!cur) why = `The capacitor holds ${vin.toFixed(2)} V. No bit is decided yet, so the voltage can be anywhere from 0 V to 3.0 V. Each round tries one bit, from the top bit down, and cuts that range in half. Press Next.`;
  else {
    const first = `Round ${step}: try bit ${cur.bit}, worth ${trim(cur.weight)} V. The DAC makes ${cur.keptBefore > 0 ? `the ${trim(cur.keptBefore)} V kept so far plus ${trim(cur.weight)} V = ` : ""}${trim(cur.trial)} V. Is ${vin.toFixed(2)} V at least ${trim(cur.trial)} V? `;
    const second = cur.yes ? `Yes: bit ${cur.bit} stays 1.` : `No, the guess was too high: bit ${cur.bit} goes back to 0 and its ${trim(cur.weight)} V is not kept.`;
    const range = ` The voltage is now known to be between ${trim(cur.lo)} V and ${trim(cur.hi)} V.`;
    why = first + second + range + (done ? ` Done after ${bits} comparisons: ${binary} = ${code}. Check: ${1 << bits} x ${vin.toFixed(2)} / 3.0 = ${(((1 << bits) * vin) / VREF).toFixed(2)}, fraction dropped${code === (1 << bits) - 1 && vin >= VREF ? ", limited to the top" : ""}.` : "");
  }

  const reset = (b: number) => {
    setBits(b);
    setStep(0);
  };

  return (
    <figure className="figure sar" aria-label="Step-through of a successive approximation conversion">
      <style>{CSS}</style>
      <svg viewBox="0 0 420 190" role="img" aria-label={cur ? `Round ${step} of ${bits}. Trial voltage ${trim(cur.trial)} volts against held voltage ${vin.toFixed(2)} volts: ${cur.yes ? "yes, bit kept" : "no, bit cleared"}. Bits so far ${rs.slice(0, step).map((r) => (r.yes ? 1 : 0)).join("")}.` : `Held voltage ${vin.toFixed(2)} volts. No bit decided yet.`}>
        {/* axes */}
        {[0, 1.5, 3].map((v) => (
          <g key={v}>
            <line x1={X0} x2={X1} y1={y(v)} y2={y(v)} stroke="var(--border)" />
            <text x={X0 - 4} y={y(v) + 3} textAnchor="end" className="fig-label">{v.toFixed(1)} V</text>
          </g>
        ))}
        <line x1={X0} x2={X0} y1={Y0} y2={Y1} className="fig-wire" />
        {/* rounds */}
        {rs.map((r, i) => {
          const x = X0 + i * cw;
          const shown = i < step;
          const isCur = i === step - 1;
          return (
            <g key={i}>
              {shown && <rect x={x + 1} y={y(r.hi)} width={cw - 2} height={Math.max(0.8, y(r.lo) - y(r.hi))} fill="var(--harvest)" fillOpacity={isCur ? 0.3 : 0.16} />}
              {shown && (r.yes ? <line x1={x + 2} x2={x + cw - 2} y1={y(r.trial)} y2={y(r.trial)} stroke="var(--harvest)" strokeWidth="2.6" /> : <line x1={x + 2} x2={x + cw - 2} y1={y(r.trial)} y2={y(r.trial)} stroke="var(--dim)" strokeWidth="1.6" strokeDasharray="3 2" />)}
              {isCur && <rect x={x + 0.5} y={Y1 - 4} width={cw - 1} height={Y0 - Y1 + 4} fill="none" stroke="var(--orange)" strokeWidth="1" strokeDasharray="2 2" />}
              <rect x={x + 1.5} y={Y0 + 7} width={cw - 3} height="17" rx="3" className={`fig-box ${isCur ? "hot" : shown ? "active" : "off"}`} />
              <text x={x + cw / 2} y={Y0 + 19.5} textAnchor="middle" className={shown ? "fig-value" : "fig-label dim"}>{shown ? (r.yes ? 1 : 0) : "?"}</text>
              <text x={x + cw / 2} y={Y0 + 36} textAnchor="middle" className="fig-label dim">{cw >= 30 ? `bit ${r.bit}` : r.bit}</text>
            </g>
          );
        })}
        {cw < 30 && <text x={X0 - 4} y={Y0 + 36} textAnchor="end" className="fig-label dim">bit</text>}
        {/* the held voltage */}
        <line x1={X0} x2={X1 + 2} y1={y(vin)} y2={y(vin)} stroke="var(--orange)" strokeWidth="1.8" />
        {/* comparator panel */}
        <line x1={PX} x2={PX + 12} y1="21" y2="21" stroke="var(--orange)" strokeWidth="1.8" />
        <text x={PX + 16} y="24" className="fig-label dim">held voltage</text>
        <text x={PX} y="37" className="fig-value" style={{ fill: "var(--orange)" }}>{vin.toFixed(2)} V</text>
        <line x1={PX} x2={PX + 12} y1="52" y2="52" stroke="var(--harvest)" strokeWidth="2.6" />
        <text x={PX + 16} y="55" className="fig-label dim">DAC trial voltage</text>
        <text x={PX} y="68" className="fig-value">{cur ? `${trim(cur.trial)} V` : "-"}</text>
        <rect x={PX - 4} y="78" width="106" height="36" rx="4" className={`fig-box ${cur ? "hot" : ""}`} />
        <text x={PX + 2} y="91" className="fig-label">comparator: held is</text>
        <text x={PX + 2} y="102" className="fig-label">at least the trial?</text>
        {cur && <text x={PX + 98} y="107" textAnchor="end" className={cur.yes ? "sar-yes" : "sar-no"}>{cur.yes ? "YES" : "NO"}</text>}
        <text x={PX} y="131" className="fig-value">{cur ? `bit ${cur.bit} = ${cur.yes ? 1 : 0}` : " "}</text>
        <text x={PX} y="143" className="fig-label dim">{cur ? (cur.yes ? "kept" : "cleared") : "press Next to start"}</text>
        <text x={PX} y="160" className="fig-label dim">voltage (V) is between</text>
        <text x={PX} y="172" className="fig-value small">{trim(cur ? cur.lo : 0)} and {trim(cur ? cur.hi : VREF)}</text>
        <text x={PX} y="184" className="fig-label dim">a band {width >= 0.1 ? `${trim(width)} V` : `${(width * 1000).toFixed(2)} mV`} wide</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls row">
        <button className="btn small" onClick={() => setStep(step - 1)} disabled={step === 0}>Back</button>
        <button className="btn small primary" onClick={() => setStep(step + 1)} disabled={done} aria-label={done ? "Next" : `Next: try bit ${rs[step].bit}`}>Next</button>
        <button className="btn small" onClick={() => setStep(0)} disabled={step === 0}>Reset</button>
        <span className="fig-dots" aria-hidden="true">{rs.map((_, k) => (<i key={k} className={k < step ? "on" : ""} />))}</span>
      </div>
      <div className="fig-controls">
        <div>
          <span>Held voltage</span>
          <input type="range" min={0} max={VREF} step={0.01} value={vin} aria-label="Held voltage in volts" onChange={(e) => setVin(+e.target.value)} />
          <span className="sar-num">{vin.toFixed(2)} V</span>
        </div>
        <div>
          <span>Converter</span>
          <button className="fig-opt" aria-pressed={bits === 4} onClick={() => reset(4)}>4 bits</button>
          <button className="fig-opt" aria-pressed={bits === 8} onClick={() => reset(8)}>8 bits</button>
          <button className="fig-opt" aria-pressed={bits === 12} onClick={() => reset(12)}>12 bits (the chip)</button>
        </div>
      </div>
      <figcaption>A binary search with a DAC and a comparator. Each column is one comparison: a thick solid bar is a trial voltage that was kept, a dashed bar one that was too high. The shaded band is where the held voltage (the line across) can still be; it halves every round, so N bits need N comparisons.</figcaption>
    </figure>
  );
}

export const figure = { id: "sar-search", Component: SarSearch };
