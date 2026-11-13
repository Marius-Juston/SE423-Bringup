// The buzzer's square wave as chapter 10 sets it up (ch10_actuators.ts,
// act-toggle and act-buzzer; src/sim/plugins/actuators.ts): EPWM9A on
// GPIO16 with AQCTLA.PRD = 3 (toggle at counter = TBPRD, TRM 15.6.2) and
// no compare action, so the pin changes once per counter period and one
// period of the tone takes two. CLKDIV = 2 (/4) gives TBCLK = 12.5 MHz,
// 80 ns a count, and the chapter's note values are
// TBPRD = ((50000000 / 4) / 2) / frequency. By 15.4.3 a counter period is
// TBPRD + 1 counts: tone = TBCLK / (2 x (TBPRD + 1)), a little below the
// note (A4: 439.99 Hz for 440 Hz). These are not homework 3's numbers.
import { useState } from "react";
import { CodePre } from "../CopyButton";

const TBCLK = 12.5e6;
/** One count of the counter, in ns. */
const TICK_NS = 1e9 / TBCLK;
const NOTES: [string, number][] = [
  ["C4", 261.63],
  ["D4", 293.66],
  ["E4", 329.63],
  ["F4", 349.23],
  ["G4", 392.0],
  ["A4", 440.0],
  ["B4", 493.88],
  ["C5", 523.25],
];
/** Window drawn, in ticks of 80 ns: 8 ms. */
const TW = 100000;
const CMAX = 25000;

const CSS = `
.buzt-read { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.4rem 0; }
.buzt-read div { flex: 1 1 5.4rem; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 0.25rem 0.55rem; font-size: 0.78rem; color: var(--dim); }
.buzt-read b { display: block; font-family: var(--mono); color: var(--value); font-size: 0.95rem; }
.buzt pre { margin: 0.3rem 0 0; font-size: 0.78rem; background: var(--surface); border-radius: 6px; padding: 0.4rem 0.6rem; overflow-x: auto; }
.buzt .fig-opt { padding: 0.12em 0.55em; }
.buzt-halo { paint-order: stroke; stroke: var(--inset); stroke-width: 3px; stroke-linejoin: round; }
`;

function play(hz: number) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = hz;
    gain.gain.value = 0.04;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
    osc.onended = () => void ctx.close();
  } catch {
    // No sound available: the picture still tells the story.
  }
}

