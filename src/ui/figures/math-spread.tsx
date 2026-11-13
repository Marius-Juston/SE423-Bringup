import { useState } from "react";

// Maths you need before the Kalman filter (Lectures 20-21, HW6): the
// average (mean) of noisy readings and their spread (variance, standard
// deviation), and the bell curve (Gaussian) that noise usually follows.
// Not a chip peripheral: no TRM section applies.

const TRUE = 2.0; // ft
const LO = 0.6;
const HI = 3.4;
const X0 = 10;
const X1 = 390;
const BASE = 150;
const BIN = 0.1;
const sx = (v: number) => X0 + ((v - LO) / (HI - LO)) * (X1 - X0);
const fmt = (v: number, d = 2) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);

// 200 fixed standard-normal numbers (seeded generator + Box-Muller), so the
// figure shows the same readings every time.
const NORMALS: number[] = (() => {
  let seed = 423;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return (seed + 1) / 2147483649;
  };
  const out: number[] = [];
  while (out.length < 200) {
    const r = Math.sqrt(-2 * Math.log(rnd()));
    const a = 2 * Math.PI * rnd();
    out.push(r * Math.cos(a), r * Math.sin(a));
  }
  return out;
})();

function MathSpread() {
  const [sigma, setSigma] = useState(0.2);
  const [n, setN] = useState(40);
  const [bias, setBias] = useState(false);

  const centre = TRUE + (bias ? 0.3 : 0);
  const readings = NORMALS.slice(0, n).map((z) => centre + sigma * z);
  const mean = readings.reduce((a, b) => a + b, 0) / n;
  const variance = readings.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  const last = readings[n - 1];
  // histogram
  const bins = new Map<number, number>();
  for (const r of readings) {
    const k = Math.floor((r - LO) / BIN);
    bins.set(k, (bins.get(k) ?? 0) + 1);
  }
  const peakCount = Math.max(...bins.values());
  const unit = Math.min(12, 104 / peakCount); // px per reading
  // bell curve of the sensor, scaled to the expected count per bin
  let bell = "";
  for (let i = 0; i <= 140; i++) {
    const v = LO + (i / 140) * (HI - LO);
    const pdf = Math.exp(-((v - centre) ** 2) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI));
    bell += `${i ? "L" : "M"}${sx(v).toFixed(1)},${Math.max(BASE - pdf * BIN * n * unit, 18).toFixed(1)}`;
  }
  const why =
    n === 1
      ? `One reading: ${fmt(last)} ft. The true distance is ${fmt(TRUE)} ft, so this reading is ${fmt(Math.abs(last - TRUE))} ft off, and you cannot tell from one number. Take more readings.`
      : bias
        ? `The sensor now reads 0.3 ft too much, every time (a bias). The average of ${n} readings is ${fmt(mean)} ft: averaging removed the noise but not the bias. The spread is unchanged: variance ${fmt(variance, 3)}.`
        : `${n} readings of the same ${fmt(TRUE)} ft. Their average (mean) is ${fmt(mean)} ft, only ${fmt(Math.abs(mean - TRUE), 3)} ft off. A single reading is typically ${fmt(sd)} ft from the mean (the standard deviation). Its square, ${fmt(variance, 3)}, is the variance.`;

  return (
    <figure className="figure mp-fig" aria-label="Interactive figure: the mean and the spread of noisy sensor readings">
      <style>{`.mp-fig .mp-range{flex:1;min-width:110px;accent-color:var(--orange)}.mp-fig .mp-axis{stroke:var(--dim);stroke-width:1}.mp-fig .mp-bar{fill:var(--accent-soft);stroke:var(--orange);stroke-width:1}.mp-fig .mp-band{fill:var(--faint)}.mp-fig .mp-bell{fill:none;stroke:var(--arches);stroke-width:1.8}.mp-fig .mp-mean{stroke:var(--harvest);stroke-width:2.4}.mp-fig .mp-true{stroke:var(--text);stroke-width:1.4;stroke-dasharray:4 3}.mp-fig .mp-num{font-family:var(--mono);font-size:0.82rem;min-width:4.6rem;text-align:right}`}</style>
      <svg viewBox="0 0 400 200" role="img" aria-label={`${n} readings of a true distance of ${fmt(TRUE)} feet. Mean ${fmt(mean)} feet, variance ${fmt(variance, 3)}, standard deviation ${fmt(sd)} feet.`}>
        {n > 1 && <rect x={sx(mean - sd)} width={sx(mean + sd) - sx(mean - sd)} y={30} height={BASE - 30} className="mp-band" />}
        {[...bins.entries()].map(([k, count]) => (
          <rect key={k} x={sx(LO + k * BIN) + 0.6} width={sx(LO + BIN) - X0 - 1.2} y={BASE - count * unit} height={count * unit} className="mp-bar" />
        ))}
        <path d={bell} className="mp-bell" />
        <line x1={X0} x2={X1} y1={BASE} y2={BASE} className="mp-axis" />
        {[1, 1.5, 2, 2.5, 3].map((v) => (
          <g key={v}>
            <line x1={sx(v)} x2={sx(v)} y1={BASE} y2={BASE + 4} className="mp-axis" />
            <text x={sx(v)} y={BASE + 14} textAnchor="middle" className="fig-label dim">{v.toFixed(1)} ft</text>
          </g>
        ))}
        <line x1={sx(TRUE)} x2={sx(TRUE)} y1={22} y2={BASE} className="mp-true" />
        <text x={sx(TRUE) - 4} y={20} textAnchor="end" className="fig-label">true: {fmt(TRUE)}</text>
        <line x1={sx(mean)} x2={sx(mean)} y1={30} y2={BASE} className="mp-mean" />
        <text x={sx(mean) + 4} y={20} className="fig-value small">mean: {fmt(mean)}</text>
        {n > 1 && <text x={sx(mean + sd) + 3} y={42} className="fig-label dim">grey band: mean ± {fmt(sd)}</text>}
        <text x={X0} y={178} className="fig-label">mean = sum / count = <tspan className="fig-value small">{fmt(mean)} ft</tspan></text>
        <text x={X0} y={193} className="fig-label">variance = average of (reading - mean) squared = <tspan className="fig-value small">{fmt(variance, 3)}</tspan></text>
        <text x={X1} y={178} textAnchor="end" className="fig-label dim">bars: readings, blue: bell curve</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Readings</span>
          <input className="mp-range" type="range" aria-label="Number of readings" min={1} max={200} step={1} value={n} onChange={(e) => setN(+e.target.value)} />
          <span className="mp-num">{n}</span>
        </div>
        <div>
          <span>Noise</span>
          <input className="mp-range" type="range" aria-label="Noise of the sensor: typical error of one reading, in feet" min={0.05} max={0.4} step={0.05} value={sigma} onChange={(e) => setSigma(+e.target.value)} />
          <span className="mp-num">{fmt(sigma)} ft</span>
        </div>
        <div>
          <span>Sensor</span>
          <button className="fig-opt" aria-pressed={!bias} onClick={() => setBias(false)}>noise only</button>
          <button className="fig-opt" aria-pressed={bias} onClick={() => setBias(true)}>noise and a bias of 0.3 ft</button>
        </div>
      </div>
      <figcaption>A sensor measures the same distance again and again and never says the same thing twice. The mean is the best single guess. The variance says how wide the readings scatter: a good sensor has a small one. Most noise piles up in a bell shape (a Gaussian): about two thirds of the readings fall inside the grey band.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "math-spread",
  title: "Mean and variance of noisy readings",
  description: "Take more readings or make the sensor noisier and watch the mean, the variance and the bell shape of the scatter.",
  Component: MathSpread,
};
