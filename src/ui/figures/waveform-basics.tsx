import { useState } from "react";

// Reading a waveform (primer A): voltage against time, as an oscilloscope
// draws it. A square wave between 0 V and 3.3 V with its period T, its
// frequency f = 1 / T and its duty cycle (the share of each period spent
// high). The window is always 10 ms wide.

const FREQS: [number, string][] = [
  [100, "100 Hz"],
  [200, "200 Hz"],
  [500, "500 Hz"],
  [1000, "1 kHz"],
];
const WIN_MS = 10;

const CSS = `
.wb input[type=range] { flex: 1 1 7rem; min-width: 5rem; padding: 0; }
.wb-num { color: var(--value); font-family: var(--mono); min-width: 3.4em; text-align: right; font-size: 0.86rem; }
.wb-dim { stroke: var(--harvest); stroke-width: 1.2; fill: none; }
.wb-grid { stroke: var(--border); stroke-width: 1; }
.wb-fill { fill: var(--accent-soft); }
`;

function WaveformBasics() {
  const [fi, setFi] = useState(1);
  const [pct, setPct] = useState(50);
  const f = FREQS[fi][0];
  const tMs = 1000 / f;
  const duty = pct / 100;
  const highMs = +(tMs * duty).toFixed(3);
  const X0 = 44;
  const X1 = 388;
  const HI = 34;
  const LO = 92;
  const x = (ms: number) => X0 + (ms / WIN_MS) * (X1 - X0);
  const periods = WIN_MS / tMs;
  let path = "";
  let fill = "";
  if (duty === 0) path = `M${X0},${LO} H${X1}`;
  else if (duty === 1) path = `M${X0},${HI} H${X1}`;
  else {
    path = `M${X0},${LO}`;
    for (let k = 0; k < periods; k++) {
      const a = x(k * tMs);
      const b = x((k + duty) * tMs);
      path += ` V${HI} H${b} V${LO} H${x((k + 1) * tMs)}`;
      fill += `M${a},${LO} V${HI} H${b} V${LO} Z `;
    }
  }
  const flat = duty === 0 || duty === 1;
  const why = flat
    ? `At ${pct} % the signal never changes: it stays ${duty ? "high at 3.3 V" : "low at 0 V"}. There is no period to measure.`
    : `One full cycle (high, then low) takes T = ${tMs} ms. That fits ${periods === 1 ? "once" : `${periods} times`} in this 10 ms picture, and ${f} times in one second: f = 1 / T = ${FREQS[fi][1]}. The signal is high for ${highMs} ms of every ${tMs} ms, a duty cycle of ${pct} %.`;
  const bracket = (xa: number, xb: number, y: number) => `M${xa},${y - 4} V${y + 4} M${xa},${y} H${xb} M${xb},${y - 4} V${y + 4}`;
  return (
    <figure className="figure wb" aria-label="Interactive waveform: a square wave with adjustable frequency and duty cycle">
      <style>{CSS}</style>
      <svg viewBox="0 0 400 150" role="img" aria-label={flat ? `A flat line at ${duty ? "3.3 volts" : "0 volts"}.` : `A square wave between 0 and 3.3 volts. Period ${tMs} milliseconds, frequency ${FREQS[fi][1]}, high for ${highMs} milliseconds of each period, duty cycle ${pct} percent.`}>
        <text x={X0 - 5} y={HI + 3} textAnchor="end" className="fig-label">3.3 V</text>
        <text x={X0 - 5} y={LO + 3} textAnchor="end" className="fig-label">0 V</text>
        <text x="6" y={(HI + LO) / 2 + 3} className="fig-label dim">voltage</text>
        {Array.from({ length: 11 }, (_, k) => (
          <line key={k} x1={x(k)} y1={HI - 6} x2={x(k)} y2={LO + 6} className="wb-grid" />
        ))}
        <path d={fill} className="wb-fill" />
        <path d={path} className="fig-trace" style={{ stroke: "var(--hi)" }} />
        {!flat && (
          <>
            <path d={bracket(x(0), x(tMs), 16)} className="wb-dim" />
            <text x={(x(0) + x(tMs)) / 2} y="11" textAnchor="middle" className="fig-value small">T = {tMs} ms</text>
            <path d={bracket(x(0), x(highMs), 106)} className="wb-dim" />
            <text x={x(0)} y="122" className="fig-value small">high {highMs} ms</text>
          </>
        )}
        {[0, 5, 10].map((ms) => (
          <text key={ms} x={x(ms)} y="140" textAnchor={ms === 0 ? "start" : ms === 10 ? "end" : "middle"} className="fig-label dim">{ms} ms</text>
        ))}
        <text x={x(7.5)} y="140" textAnchor="middle" className="fig-label dim">time</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Frequency</span>
          {FREQS.map(([, name], k) => (
            <button key={name} className="fig-opt" aria-pressed={k === fi} onClick={() => setFi(k)}>{name}</button>
          ))}
        </div>
        <div>
          <span>Duty cycle</span>
          <input type="range" min={0} max={100} step={10} value={pct} aria-label="Duty cycle in percent" onChange={(e) => setPct(+e.target.value)} />
          <span className="wb-num">{pct} %</span>
        </div>
      </div>
      <figcaption>A waveform is voltage drawn against time, left to right. Each grey line is 1 ms. Period T is the time of one full cycle; frequency f = 1 / T is how many cycles fit in one second.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "waveform-basics",
  title: "Period, frequency and duty cycle",
  description: "Change the frequency and the duty cycle of a square wave to read its period and the time it spends high.",
  Component: WaveformBasics,
};
