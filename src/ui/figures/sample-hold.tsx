// The acquisition (sample-and-hold) window. TRM section 11.5.3: the window
// is (ACQPS + 1) SYSCLK cycles, 5 ns each at 200 MHz. TRM section 11.15.2
// "Choosing an Acquisition Window Duration": RC settling model, time
// constant (Rs + Ron) * Ch (the pin capacitance terms are left out here),
// about 9.7 time constants to settle within 1/4 step of 12 bits. Ron =
// 425 ohm and Ch = 14.5 pF are the 12-bit input model of the F2837xD data
// manual, which also gives the 75 ns minimum window.
import { useState } from "react";

const RON = 425;
const CH_PF = 14.5;
const VPIN = 1.5;
const T_MAX = 1100;
const SOURCES = [
  { r: 50, label: "50 Ω" },
  { r: 1000, label: "1 kΩ" },
  { r: 5000, label: "5 kΩ" },
  { r: 20000, label: "20 kΩ" },
];
const CSS = `
.shold input[type=range] { flex: 1 1 8rem; min-width: 6rem; padding: 0; accent-color: var(--orange); }
.shold .shold-num { font-family: var(--mono); color: var(--harvest); min-width: 2.4em; text-align: right; }
`;
const adc = (v: number) => Math.min(4095, Math.max(0, Math.floor((4096 * v) / 3.0)));

