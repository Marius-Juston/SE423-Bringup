import { useMemo, useState } from "react";
import { TAU, WHEEL_BASE } from "../../sim/plugins/plant";

// Dead reckoning of a differential-drive robot (Lecture 15, Lab 5), with the
// wheel base and wheel time constant of the test bench
// (src/sim/plugins/plant.ts). Not a chip peripheral: no TRM section applies.
// "True" path: the wheels speed up as on the bench (first order, TAU) and the
// pose is integrated in 0.5 ms arcs. "Estimate": the code of the levels
// loc-dead (rectangle rule) and loc-trap (trapezoid rule), run every dt on
// the sampled wheel speeds.

interface Pose {
  x: number;
  y: number;
  th: number;
}
type Rule = "rect" | "trap";
const fmt = (v: number, d = 2) => {
  const s = v.toFixed(d);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
};

function drive(vL: number, vR: number, T: number, dtMs: number, rule: Rule, bias: number) {
  const speed = (vss: number, t: number) => vss * (1 - Math.exp(-t / TAU));
  const h = 0.0005;
  const n = Math.round(T / h);
  const per = Math.round(dtMs / 0.5);
  const dt = dtMs / 1000;
  const truth: Pose[] = [{ x: 0, y: 0, th: 0 }];
  const est: Pose[] = [{ x: 0, y: 0, th: 0 }];
  const err: number[] = [0];
  let p = { x: 0, y: 0, th: 0 };
  let e = { x: 0, y: 0, th: 0 };
  let vOld = 0;
  let wOld = 0;
  let dist = 0;
  for (let i = 1; i <= n; i++) {
    const t = (i - 0.5) * h;
    const l = speed(vL, t);
    const r = speed(vR, t);
    const dTh = ((r - l) / WHEEL_BASE) * h;
    const ds = ((l + r) / 2) * h;
    p = { x: p.x + ds * Math.cos(p.th + dTh / 2), y: p.y + ds * Math.sin(p.th + dTh / 2), th: p.th + dTh };
    dist += Math.abs(ds);
    if (i % per === 0) {
      // One pass of the interrupt: sample the speeds, integrate one step.
      const ml = speed(vL, i * h);
      const mr = speed(vR, i * h) * (1 + bias);
      const v = 0.5 * (ml + mr);
      const w = (mr - ml) / WHEEL_BASE;
      if (rule === "rect") {
        const th = e.th + w * dt;
        e = { th, x: e.x + v * Math.cos(th) * dt, y: e.y + v * Math.sin(th) * dt };
      } else {
        const th = e.th + 0.5 * (w + wOld) * dt;
        e = { th, x: e.x + 0.5 * (v * Math.cos(th) + vOld * Math.cos(e.th)) * dt, y: e.y + 0.5 * (v * Math.sin(th) + vOld * Math.sin(e.th)) * dt };
        wOld = w;
        vOld = v;
      }
      est.push(e);
      truth.push(p);
      err.push(Math.hypot(e.x - p.x, e.y - p.y));
    }
  }
  return { truth, est, err, dist, end: p, endEst: e };
}

