import { useMemo, useState } from "react";

// Speed from encoder counts: the backward difference of Lab 3, sampled every
// 1 ms, and its quantisation at low speed. One count of the wheel encoder is
// 2 pi / (2000 x 20) rad (src/sim/plugins/eqep.ts). The eQEP's own answer to
// slow shafts is the edge capture unit, TRM 17.6 "eQEP Edge Capture Unit"
// (time between counts); the last option here does that in software.

const RAD_PER_COUNT = (2 * Math.PI) / (2000 * 20);
const T_MS = 200;
const X0 = 46;
const X1 = 412;
const xOf = (ms: number) => X0 + (ms / T_MS) * (X1 - X0);
const speedOf = (s: number) => 0.005 * Math.pow(200, s);
const sig = (v: number) => (v === 0 ? "0" : v >= 1 ? v.toFixed(2) : v >= 0.1 ? v.toFixed(3) : v.toFixed(4));
type Method = 1 | 5 | 20 | 50 | "gap";

function SpeedFromCounts() {
  const [s, setS] = useState(0.55);
  const [method, setMethod] = useState<Method>(1);
  const [change, setChange] = useState(false);
  const v0 = speedOf(s);

  const sim = useMemo(() => {
    const vAt = (ms: number) => (change && ms >= 100 ? v0 / 2 : v0);
    // Position in counts at every millisecond; the shaft starts in the middle of a count.
    const pos: number[] = [0.5];
    for (let k = 1; k <= T_MS; k++) pos.push(pos[k - 1] + (vAt(k - 1) * 0.001) / RAD_PER_COUNT);
    const cnt = pos.map(Math.floor);
    const est: (number | null)[] = [];
    if (method === "gap") {
      let last = cnt[0];
      let kLast = 0;
      let v = 0;
      let seen = false;
      for (let k = 0; k <= T_MS; k++) {
        if (k > 0 && cnt[k] !== last) {
          // The first change only starts the clock: the time before it is not a full gap.
          if (seen) v = ((cnt[k] - last) * RAD_PER_COUNT) / ((k - kLast) * 0.001);
          seen = true;
          last = cnt[k];
          kLast = k;
        }
        est.push(v);
      }
    } else {
      for (let k = 0; k <= T_MS; k++) est.push(k < method ? null : ((cnt[k] - cnt[k - method]) * RAD_PER_COUNT) / (method * 0.001));
    }
    return { vAt, pos, cnt, est };
  }, [v0, method, change]);

  const perMs = v0 / RAD_PER_COUNT / 1000;
  const vals = sim.est.slice(change ? 30 : 60, change ? 100 : T_MS + 1).filter((x): x is number => x !== null);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const res = method === "gap" ? 0 : RAD_PER_COUNT / (method * 0.001);
  const top = Math.max(hi, ...sim.est.map((x) => x ?? 0), v0) * 1.18;

  // position plot
  const cMax = Math.max(4, sim.cnt[T_MS] + 1);
  const yC = (c: number) => 84 - (c / cMax) * 64;
  let stair = `M${X0},${yC(sim.cnt[0])}`;
  for (let k = 1; k <= T_MS; k++) if (sim.cnt[k] !== sim.cnt[k - 1]) stair += ` H${xOf(k).toFixed(1)} V${yC(sim.cnt[k]).toFixed(1)}`;
  stair += ` H${X1}`;
  const truePos = sim.pos.map((p, k) => `${k ? "L" : "M"}${xOf(k).toFixed(1)},${yC(p - 0.5).toFixed(1)}`).join(" ");
  // speed plot
  const yV = (v: number) => 190 - (v / top) * 78;
  let trace = "";
  sim.est.forEach((v, k) => {
    if (v === null) return;
    trace += trace ? ` H${xOf(k).toFixed(1)} V${yV(v).toFixed(1)}` : `M${xOf(k).toFixed(1)},${yV(v).toFixed(1)}`;
  });
  const trueV = `M${X0},${yV(v0)} ${change ? `H${xOf(100)} V${yV(v0 / 2)} ` : ""}H${X1}`;
  const levels: number[] = [];
  if (res > 0 && top / res <= 9) for (let n = 0; n * res <= top; n++) levels.push(n * res);
  // Label every level only while the labels are at least 11 units apart.
  const labelEvery = levels.length > 1 && yV(levels[0]) - yV(levels[1]) < 11 ? 2 : 1;

  const flat = hi - lo < v0 * 0.02;
  const why =
    method === "gap"
      ? `Turned around: measure the time between two counts. One count is ${RAD_PER_COUNT.toFixed(6)} rad; here they are ${(1 / perMs).toFixed(perMs > 1 ? 2 : 0)} ms apart. ${perMs < 0.5 ? `The reading is steady at low speed. But it only changes when a count arrives${change ? ": look how long the old speed stays after the change at 100 ms" : ""}. If the wheel stops, no count comes and the old speed stays for ever, so real code also sets the speed to 0 after a time-out.` : "At this speed the counts come faster than the 1 ms clock can time them, so this method gets coarse. Use the difference over a few milliseconds."}`
      : `In ${method} ms the wheel moves ${(perMs * method).toFixed(2)} counts, but the counter only shows whole counts. So the difference is ${Math.floor(perMs * method)} or ${Math.floor(perMs * method) + 1} count${Math.floor(perMs * method) === 0 ? "" : "s"}, and the speed reads ${sig(Math.floor(perMs * method) * res)} or ${sig((Math.floor(perMs * method) + 1) * res)} rad/s: steps of ${sig(res)} rad/s, never ${sig(v0)}.${method > 1 ? ` The longer window makes the steps ${method} times finer, but the answer is on average ${method / 2} ms old${change ? ": look how late it follows the change at 100 ms" : ""}. Averaging the last ${method} one-millisecond speeds gives exactly the same numbers.` : flat ? "" : " Try a longer window."}`;

  return (
    <figure className="figure sc-fig" aria-label="Interactive plot: speed computed from encoder counts, with its quantisation">
      <style>{`.sc-fig .sc-range{flex:1;min-width:140px;accent-color:var(--orange)}.sc-fig .sc-true{fill:none;stroke:var(--dim);stroke-width:1.3;stroke-dasharray:4 3}.sc-fig .sc-grid{stroke:var(--border);stroke-width:1}.sc-fig .sc-thin{stroke-width:1;opacity:.4}.sc-fig .sc-dot{fill:var(--harvest)}.sc-fig .fig-controls>div>span:first-child{width:5.6rem}`}</style>
      <svg viewBox="0 0 420 208" role="img" aria-label={`True speed ${sig(v0)} radians per second. The computed speed is between ${sig(lo)} and ${sig(hi)}.`}>
        <text x={X0} y={10} className="fig-label">position: <tspan className="fig-label dim">true (dashed) and </tspan>the counter</text>
        <line x1={X0} x2={X1} y1={84} y2={84} className="sc-grid" />
        <path d={truePos} className="sc-true" />
        <path d={stair} className="fig-trace" />
        <text x={X0 - 4} y={87} textAnchor="end" className="fig-label dim">0</text>
        <text x={X0 - 4} y={yC(sim.cnt[T_MS]) + 3} textAnchor="end" className="fig-value small">{sim.cnt[T_MS]}</text>
        <text x={4} y={52} className="fig-label dim">counts</text>

        <text x={X0} y={106} className="fig-label">speed: <tspan className="fig-label dim">true {sig(v0)}{change ? `, then ${sig(v0 / 2)}` : ""} rad/s (dashed) and </tspan>computed every 1 ms</text>
        {levels.map((l, i) => (
          <g key={i}>
            <line x1={X0} x2={X1} y1={yV(l)} y2={yV(l)} className="sc-grid" />
            {i % labelEvery === 0 && <text x={X0 - 4} y={yV(l) + 3} textAnchor="end" className="fig-label dim">{l === 0 ? "0" : sig(l)}</text>}
          </g>
        ))}
        {!levels.length && (
          <g>
            <line x1={X0} x2={X1} y1={190} y2={190} className="sc-grid" />
            <text x={X0 - 4} y={193} textAnchor="end" className="fig-label dim">0</text>
            <text x={X0 - 4} y={yV(v0) + 3} textAnchor="end" className="fig-label dim">{sig(v0)}</text>
          </g>
        )}
        <path d={trueV} className="sc-true" />
        {method !== 1 && <path d={trace} className="fig-trace data sc-thin" />}
        {sim.est.map((v, k) => (v === null ? null : <circle key={k} cx={xOf(k)} cy={yV(v)} r={1.4} className="sc-dot" />))}
        {[0, 50, 100, 150, 200].map((ms) => (
          <text key={ms} x={xOf(ms)} y={204} textAnchor={ms === 0 ? "start" : ms === 200 ? "end" : "middle"} className="fig-label dim">{ms} ms</text>
        ))}
      </svg>
      <div className="fig-controls">
        <div>
          <span>Wheel speed</span>
          <input className="sc-range" type="range" aria-label="True wheel speed" min={0} max={1} step={0.01} value={s} onChange={(e) => setS(+e.target.value)} />
          <code>{sig(v0)} rad/s = {perMs.toFixed(2)} counts per ms</code>
        </div>
        <div>
          <span>Method</span>
          {([1, 5, 20, 50] as Method[]).map((m) => (
            <button key={m} className="fig-opt" aria-pressed={method === m} onClick={() => setMethod(m)}>difference over {m} ms</button>
          ))}
          <button className="fig-opt" aria-pressed={method === "gap"} onClick={() => setMethod("gap")}>time between counts</button>
        </div>
        <div>
          <span>True speed</span>
          <button className="fig-opt" aria-pressed={!change} onClick={() => setChange(false)}>steady</button>
          <button className="fig-opt" aria-pressed={change} onClick={() => setChange(true)}>halves at 100 ms</button>
        </div>
      </div>
      <div className="fig-why" role="status">{why}</div>
      <div className="fig-step">
        <pre><code>{method === "gap" ? "msSinceChange++;                 // every 1 ms\nif (count != lastCount) {       // a count arrived\n    SlowVel = (count - lastCount)*radPerCount\n              / (msSinceChange*0.001);\n    lastCount = count;\n    msSinceChange = 0;\n}" : method === 1 ? "// every 1 ms\nvel = (pos - pos_old) / 0.001;\npos_old = pos;" : `// every 1 ms, pos_${method}: the position ${method} ms ago\nvel = (pos - pos_${method}) / ${(method * 0.001).toFixed(3)};`}</code></pre>
      </div>
      <figcaption>The counter moves in whole counts, so a difference of positions moves in whole counts too. Fast wheels do not notice. Slow wheels need a longer window, which gives an older answer, or the time between counts.</figcaption>
    </figure>
  );
}

export const figure = { id: "speed-from-counts", Component: SpeedFromCounts };
