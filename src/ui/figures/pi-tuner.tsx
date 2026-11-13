import { useMemo, useState } from "react";
import { COULOMB, GAIN, MAX_EFFORT, TAU, stepWheel } from "../../sim/plugins/plant";

// Step response of the chapter 16 wheel under P or PI control. Not a chip
// peripheral (no TRM section): the wheel is the test bench of
// src/sim/plugins/plant.ts, advanced with its own stepWheel(), and the
// controller is the code of the levels, run once per millisecond on a
// 32-bit float reading as tb_left_speed() returns it.

type Scenario = "step" | "windup";
const X0 = 40;
const X1 = 412;
const fmt = (v: number, d = 2) => {
  const s = v.toFixed(d);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
};

function simulate(kp: number, ki: number, clamp: boolean, scenario: Scenario) {
  const n = scenario === "step" ? 1000 : 4000;
  const w = { v: 0 };
  let I = 0;
  const v: number[] = [];
  const u: number[] = [];
  const raw: number[] = [];
  const integ: number[] = [];
  const ref: number[] = [];
  for (let k = 1; k <= n; k++) {
    const r = scenario === "step" ? 1 : k < 2000 ? 3 : 1;
    const meas = Math.fround(w.v);
    const e = r - meas;
    let uk: number;
    let rawk: number;
    if (clamp) {
      rawk = kp * e + ki * (I + e * 0.001);
      if (rawk > MAX_EFFORT) uk = MAX_EFFORT;
      else if (rawk < -MAX_EFFORT) uk = -MAX_EFFORT;
      else {
        uk = rawk;
        I += e * 0.001;
      }
    } else {
      I += e * 0.001;
      rawk = kp * e + ki * I;
      uk = Math.max(-MAX_EFFORT, Math.min(MAX_EFFORT, rawk));
    }
    ref.push(r);
    v.push(meas);
    u.push(uk);
    raw.push(rawk);
    integ.push(ki * I);
    stepWheel(w, uk, 0.001);
  }
  return { n, v, u, raw, integ, ref, I, final: w.v };
}

