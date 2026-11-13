import { useState } from "react";

// Maths you need: integration as a running sum of small steps,
// total = total + rate * dt. Not a chip peripheral: no TRM section applies.
// The same line is the integral term of Lecture 11's PI controller
// (I = I + e * 0.001) and the dead reckoning of Lecture 15
// (x = x + v * 0.001): the rectangle rule.

type Kind = "speed" | "error";
type Pattern = "steady" | "ramp" | "back";

const T_END = 5;
const X0 = 44;
const X1 = 392;
const sx = (t: number) => X0 + (t / T_END) * (X1 - X0);
const fmt = (v: number, d = 2) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);

const rate = (p: Pattern, t: number) => (p === "steady" ? 1 : p === "ramp" ? 0.4 * t : t < 3 ? 1 : -1);
const exact = (p: Pattern, t: number) => (p === "steady" ? t : p === "ramp" ? 0.2 * t * t : t < 3 ? t : 6 - t);

const WORDS: Record<Kind, { rate: string; total: string; ru: string; tu: string; code: string; rname: string; tname: string }> = {
  speed: { rate: "speed v, ft/s", total: "distance x, ft", ru: "ft/s", tu: "ft", code: "x = x + v * DT;", rname: "speed", tname: "distance" },
  error: { rate: "error e, ft/s", total: "integral I", ru: "ft/s", tu: "", code: "I = I + e * DT;", rname: "error", tname: "integral" },
};