function SampleHold() {
  const [acqps, setAcqps] = useState(99);
  const [rs, setRs] = useState(1000);
  const [prev, setPrev] = useState(0.2);
  const windowNs = (acqps + 1) * 5;
  const tau = ((rs + RON) * CH_PF) / 1000; // ns
  const vAt = (t: number) => VPIN + (prev - VPIN) * Math.exp(-t / tau);
  const held = vAt(windowNs);
  const want = adc(VPIN);
  // Error in whole steps: less than half a step off counts as settled.
  const off = Math.round(((held - VPIN) * 4096) / 3.0);
  const code = want + off;
  const needNs = 9.7 * tau;
  const needAcqps = Math.max(14, Math.ceil(needNs / 5) - 1);
  const tooShort = windowNs < 75;

  const X0 = 40;
  const X1 = 408;
  const Y1 = 104;
  const Y0 = 172;
  const pad = 0.2 * Math.abs(prev - VPIN);
  const lo = Math.min(prev, VPIN) - pad;
  const hi = Math.max(prev, VPIN) + pad;
  const x = (t: number) => X0 + (t / T_MAX) * (X1 - X0);
  const y = (v: number) => Y0 - ((v - lo) / (hi - lo)) * (Y0 - Y1);
  let d = `M${x(0)},${y(prev)}`;
  for (let i = 1; i <= 80; i++) {
    const t = (windowNs * i) / 80;
    d += ` L${x(t).toFixed(1)},${y(vAt(t)).toFixed(1)}`;
  }
  d += ` H${X1}`;
  const xw = x(windowNs);
  const rLabel = SOURCES.find((s) => s.r === rs)!.label;
  const mvOff = Math.abs(held - VPIN) * 1000;

  const why = tooShort
    ? `A window of ${windowNs} ns is below the chip's minimum of 75 ns (ACQPS = 14). Do not use it, whatever the source.`
    : off !== 0
      ? `The window closes after ${windowNs} ns, but with ${rLabel} in the way the capacitor charges with a time constant of ${tau.toFixed(0)} ns. It is still ${mvOff.toFixed(1)} mV away from the pin, on the side of the channel measured before: the result is ${code} instead of ${want}. ${needAcqps <= 511 ? `This source needs about ${needNs.toFixed(0)} ns: ACQPS = ${needAcqps} or more.` : `This source would need ${needNs.toFixed(0)} ns, more than ACQPS can give (511, 2560 ns): put an amplifier between sensor and pin.`}`
      : `In ${windowNs} ns the capacitor reaches the pin voltage (time constant ${tau.toFixed(0)} ns, so the window is ${(windowNs / tau).toFixed(0)} time constants long). The switch opens and the capacitor holds ${VPIN.toFixed(1)} V: the result is ${code}, as it should be.`;

  return (
    <figure className="figure shold" aria-label="Interactive sample-and-hold circuit and charging curve">
      <style>{CSS}</style>
      <svg viewBox="0 0 420 200" role="img" aria-label={`Acquisition window ${windowNs} nanoseconds, source resistance ${rLabel}. The capacitor holds ${held.toFixed(4)} volts, result ${code}; the pin is at ${VPIN} volts, which is ${want}.`}>
        {/* circuit */}
        <rect x="6" y="18" width="62" height="34" rx="4" className="fig-box active" />
        <text x="37" y="32" textAnchor="middle" className="fig-label">sensor</text>
        <text x="37" y="45" textAnchor="middle" className="fig-value small" style={{ fill: "var(--orange)" }}>{VPIN.toFixed(1)} V</text>
        <line x1="68" x2="84" y1="35" y2="35" className="fig-wire hot" />
        <rect x="84" y="30" width="34" height="10" className="fig-box" />
        <text x="101" y="24" textAnchor="middle" className="fig-label">its resistance</text>
        <text x="101" y="52" textAnchor="middle" className="fig-value small">{rLabel}</text>
        <line x1="118" x2="150" y1="35" y2="35" className="fig-wire hot" />
        <rect x="134" y="29" width="8" height="12" className="fig-pin" />
        <text x="138" y="24" textAnchor="middle" className="fig-label dim">pin</text>
        {/* switch */}
        <circle cx="152" cy="35" r="2.2" className="fig-dot" />
        <line x1="152" x2="180" y1="35" y2="24" className="fig-wire thick" />
        <circle cx="182" cy="35" r="2.2" className="fig-dot" />
        <text x="167" y="14" textAnchor="middle" className="fig-label">switch</text>
        <text x="167" y="52" textAnchor="middle" className="fig-value small">closed {windowNs} ns,</text>
        <text x="167" y="63" textAnchor="middle" className="fig-value small">then open</text>
        <line x1="182" x2="198" y1="35" y2="35" className="fig-wire" />
        <rect x="198" y="30" width="28" height="10" className="fig-box" />
        <text x="212" y="24" textAnchor="middle" className="fig-label dim">425 Ω</text>
        <line x1="226" x2="290" y1="35" y2="35" className="fig-wire" style={{ stroke: "var(--harvest)" }} />
        {/* capacitor */}
        <circle cx="252" cy="35" r="2.2" className="fig-dot" />
        <line x1="252" x2="252" y1="35" y2="50" className="fig-wire" style={{ stroke: "var(--harvest)" }} />
        <line x1="242" x2="262" y1="50" y2="50" className="fig-wire thick" />
        <line x1="242" x2="262" y1="55" y2="55" className="fig-wire thick" />
        <line x1="252" x2="252" y1="55" y2="66" className="fig-wire" style={{ stroke: "var(--arches)" }} />
        <line x1="245" x2="259" y1="66" y2="66" className="fig-wire" style={{ stroke: "var(--arches)" }} />
        <text x="238" y="56" textAnchor="end" className="fig-label dim">14.5 pF</text>
        <text x="252" y="24" textAnchor="middle" className="fig-label">capacitor</text>
        <rect x="290" y="14" width="124" height="46" rx="4" className={`fig-box ${off !== 0 || tooShort ? "hot" : "active"}`} />
        <text x="352" y="27" textAnchor="middle" className="fig-label">converter measures</text>
        <text x="352" y="41" textAnchor="middle" className="fig-value">{held.toFixed(4)} V = {code}</text>
        <text x="352" y="54" textAnchor="middle" className="fig-label" style={{ fill: off !== 0 ? "var(--bad)" : "var(--ok)" }}>{off !== 0 ? `wrong by ${Math.abs(off)} step${Math.abs(off) > 1 ? "s" : ""} (pin: ${want})` : `correct (pin: ${want})`}</text>
        {/* plot */}
        <text x={X0} y="90" className="fig-label dim">capacitor voltage over time</text>
        <rect x={X0} y={Y1 - 6} width={Math.max(0, xw - X0)} height={Y0 - Y1 + 6} fill="var(--orange)" fillOpacity="0.12" />
        <line x1={X0} x2={X1} y1={Y0} y2={Y0} className="fig-wire" />
        <line x1={X0} x2={X0} y1={Y0} y2={Y1 - 6} className="fig-wire" />
        <line x1={X0} x2={X1} y1={y(VPIN)} y2={y(VPIN)} stroke="var(--orange)" strokeWidth="1.2" strokeDasharray="4 3" />
        <text x={X0 - 4} y={y(VPIN) + 3} textAnchor="end" className="fig-label" style={{ fill: "var(--orange)" }}>{VPIN.toFixed(1)} V</text>
        <text x={X0 - 4} y={y(prev) + 3} textAnchor="end" className="fig-label">{prev.toFixed(1)} V</text>
        <text x={X0 + 14} y={y(VPIN) - 4} className="fig-label" style={{ fill: "var(--orange)" }}>pin voltage</text>
        <path d={d} className="fig-trace data" />
        <line x1={xw} x2={xw} y1={Y1 - 6} y2={Y0 + 3} stroke="var(--orange)" strokeWidth="1.4" />
        <circle cx={xw} cy={y(held)} r="3.2" fill="var(--harvest)" stroke="var(--text)" strokeWidth="0.8" />
        <text x={xw < 300 ? xw + 5 : xw - 5} y={prev < VPIN ? Y0 - 5 : Y1 + 2} textAnchor={xw < 300 ? "start" : "end"} className="fig-label">switch opens: this voltage is held</text>
        {[0, 500, 1000].map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={Y0} y2={Y0 + 3} className="fig-wire" />
            <text x={x(t)} y={Y0 + 13} textAnchor="middle" className="fig-label">{t} ns</text>
          </g>
        ))}
        <line x1={x(75)} x2={x(75)} y1={Y0 - 4} y2={Y0 + 4} stroke="var(--bad)" strokeWidth="1.6" />
        <text x={x(75) + 4} y={Y0 + 13} className="fig-label" style={{ fill: "var(--bad)" }}>75 ns minimum</text>
        <text x={X1} y={Y0 + 25} textAnchor="end" className="fig-label dim">shaded: switch closed, capacitor charging</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>ACQPS</span>
          <input type="range" min={0} max={199} value={acqps} aria-label="ACQPS" onChange={(e) => setAcqps(+e.target.value)} />
          <span className="shold-num">{acqps}</span>
          <code>window = ({acqps} + 1) x 5 ns = {windowNs} ns</code>
        </div>
        <div>
          <span>Source</span>
          {SOURCES.map((s) => (
            <button key={s.r} className="fig-opt" aria-pressed={rs === s.r} onClick={() => setRs(s.r)}>{s.label}</button>
          ))}
          <code>time constant = ({rs} + 425) Ω x 14.5 pF = {tau.toFixed(1)} ns</code>
        </div>
        <div>
          <span>Before</span>
          <button className="fig-opt" aria-pressed={prev === 0.2} onClick={() => setPrev(0.2)}>last pin was at 0.2 V</button>
          <button className="fig-opt" aria-pressed={prev === 2.8} onClick={() => setPrev(2.8)}>last pin was at 2.8 V</button>
        </div>
        <div>
          <span>In code</span>
          <code>AdcaRegs.ADCSOC0CTL.bit.ACQPS = {acqps};</code>
        </div>
      </div>
      <figcaption>During the window a switch connects the pin to a small capacitor, which still carries the voltage of the pin measured before. It must reach the new pin voltage before the switch opens. A source with a high resistance charges it slowly and needs a longer window. The slider stops at 199 here; the register goes to 511 (2560 ns).</figcaption>
    </figure>
  );
}

export const figure = { id: "sample-hold", Component: SampleHold };
