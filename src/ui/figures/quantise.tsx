// Quantisation, TRM section 11.4.5 "Expected Conversion Results" (Table
// 11-2, 12-bit single-ended): ADCRESULT = 4096 * (ADCIN - VREFLO) /
// (VREFHI - VREFLO), fraction dropped, 0 at or below VREFLO and 4095 at or
// above VREFHI. VREFHI is 3.0 V on the course boards. Fewer bits are shown
// with the same rule to make the steps visible.
import { useState } from "react";

const VREF = 3.0;
const VMAX = 3.3;
const CSS = `
.quant input[type=range] { flex: 1 1 4rem; min-width: 3.5rem; padding: 0; accent-color: var(--orange); }
.quant .quant-num { font-family: var(--mono); color: var(--harvest); min-width: 4.6em; text-align: right; }
`;

function Quantise() {
  const [bits, setBits] = useState(4);
  const [vin, setVin] = useState(2.0);
  const levels = 1 << bits;
  const top = levels - 1;
  const lsb = VREF / levels;
  const exact = (levels * vin) / VREF;
  const code = Math.min(top, Math.max(0, Math.floor(exact + 1e-9)));
  const back = code * lsb;
  const clipped = vin >= VREF;
  const errMv = (vin - back) * 1000;
  const dec = bits <= 3 ? 3 : bits <= 8 ? 4 : 5;
  const mv = (v: number) => (v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3));

  // left panel: the whole range
  const LX0 = 36;
  const LX1 = 196;
  const Y0 = 150;
  const Y1 = 26;
  const lx = (v: number) => LX0 + (v / VMAX) * (LX1 - LX0);
  const ly = (c: number) => Y0 - (c / levels) * (Y0 - Y1);
  let whole = "";
  if (bits <= 4) {
    for (let c = 0; c <= top; c++) whole += `${c ? "V" : `M${lx(0)},`}${ly(c)} H${lx(c === top ? VMAX : (c + 1) * lsb)}`;
  } else whole = `M${lx(0)},${ly(0)} L${lx(VREF)},${ly(top)} H${lx(VMAX)}`;

  // right panel: four steps around the voltage
  const c0 = Math.min(Math.max(code - 1, 0), top - 3);
  const RX0 = 250;
  const RX1 = 400;
  const rx = (v: number) => RX0 + ((v - c0 * lsb) / (4 * lsb)) * (RX1 - RX0);
  const RY0 = Y0 - 14;
  const ry = (v: number) => RY0 - ((v - c0 * lsb) / (4 * lsb)) * (RY0 - Y1);
  let zoom = "";
  for (let k = 0; k < 4; k++) zoom += `${k ? "V" : `M${rx(c0 * lsb)},`}${ry((c0 + k) * lsb)} H${rx((c0 + k + 1) * lsb)}`;
  const mxv = Math.min(vin, (c0 + 4) * lsb);
  const mx = rx(mxv);
  const zx = lx(c0 * lsb);
  const zw = Math.max(5, lx((c0 + 4) * lsb) - zx);
  const zy = ly(c0 + 4);
  const zh = Math.max(5, ly(c0) - zy);

  const why = clipped
    ? `${vin.toFixed(3)} V is at or above the 3.0 V reference, so the result stays at the top, ${top}. The ADC cannot tell 3.0 V from 3.3 V.`
    : `${vin.toFixed(4)} V lies on step ${code}, which starts at ${back.toFixed(dec)} V. Every voltage on that step gives ${code}. ${errMv < 0.00005 ? "Here the voltage is exactly at the start of the step, so nothing is lost." : `The ${mv(errMv)} mV above the start of the step is lost.`} This quantisation error is always less than one step, ${mv(lsb * 1000)} mV.`;

  return (
    <figure className="figure quant" aria-label="Interactive ADC transfer curve: pin voltage against result">
      <style>{CSS}</style>
      <svg viewBox="0 0 420 182" role="img" aria-label={`${bits}-bit converter. Pin voltage ${vin.toFixed(4)} volts gives ${code}. One step is ${mv(lsb * 1000)} millivolts.`}>
        {/* ---- whole range ---- */}
        <text x={LX0} y="12" className="fig-label dim">whole range: {levels} steps</text>
        <rect x={lx(VREF)} y={Y1} width={LX1 - lx(VREF)} height={Y0 - Y1} fill="var(--bad)" fillOpacity="0.12" />
        <line x1={LX0} x2={LX1} y1={Y0} y2={Y0} className="fig-wire" />
        <line x1={LX0} x2={LX0} y1={Y0} y2={Y1 - 6} className="fig-wire" />
        <text x={LX0 - 4} y={ly(top) + 3} textAnchor="end" className="fig-label">{top}</text>
        <text x={lx(0)} y={Y0 + 11} textAnchor="middle" className="fig-label">0 V</text>
        <text x={lx(VREF)} y={Y0 + 11} textAnchor="middle" className="fig-label">3.0 V</text>
        <text x={(LX0 + LX1) / 2} y={Y0 + 24} textAnchor="middle" className="fig-label dim">pin voltage</text>
        <text x="10" y={(Y0 + Y1) / 2} textAnchor="middle" className="fig-label dim" transform={`rotate(-90 10 ${(Y0 + Y1) / 2})`}>result</text>
        <path d={whole} className="fig-trace data" style={{ strokeWidth: 1.6 }} />
        <rect x={zx} y={zy} width={zw} height={zh} fill="none" stroke="var(--orange)" strokeWidth="1" />
        <path d={`M${zx + zw},${zy} L${RX0},${Y1} M${zx + zw},${zy + zh} L${RX0},${RY0}`} className="fig-wire" strokeDasharray="2 3" style={{ strokeWidth: 0.8 }} />
        <circle cx={lx(vin)} cy={ly(code)} r="3" fill="var(--orange)" stroke="var(--text)" strokeWidth="0.8" />
        {/* ---- magnified ---- */}
        <text x={RX0} y="12" className="fig-label dim">magnified: 4 steps of {mv(lsb * 1000)} mV</text>
        <line x1={RX0} x2={RX1} y1={Y0} y2={Y0} className="fig-wire" />
        <line x1={RX0} x2={RX0} y1={Y0} y2={Y1} className="fig-wire" />
        <path d={`M${RX0},${RY0} L${RX1},${Y1}`} className="fig-trace dim" strokeDasharray="4 3" />
        <path d={zoom} className="fig-trace data" />
        {[0, 1, 2, 3].map((k) => (
          <text key={k} x={rx((c0 + k + 1) * lsb) - 4} y={ry((c0 + k) * lsb) + 11} textAnchor="end" className={c0 + k === code ? "fig-value" : "fig-label dim"}>{c0 + k}</text>
        ))}
        {[0, 1, 2, 3, 4].map((k) => (
          <g key={k}>
            <line x1={rx((c0 + k) * lsb)} x2={rx((c0 + k) * lsb)} y1={Y0} y2={Y0 + 3} className="fig-wire" />
            {(c0 + k === code || c0 + k === code + 1) && <text x={rx((c0 + k) * lsb)} y={Y0 + 11} textAnchor="middle" className="fig-label">{((c0 + k) * lsb).toFixed(dec)}</text>}
          </g>
        ))}
        <text x={(RX0 + RX1) / 2} y={Y0 + 24} textAnchor="middle" className="fig-label dim">pin voltage (V)</text>
        {/* the voltage, and what is lost */}
        <line x1={mx} x2={mx} y1={Y0} y2={ry(back)} className="fig-sample" />
        {!clipped && <line x1={mx} x2={mx} y1={ry(back)} y2={ry(vin)} stroke="var(--orange)" strokeWidth="3" />}
        <circle cx={mx} cy={ry(back)} r="3.5" fill="var(--orange)" stroke="var(--text)" strokeWidth="0.8" />
        {!clipped && (
          <>
            <line x1={RX0 + 8} x2={RX0 + 8} y1={Y1 + 2} y2={Y1 + 12} stroke="var(--orange)" strokeWidth="3" />
            <text x={RX0 + 14} y={Y1 + 10} className="fig-label" style={{ fill: "var(--orange)" }}>lost: {mv(errMv)} mV</text>
          </>
        )}
        {clipped && <text x={RX0 + 6} y={Y1 + 10} className="fig-label" style={{ fill: "var(--bad)" }}>off the scale: stays at {top}</text>}
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Pin voltage</span>
          <input type="range" min={0} max={VMAX} step={0.001} value={vin} aria-label="Pin voltage in volts" onChange={(e) => setVin(+e.target.value)} />
          <span className="quant-num">{vin.toFixed(4)} V</span>
          <button className="fig-opt" aria-label="0.1 millivolt lower" onClick={() => setVin(Math.max(0, +(vin - 0.0001).toFixed(4)))}>- 0.1 mV</button>
          <button className="fig-opt" aria-label="0.1 millivolt higher" onClick={() => setVin(Math.min(VMAX, +(vin + 0.0001).toFixed(4)))}>+ 0.1 mV</button>
        </div>
        <div>
          <span>Resolution</span>
          {[3, 4, 8, 12].map((b) => (
            <button key={b} className="fig-opt" aria-pressed={bits === b} onClick={() => setBits(b)}>{b} bits{b === 12 ? " (the chip)" : ""}</button>
          ))}
          <code>one step = 3.0 V / {levels} = {mv(lsb * 1000)} mV</code>
        </div>
        <div>
          <span>To a number</span>
          <code>result = {levels} * {vin.toFixed(4)} / 3.0 = {exact.toFixed(2)}, so {code}{clipped ? " (limited)" : ""}</code>
        </div>
        <div>
          <span>And back</span>
          <code>volts = {code} * 3.0 / {levels}.0 = {back.toFixed(5)} V</code>
        </div>
      </div>
      <figcaption>result = 4096 x Vin / 3.0 V with the fraction dropped, limited to 4095: the ADC answers with the number of the step the voltage is on. Dashed line: the exact voltage. Staircase: what the result says. The short thick bar between them is the quantisation error.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "quantise",
  title: "ADC steps (quantisation)",
  description: "Slide the pin voltage and change the number of bits to see which step of the staircase the converter answers with and how wide one step is.",
  Component: Quantise,
};
