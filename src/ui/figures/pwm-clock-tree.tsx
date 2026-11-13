// The ePWM counter clock. TRM 15.4 (time base) and the TBCTL register
// (15.15.2): TBCLK = EPWMCLK / (HSPCLKDIV x CLKDIV). EPWMCLK is SYSCLK / 2
// = 100 MHz (PERCLKDIVSEL.EPWMCLKDIV, reset value). HSPCLKDIV: 0 = /1,
// 1 = /2 (reset), 2 = /4, 3 = /6 ... 7 = /14. CLKDIV: /1 (reset) to /128
// in powers of two. TBPRD is 16 bits. Up count: TPWM = (TBPRD + 1) x TTBCLK
// (15.4.3); the course writes the round number of counts into TBPRD.
// Frequencies offered: those of ch09_pwm.ts (LED1 at 10 kHz, TBPRD = 5000)
// and of the servo level, never a lab or homework answer.
import { useState } from "react";

const HSP = [1, 2, 4, 6, 8, 10, 12, 14];
const WANT: [number, string, string][] = [
  [50, "50 Hz", "RC servo"],
  [1000, "1 kHz", ""],
  [10000, "10 kHz", "LED1"],
  [200000, "200 kHz", ""],
];

const CSS = `
.pwmc-read { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.4rem 0; }
.pwmc-read div { flex: 1 1 5.4rem; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 0.25rem 0.55rem; font-size: 0.78rem; color: var(--dim); }
.pwmc-read b { display: block; font-family: var(--mono); color: var(--value); font-size: 0.95rem; }
.pwmc-read div.bad b { color: var(--bad); }
.pwmc .fig-opt { padding: 0.12em 0.5em; }
`;

const group = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+$)/g, " ");
const trim = (n: number, d: number) => n.toFixed(d).replace(/\.?0+$/, "");
const hz = (f: number) => (f >= 1e6 ? `${trim(f / 1e6, 3)} MHz` : f >= 1e3 ? `${trim(f / 1e3, 2)} kHz` : `${trim(f, 1)} Hz`);
const time = (ns: number) => (ns >= 1e6 ? `${trim(ns / 1e6, 2)} ms` : ns >= 1e3 ? `${trim(ns / 1e3, 2)} µs` : `${trim(ns, 2)} ns`);

