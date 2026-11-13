import { useEffect, useState, type ReactNode } from "react";

// A CPU timer, clock cycle by clock cycle. TRM 3.8 "32-Bit CPU Timers 0/1/2"
// (Figure 3-10) and the TIM / PRD / TPR / TCR register tables (3.15.x):
// the prescale counter PSCH:PSC counts down from TDDRH:TDDR on every SYSCLK
// cycle; one cycle after it reaches 0 it is reloaded and TIMH:TIM
// decrements; one tick after TIM reaches 0 it is reloaded from PRDH:PRD and
// TIF is set. So period = (PRD + 1) x (TDDRH:TDDR + 1) SYSCLK cycles of 5 ns.
// TCR: TSS (bit 4) stops, TRB (bit 5) reloads TIM and PSC, TIF (bit 15) is
// cleared by writing 1. ConfigCpuTimer (F2837xD_CpuTimers.c) sets
// PRD = (Uint32)(Freq * Period) - 1, the prescaler to 0, TSS = 1, TIE = 1.

interface Sim {
  /** TIM after each clock cycle. */
  tim: number[];
  /** TIF after each clock cycle. */
  tif: number[];
  /** Clock cycles (indices into tim) at which TIM was reloaded from PRD because it had reached 0. */
  zeros: number[];
  /** Clock cycles dropped from the front of the history, so it cannot grow without limit. */
  base: number;
  psc: number;
  tss: boolean;
  note: "" | "trb" | "clear";
}

const WINDOW = 80;
const NS = 5;

function step(s: Sim, prd: number, tddr: number, n = 1): Sim {
  const tim = [...s.tim];
  const tif = [...s.tif];
  const zeros = [...s.zeros];
  let psc = s.psc;
  let t = tim[tim.length - 1];
  let f = tif[tif.length - 1];
  for (let i = 0; i < n; i++) {
    if (!s.tss) {
      if (psc > 0) psc--;
      else {
        psc = tddr;
        if (t > 0) t--;
        else {
          t = prd;
          f = 1;
          zeros.push(tim.length);
        }
      }
    }
    tim.push(t);
    tif.push(f);
  }
  // Keep only what the picture can show (WINDOW cycles, plus some spare).
  const cut = tim.length > 4 * WINDOW ? tim.length - 2 * WINDOW : 0;
  return {
    ...s,
    tim: cut ? tim.slice(cut) : tim,
    tif: cut ? tif.slice(cut) : tif,
    zeros: cut ? zeros.map((z) => z - cut).filter((z) => z >= 0) : zeros,
    base: s.base + cut,
    psc,
    note: "",
  };
}

const fresh = (prd: number, tddr: number): Sim => step({ tim: [prd], tif: [0], zeros: [], base: 0, psc: tddr, tss: false, note: "" }, prd, tddr, 46);

function nice(ns: number): string {
  if (ns >= 1e9) return `${+(ns / 1e9).toPrecision(6)} s`;
  if (ns >= 1e6) return `${+(ns / 1e6).toPrecision(6)} ms`;
  if (ns >= 1e3) return `${+(ns / 1e3).toPrecision(6)} us`;
  return `${ns} ns`;
}

