// From the counter to the pin. TRM chapter 15: time base 15.4 (period,
// 15.4.3: up count TPWM = (TBPRD + 1) x TTBCLK, up-down TPWM = 2 x TBPRD x
// TTBCLK), counter compare 15.5, action qualifier 15.6 (AQCTLA actions
// 0 nothing, 1 clear, 2 set, 3 toggle; event priorities Tables 15-4 and
// 15-6; a compare value above the period, Table 15-7). TBCLK is 50 MHz here: EPWMCLK 100 MHz, HSPCLKDIV /2 (reset),
// CLKDIV /1. The waveform is computed the way src/sim/plugins/epwm.ts does.
import { useRef, useState } from "react";
import type { PointerEvent as RPointerEvent } from "react";

const TICK_NS = 20;
/** Ticks drawn: 200 µs. */
const TW = 10000;
const CMAX = 5000;
const PMIN = 500;
const ACTS = ["nothing", "clear", "set", "toggle"];
const DOES = ["does nothing", "goes low", "goes high", "toggles"];

const CSS = `
.pwmw input[type=range] { flex: 1 1 7rem; min-width: 5rem; padding: 0; accent-color: var(--accent); }
.pwmw-num { font-family: var(--mono); color: var(--value); min-width: 2.6em; text-align: right; font-size: 0.82rem; }
.pwmw-read { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.4rem 0; }
.pwmw-read div { flex: 1 1 7rem; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 0.25rem 0.55rem; font-size: 0.78rem; color: var(--dim); }
.pwmw-read b { display: block; font-family: var(--mono); color: var(--value); font-size: 0.95rem; }
.pwmw-grab { cursor: ns-resize; touch-action: none; fill: transparent; }
.pwmw-halo { paint-order: stroke; stroke: var(--inset); stroke-width: 3px; stroke-linejoin: round; }
`;

interface Edge {
  /** Tick at which the pin changes. */
  t: number;
  level: number;
}