function PwmClockTree() {
  const [hsp, setHsp] = useState(1);
  const [clk, setClk] = useState(0);
  const [wi, setWi] = useState(2);
  const mid = 100e6 / HSP[hsp];
  const tbclk = mid / (1 << clk);
  const tickNs = 1e9 / tbclk;
  const [f, fname] = WANT[wi];
  const counts = tbclk / f;
  const prd = Math.round(counts);
  const fits = prd <= 65535;
  const useful = prd >= 2;
  const stepPct = 100 / Math.max(1, prd);

  // Clock chain.
  const BW = 70;
  const GAP = 44;
  const bx = (i: number) => 4 + i * (BW + GAP);
  const boxes = [
    ["SYSCLK", "200 MHz"],
    ["EPWMCLK", "100 MHz"],
    ["", hz(mid)],
    ["TBCLK", hz(tbclk)],
  ];
  const divs = [
    ["/2", "EPWMCLKDIV", false],
    [`/${HSP[hsp]}`, "HSPCLKDIV", true],
    [`/${1 << clk}`, "CLKDIV", true],
  ] as const;

  // Counts axis, logarithmic from 10 to 10 million.
  const AX0 = 22;
  const AX1 = 404;
  const AY = 136;
  const lx = (c: number) => AX0 + ((Math.log10(Math.max(10, Math.min(1e7, c))) - 1) / 6) * (AX1 - AX0);

  // Marks on the axis. Labels that would overlap go one row higher.
  const rowEnd: number[] = [];
  const marks = WANT.map(([wf, name], i) => {
    const c = tbclk / wf;
    const off = c < 10 || c > 1e7;
    const label = off ? `${name} (${c < 10 ? "under 10" : "over 10 million"})` : name;
    const w = label.length * 5.9 + 6;
    const mx = lx(c);
    const tx = Math.max(AX0, Math.min(AX1 - w, mx - w / 2));
    return { name, label, on: i === wi, off, x: mx, tx, w, row: 0 };
  });
  for (const m of [...marks].sort((a, b) => a.tx - b.tx)) {
    let row = 0;
    while (rowEnd[row] !== undefined && rowEnd[row] > m.tx) row++;
    rowEnd[row] = m.tx + m.w;
    m.row = row;
  }

  let why: string;
  if (!fits) {
    const need = [0, 1, 2, 3, 4, 5, 6, 7].find((k) => Math.round(mid / (1 << k) / f) <= 65535);
    why = `${fname} at ${hz(tbclk)} would need ${group(prd)} counts in one period, but TBPRD is a 16-bit register: 65 535 at most. Slow the counter down. ${need !== undefined ? `CLKDIV = ${need} (/${1 << need}) leaves ${group(mid / (1 << need) / f)} counts, which fits.` : "Even /128 is not enough with this HSPCLKDIV."}`;
  } else if (!useful) why = `The counter now ticks only every ${time(tickNs)}, slower than the ${fname} you want. There is no TBPRD for that: divide the clock less.`;
  else
    why = `One count lasts ${time(tickNs)}. A period of ${time(1e9 / f)} (${fname}) is ${hz(tbclk)} / ${fname} = ${group(prd)} counts, so TBPRD = ${prd}${Number.isInteger(counts) ? " (strictly a period is TBPRD + 1 counts; the course writes the round number)" : ""}. CMPA is a whole number of counts: the duty cycle moves in ${group(prd)} steps of ${trim(stepPct, stepPct < 0.01 ? 4 : 2)} %.${prd < 500 ? " That is coarse: a faster carrier costs resolution." : ""}${hsp !== 1 ? " The course never touches HSPCLKDIV: it stays /2 from reset." : ""}`;

  return (
    <figure className="figure pwmc" aria-label="Interactive ePWM clock tree: from the system clock to the counter clock, the period register and the duty resolution">
      <style>{CSS}</style>
      <svg viewBox="0 0 420 168" role="img" aria-label={`System clock 200 megahertz, divided by 2, by ${HSP[hsp]} and by ${1 << clk}: counter clock ${hz(tbclk)}, one count every ${time(tickNs)}. ${fname} needs ${group(prd)} counts per period${fits ? "" : ", which does not fit in the 16-bit period register"}.`}>
        <defs>
          <marker id="pwmc-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" className="fig-arrowhead" />
          </marker>
        </defs>
        {boxes.map(([name, value], i) => (
          <g key={i}>
            <rect x={bx(i)} y="8" width={BW} height="32" rx="4" className={`fig-box ${i === 3 ? "hot" : ""}`} />
            {name ? (
              <>
                <text x={bx(i) + BW / 2} y="21" textAnchor="middle" className="fig-label">{name}</text>
                <text x={bx(i) + BW / 2} y="34" textAnchor="middle" className="fig-value small">{value}</text>
              </>
            ) : (
              <text x={bx(i) + BW / 2} y="28" textAnchor="middle" className="fig-value small">{value}</text>
            )}
          </g>
        ))}
        {divs.map(([d, name, yours], i) => {
          const cx = bx(i) + BW + GAP / 2;
          return (
            <g key={name}>
              <path d={`M${bx(i) + BW} 24 H${bx(i + 1) - 1}`} className={`fig-wire arrow ${yours ? "hot" : ""}`} markerEnd="url(#pwmc-arrow)" />
              <text x={cx - 2} y="19" textAnchor="middle" className="fig-value small">{d}</text>
              <text x={cx} y="54" textAnchor="middle" className={`fig-label ${yours ? "" : "dim"}`}>{name}</text>
              <line x1={cx} x2={cx} y1="27" y2="46" className="fig-wire" strokeDasharray="2 2" />
            </g>
          );
        })}

        {/* counts per period */}
        <text x={AX0} y="72" className="fig-label">Counts in one period = TBCLK / frequency = number of duty steps</text>
        <rect x={lx(65535)} y={AY - 30} width={AX1 - lx(65535)} height="30" fill="var(--bad)" fillOpacity="0.12" />
        <line x1={lx(65535)} x2={lx(65535)} y1={AY - 30} y2={AY} stroke="var(--bad)" strokeDasharray="3 3" />
        <text x={AX1} y={AY + 26} textAnchor="end" className="fig-label" style={{ fill: "var(--bad)" }}>more than 65 535 counts do not fit in TBPRD</text>
        <line x1={AX0} x2={AX1} y1={AY} y2={AY} className="fig-wire" />
        {[1, 2, 3, 4, 5, 6, 7].map((e) => (
          <g key={e}>
            <line x1={lx(10 ** e)} x2={lx(10 ** e)} y1={AY} y2={AY + 4} className="fig-wire" />
            <text x={lx(10 ** e)} y={AY + 14} textAnchor={e === 1 ? "start" : e === 7 ? "end" : "middle"} className="fig-label dim">{["10", "100", "1 000", "10 000", "100 000", "1 million", "10 M"][e - 1]}</text>
          </g>
        ))}
        {marks.map((m) => (
          <g key={m.name} opacity={m.off ? 0.75 : 1}>
            <line x1={m.x} x2={m.x} y1={AY} y2={AY - 8} stroke={m.on ? "var(--accent)" : "var(--dim)"} strokeWidth={m.on ? 2.2 : 1.2} />
            <circle cx={m.x} cy={AY} r={m.on ? 4 : 2.5} fill={m.on ? "var(--accent)" : "var(--dim)"} />
            <text x={m.tx} y={AY - 11 - m.row * 11} className={m.on ? "fig-value small" : "fig-label dim"}>{m.label}</text>
          </g>
        ))}
      </svg>
      <div className="pwmc-read">
        <div>Counter clock<b>{hz(tbclk)}</b>100 MHz / ({HSP[hsp]} x {1 << clk})</div>
        <div>One count<b>{time(tickNs)}</b>1 / TBCLK</div>
        <div className={fits && useful ? "" : "bad"}>TBPRD for {fname}<b>{fits && useful ? prd : fits ? "none" : "too big"}</b>{fits ? `${hz(tbclk)} / ${fname}` : `${group(prd)} > 65 535`}</div>
        <div>Duty steps<b>{fits && useful ? group(prd) : "-"}</b>{fits && useful ? `each ${trim(stepPct, stepPct < 0.01 ? 4 : 2)} %` : "no valid period"}</div>
      </div>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>HSPCLKDIV</span>
          {HSP.map((d, i) => (
            <button key={d} className="fig-opt" aria-pressed={hsp === i} aria-label={`HSPCLKDIV divide by ${d}`} onClick={() => setHsp(i)}>/{d}</button>
          ))}
          <code>EPwm12Regs.TBCTL.bit.HSPCLKDIV = {hsp};{hsp === 1 ? " // reset value" : ""}</code>
        </div>
        <div>
          <span>CLKDIV</span>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((k) => (
            <button key={k} className="fig-opt" aria-pressed={clk === k} aria-label={`CLKDIV divide by ${1 << k}`} onClick={() => setClk(k)}>/{1 << k}</button>
          ))}
          <code>EPwm12Regs.TBCTL.bit.CLKDIV = {clk};</code>
        </div>
        <div>
          <span>You want</span>
          {WANT.map(([, name, use], i) => (
            <button key={name} className="fig-opt" aria-pressed={wi === i} onClick={() => setWi(i)}>{name}{use ? ` (${use})` : ""}</button>
          ))}
          <code>{fits && useful ? `EPwm12Regs.TBPRD = ${prd};` : "no TBPRD works"}</code>
        </div>
      </div>
      <figcaption>The counter clock is fixed by two dividers, and everything else follows from it: the period register is the number of counts in one period, and that same number is how finely the duty cycle can be set. Try 10 kHz against 200 kHz, then 50 Hz.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "pwm-clock-tree",
  title: "PWM counter clock and period",
  description: "Change the two clock dividers and pick a frequency, and read how long one count lasts, how many counts a period needs and how finely the duty cycle can then be set.",
  Component: PwmClockTree,
};