function BuzzerTone() {
  const [ni, setNi] = useState(5);
  const off = ni < 0;
  const [name, want] = off ? ["OFF", 0] : NOTES[ni];
  const prd = off ? 0 : Math.floor(TBCLK / 2 / want);
  const len = prd + 1;
  const toothMs = (len * TICK_NS) / 1e6;
  const tone = TBCLK / (2 * len);

  const X0 = 52;
  const X1 = 408;
  const Y0 = 100;
  const Y1 = 22;
  const PH = 122;
  const PL = 146;
  const x = (t: number) => X0 + (Math.min(t, TW) / TW) * (X1 - X0);
  const y = (c: number) => Y0 - (c / CMAX) * (Y0 - Y1);
  let ctr = "";
  let pin = `M${X0},${PL}`;
  let fill = "";
  // The pin starts low and toggles each time the counter equals TBPRD.
  const tops = off ? [] : Array.from({ length: Math.ceil((TW - prd) / len) }, (_, k) => k * len + prd);
  if (!off) {
    for (let k = 0; k * len < TW; k++) {
      const t0 = k * len;
      const t1 = Math.min(TW, t0 + prd);
      ctr += `M${x(t0)},${y(0)} L${x(t1)},${y(t1 - t0)} `;
      if (t0 + prd < TW) ctr += `V${y(0)} `;
    }
    tops.forEach((t, k) => {
      pin += ` H${x(t)} V${k % 2 === 0 ? PH : PL}`;
      if (k % 2 === 0) fill += `M${x(t)},${PL} V${PH} H${x(t + len)} V${PL} Z `;
    });
    pin += ` H${X1}`;
  } else {
    ctr = `M${X0},${y(0)} H${X1}`;
    pin += ` H${X1}`;
  }

  const why = off
    ? "OFFNOTE is 0. With TBPRD = 0 the counter has nowhere to go: it equals TBPRD on every count, so the pin would toggle every 80 ns. That is a 6.25 MHz square wave, far above what the buzzer or your ear can follow: silence."
    : `The pin toggles each time the counter reaches TBPRD, the top of a tooth, so one high plus one low takes two teeth: the tone is half the counter's frequency. ${name}: 12.5 MHz / 2 / ${want} Hz = ${prd} counts in TBPRD. The pin gives ${tone.toFixed(2)} Hz, always at 50 % duty, and CMPA is not used at all.`;

  return (
    <figure className="figure buzt" aria-label="Interactive buzzer figure: a counter that toggles the pin at its top makes a square wave of half its frequency">
      <style>{CSS}</style>
      <svg viewBox="0 0 420 188" role="img" aria-label={off ? "Note off: TBPRD is 0, the buzzer is silent." : `Note ${name}: TBPRD ${prd}, one tooth of the counter lasts ${toothMs.toFixed(3)} milliseconds, the pin toggles each time the counter equals TBPRD and gives ${tone.toFixed(2)} hertz.`}>
        <text x="4" y={Y1 + 3} className="fig-label">TBCTR</text>
        <text x="4" y={Y1 + 14} className="fig-label dim">counter</text>
        <line x1={X0} x2={X1} y1={Y0} y2={Y0} className="fig-wire" />
        <line x1={X0} x2={X0} y1={Y0} y2={Y1 - 8} className="fig-wire" />
        <text x={X0 - 5} y={Y0 + 3} textAnchor="end" className="fig-label dim">0</text>
        {tops.map((t) => (
          <line key={t} x1={x(t)} x2={x(t)} y1={y(prd)} y2={PL} className="fig-sample" />
        ))}
        <path d={ctr} className="fig-trace dim" style={{ stroke: "var(--text)" }} />
        {!off && (
          <>
            <line x1={X0} x2={X1} y1={y(prd)} y2={y(prd)} stroke="var(--info)" strokeWidth="1.4" strokeDasharray="6 3" />
            <text x={X1 - 2} y={y(prd) - 4} textAnchor="end" className="fig-value small buzt-halo" style={{ fill: "var(--info)" }}>TBPRD = {prd}</text>
          </>
        )}
        {tops.map((t) => (
          <circle key={t} cx={x(t)} cy={y(prd)} r="2.6" fill="var(--accent)" />
        ))}
        <text x="4" y={PH + 9} className="fig-label">EPWM9A</text>
        <text x="4" y={PH + 20} className="fig-label dim">buzzer</text>
        <path d={fill} fill="var(--accent-soft)" />
        <path d={pin} className="fig-trace" style={{ stroke: "var(--hi)" }} />
        {off ? (
          <text x={(X0 + X1) / 2} y={PH + 8} textAnchor="middle" className="fig-label dim">silent</text>
        ) : (
          <>
            <path d={`M${x(0)},${PL + 5} v4 H${x(len)} v-4`} className="fig-wire" />
            <text x={x(len / 2)} y={PL + 19} textAnchor="middle" className="fig-label dim">1 tooth</text>
            <path d={`M${x(prd + len)},${PL + 5} v4 H${x(prd + 3 * len)} v-4`} className="fig-wire" style={{ stroke: "var(--value)" }} />
            <text x={x(prd + 2 * len)} y={PL + 19} textAnchor="middle" className="fig-value small">one period of the tone</text>
          </>
        )}
        {[0, 2, 4, 6, 8].map((ms) => (
          <text key={ms} x={x(ms * 12500)} y="184" textAnchor={ms === 0 ? "start" : ms === 8 ? "end" : "middle"} className="fig-label dim">{ms === 0 ? "0" : `${ms} ms`}</text>
        ))}
      </svg>
      <div className="buzt-read">
        <div>TBPRD<b>{prd}</b>{off ? "OFFNOTE" : `6.25 MHz / ${want} Hz`}</div>
        <div>Counter<b>{off ? "-" : `${(TBCLK / len).toFixed(1)} Hz`}</b>{off ? "not counting" : `${toothMs.toFixed(3)} ms a tooth`}</div>
        <div>Tone on the pin<b>{off ? "silent" : `${tone.toFixed(2)} Hz`}</b>{off ? "nothing to hear" : "half the counter's"}</div>
      </div>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Note</span>
          {NOTES.map(([n], i) => (
            <button key={n} className="fig-opt" aria-pressed={ni === i} aria-label={`Note ${n}`} onClick={() => setNi(i)}>{n}</button>
          ))}
          <button className="fig-opt" aria-pressed={off} onClick={() => setNi(-1)}>off</button>
          <button className="btn small" disabled={off} onClick={() => play(tone)}>Hear it</button>
        </div>
      </div>
      <CodePre><code>{`EPwm9Regs.TBCTL.bit.CLKDIV = 2;   // /4: 12.5 MHz\nEPwm9Regs.AQCTLA.bit.PRD = 3;     // toggle at TBPRD\nEPwm9Regs.AQCTLA.bit.CAU = 0;     // no compare action\n${off ? "#define OFFNOTE 0" : `#define ${name}NOTE ((uint16_t)(((50000000/4)/2)/${want.toFixed(2)}))`}\nEPwm9Regs.TBPRD = ${name}NOTE;        // ${prd}`}</code></CodePre>
      <figcaption>The time axis is fixed at 8 ms: a higher note has a smaller TBPRD, so the counter turns back sooner and more teeth fit.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "buzzer-tone",
  title: "Buzzer notes from a timer",
  description: "Pick a note and see the counter period that produces it, the square wave on the pin and why the tone is half the counter's frequency.",
  Component: BuzzerTone,
};
