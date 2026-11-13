// Why PWM works: a load that is slower than the switching sees the average,
// duty x 3.3 V (TRM 15.1 introduction; Lab 3 exercise 1 dims LED1 this
// way; duty = CMPA / (TBPRD + 1) with ZRO set and CAU clear, 15.6). The "slow load" is a first-order low-pass filter with a 30 ms time
// constant, about what the eye does with a flickering light.
import { useEffect, useMemo, useState } from "react";

const FREQS: [number, string][] = [
  [2, "2 Hz"],
  [5, "5 Hz"],
  [20, "20 Hz"],
  [100, "100 Hz"],
  [20000, "20 kHz"],
];
/** Window drawn, s. While playing, the cursor crosses it in real time. */
const WIN = 1;
const TAU = 0.03;
const N = 2000;

const CSS = `
.pwma input[type=range] { flex: 1 1 7rem; min-width: 5rem; padding: 0; accent-color: var(--accent); }
.pwma-note { color: var(--dim); font-size: 0.82rem; }
.pwma-halo { paint-order: stroke; stroke: var(--inset); stroke-width: 3px; stroke-linejoin: round; }
`;

function PwmAverage() {
  const [pct, setPct] = useState(25);
  const [fi, setFi] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [phase, setPhase] = useState(0);
  const [still] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const duty = pct / 100;
  const f = FREQS[fi][0];
  const periods = f * WIN;
  const drawn = periods <= 20;

  // The filter's output in steady state, sampled over the window (0..1 of 3.3 V).
  const filtered = useMemo(() => {
    const out = new Float32Array(N + 1);
    if (f > 1000) return out.fill(duty);
    const dt = WIN / N;
    const a = 1 - Math.exp(-dt / TAU);
    let v = duty;
    // Two passes: the first one settles the filter.
    for (let pass = 0; pass < 2; pass++)
      for (let i = 0; i <= N; i++) {
        const frac = (i * dt * f) % 1;
        v += ((frac < duty ? 1 : 0) - v) * a;
        if (pass) out[i] = v;
      }
    return out;
  }, [f, duty]);

  useEffect(() => {
    if (!playing || still) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      setPhase((((t - t0) / 1000) % WIN) / WIN);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, still]);

  const X0 = 46;
  const X1 = 318;
  const PH = 22;
  const PL = 62;
  const FH = 92;
  const FL = 132;
  const x = (s: number) => X0 + (s / WIN) * (X1 - X0);
  const yp = (v: number) => PL - v * (PL - PH);
  const yf = (v: number) => FL - v * (FL - FH);

  let pin = "";
  let fill = "";
  if (drawn && duty > 0 && duty < 1) {
    pin = `M${X0},${PL}`;
    for (let k = 0; k < periods; k++) {
      const a = x(k / f);
      const b = x((k + duty) / f);
      pin += ` V${PH} H${b} V${PL} H${x((k + 1) / f)}`;
      fill += `M${a},${PL} V${PH} H${b} V${PL} Z `;
    }
  } else if (duty === 0 || duty === 1) pin = `M${X0},${yp(duty)} H${X1}`;
  let filt = "";
  for (let i = 0; i <= N; i += 4) filt += `${i ? "L" : "M"}${x((i / N) * WIN).toFixed(1)},${yf(filtered[i]).toFixed(1)} `;

  // The eye (and a 60 frames per second screen) cannot follow more than about 20 Hz.
  const flickers = f <= 20 && duty > 0 && duty < 1;
  const at = playing ? phase : 0;
  const seen = flickers && playing ? filtered[Math.round(at * N)] : duty;
  const lo = Math.min(...filtered);
  const hi = Math.max(...filtered);
  const ripple = (hi - lo) * 3.3;
  const avg = duty * 3.3;
  const cmpa = Math.round(duty * 2500);
  const avgV = avg.toFixed(3).replace(/0$/, "");

  const why =
    duty === 0 || duty === 1
      ? `At ${pct} % the pin never switches: it is simply ${duty ? "high, 3.3 V" : "low, 0 V"}.`
      : f <= 5
        ? `At ${FREQS[fi][1]} the LED has time to go fully on and fully off: you see it blink, not dim. The slow load follows the pin (it swings by ${ripple.toFixed(1)} V).${playing || still ? "" : " Press Play to watch."}`
        : f <= 20
          ? `At 20 Hz the LED flickers: the slow load no longer reaches 0 V or 3.3 V, but it still swings by ${ripple.toFixed(1)} V around the average.`
          : f <= 1000
            ? `At 100 Hz the pulses are much shorter than the load's response time. Only a ripple of ${ripple.toFixed(2)} V is left around the average of ${avgV} V: the LED looks steadily dim.`
            : `At 20 kHz there are 20 000 pulses in this one second, far too many to draw or to see. What is left is the average, ${pct} % x 3.3 V = ${avgV} V. This is the course's PWM frequency.`;

  return (
    <figure className="figure pwma" aria-label="Interactive figure: a PWM waveform, its average and what a slow load sees">
      <style>{CSS}</style>
      <svg viewBox="0 0 420 152" role="img" aria-label={`Duty cycle ${pct} percent at ${FREQS[fi][1]}. Average ${avgV} volts. ${flickers ? "The LED visibly flickers." : "The LED looks steady."} The slow load swings by ${ripple.toFixed(2)} volts.`}>
        <text x="4" y={(PH + PL) / 2 + 3} className="fig-label">the pin</text>
        <text x={X0 - 4} y={PH + 3} textAnchor="end" className="fig-label dim">3.3 V</text>
        <text x={X0 - 4} y={PL + 3} textAnchor="end" className="fig-label dim">0 V</text>
        {drawn || duty === 0 || duty === 1 ? (
          <>
            <path d={fill} fill="var(--accent-soft)" />
            <path d={pin} className="fig-trace" style={{ stroke: "var(--hi)" }} />
          </>
        ) : (
          <>
            <rect x={X0} y={PH} width={X1 - X0} height={PL - PH} fill="var(--hi)" fillOpacity={0.15 + 0.5 * duty} stroke="var(--hi)" strokeWidth="1.5" />
            <text x={(X0 + X1) / 2} y={(PH + PL) / 2 + 3} textAnchor="middle" className="fig-label pwma-halo">{periods >= 1000 ? "20 000" : periods} pulses, too close to draw</text>
          </>
        )}
        <line x1={X0} x2={X1} y1={yp(duty)} y2={yp(duty)} stroke="var(--value)" strokeWidth="1.4" strokeDasharray="5 3" />
        <text x={X1 + 4} y={yp(duty) + 3} className="fig-value small">{avgV} V</text>
        <text x={X1 + 4} y={yp(duty) + 13 > PL + 6 ? yp(duty) - 7 : yp(duty) + 13} className="fig-label dim">average</text>

        <text x="4" y={FH + 8} className="fig-label">a slow</text>
        <text x="4" y={FH + 19} className="fig-label">load sees</text>
        <line x1={X0} x2={X1} y1={FH} y2={FH} stroke="var(--border)" />
        <line x1={X0} x2={X1} y1={FL} y2={FL} stroke="var(--border)" />
        <line x1={X0} x2={X1} y1={yf(duty)} y2={yf(duty)} stroke="var(--value)" strokeWidth="1" strokeDasharray="5 3" />
        <path d={filt} className="fig-trace data" style={{ strokeWidth: 1.8 }} strokeLinejoin="round" />
        <text x={X0} y="146" className="fig-label dim">0</text>
        <text x={(X0 + X1) / 2} y="146" textAnchor="middle" className="fig-label dim">0.5 s</text>
        <text x={X1} y="146" textAnchor="end" className="fig-label dim">1 s</text>
        {playing && flickers && <line x1={x(at * WIN)} x2={x(at * WIN)} y1={PH - 6} y2={FL + 4} className="fig-sample" />}

        {/* LED */}
        <text x="382" y="20" textAnchor="middle" className="fig-label">LED1</text>
        <circle cx="382" cy="62" r="30" fill="var(--hi)" fillOpacity={0.3 * seen} />
        <circle cx="382" cy="62" r="17" fill="var(--surface)" stroke="var(--dim)" />
        <circle cx="382" cy="62" r="17" fill="var(--hi)" fillOpacity={seen} />
        <text x="382" y="108" textAnchor="middle" className="fig-value small">{Math.round(seen * 100)} %</text>
        <text x="382" y="119" textAnchor="middle" className="fig-label dim">brightness</text>
        <text x="382" y="130" textAnchor="middle" className="fig-label dim">{flickers ? (playing ? "flickering" : "it flickers") : "steady"}</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Duty cycle</span>
          <input type="range" min={0} max={100} step={5} value={pct} aria-label="Duty cycle in percent" onChange={(e) => setPct(+e.target.value)} />
          <span className="pwma-note" style={{ color: "var(--value)", fontFamily: "var(--mono)", minWidth: "2.8em", textAlign: "right" }}>{pct} %</span>
          <code>EPwm12Regs.CMPA.bit.CMPA = {cmpa}; // {pct} % of 2500</code>
        </div>
        <div>
          <span>Switching</span>
          {FREQS.map(([, name], i) => (
            <button key={name} className="fig-opt" aria-pressed={fi === i} onClick={() => setFi(i)}>{name}</button>
          ))}
        </div>
        <div>
          <span>Real time</span>
          <button className="btn small primary" aria-pressed={playing} disabled={still} onClick={() => setPlaying(!playing)}>{playing ? "Stop" : "Play"}</button>
          <span className="pwma-note">{still ? "off: your system asks for reduced motion" : "the picture is one second long; Play runs it at real speed"}</span>
        </div>
      </div>
      <figcaption>The pin only ever outputs 0 V or 3.3 V. Switched slowly, the LED blinks. Switched faster than the load can follow, the same waveform is a steady {avgV} V: the duty cycle has become a voltage.</figcaption>
    </figure>
  );
}

export const figure = { id: "pwm-average", Component: PwmAverage };