function MathIntegrate() {
  const [kind, setKind] = useState<Kind>("speed");
  const [pattern, setPattern] = useState<Pattern>("steady");
  const [dt, setDt] = useState(1);
  const [t, setT] = useState(3);

  const w = WORDS[kind];
  const steps = Math.round(t / dt);
  const now = steps * dt;
  // top plot: rate from -1.2 to 2.2; bottom plot: total from -0.5 to 5.5
  const ry = (v: number) => 62 - v * 22;
  const ty = (v: number) => 196 - v * 13;
  let total = 0;
  const bars = [];
  const pts: string[] = [`${sx(0)},${ty(0)}`];
  const terms: string[] = [];
  for (let k = 0; k < Math.round(T_END / dt); k++) {
    const r = rate(pattern, k * dt);
    const done = k < steps;
    bars.push(<rect key={k} x={sx(k * dt)} width={Math.max(sx(dt) - X0 - (dt >= 0.5 ? 1.5 : 0.4), 0.6)} y={Math.min(ry(r), ry(0))} height={Math.abs(ry(r) - ry(0))} className={done ? (r < 0 ? "mi-bar neg" : "mi-bar") : "mi-bar todo"} />);
    if (done) {
      total += r * dt;
      pts.push(`${sx((k + 1) * dt).toFixed(1)},${ty(total).toFixed(1)}`);
      if (terms.length < 6) terms.push(`${fmt(r, 1)} x ${dt}`);
    }
  }
  const truth = exact(pattern, now);
  let smooth = "";
  for (let i = 0; i <= 100; i++) smooth += `${i ? "L" : "M"}${sx((i / 100) * T_END).toFixed(1)},${ty(exact(pattern, (i / 100) * T_END)).toFixed(1)}`;
  let rline = "";
  for (let i = 0; i <= 100; i++) rline += `${i ? "L" : "M"}${sx((i / 100) * T_END).toFixed(1)},${ry(rate(pattern, (i / 100) * T_END)).toFixed(1)}`;
  const off = Math.abs(total - truth);
  const sum = steps === 0 ? "nothing added yet" : steps <= 4 ? `${terms.join(" + ")} = ${fmt(total)}` : `${steps} small pieces, sum ${fmt(total)}`;
  const why =
    steps === 0
      ? `At the start the ${w.tname} is 0. Move the time slider: every step adds one bar, ${w.rname} x time step.`
      : `After ${fmt(now, 1)} s the ${w.tname} is the sum of ${steps} bar${steps > 1 ? "s" : ""}, each one "${w.rname} x ${dt} s": ${sum}${w.tu ? ` ${w.tu}` : ""}. ${
          pattern === "back" && now > 3
            ? `The ${w.rname} went negative after 3 s, so those bars are subtracted: the total comes back down.`
            : off < 0.005
              ? `That is exact here, because the ${w.rname} did not change during a step.`
              : `The exact answer is ${fmt(truth)}: the sum is ${fmt(off)} off, because the ${w.rname} changes during each step. Choose a smaller time step and the error shrinks.`
        }`;

  return (
    <figure className="figure mi-fig" aria-label="Interactive figure: adding up small steps of rate times time gives a running total">
      <style>{`.mi-fig .mi-range{flex:1;min-width:110px;accent-color:var(--orange)}.mi-fig .mi-axis{stroke:var(--dim);stroke-width:1}.mi-fig .mi-bar{fill:var(--accent-soft);stroke:var(--orange);stroke-width:1}.mi-fig .mi-bar.neg{fill:none;stroke:var(--arches);stroke-dasharray:3 2}.mi-fig .mi-bar.todo{fill:none;stroke:var(--faint);stroke-dasharray:none}.mi-fig .mi-rate{fill:none;stroke:var(--text);stroke-width:1.6}.mi-fig .mi-total{fill:none;stroke:var(--harvest);stroke-width:2.4}.mi-fig .mi-exact{fill:none;stroke:var(--dim);stroke-width:1.2;stroke-dasharray:4 3}.mi-fig .mi-now{stroke:var(--orange);stroke-width:1;stroke-dasharray:3 3}.mi-fig .mi-num{font-family:var(--mono);font-size:0.82rem;min-width:3.6rem;text-align:right}`}</style>
      <svg viewBox="0 0 400 226" role="img" aria-label={`After ${fmt(now, 1)} seconds, ${steps} steps of ${dt} seconds have been added. The running total is ${fmt(total)}; the exact value is ${fmt(truth)}.`}>
        <text x={X0} y={11} className="fig-label">{w.rate}: each bar is one step, {w.rname} x {dt} s</text>
        <line x1={X0} x2={X1} y1={ry(0)} y2={ry(0)} className="mi-axis" />
        <line x1={X0} x2={X0} y1={ry(2.1)} y2={ry(-1.1)} className="mi-axis" />
        {[-1, 0, 1, 2].map((v) => (
          <text key={v} x={X0 - 4} y={ry(v) + 3} textAnchor="end" className="fig-label dim">{v}</text>
        ))}
        {bars}
        <path d={rline} className="mi-rate" />
        <line x1={sx(now)} x2={sx(now)} y1={ry(2.1)} y2={ty(-0.4)} className="mi-now" />

        <text x={X0} y={112} className="fig-label">{w.total}: the bars added up so far = <tspan className="fig-value small">{fmt(total)}{w.tu ? ` ${w.tu}` : ""}</tspan></text>
        <line x1={X0} x2={X1} y1={ty(0)} y2={ty(0)} className="mi-axis" />
        <line x1={X0} x2={X0} y1={ty(5.4)} y2={ty(-0.4)} className="mi-axis" />
        {[0, 2, 4].map((v) => (
          <text key={v} x={X0 - 4} y={ty(v) + 3} textAnchor="end" className="fig-label dim">{v}</text>
        ))}
        <path d={smooth} className="mi-exact" />
        <path d={`M${pts.join(" L")}`} className="mi-total" />
        <circle cx={sx(now)} cy={ty(total)} r={3.5} style={{ fill: "var(--harvest)" }} />
        {[0, 1, 2, 3, 4, 5].map((v) => (
          <text key={v} x={sx(v)} y={222} textAnchor="middle" className="fig-label dim">{v} s</text>
        ))}
        <text x={X1} y={124} textAnchor="end" className="fig-label dim">dashed: exact</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Adding up</span>
          <button className="fig-opt" aria-pressed={kind === "speed"} onClick={() => setKind("speed")}>speed into distance</button>
          <button className="fig-opt" aria-pressed={kind === "error"} onClick={() => setKind("error")}>error into integral</button>
        </div>
        <div>
          <span>The {w.rname}</span>
          <button className="fig-opt" aria-pressed={pattern === "steady"} onClick={() => setPattern("steady")}>steady</button>
          <button className="fig-opt" aria-pressed={pattern === "ramp"} onClick={() => setPattern("ramp")}>growing</button>
          <button className="fig-opt" aria-pressed={pattern === "back"} onClick={() => setPattern("back")}>positive, then negative</button>
        </div>
        <div>
          <span>Time step</span>
          {[1, 0.5, 0.1].map((d) => (
            <button key={d} className="fig-opt" aria-pressed={dt === d} onClick={() => setDt(d)}>{d} s</button>
          ))}
          <code>{`#define DT ${dt}`}</code>
        </div>
        <div>
          <span>Time</span>
          <input className="mi-range" type="range" aria-label="Time in seconds" min={0} max={T_END} step={dt} value={now} onChange={(e) => setT(+e.target.value)} />
          <span className="mi-num">{fmt(now, 1)} s</span>
        </div>
      </div>
      <div className="fig-step">
        <pre><code>{`// runs once every DT seconds\n${w.code}   // now ${fmt(total)}`}</code></pre>
      </div>
      <figcaption>Integrating means adding up "rate x time step", step after step, in a variable that keeps its value. Positive rates raise the total, negative ones lower it, and a rate of zero leaves it where it is. The robot does this every millisecond (DT = 0.001).</figcaption>
    </figure>
  );
}

export const figure = { id: "math-integrate", Component: MathIntegrate };