function DeadReckoning() {
  const [vL, setVL] = useState(0.8);
  const [vR, setVR] = useState(1.0);
  const [T, setT] = useState(4);
  const [bias, setBias] = useState(false);
  const [rule, setRule] = useState<Rule>("rect");
  const [dtMs, setDtMs] = useState(1);
  const sim = useMemo(() => drive(vL, vR, T, dtMs, rule, bias ? 0.01 : 0), [vL, vR, T, dtMs, rule, bias]);
  // The whole 10 s drive sets the scale, so the picture does not jump while the time slider moves.
  const full = useMemo(() => drive(vL, vR, 10, 20, "trap", bias ? 0.01 : 0), [vL, vR, bias]);

  const V = (vL + vR) / 2;
  const omega = (vR - vL) / WHEEL_BASE;
  const pts = [...full.truth, ...full.est, ...sim.est];
  let x0 = Math.min(...pts.map((p) => p.x)) - 0.4;
  let x1 = Math.max(...pts.map((p) => p.x)) + 0.4;
  let y0 = Math.min(...pts.map((p) => p.y)) - 0.4;
  let y1 = Math.max(...pts.map((p) => p.y)) + 0.4;
  const W = 412;
  const H = 196;
  const k = Math.min(W / (x1 - x0), H / (y1 - y0));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  x0 = cx - W / 2 / k;
  x1 = cx + W / 2 / k;
  y0 = cy - H / 2 / k;
  y1 = cy + H / 2 / k;
  const sx = (x: number) => 4 + (x - x0) * k;
  const sy = (y: number) => 4 + (y1 - y) * k;
  const grid = [0.5, 1, 2, 5, 10].find((g) => (x1 - x0) / g <= 12) ?? 20;
  const lines = (lo: number, hi: number) => {
    const out: number[] = [];
    for (let g = Math.ceil(lo / grid) * grid; g <= hi; g += grid) out.push(g);
    return out;
  };
  const poly = (a: Pose[]) => {
    const stride = Math.max(1, Math.floor(a.length / 400));
    let d = "";
    for (let i = 0; i < a.length; i += stride) d += `${d ? "L" : "M"}${sx(a[i].x).toFixed(1)},${sy(a[i].y).toFixed(1)}`;
    const last = a[a.length - 1];
    return `${d}L${sx(last.x).toFixed(1)},${sy(last.y).toFixed(1)}`;
  };
  const robot = (p: Pose, cls: string) => {
    const s = Math.max(5, Math.min(14, (WHEEL_BASE * k) / 2));
    return <path d={`M${-s},${-s} L${s * 0.6},${-s} L${s * 1.5},0 L${s * 0.6},${s} L${-s},${s} Z`} transform={`translate(${sx(p.x)},${sy(p.y)}) rotate(${(-p.th * 180) / Math.PI})`} className={cls} />;
  };
  const error = sim.err[sim.err.length - 1];
  const errTop = Math.max(0.02, ...full.err, ...sim.err) * 1.1;
  const errPath = sim.err.map((e, i) => `${i ? "L" : "M"}${(40 + (i / (sim.err.length - 1 || 1)) * (T / 10) * 372).toFixed(1)},${(262 - (e / errTop) * 34).toFixed(1)}`).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 300)) === 0 || i === a.length - 1).join(" ");

  const turnText = Math.abs(omega) < 1e-9 ? "Both wheels run at the same speed: the robot drives straight." : `The ${omega > 0 ? "right" : "left"} wheel is faster, so the robot turns ${omega > 0 ? "left (omega positive)" : "right (omega negative)"}${Math.abs(V) > 1e-9 ? ` on a circle of radius V / omega = ${fmt(Math.abs(V / omega))} ft` : " on the spot"}.`;
  const why =
    error < 0.005
      ? `${turnText} The estimate (dashed) lies on the true path: after ${fmt(sim.dist, 1)} ft it is off by ${fmt(error, 3)} ft. Perfect wheels and a 1 ms step leave nothing to see; switch on an error.`
      : bias
        ? `${turnText} The right encoder reads 1 % too much (a wheel 1 % smaller than the code thinks). The same small mistake is added on every pass, so the heading drifts and the error grows with the distance: ${fmt(error, 2)} ft after ${fmt(sim.dist, 1)} ft. Dead reckoning cannot notice, it has nothing to compare with.`
        : `${turnText} With a ${dtMs} ms step the ${rule === "rect" ? "rectangle rule pretends the speed and heading measured now held for the whole step: the estimate is off by" : "trapezoid rule averages this step's and the last step's values: the estimate is off by only"} ${fmt(error, 3)} ft after ${fmt(sim.dist, 1)} ft.${rule === "rect" ? " Try the trapezoid rule." : ""}`;

  return (
    <figure className="figure dr-fig" aria-label="Interactive dead reckoning: true path and estimated path of a two-wheeled robot">
      <style>{`.dr-fig .dr-range{flex:1;min-width:110px;accent-color:var(--orange)}.dr-fig .dr-map{fill:var(--bg);stroke:var(--border)}.dr-fig .dr-grid{stroke:var(--border);stroke-width:1}.dr-fig .dr-true{fill:none;stroke:var(--arches);stroke-width:2.2}.dr-fig .dr-est{fill:none;stroke:var(--harvest);stroke-width:2;stroke-dasharray:5 3}.dr-fig .dr-rt{fill:var(--arches);stroke:var(--text);stroke-width:1}.dr-fig .dr-re{fill:none;stroke:var(--harvest);stroke-width:1.6;stroke-dasharray:3 2}.dr-fig .dr-err{stroke:var(--bad);stroke-width:1.5}.dr-fig .dr-errp{fill:none;stroke:var(--bad);stroke-width:1.8}.dr-fig .dr-num{width:4.6rem;font-family:var(--mono);font-size:.8rem;color:var(--harvest)}`}</style>
      <svg viewBox="0 0 420 278" role="img" aria-label={`After ${fmt(T, 1)} seconds and ${fmt(sim.dist, 1)} feet the robot is at ${fmt(sim.end.x)}, ${fmt(sim.end.y)}; the estimate is ${fmt(error, 3)} feet off.`}>
        <clipPath id="dr-clip"><rect x={4} y={4} width={W} height={H} /></clipPath>
        <rect x={4} y={4} width={W} height={H} className="dr-map" />
        <g clipPath="url(#dr-clip)">
          {lines(x0, x1).map((g) => (
            <line key={`x${g}`} x1={sx(g)} x2={sx(g)} y1={4} y2={4 + H} className="dr-grid" />
          ))}
          {lines(y0, y1).map((g) => (
            <line key={`y${g}`} x1={4} x2={4 + W} y1={sy(g)} y2={sy(g)} className="dr-grid" />
          ))}
          <path d={poly(sim.truth)} className="dr-true" />
          <path d={poly(sim.est)} className="dr-est" />
          <circle cx={sx(0)} cy={sy(0)} r={3} className="fig-dot" />
          {error > 0.02 && <line x1={sx(sim.end.x)} y1={sy(sim.end.y)} x2={sx(sim.endEst.x)} y2={sy(sim.endEst.y)} className="dr-err" />}
          {robot(sim.end, "dr-rt")}
          {robot(sim.endEst, "dr-re")}
        </g>
        <text x={10} y={16} className="fig-label dim">grid: {grid} ft</text>
        <path d="M262 209 h16" className="dr-true" />
        <text x={282} y={212} className="fig-label">true path</text>
        <path d="M326 209 h16" className="dr-est" />
        <text x={346} y={212} className="fig-label">dead reckoning</text>
        {/* error over time */}
        <text x={40} y={224} className="fig-label">error of the estimate, ft: <tspan className="fig-value small">{fmt(error, 3)}</tspan></text>
        <line x1={40} x2={412} y1={262} y2={262} className="dr-grid" />
        <path d={errPath} className="dr-errp" />
        <text x={36} y={265} textAnchor="end" className="fig-label dim">0</text>
        <text x={36} y={232} textAnchor="end" className="fig-label dim">{fmt(errTop, errTop < 0.1 ? 3 : 2)}</text>
        <text x={40} y={274} className="fig-label dim">0 s</text>
        <text x={412} y={274} textAnchor="end" className="fig-label dim">10 s</text>
      </svg>
      <div className="fig-controls">
        <div>
          <span>Left wheel</span>
          <input className="dr-range" type="range" aria-label="Left wheel speed" min={-0.5} max={1.5} step={0.05} value={vL} onChange={(e) => setVL(+e.target.value)} />
          <span className="dr-num">{fmt(vL)} ft/s</span>
        </div>
        <div>
          <span>Right wheel</span>
          <input className="dr-range" type="range" aria-label="Right wheel speed" min={-0.5} max={1.5} step={0.05} value={vR} onChange={(e) => setVR(+e.target.value)} />
          <span className="dr-num">{fmt(vR)} ft/s</span>
        </div>
        <div>
          <span>Drive for</span>
          <input className="dr-range" type="range" aria-label="Driving time" min={0.2} max={10} step={0.1} value={T} onChange={(e) => setT(+e.target.value)} />
          <span className="dr-num">{fmt(T, 1)} s</span>
        </div>
        <div>
          <span>Encoder</span>
          <button className="fig-opt" aria-pressed={!bias} onClick={() => setBias(false)}>perfect</button>
          <button className="fig-opt" aria-pressed={bias} onClick={() => setBias(true)}>right wheel reads 1 % too much</button>
        </div>
        <div>
          <span>Integrate</span>
          <button className="fig-opt" aria-pressed={rule === "rect"} onClick={() => setRule("rect")}>rectangle rule</button>
          <button className="fig-opt" aria-pressed={rule === "trap"} onClick={() => setRule("trap")}>trapezoid rule</button>
        </div>
        <div>
          <span>Time step</span>
          {[1, 20, 100].map((d) => (
            <button key={d} className="fig-opt" aria-pressed={dtMs === d} onClick={() => setDtMs(d)}>every {d} ms</button>
          ))}
        </div>
      </div>
      <div className="fig-why" role="status">{why}</div>
      <div className="fig-step">
        <pre><code>{`// WHEEL_BASE = ${WHEEL_BASE} ft between the wheels\nV     = (vLeft + vRight) / 2;           // ${fmt(V, 3)} ft/s\nomega = (vRight - vLeft) / WHEEL_BASE;  // ${fmt(omega, 3)} rad/s\n${rule === "rect" ? `theta = theta + omega * ${dtMs / 1000};\nx = x + V * cos(theta) * ${dtMs / 1000};\ny = y + V * sin(theta) * ${dtMs / 1000};` : `theta_new = theta + 0.5*(omega + omega_old)*${dtMs / 1000};\nx = x + 0.5*(V*cos(theta_new) + V_old*cos(theta))*${dtMs / 1000};\ny = y + 0.5*(V*sin(theta_new) + V_old*sin(theta))*${dtMs / 1000};`}`}</code></pre>
      </div>
      <figcaption>The robot adds up small steps from its own wheel speeds. Every step is nearly right, and the small mistakes add up: the longer the drive, the further the estimate is from the truth.</figcaption>
    </figure>
  );
}

export const figure = { id: "dead-reckoning", Component: DeadReckoning };