function PiTuner() {
  const [kp, setKp] = useState(12);
  const [ki, setKi] = useState(0);
  const [clamp, setClamp] = useState(false);
  const [scenario, setScenario] = useState<Scenario>("step");
  const sim = useMemo(() => simulate(kp, ki, clamp, scenario), [kp, ki, clamp, scenario]);
  const { n } = sim;
  const rEnd = 1;
  const from = scenario === "step" ? 0 : 2000;
  const tail = sim.v.slice(from);
  const peak = Math.max(...tail.slice(scenario === "step" ? 0 : 1));
  const overshoot = Math.max(0, peak - rEnd);
  const sse = rEnd - sim.final;
  const rise = sim.v.findIndex((x) => x >= 0.9);
  const back = (() => {
    // Last time the speed is outside +-0.05 of the final reference.
    let last = -1;
    for (let k = 0; k < tail.length; k++) if (Math.abs(tail[k] - rEnd) > 0.05) last = k;
    return last + 1;
  })();
  const cameBack = back < tail.length;
  const backText = cameBack ? `${back} ms` : "not within 2 s";
  const satMs = sim.raw.filter((x) => Math.abs(x) > MAX_EFFORT).length;
  const iAtDrop = scenario === "windup" ? sim.integ[1998] / (ki || 1) : 0;
  const ringing = tail.slice(-200).some((x) => Math.abs(x - sim.final) > 0.02);

  const vTop = scenario === "step" ? Math.max(1.3, Math.min(2.4, peak * 1.08)) : 3.3;
  const x = (k: number) => X0 + (k / n) * (X1 - X0);
  const yV = (v: number) => 112 - (Math.max(-0.1, Math.min(vTop, v)) / vTop) * 98;
  const yU = (u: number) => 184 - (Math.max(-13, Math.min(13, u)) / 13) * 40;
  const stride = n / 500;
  const path = (a: number[], y: (v: number) => number) => {
    let d = `M${X0},${y(a[0]).toFixed(1)}`;
    for (let k = stride; k < n; k += stride) d += `L${x(k).toFixed(1)},${y(a[k]).toFixed(1)}`;
    return d;
  };
  const refPath = scenario === "step" ? `M${X0},${yV(1)} H${X1}` : `M${X0},${yV(3)} H${x(2000)} V${yV(1)} H${X1}`;

  let why: string;
  if (scenario === "step") {
    if (ringing) why = "The speed is still swinging after 1 s: the loop has not settled. Lower the gains.";
    else if (ki === 0)
      why = kp * 1 <= COULOMB
        ? `Kp × error is only ${fmt(kp, 1)}, less than the ${COULOMB} the wheel needs to start. It never moves.`
        : `P only: the wheel stops at ${fmt(sim.final, 3)} ft/s, ${fmt(sse, 3)} short. There the effort Kp × error = ${fmt(kp * sse, 2)} is exactly what that speed needs (4 v + 0.8). More Kp shrinks the error; only an integral removes it.`;
    else if (Math.abs(sse) > 0.01) why = `The integral is still filling: after 1 s the error is ${fmt(sse, 3)} ft/s. Raise Ki.`;
    else if (overshoot > 0.05) why = `No error left, but the speed overshoots to ${fmt(peak, 2)} ft/s: the integral was still large when the wheel arrived. Lower Ki or raise Kp (try Ki / Kp near 1 / ${TAU} = ${(1 / TAU).toFixed(0)}).`;
    else why = `PI: no error left${overshoot > 0.005 ? `, overshoot ${fmt(overshoot * 100, 0)} %` : " and no overshoot"}. At the end the error is 0, so the whole effort of ${fmt(sim.u[n - 1], 1)} comes from the integral part.${rise >= 0 ? ` 0.9 ft/s is reached after ${rise} ms.` : ""}`;
  } else if (ki === 0) why = "Only the integral can wind up. With Ki = 0 there is no integral. Raise Ki.";
  else if (!clamp) why = `The wheel cannot reach 3 ft/s, so for 2 s the error stays and the integral keeps adding it up: to ${fmt(iAtDrop, 2)}, where ${fmt((rEnd / GAIN + COULOMB) / ki, 3)} is all it needs at 1 ft/s. After the reference drops, ${cameBack ? `the wheel takes ${back} ms to come down to 1 ft/s` : "the wheel is still not back at 1 ft/s 2 s later"}, because the integral must first unwind. Switch the clamping on.`;
  else why = `Clamping: while the effort is at the limit the integral is not updated, so it stays at ${fmt(iAtDrop, 3)}. When the reference drops, ${cameBack ? `the wheel follows in ${back} ms` : "the wheel still does not reach 1 ft/s within 2 s: these gains are too weak"}.`;

  const chips: [string, string][] =
    scenario === "step"
      ? [
          ["steady-state error", `${fmt(sse, 3)} ft/s`],
          ["overshoot", `${fmt(overshoot * 100, 0)} %`],
          ["0.9 ft/s reached", rise >= 0 ? `${rise} ms` : "never"],
          ["effort at the limit", `${satMs} ms`],
        ]
      : [
          ["integral at 2 s", fmt(iAtDrop, 3)],
          ["back at 1 ft/s after", backText],
          ["effort at the limit", `${satMs} ms`],
        ];

  return (
    <figure className="figure pt-fig" aria-label="Interactive step response of the wheel under P or PI control">
      <style>{`.pt-fig .pt-range{flex:1;min-width:120px;accent-color:var(--orange)}.pt-fig .pt-ref{fill:none;stroke:var(--dim);stroke-width:1.3;stroke-dasharray:4 3}.pt-fig .pt-grid{stroke:var(--border);stroke-width:1}.pt-fig .pt-sat{fill:var(--bad);opacity:.22}.pt-fig .pt-raw{fill:none;stroke:var(--dim);stroke-width:1.2;stroke-dasharray:2 2}.pt-fig .pt-u{fill:none;stroke:var(--orange);stroke-width:2.2}.pt-fig .pt-int{fill:none;stroke:var(--harvest);stroke-width:1.4}.pt-fig .pt-chips{display:flex;flex-wrap:wrap;gap:.3rem .9rem;margin:.4rem 0;font-size:.85rem;color:var(--dim)}.pt-fig .pt-chips b{color:var(--harvest);font-family:var(--mono)}`}</style>
      <svg viewBox="0 0 420 240" role="img" aria-label={`Kp ${kp}, Ki ${ki}. The wheel ends at ${fmt(sim.final, 3)} feet per second; ${chips.map((c) => `${c[0]} ${c[1]}`).join(", ")}.`}>
        {/* speed */}
        <text x={X0} y={10} className="fig-label">speed <tspan className="fig-label dim">and reference (dashed), ft/s</tspan></text>
        {(scenario === "step" ? [0, 0.5, 1] : [0, 1, 2, 3]).map((g) => (
          <g key={g}>
            <line x1={X0} x2={X1} y1={yV(g)} y2={yV(g)} className="pt-grid" />
            <text x={X0 - 4} y={yV(g) + 3} textAnchor="end" className="fig-label dim">{g}</text>
          </g>
        ))}
        <path d={refPath} className="pt-ref" />
        <path d={path(sim.v, yV)} className="fig-trace" />
        {/* effort */}
        <text x={X0} y={134} className="fig-label">effort sent</text>
        <path d={`M${X0 + 50} 131 h14`} className="pt-u" />
        <text x={X0 + 74} y={134} className="fig-label dim">asked for</text>
        <path d={`M${X0 + 114} 131 h14`} className="pt-raw" />
        <text x={X0 + 138} y={134} className="fig-label dim">integral part Ki × I</text>
        <path d={`M${X0 + 212} 131 h14`} className="pt-int" />
        <rect x={X0} y={yU(13)} width={X1 - X0} height={yU(10) - yU(13)} className="pt-sat" />
        <rect x={X0} y={yU(-10)} width={X1 - X0} height={yU(-13) - yU(-10)} className="pt-sat" />
        <text x={X1 - 3} y={yU(-13) - 2} textAnchor="end" className="fig-label dim">shaded: beyond the limit</text>
        {[10, 0, -10].map((g) => (
          <g key={g}>
            <line x1={X0} x2={X1} y1={yU(g)} y2={yU(g)} className="pt-grid" />
            <text x={X0 - 4} y={yU(g) + 3} textAnchor="end" className="fig-label dim">{g}</text>
          </g>
        ))}
        <path d={path(sim.raw, yU)} className="pt-raw" />
        <path d={path(sim.integ, yU)} className="pt-int" />
        <path d={path(sim.u, yU)} className="pt-u" />
        {(scenario === "step" ? [0, 0.25, 0.5, 0.75, 1] : [0, 1, 2, 3, 4]).map((t) => (
          <text key={t} x={x(t * 1000)} y={237} textAnchor={t === 0 ? "start" : t * 1000 === n ? "end" : "middle"} className="fig-label dim">{t} s</text>
        ))}
      </svg>
      <div className="pt-chips">
        {chips.map(([k, v]) => (
          <span key={k}>{k} <b>{v}</b></span>
        ))}
      </div>
      <div className="fig-controls">
        <div>
          <span>Kp</span>
          <input className="pt-range" type="range" aria-label="Kp" min={0} max={60} step={1} value={kp} onChange={(e) => setKp(+e.target.value)} />
          <code>float Kp = {kp.toFixed(1)};</code>
        </div>
        <div>
          <span>Ki</span>
          <input className="pt-range" type="range" aria-label="Ki" min={0} max={800} step={10} value={ki} onChange={(e) => setKi(+e.target.value)} />
          <code>float Ki = {ki.toFixed(1)};</code>
        </div>
        <div>
          <span>Reference</span>
          <button className="fig-opt" aria-pressed={scenario === "step"} onClick={() => setScenario("step")}>step to 1 ft/s</button>
          <button
            className="fig-opt"
            aria-pressed={scenario === "windup"}
            onClick={() => {
              setScenario("windup");
              if (ki === 0) {
                setKp(8);
                setKi(100);
              }
            }}
          >
            3 ft/s for 2 s (too fast), then 1
          </button>
        </div>
        <div>
          <span>Anti-windup</span>
          <button className="fig-opt" aria-pressed={!clamp} onClick={() => setClamp(false)}>none</button>
          <button className="fig-opt" aria-pressed={clamp} onClick={() => setClamp(true)}>clamping</button>
        </div>
      </div>
      <div className="fig-why" role="status">{why}</div>
      <div className="fig-step">
        <pre><code>{clamp ? "eLeft = vref - vLeft;\nuLeft = Kp*eLeft + Ki*(ILeft + eLeft*0.001);\nif (uLeft > 10.0) uLeft = 10.0;        // saturated:\nelse if (uLeft < -10.0) uLeft = -10.0; // ILeft kept\nelse ILeft = ILeft + eLeft*0.001;" : `eLeft = vref - vLeft;\n${ki === 0 ? "uLeft = Kp*eLeft;" : "ILeft = ILeft + eLeft*0.001;\nuLeft = Kp*eLeft + Ki*ILeft;"}\nif (uLeft > 10.0) uLeft = 10.0;\nif (uLeft < -10.0) uLeft = -10.0;`}</code></pre>
      </div>
      <figcaption>The wheel of the test bench in the code levels, with the controller run once per millisecond. The wheel needs an effort of 0.8 to start and gains 0.25 ft/s per unit above that, with a 60 ms time constant. The effort is limited to ±10.</figcaption>
    </figure>
  );
}

export const figure = { id: "pi-tuner", Component: PiTuner };