function TimerSawtooth() {
  const [prd, setPrd] = useState(4);
  const [tddr, setTddr] = useState(1);
  const [sim, setSim] = useState<Sim>(() => fresh(4, 1));
  const [running, setRunning] = useState(false);
  const [us, setUs] = useState("10000");
  const calm = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setSim((s) => step(s, prd, tddr)), 140);
    return () => window.clearInterval(id);
  }, [running, prd, tddr]);

  const change = (p: number, d: number) => {
    setPrd(p);
    setTddr(d);
    setSim((s) => ({ ...fresh(p, d), tss: s.tss }));
  };
  const cyclesPerPeriod = (prd + 1) * (tddr + 1);
  const now = sim.tim.length - 1;
  const tim = sim.tim[now];
  const tif = sim.tif[now];

  // Drawing: the last WINDOW clock cycles.
  const from = Math.max(0, now - WINDOW);
  const X0 = 58;
  const X1 = 410;
  const x = (c: number) => X0 + ((c - from) / WINDOW) * (X1 - X0);
  const yT = (v: number) => 92 - (v / prd) * 68;
  let stair = "";
  for (let c = from; c <= now; c++) {
    const y = yT(Math.min(prd, sim.tim[c]));
    stair += c === from ? `M${x(c)},${y}` : sim.tim[c] === sim.tim[c - 1] ? "" : `H${x(c)}V${y}`;
  }
  stair += `H${x(now)}`;
  const tifSegs: ReactNode[] = [];
  let a = from;
  for (let c = from + 1; c <= now + 1; c++) {
    if (c > now || sim.tif[c] !== sim.tif[a]) {
      const v = sim.tif[a];
      const end = Math.min(c, now);
      tifSegs.push(<line key={`h${a}`} x1={x(a)} x2={x(end)} y1={v ? 112 : 126} y2={v ? 112 : 126} stroke={v ? "var(--orange)" : "var(--arches)"} strokeWidth={2} />);
      if (c <= now) tifSegs.push(<line key={`v${a}`} x1={x(c)} x2={x(c)} y1={112} y2={126} stroke="var(--dim)" strokeWidth={1} />);
      a = c;
    }
  }
  const zeros = sim.zeros.filter((z) => z >= from && z <= now);
  const lastTwo = zeros.slice(-2);

  const countList = prd <= 3 ? Array.from({ length: prd + 1 }, (_, i) => prd - i).join(", ") : `${prd}, ${prd - 1}, ... 0`;
  const counts = `TIM counts ${countList}: that is PRD + 1 = ${prd + 1} ticks, and each tick is ${tddr + 1} clock cycle${tddr ? "s" : ""}.`;
  const why = sim.tss
    ? `Stopped: with TSS = 1 the counter is frozen at TIM = ${tim}. The clock keeps running, the timer ignores it. Writing TSS = 0 lets it continue from ${tim}, not from PRD.`
    : sim.note === "trb"
      ? `TRB loaded TIM with PRD (${prd}) and restarted the prescaler, so a full period starts now. TRB itself reads back as 0.`
      : sim.note === "clear"
        ? "Writing 1 to TIF cleared it. It stays 0 until the counter passes zero again."
        : tif
          ? `${counts} One tick after 0 the timer sets TIF and loads TIM from PRD again. TIF then stays 1 until the program writes 1 to it.`
          : `${counts} TIF is 0: the counter has not passed zero since it was cleared.`;

  const usNum = Number(us);
  const product = Math.floor(200 * usNum);
  const valid = us.trim() !== "" && Number.isFinite(usNum) && product >= 1;
  const fits = valid && product <= 4294967296;
  const prdReal = product - 1;

  return (
    <figure className="figure ts-fig" aria-label="Interactive diagram of a CPU timer counting down and reloading">
      <style>{`
        .ts-fig input[type=range] { flex: 1 1 6rem; min-width: 5rem; max-width: 12rem; accent-color: var(--orange); }
        .ts-fig .ts-formula { font-family: var(--mono); font-size: 0.86rem; overflow-wrap: anywhere; }
        .ts-fig .ts-formula b { color: var(--harvest); }
        .ts-fig .ts-us { width: 7.5em; font: inherit; font-family: var(--mono); background: var(--inset); color: var(--text); border: 1px solid var(--border-strong, var(--dim)); border-radius: 4px; padding: 0.1em 0.3em; }
        .ts-fig .ts-real pre { white-space: pre-wrap; overflow-wrap: anywhere; }
        .ts-fig .ts-real h4 { margin: 0 0 0.3rem; font-size: 0.9rem; }
        .ts-fig .ts-bad { color: var(--bad); }
      `}</style>
      <svg viewBox="0 0 420 166" role="img" aria-label={`Counter TIM counts down from PRD = ${prd} to 0 and reloads every ${cyclesPerPeriod} clock cycles, ${cyclesPerPeriod * NS} nanoseconds. Now TIM is ${tim}, TIF is ${tif}, the timer is ${sim.tss ? "stopped" : "running"}.`}>
        <text x={4} y={12} className="fig-label">counter TIM</text>
        <text x={X0 - 5} y={27} textAnchor="end" className="fig-value small">PRD = {prd}</text>
        <text x={X0 - 5} y={95} textAnchor="end" className="fig-value small">0</text>
        <line x1={X0} x2={X1} y1={24} y2={24} className="fig-wire" strokeDasharray="3 3" style={{ strokeWidth: 0.8 }} />
        <line x1={X0} x2={X1} y1={92} y2={92} className="fig-wire" style={{ strokeWidth: 0.8 }} />
        {zeros.map((z) => (
          <line key={z + sim.base} x1={x(z)} x2={x(z)} y1={20} y2={128} className="fig-sample" />
        ))}
        <path d={stair} className="fig-trace data" />
        {/* clock */}
        <text x={4} y={104} className="fig-label dim">clock</text>
        {Array.from({ length: now - from }, (_, i) => (
          <line key={i} x1={x(from + i + 1)} x2={x(from + i + 1)} y1={98} y2={104} stroke="var(--dim)" strokeWidth={0.7} />
        ))}
        {/* flag */}
        <text x={4} y={122} className="fig-label">flag TIF</text>
        <text x={X0 - 5} y={115} textAnchor="end" className="fig-value small" style={{ fill: tif ? undefined : "var(--dim)" }}>1</text>
        <text x={X0 - 5} y={129} textAnchor="end" className="fig-value small" style={{ fill: tif ? "var(--dim)" : undefined }}>0</text>
        {tifSegs}
        {/* now */}
        <line x1={x(now)} x2={x(now)} y1={16} y2={132} stroke="var(--text)" strokeWidth={1} />
        <circle cx={x(now)} cy={yT(Math.min(prd, tim))} r={3} fill="var(--harvest)" stroke="var(--inset)" strokeWidth={0.8} />
        <circle cx={x(now)} cy={tif ? 112 : 126} r={3} fill={tif ? "var(--orange)" : "var(--arches)"} stroke="var(--inset)" strokeWidth={0.8} />
        <text x={Math.min(x(now), X1 - 2)} y={12} textAnchor={x(now) > X1 - 60 ? "end" : "middle"} className="fig-label">
          now: TIM = {tim}{sim.tss ? ", stopped" : ""}
        </text>
        {/* one period */}
        {lastTwo.length === 2 && (
          <g>
            <path d={`M${x(lastTwo[0])},137 v6 H${x(lastTwo[1])} v-6`} className="fig-wire" />
            <text x={(x(lastTwo[0]) + x(lastTwo[1])) / 2} y={154} textAnchor="middle" className="fig-value small">
              one period = {cyclesPerPeriod * NS} ns
            </text>
          </g>
        )}
        <text x={4} y={163} className="fig-label dim">time</text>
        <text x={X0} y={163} className="fig-label dim">{(sim.base + from) * NS} ns</text>
        <text x={X1} y={163} textAnchor="end" className="fig-label dim">{(sim.base + from + WINDOW) * NS} ns</text>
      </svg>
      <div className="fig-step">
        <p className="ts-formula">
          Period = (PRD + 1) x (TDDRH:TDDR + 1) x 5 ns = ({prd} + 1) x ({tddr} + 1) x 5 ns = <b>{cyclesPerPeriod * NS} ns</b>
        </p>
      </div>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span id="ts-prd">PRD</span>
          <input type="range" min={1} max={9} value={prd} aria-labelledby="ts-prd" aria-valuetext={`PRD = ${prd}`} onChange={(e) => change(+e.target.value, tddr)} />
          <code>CpuTimer0Regs.PRD.all = {prd};</code>
        </div>
        <div>
          <span id="ts-tddr">Prescaler</span>
          <input type="range" min={0} max={3} value={tddr} aria-labelledby="ts-tddr" aria-valuetext={`TDDR = ${tddr}, divide by ${tddr + 1}`} onChange={(e) => change(prd, +e.target.value)} />
          <code>CpuTimer0Regs.TPR.bit.TDDR = {tddr};</code>
        </div>
        <div>
          <span>Time</span>
          <button className="fig-opt" onClick={() => setSim((s) => step(s, prd, tddr))}>+1 clock cycle</button>
          <button className="fig-opt" onClick={() => setSim((s) => step(s, prd, tddr, cyclesPerPeriod))}>+1 period</button>
          {!calm && <button className="fig-opt" aria-pressed={running} onClick={() => setRunning(!running)}>{running ? "pause" : "run"}</button>}
          <button className="fig-opt" onClick={() => { setRunning(false); setSim(fresh(prd, tddr)); }}>Reset</button>
        </div>
      </div>
      <details className="fig-more">
        <summary>More controls: stop, reload, clear the flag, real periods</summary>
        <div className="fig-controls">
          <div>
            <span>Stop</span>
            <button className="fig-opt" aria-pressed={!sim.tss} onClick={() => setSim((s) => ({ ...s, tss: false, note: "" }))}>TSS = 0, running</button>
            <button className="fig-opt" aria-pressed={sim.tss} onClick={() => setSim((s) => ({ ...s, tss: true, note: "" }))}>TSS = 1, stopped</button>
            <code>CpuTimer0Regs.TCR.bit.TSS = {sim.tss ? 1 : 0};</code>
          </div>
          <div>
            <span>Reload</span>
            <button
              className="fig-opt"
              onClick={() =>
                setSim((s) => {
                  const tim = [...s.tim];
                  tim[tim.length - 1] = prd;
                  return { ...s, tim, psc: tddr, note: "trb" };
                })
              }
            >
              write TRB = 1
            </button>
            <code>CpuTimer0Regs.TCR.bit.TRB = 1;</code>
          </div>
          <div>
            <span>Flag</span>
            <button
              className="fig-opt"
              onClick={() =>
                setSim((s) => {
                  const tif = [...s.tif];
                  tif[tif.length - 1] = 0;
                  return { ...s, tif, note: "clear" };
                })
              }
            >
              write TIF = 1
            </button>
            <code>CpuTimer0Regs.TCR.bit.TIF = 1;  // clears the flag</code>
          </div>
        </div>
        <div className="fig-step ts-real">
          <h4>Real periods: let ConfigCpuTimer do the arithmetic</h4>
          <p>
            <label>
              Period in microseconds: <input className="ts-us" type="number" min={1} step={1} value={us} onChange={(e) => setUs(e.target.value)} />
            </label>{" "}
            {[
              ["1 ms", "1000"],
              ["10 ms", "10000"],
              ["0.5 s", "500000"],
            ].map(([name, v]) => (
              <button key={v} className="fig-opt" aria-pressed={us === v} onClick={() => setUs(v)}>{name}</button>
            ))}
          </p>
          {!valid ? (
            <p className="ts-bad">Enter a period of at least 0.005 microseconds (one clock cycle).</p>
          ) : !fits ? (
            <p className="ts-bad">
              200 x {us} = {product} does not fit in the 32-bit PRD. The longest period without the prescaler is 2^32 x 5 ns, about 21.47 s.
            </p>
          ) : (
            <pre>
              <code>
                {`ConfigCpuTimer(&CpuTimer0, 200, ${us});\n// PRD = 200 x ${us} - 1 = ${prdReal}, prescaler = 0\n// period = (${prdReal} + 1) x 1 x 5 ns = ${nice((prdReal + 1) * NS)}\nCpuTimer0Regs.TCR.all = 0x4000;  // TIE = 1, TSS = 0: start`}
              </code>
            </pre>
          )}
        </div>
      </details>
      <figcaption>
        The staircase is the counter TIM, with small numbers so that every tick is visible; a real PRD is in the hundreds of thousands or more. One clock cycle is 5 ns. Dashed lines mark the moments it passes zero: TIF is set and, if TIE is 1, an interrupt is requested. Changing PRD or the prescaler here restarts the picture from a reload.
      </figcaption>
    </figure>
  );
}

export const figure = {
  id: "timer-sawtooth",
  title: "CPU timer countdown",
  description: "Set the period register and the prescaler, step the clock and watch the counter count down to zero, raise its flag and start again.",
  Component: TimerSawtooth,
};
