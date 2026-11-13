// Sampling and aliasing (course Lectures 8-9; not a chip feature, so no TRM
// section: the ADC only supplies the sampling rate, set by its trigger, TRM
// 11.5). Samples of sin(2 pi f t) taken every 1/fs are identical to samples
// of sin(2 pi (f - k fs) t) for any whole k. The lowest such frequency,
// |f - k fs| with k = round(f / fs), is what the samples show. It equals f
// only while f is below the Nyquist frequency fs / 2.
import { useState } from "react";

const T_MS = 10;
const F_AXIS = 2000;
const CSS = `
.alias input[type=range] { flex: 1 1 8rem; min-width: 6rem; padding: 0; accent-color: var(--orange); }
.alias .alias-num { font-family: var(--mono); color: var(--harvest); min-width: 4.2em; text-align: right; }
`;

function SamplingAlias() {
  const [f, setF] = useState(900);
  const [fs, setFs] = useState(1000);
  const nyq = fs / 2;
  const k = Math.round(f / fs);
  const fd = f - k * fs; // in (-fs/2, fs/2]
  const fa = Math.abs(fd);
  const onLimit = fa === nyq && f > nyq;
  const aliased = f > nyq + 1e-9;
  const flipped = fd < 0;

  const X0 = 10;
  const X1 = 410;
  const MID = 62;
  const AMP = 34;
  const x = (ms: number) => X0 + (ms / T_MS) * (X1 - X0);
  const wave = (hz: number, sign: number) => {
    let d = "";
    for (let i = 0; i <= 800; i++) {
      const ms = (T_MS * i) / 800;
      d += `${i ? "L" : "M"}${x(ms).toFixed(1)},${(MID - sign * AMP * Math.sin(2 * Math.PI * hz * ms * 1e-3)).toFixed(1)}`;
    }
    return d;
  };
  const samples: { ms: number; v: number }[] = [];
  for (let n = 0; n <= Math.floor((T_MS * fs) / 1000 + 1e-9); n++) samples.push({ ms: (n * 1000) / fs, v: Math.sin((2 * Math.PI * f * n) / fs) });

  // frequency strip
  const FX0 = 30;
  const FX1 = 404;
  const FY = 160;
  const fx = (hz: number) => FX0 + (hz / F_AXIS) * (FX1 - FX0);
  const formula = k === 0 ? "" : fd < 0 ? `${k === 1 ? "" : `${k} x `}${fs} - ${f} = ${fa}` : `${f} - ${k === 1 ? "" : `${k} x `}${fs} = ${fa}`;
  const perPeriod = (fs / f).toFixed(fs % f === 0 ? 0 : 2);

  const why = !aliased
    ? `${f} Hz is below the Nyquist frequency ${fs} / 2 = ${nyq} Hz. There are ${perPeriod} samples in every period, enough to pin the sine down: the samples show the real signal.`
    : fa === 0
      ? `${f} Hz is ${k === 1 ? "exactly" : `${k} times`} the sampling rate. Every sample lands on the same point of the wave, so the samples show a constant: 0 Hz. The tone has vanished.`
      : onLimit
        ? `${f} Hz folds onto the Nyquist frequency itself (${nyq} Hz), where there are only 2 samples per period. Here they all land on the zero crossings. Sample more than twice as fast as the highest frequency, not exactly twice.`
        : `${f} Hz is above the Nyquist frequency ${fs} / 2 = ${nyq} Hz: only ${perPeriod} samples per period. The very same samples fit a sine of ${fa} Hz (${formula})${flipped ? ", upside down" : ""}. That alias is what your program sees, and nothing done after sampling can tell the two apart.`;
  const whyLimit = Math.abs(f - nyq) < 1e-9 ? `${f} Hz is exactly the Nyquist frequency ${fs} / 2: 2 samples per period. Here every sample lands on a zero crossing and the tone vanishes. Sample more than twice as fast as the highest frequency, not exactly twice.` : why;

  return (
    <figure className="figure alias" aria-label="Interactive sampling and aliasing diagram">
      <style>{CSS}</style>
      <svg viewBox="0 0 420 196" role="img" aria-label={`A ${f} hertz sine sampled ${fs} times per second. Nyquist frequency ${nyq} hertz. The samples show ${aliased ? `${fa} hertz, an alias` : "the real signal"}.`}>
        <text x={X0} y="12" className="fig-label" style={{ fill: "var(--arches)" }}>real signal: {f} Hz</text>
        <text x={X1} y="12" textAnchor="end" className="fig-label" style={{ fill: "var(--harvest)" }}>{aliased ? `what the samples show: ${fa} Hz` : "the samples show the same signal"}</text>
        <line x1={X0} x2={X1} y1={MID} y2={MID} stroke="var(--border)" />
        <path d={wave(f, 1)} className="fig-trace" style={{ strokeWidth: aliased ? 1.1 : 1.8, opacity: aliased ? 0.75 : 1 }} />
        {aliased && <path d={wave(fa, flipped ? -1 : 1)} className="fig-trace data" style={{ strokeWidth: 2.2 }} />}
        {samples.map((s, i) => (
          <g key={i}>
            <line x1={x(s.ms)} x2={x(s.ms)} y1={MID} y2={MID - AMP * s.v} stroke="var(--orange)" strokeWidth="1" />
            <circle cx={x(s.ms)} cy={MID - AMP * s.v} r="3" fill="var(--orange)" stroke="var(--text)" strokeWidth="0.7" />
          </g>
        ))}
        <text x={X0} y="112" className="fig-label dim">0 ms</text>
        <text x={(X0 + X1) / 2} y="112" textAnchor="middle" className="fig-label" style={{ fill: "var(--orange)" }}>dots: {samples.length} samples, one every {(1000 / fs).toFixed(2)} ms</text>
        <text x={X1} y="112" textAnchor="end" className="fig-label dim">{T_MS} ms</text>
        {/* frequency strip */}
        <rect x={FX0} y={FY - 20} width={fx(nyq) - FX0} height="20" fill="var(--arches)" fillOpacity="0.16" />
        <line x1={FX0} x2={FX1} y1={FY} y2={FY} className="fig-wire" />
        {[0, 500, 1000, 1500, 2000].map((hz) => (
          <g key={hz}>
            <line x1={fx(hz)} x2={fx(hz)} y1={FY} y2={FY + 3} className="fig-wire" />
            <text x={fx(hz)} y={FY + 13} textAnchor="middle" className="fig-label dim">{hz}{hz === 2000 ? " Hz" : ""}</text>
          </g>
        ))}
        <line x1={fx(nyq)} x2={fx(nyq)} y1={FY - 30} y2={FY} stroke="var(--text)" strokeWidth="1.4" strokeDasharray="3 2" />
        <text x={fx(nyq) - 4} y={FY - 25} textAnchor="end" className="fig-label">Nyquist {nyq} Hz</text>
        <line x1={fx(fs)} x2={fx(fs)} y1={FY - 30} y2={FY} stroke="var(--orange)" strokeWidth="1.4" />
        <text x={fx(fs) + (fs > 1500 ? -4 : 4)} y={FY - 25} textAnchor={fs > 1500 ? "end" : "start"} className="fig-label" style={{ fill: "var(--orange)" }}>{fs > 1500 ? `${fs} samples/s` : `sampling rate ${fs}/s`}</text>
        {aliased && Math.abs(fx(f) - fx(fa)) > 16 && (
          <path d={`M${fx(f)},${FY - 5} Q${(fx(f) + fx(fa)) / 2},${FY - 26} ${fx(fa) + (fa < f ? 3 : -3)},${FY - 6}`} fill="none" stroke="var(--harvest)" strokeWidth="1.4" strokeDasharray="3 2" markerEnd="url(#alias-arrow)" />
        )}
        <circle cx={fx(f)} cy={FY} r="4.2" fill="var(--arches)" stroke="var(--text)" strokeWidth="0.8" />
        <text x={fx(f) + 7} y={FY + 26} className="fig-label" style={{ fill: "var(--arches)" }}>real: {f} Hz</text>
        <line x1={fx(f)} x2={fx(f) + 5} y1={FY + 5} y2={FY + 19} stroke="var(--arches)" strokeWidth="0.8" />
        {aliased && (
          <>
            <rect x={fx(fa) - 4} y={FY - 4} width="8" height="8" fill="var(--harvest)" stroke="var(--text)" strokeWidth="0.8" />
            <line x1={fx(fa)} x2={fx(fa) + (fx(fa) < 100 ? 5 : -5)} y1={FY + 5} y2={FY + 19} stroke="var(--harvest)" strokeWidth="0.8" />
            <text x={fx(fa) + (fx(fa) < 100 ? 7 : -7)} y={FY + 26} textAnchor={fx(fa) < 100 ? "start" : "end"} className="fig-label" style={{ fill: "var(--harvest)" }}>seen as: {fa} Hz</text>
          </>
        )}
        <defs>
          <marker id="alias-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" fill="var(--harvest)" />
          </marker>
        </defs>
      </svg>
      <p className="fig-why" role="status">{whyLimit}</p>
      <div className="fig-controls">
        <div>
          <span>Signal</span>
          <input type="range" min={50} max={1500} step={10} value={f} aria-label="Signal frequency in hertz" onChange={(e) => setF(+e.target.value)} />
          <span className="alias-num">{f} Hz</span>
        </div>
        <div>
          <span>Sampling</span>
          <input type="range" min={400} max={2000} step={50} value={fs} aria-label="Sampling rate in hertz" onChange={(e) => setFs(+e.target.value)} />
          <span className="alias-num">{fs} Hz</span>
          <code>Nyquist = {fs} / 2 = {nyq} Hz</code>
        </div>
      </div>
      <figcaption>Top: 10 ms of a sine and the samples taken from it. Bottom: the frequency axis. Only the shaded part, from 0 Hz to half the sampling rate, can be told apart in the samples; a tone outside it lands back inside. Drag the signal frequency across the Nyquist line and watch the slow wave appear.</figcaption>
    </figure>
  );
}

export const figure = { id: "sampling-alias", Component: SamplingAlias };