/** Events of one cycle: [position in ticks, action], in time order. */
function cyclePoints(upDown: boolean, prd: number, cmpa: number, zro: number, cau: number, cad: number): [number, number][] {
  const at = new Map<number, string[]>();
  const add = (ev: string, p: number) => at.set(p, [...(at.get(p) ?? []), ev]);
  add("ZRO", 0);
  // Table 15-7: in up count a compare value above the period never matches.
  if (!upDown) {
    if (cmpa <= prd) add("CAU", cmpa);
  }
  else {
    add("CAU", cmpa < prd ? cmpa : prd);
    add("CAD", cmpa >= prd ? prd : cmpa === 0 ? 0 : 2 * prd - cmpa);
  }
  const action: Record<string, number> = { ZRO: zro, CAU: cau, CAD: cad };
  const out: [number, number][] = [];
  for (const [p, evs] of at) {
    // Highest priority first (Table 15-4 for up count, 15-6 for up-down).
    const prio = !upDown ? ["CAU", "ZRO"] : p === 0 ? ["CAU", "ZRO", "CAD"] : p === prd ? ["CAD", "CAU"] : ["CAU", "CAD", "ZRO"];
    const e = prio.find((x) => evs.includes(x) && action[x]);
    if (e) out.push([p, action[e]]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

function PwmWaveform() {
  const [upDown, setUpDown] = useState(false);
  const [prd, setPrdRaw] = useState(2500);
  const [cmpa, setCmpaRaw] = useState(1250);
  const [zro, setZro] = useState(2);
  const [cau, setCau] = useState(1);
  const [cad, setCad] = useState(0);
  const svg = useRef<SVGSVGElement>(null);

  const setPrd = (v: number) => {
    const p = Math.max(PMIN, Math.min(CMAX, Math.round(v / 50) * 50));
    setPrdRaw(p);
  };
  const setCmpa = (v: number) => setCmpaRaw(Math.max(0, Math.min(CMAX, Math.round(v / 25) * 25)));
  const setMode = (ud: boolean) => {
    setUpDown(ud);
    // The usual actions of each mode: a pulse from zero in up count, a centred pulse in up-down.
    setZro(ud ? 0 : 2);
    setCau(ud ? 2 : 1);
    setCad(ud ? 1 : 0);
  };

  const len = upDown ? 2 * prd : prd + 1;
  const pts = cyclePoints(upDown, prd, cmpa, zro, cau, upDown ? cad : 0);
  // The pin from reset (low) over the window, and its duty over two later cycles.
  const edges: Edge[] = [];
  let level = 0;
  let high = 0;
  let last = 0;
  const cycles = Math.max(4, Math.ceil(TW / len) + 1);
  let startOf2 = 0;
  let startOf3 = 0;
  for (let c = 0; c < cycles; c++) {
    if (c === 2) startOf2 = level;
    if (c === 3) startOf3 = level;
    for (const [p, a] of pts) {
      const t = c * len + p;
      const next = a === 1 ? 0 : a === 2 ? 1 : 1 - level;
      if (c >= 2 && c < 4 && level) high += t - Math.max(last, 2 * len);
      if (next !== level) edges.push({ t, level: next });
      level = next;
      last = t;
    }
    if (c >= 2 && c < 4 && level) high += (c + 1) * len - Math.max(last, 2 * len);
    last = (c + 1) * len;
  }
  const duty = high / (2 * len);
  const moving = edges.some((e) => e.t >= 2 * len && e.t < 4 * len);
  const halved = moving && startOf2 !== startOf3;

  const X0 = 52;
  const X1 = 408;
  const Y0 = 118;
  const Y1 = 20;
  const PH = 146;
  const PL = 172;
  const x = (t: number) => X0 + (Math.min(t, TW) / TW) * (X1 - X0);
  const y = (c: number) => Y0 - (c / CMAX) * (Y0 - Y1);

  // Counter: one line per rise (and fall), clipped at the right edge.
  let ctr = "";
  for (let c = 0; c * len < TW; c++) {
    const t0 = c * len;
    const seg = (ta: number, ca: number, tb: number, cb: number) => {
      if (ta >= TW) return;
      const f = tb > TW ? (TW - ta) / (tb - ta) : 1;
      ctr += `M${x(ta)},${y(ca)} L${x(ta + (tb - ta) * f)},${y(ca + (cb - ca) * f)} `;
    };
    if (upDown) {
      seg(t0, 0, t0 + prd, prd);
      seg(t0 + prd, prd, t0 + 2 * prd, 0);
    } else {
      seg(t0, 0, t0 + prd, prd);
      if (t0 + prd < TW) ctr += `M${x(t0 + prd)},${y(prd)} V${y(0)} `;
    }
  }
  // Pin.
  let pin = `M${X0},${PL}`;
  let fill = "";
  let lv = 0;
  let from = 0;
  for (const e of edges) {
    if (e.t >= TW) break;
    pin += ` H${x(e.t)} V${e.level ? PH : PL}`;
    if (lv) fill += `M${x(from)},${PL} V${PH} H${x(e.t)} V${PL} Z `;
    lv = e.level;
    from = e.t;
  }
  pin += ` H${X1}`;
  if (lv) fill += `M${x(from)},${PL} V${PH} H${X1} V${PL} Z `;
  // Event marks on the counter, with a line down to the pin where the pin moves.
  const marks: { t: number; c: number; ev: boolean }[] = [];
  for (let c = 0; c * len < TW; c++)
    for (const [p] of pts) {
      const t = c * len + p;
      if (t <= TW) marks.push({ t, c: upDown && p > prd ? 2 * prd - p : p, ev: edges.some((e) => e.t === t) });
    }

  const drag = (which: "prd" | "cmpa") => ({
    onPointerDown: (e: RPointerEvent<SVGRectElement>) => e.currentTarget.setPointerCapture(e.pointerId),
    onPointerMove: (e: RPointerEvent<SVGRectElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId) || !svg.current) return;
      const r = svg.current.getBoundingClientRect();
      const count = ((Y0 - ((e.clientY - r.top) * 200) / r.height) / (Y0 - Y1)) * CMAX;
      if (which === "prd") setPrd(count);
      else setCmpa(count);
    },
  });

  const periodUs = (len * TICK_NS) / 1000;
  const freq = 1e9 / (len * TICK_NS);
  const pct = (duty * 100).toFixed(2).replace(/\.?0+$/, "");
  const group = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+$)/g, " ");
  const standard = !upDown && zro === 2 && cau === 1;
  const swapped = !upDown && zro === 1 && cau === 2;
  const centred = upDown && cau === 2 && cad === 1 && zro === 0;
  let why: string;
  const anyAction = zro || cau || (upDown && cad);
  if (!moving) {
    const reason = !anyAction
      ? "No event has an action, so the counter runs and the pin never moves. This is the state after reset."
      : !upDown && cau && cmpa > prd
        ? `CMPA = ${cmpa} is above TBPRD = ${prd}: the counter turns back before it gets there, so the compare event never happens. Only the zero event acts on the pin.${zro === 2 && cau === 1 ? " That is a duty cycle of 100 %." : ""}`
        : !upDown && cau && cmpa === 0
          ? "With CMPA = 0 both events fall on the same count, and the compare event has priority over the zero event."
          : upDown && (cau || cad) && cmpa >= prd
            ? "CMPA is at or above TBPRD, so both compare events fall on the peak of the triangle. There the event on the way down has priority, and the one on the way up is ignored."
            : upDown && (cau || cad) && cmpa === 0
              ? "With CMPA = 0 both compare events fall on the zero count. There the event on the way up has priority, and the one on the way down is ignored."
              : "Nothing ever moves it the other way: one event must set the pin and another must clear it.";
    why = `The pin stays ${level ? "high" : "low"}. ${reason}`;
  }
  else if (standard) why = `The pin goes high when the counter is 0 and low when it reaches CMPA = ${cmpa}. It is high for ${cmpa} of the ${len} counts in a period: ${pct} %. A bigger CMPA is a wider pulse; TBPRD only sets how often the pulses come.`;
  else if (swapped) why = `Swapped actions, upside-down waveform: the pin is low from zero to CMPA and high for the rest of the period, ${pct} % instead of ${((cmpa / len) * 100).toFixed(2).replace(/\.?0+$/, "")} %. Raising CMPA now makes the LED dimmer.`;
  else if (centred) why = `The pin goes high at CMPA on the way up and low at CMPA on the way down, so the pulse sits around the peak of the triangle, centred in the period. A smaller CMPA is a wider pulse: ${pct} % here. One period is 2 x TBPRD = ${len} counts.`;
  else if (halved) why = `A toggle changes the pin once per period, so the pin needs two counter periods for one high and one low: ${group(freq / 2)} Hz, half the counter's ${group(freq)} Hz, always at 50 %. The buzzer uses this.`;
  else why = `At zero the pin ${DOES[zro]}; at CMPA on the way up it ${DOES[cau]}${upDown ? `; at CMPA on the way down it ${DOES[cad]}` : ""}. The pin ends up high ${pct} % of the time.`;

  const label = `${upDown ? "Up-down" : "Up"} count, TBPRD ${prd}, CMPA ${cmpa}. Period ${periodUs.toFixed(2)} microseconds, ${moving ? `pin high ${pct} percent of the time` : `pin stays ${level ? "high" : "low"}`}.`;
  const opts = (value: number, set: (v: number) => void, what: string) =>
    ACTS.map((a, i) => (
      <button key={a} className="fig-opt" aria-pressed={value === i} aria-label={`${what}: ${a}`} onClick={() => set(i)}>{a}</button>
    ));

  return (
    <figure className="figure pwmw" aria-label="Interactive ePWM waveform: counter, period, compare value and the pin">
      <style>{CSS}</style>
      <svg ref={svg} viewBox="0 0 420 200" role="img" aria-label={label}>
        {/* counter plot */}
        <text x="4" y={Y1 + 3} className="fig-label">TBCTR</text>
        <text x="4" y={Y1 + 14} className="fig-label dim">counter</text>
        <line x1={X0} x2={X1} y1={Y0} y2={Y0} className="fig-wire" />
        <line x1={X0} x2={X0} y1={Y0} y2={Y1 - 8} className="fig-wire" />
        <text x={X0 - 5} y={Y0 + 3} textAnchor="end" className="fig-label dim">0</text>
        {marks.filter((m) => m.ev).map((m, i) => (
          <line key={i} x1={x(m.t)} x2={x(m.t)} y1={y(m.c)} y2={PL} className="fig-sample" />
        ))}
        <path d={ctr} className="fig-trace dim" style={{ stroke: "var(--text)" }} />
        {/* TBPRD */}
        <line x1={X0} x2={X1} y1={y(prd)} y2={y(prd)} stroke="var(--info)" strokeWidth="1.4" strokeDasharray="6 3" />
        <text x={X1 - 2} y={y(prd) - 4} textAnchor="end" className="fig-value small pwmw-halo" style={{ fill: "var(--info)" }}>TBPRD = {prd}</text>
        {/* CMPA */}
        <line x1={X0} x2={X1} y1={y(cmpa)} y2={y(cmpa)} stroke="var(--value)" strokeWidth="1.4" strokeDasharray="6 3" />
        <text x={X0 + 12} y={y(cmpa) > Y0 - 14 ? y(cmpa) + 11 : y(cmpa) - 4} className="fig-value small pwmw-halo">CMPA = {cmpa}</text>
        {marks.map((m, i) => (
          <circle key={i} cx={x(m.t)} cy={y(m.c)} r={m.ev ? 2.6 : 1.6} fill={m.ev ? "var(--accent)" : "var(--dim)"} />
        ))}
        <path d={`M${X0 - 5},${y(prd) - 4} L${X0 + 3},${y(prd)} L${X0 - 5},${y(prd) + 4} Z`} fill="var(--info)" />
        <path d={`M${X0 - 5},${y(cmpa) - 4} L${X0 + 3},${y(cmpa)} L${X0 - 5},${y(cmpa) + 4} Z`} fill="var(--value)" />
        <rect x={X0 - 10} y={y(prd) - 7} width={X1 - X0 + 10} height="14" className="pwmw-grab" {...drag("prd")}><title>Drag to change TBPRD</title></rect>
        <rect x={X0 - 10} y={y(cmpa) - 7} width={X1 - X0 + 10} height="14" className="pwmw-grab" {...drag("cmpa")}><title>Drag to change CMPA</title></rect>
        {/* pin */}
        <text x="4" y={PH + 9} className="fig-label">EPWM12A</text>
        <text x="4" y={PH + 20} className="fig-label dim">0 or 3.3 V</text>
        <path d={fill} fill="var(--accent-soft)" />
        <path d={pin} className="fig-trace" style={{ stroke: "var(--hi)" }} />
        {[0, 50, 100, 150, 200].map((us) => (
          <text key={us} x={x(us * 50)} y="190" textAnchor={us === 0 ? "start" : us === 200 ? "end" : "middle"} className="fig-label dim">{us === 0 ? "0" : `${us} µs`}</text>
        ))}
      </svg>
      <div className="pwmw-read">
        <div>Period<b>{periodUs.toFixed(2)} µs</b>{upDown ? `2 x ${prd}` : `(${prd} + 1)`} x 20 ns</div>
        <div>{halved ? "Pin frequency" : "Frequency"}<b>{group(halved ? freq / 2 : freq)} Hz</b>{halved ? "half the counter's" : "1 / period"}</div>
        <div>Duty cycle<b>{moving ? `${pct} %` : level ? "100 %" : "0 %"}</b>{moving ? `average ${(duty * 3.3).toFixed(2)} V` : "the pin does not switch"}</div>
      </div>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Count</span>
          <button className="fig-opt" aria-pressed={!upDown} onClick={() => setMode(false)}>up (sawtooth)</button>
          <button className="fig-opt" aria-pressed={upDown} onClick={() => setMode(true)}>up-down (triangle)</button>
          <code>EPwm12Regs.TBCTL.bit.CTRMODE = {upDown ? 2 : 0};</code>
        </div>
        <div>
          <span>Period</span>
          <input type="range" min={PMIN} max={CMAX} step={50} value={prd} aria-label="TBPRD, the period register" onChange={(e) => setPrd(+e.target.value)} />
          <code>EPwm12Regs.TBPRD = {prd};</code>
        </div>
        <div>
          <span>Compare</span>
          <input type="range" min={0} max={CMAX} step={25} value={cmpa} aria-label="CMPA, the compare register" onChange={(e) => setCmpa(+e.target.value)} />
          <code>EPwm12Regs.CMPA.bit.CMPA = {cmpa};</code>
        </div>
        <div>
          <span>Zero</span>
          {opts(zro, setZro, "When the counter is zero")}
          <code>EPwm12Regs.AQCTLA.bit.ZRO = {zro};</code>
        </div>
        <div>
          <span>{upDown ? "CMPA up" : "CMPA"}</span>
          {opts(cau, setCau, "When the counter reaches CMPA counting up")}
          <code>EPwm12Regs.AQCTLA.bit.CAU = {cau};</code>
        </div>
        {upDown && (
          <div>
            <span>CMPA down</span>
            {opts(cad, setCad, "When the counter reaches CMPA counting down")}
            <code>EPwm12Regs.AQCTLA.bit.CAD = {cad};</code>
          </div>
        )}
      </div>
      <figcaption>The counter climbs one count every 20 ns, so its slope never changes: TBPRD is where it turns back, CMPA is a level it crosses on the way. A CMPA above TBPRD is never reached. Drag the two dashed lines or use the sliders. Orange dots mark the events that move the pin.</figcaption>
    </figure>
  );
}

export const figure = { id: "pwm-waveform", Component: PwmWaveform };
