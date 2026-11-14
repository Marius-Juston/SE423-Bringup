// The whole ePWM module in one figure: time base, two compare registers,
// both action-qualifier registers, dead band, event trigger, phase loading
// and shadow loading. The behaviour is computed by pwm-model.ts, which cites
// the TRM sections it follows (chapter 15: time base 15.4, counter compare
// 15.5, action qualifier 15.6 with Tables 15-4 to 15-7, dead band 15.7,
// event trigger 15.10, registers 15.15.2) and is tested against those cases
// and against the simulator in tests/pwm_model.test.ts. The words are in
// pwm-playground-words.ts.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent, ReactNode } from "react";
import {
  ACTIONS, ET_SEL_NAMES, EVENTS, HSPCLKDIV, PRESETS, clean, code, counterAt, cycleTicks, levelAt, propose, pwmPin, simulate,
  type Action, type Aq, type Edge, type Ev, type PwmSettings, type Signal,
} from "./pwm-model";
import { MODE_NAMES, describe, eventWords, fmtHz, fmtPct, fmtTime } from "./pwm-playground-words";

const CSS = `
.pwmp input[type=range] { flex: 1 1 6rem; min-width: 4.5rem; padding: 0; accent-color: var(--accent); }
.pwmp input[type=number] { width: 5.2rem; padding: 0.15em 0.35em; font-family: var(--mono); font-size: 0.82rem; }
.pwmp input.pct { width: 4.2rem; }
.pwmp select { padding: 0.15em 0.3em; font-size: 0.82rem; max-width: 100%; }
.pwmp .pair { white-space: nowrap; }
.pwmp .unit { color: var(--dim); font-size: 0.78rem; }
.pwmp-read { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0.4rem 0; }
.pwmp-read div { flex: 1 1 6.4rem; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 0.2rem 0.5rem; font-size: 0.74rem; color: var(--dim); }
.pwmp-read b { display: block; font-family: var(--mono); color: var(--value); font-size: 0.9rem; }
.pwmp-edge { display: flex; flex-wrap: wrap; gap: 0.3rem 0.5rem; align-items: center; font-size: 0.82rem; margin: 0.3rem 0; min-height: 1.9em; }
.pwmp-edge span { flex: 1 1 12rem; color: var(--dim); }
.pwmp-edge span b { color: var(--text); font-family: var(--mono); font-weight: 700; }
.pwmp-presets { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; margin: 0.5rem 0 0.2rem; }
.pwmp-presets > span { color: var(--dim); font-size: 0.82rem; margin-right: 0.2rem; }
.pwmp-about { margin: 0.2rem 0 0.5rem; font-size: 0.85rem; color: var(--dim); }
.pwmp-group { border-top: 1px solid var(--border); }
.pwmp-group > button { display: flex; flex-wrap: wrap; gap: 0.1rem 0.6rem; align-items: baseline; width: 100%; text-align: left; background: none; border: none; padding: 0.4rem 0.1rem; font-size: 0.9rem; font-weight: 700; }
.pwmp-group > button i { font-style: normal; display: inline-block; width: 1em; color: var(--dim); }
.pwmp-group > button small { font-family: var(--mono); font-weight: 400; font-size: 0.72rem; color: var(--dim); }
.pwmp-group > .fig-controls, .pwmp-group > .pwmp-body { margin: 0 0 0.6rem; }
.pwmp-note { margin: 0.1rem 0 0.3rem; font-size: 0.8rem; color: var(--dim); }
.pwmp-aq { display: grid; grid-template-columns: auto repeat(6, minmax(0, 1fr)); gap: 3px; align-items: stretch; font-size: 0.74rem; }
.pwmp-aq .h { text-align: center; color: var(--dim); font-family: var(--mono); padding-bottom: 1px; }
.pwmp-aq .r { color: var(--dim); font-family: var(--mono); padding-right: 0.3rem; align-self: center; }
.pwmp-aq button { background: var(--surface); border: 1px solid var(--border-strong); border-radius: 6px; padding: 0.15rem 0; display: grid; justify-items: center; line-height: 1.15; min-width: 0; }
.pwmp-aq button b { font-size: 1.05rem; font-family: var(--mono); }
.pwmp-aq button span { font-size: 0.68rem; overflow: hidden; max-width: 100%; }
.pwmp-aq button.act { border-color: var(--accent); background: var(--accent-soft); }
.pwmp-aq button.never { border-style: dashed; border-color: var(--control); background: none; color: var(--dim); }
.pwmp-codebox { margin-top: 0.6rem; border-top: 1px solid var(--border); padding-top: 0.5rem; }
.pwmp-codebox > div { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.3rem; font-size: 0.85rem; font-weight: 700; }
.pwmp-codebox > div button { margin-left: auto; font-weight: 400; }
.pwmp-codebox pre { margin: 0; font-size: 0.76rem; max-height: 16rem; overflow: auto; background: var(--surface); }
.pwmp-grab { cursor: ns-resize; touch-action: none; fill: transparent; }
.pwmp-hit { fill: transparent; cursor: pointer; }
.pwmp-halo { paint-order: stroke; stroke: var(--inset); stroke-width: 3px; stroke-linejoin: round; }
`;

const ZOOMS = [0.25, 0.5, 1, 2, 3, 4, 6];
const SYMBOL = ["·", "↓", "↑", "↕"];
const EVENT_HEAD: Record<Ev, string> = { ZRO: "counter = 0", PRD: "counter = TBPRD", CAU: "CMPA, going up", CAD: "CMPA, going down", CBU: "CMPB, going up", CBD: "CMPB, going down" };
/** How many periods a preset is best looked at with (wide, narrow). */
const PRESET_VIEW: Record<string, [number, number]> = { buzzer: [5, 4], pair: [3, 2] };

// Drawing, in viewBox units.
const VW = 420;
const X0 = 62;
const X1 = 412;
const Y1 = 24;
const Y0 = 112;

interface Row {
  name: string;
  /** Spoken name. */
  full: string;
  sig: Signal;
  dim: boolean;
  top: number;
  h: number;
}

function Group({ id, title, reg, open, toggle, children }: { id: string; title: string; reg: string; open: boolean; toggle: (id: string) => void; children: ReactNode }) {
  return (
    <div className="pwmp-group">
      <button aria-expanded={open} aria-controls={`pwmp-${id}`} onClick={() => toggle(id)}>
        <span><i aria-hidden="true">{open ? "▾" : "▸"}</i>{title}</span>
        <small>{reg}</small>
      </button>
      {open && <div id={`pwmp-${id}`} className="pwmp-body">{children}</div>}
    </div>
  );
}

function PwmPlayground() {
  const [s, setS] = useState<PwmSettings>(PRESETS[0].settings);
  const [mod, setMod] = useState(PRESETS[0].module);
  const [zoom, setZoom] = useState<number | null>(null);
  const [pan, setPan] = useState(0);
  const [open, setOpen] = useState<Record<string, boolean>>({ clock: true });
  const [sel, setSel] = useState<{ row: number; t: number } | null>(null);
  const [hold, setHold] = useState<number | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [target, setTarget] = useState("20000");
  const [proposal, setProposal] = useState("");
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLElement>(null);
  const svg = useRef<SVGSVGElement>(null);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const fit = () => setNarrow(el.getBoundingClientRect().width < 440);
    fit();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const patch = (p: Partial<PwmSettings>) => setS((old) => clean({ ...old, ...p }));
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const active = PRESETS.find((p) => JSON.stringify(p.settings) === JSON.stringify(s) && p.module === mod);
  const load = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setS(p.settings);
    setMod(p.module);
    setZoom(null);
    setPan(0);
    setSel(null);
    setProposal("");
  };

  // ---- the model ----
  const len = cycleTicks(s.ctrmode, s.tbprd);
  const unit = len || 1000;
  const view = active && PRESET_VIEW[active.id];
  const z = zoom ?? (view ? view[narrow ? 1 : 0] : narrow ? 3 : 4);
  const span = Math.max(4, Math.round(ZOOMS[z] * unit));
  const tStart = Math.round((pan / 8) * unit);
  const tEnd = tStart + span;
  const r = useMemo(() => simulate(s, tEnd), [s, tEnd]);
  const words = useMemo(() => describe(s, r, mod), [s, r, mod]);
  const lines = useMemo(() => code(s, mod), [s, mod]);
  const A = `EPWM${mod}A`;
  const B = `EPWM${mod}B`;

  // ---- geometry ----
  const db = s.dbOutMode !== 0;
  const rows: Row[] = [];
  let yy = Y0 + 14;
  const addRow = (name: string, full: string, sig: Signal, dim: boolean) => {
    const h = dim ? 10 : 16;
    rows.push({ name, full, sig, dim, top: yy, h });
    yy += h + (dim ? 7 : 10);
  };
  if (db) {
    addRow("A before", `${A} before the dead band`, r.a, true);
    addRow("B before", `${B} before the dead band`, r.b, true);
    addRow(A, `the pin ${A}`, r.outA, false);
    addRow(B, `the pin ${B}`, r.outB, false);
  }
  else {
    addRow(A, A, r.a, false);
    addRow(B, B, r.b, false);
  }
  const trig: { name: string; times: number[]; y: number }[] = [];
  for (const [name, en, times] of [["SOCA", s.socaen, r.soca], ["SOCB", s.socben, r.socb], ["INT", s.inten, r.int]] as [string, boolean, number[]][]) {
    if (!en) continue;
    trig.push({ name, times, y: yy });
    yy += 12;
  }
  if (!trig.length) yy += 12;
  const axisY = yy + 8;
  const VH = axisY + 5;

  const top = Math.max(s.tbprd, 1);
  const cmpTop = Math.max(s.cmpa, s.cmpb, s.cmpaNext ?? 0);
  const ymax = hold ?? (cmpTop <= top * 1.5 ? Math.max(top, cmpTop) : top) * 1.12;
  const x = (t: number) => X0 + ((Math.max(tStart, Math.min(tEnd, t)) - tStart) / span) * (X1 - X0);
  const y = (c: number) => (c > ymax ? Y1 - 9 : Y0 - (c / ymax) * (Y0 - Y1));
  const inView = (t: number) => t >= tStart && t <= tEnd;

  // Counter: a staircase when single counts are visible, a line otherwise.
  let ctr = "";
  if (span <= 64 && len) {
    for (let t = tStart; t < tEnd; t++) ctr += `${t === tStart ? "M" : "L"}${x(t)},${y(counterAt(r, t))} H${x(t + 1)} `;
  }
  else {
    const c = r.counter;
    for (let k = 0; k + 1 < c.length; k++) {
      const p = c[k];
      const q = c[k + 1];
      if (q.t < tStart || p.t > tEnd) continue;
      const at = (t: number) => (q.t === p.t ? p.c : p.c + ((q.c - p.c) * (t - p.t)) / (q.t - p.t));
      const ta = Math.max(p.t, tStart);
      const tb = Math.min(q.t, tEnd);
      ctr += q.t === p.t ? `M${x(p.t)},${y(p.c)} V${y(q.c)} ` : `M${x(ta)},${y(at(ta))} L${x(tb)},${y(at(tb))} `;
    }
  }

  const trace = (row: Row) => {
    const hi = row.top;
    const lo = row.top + row.h;
    let level = levelAt(row.sig, tStart - 0.5);
    let from = tStart;
    let d = `M${X0},${level ? hi : lo}`;
    let fill = "";
    const shown: Edge[] = [];
    for (const e of row.sig.edges) {
      if (e.t < tStart) continue;
      if (e.t > tEnd) break;
      d += ` H${x(e.t)} V${e.level ? hi : lo}`;
      if (level) fill += `M${x(from)},${lo} V${hi} H${x(e.t)} V${lo} Z `;
      level = e.level;
      from = e.t;
      shown.push(e);
    }
    d += ` H${X1}`;
    if (level) fill += `M${x(from)},${lo} V${hi} H${X1} V${lo} Z `;
    return { d, fill, shown };
  };
  const traces = rows.map(trace);
  const allEdges = traces.flatMap((tr, row) => tr.shown.slice(0, 60).map((e) => ({ row, e }))).sort((p, q) => p.e.t - q.e.t || p.row - q.row);
  const selIdx = sel ? allEdges.findIndex((p) => p.row === sel.row && p.e.t === sel.t) : -1;
  const picked = selIdx >= 0 ? allEdges[selIdx] : null;
  const step = (d: number) => {
    if (!allEdges.length) return;
    const k = selIdx < 0 ? (d > 0 ? 0 : allEdges.length - 1) : (selIdx + d + allEdges.length) % allEdges.length;
    setSel({ row: allEdges[k].row, t: allEdges[k].e.t });
  };

  // Event marks, and one label per event name.
  const marks = r.marks.filter((m) => inView(m.t)).slice(0, 150);
  const named = new Set<string>();
  const placed: [number, number][] = [];
  const markLabels: { x: number; y: number; text: string; end: boolean }[] = [];
  // Compare events are named only when something uses them.
  const etUse = [s.socaen ? s.socasel : 0, s.socben ? s.socbsel : 0, s.inten ? s.intsel : 0];
  const usedEv = (e: Ev) => e === "ZRO" || e === "PRD" || s.aqa[e] !== 0 || s.aqb[e] !== 0 || etUse.includes(EVENTS.indexOf(e) + 2);
  const cmpbUsed = (["CBU", "CBD"] as Ev[]).some(usedEv);
  for (const m of marks) {
    const text = m.evs.filter(usedEv).join("+");
    if (!text) continue;
    if (named.has(text)) continue;
    const mx = x(m.t);
    const my = y(m.ctr);
    // Compare events go under the counter line (the line labels sit above it): right of a rising slope, left of a falling one.
    const cmp = text[0] === "C" && my + 11 < Y0 - 2;
    // ...and a period event at the far right goes under the TBPRD label.
    const corner = !cmp && text.startsWith("PRD") && mx > X1 - 110;
    const left = corner || (cmp && text[2] === "D");
    const ly = cmp || corner ? my + 11 : my - 5 < Y1 + 4 ? my + 12 : my - 5;
    if (placed.some(([px, py]) => Math.abs(px - mx) < 9 + text.length * 5 && Math.abs(py - ly) < 10)) continue;
    named.add(text);
    placed.push([mx, ly]);
    markLabels.push({ x: mx, y: ly, text, end: left || mx > X1 - 12 - text.length * 5 });
  }

  const cycles: number[] = [];
  if (len && span / len <= 12) for (let t = Math.ceil(tStart / len) * len; t <= tEnd; t += len) cycles.push(t);

  const drag = (which: "tbprd" | "cmpa" | "cmpb") => ({
    onPointerDown: (e: RPointerEvent<SVGRectElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setHold(ymax);
    },
    onPointerMove: (e: RPointerEvent<SVGRectElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId) || !svg.current) return;
      const box = svg.current.getBoundingClientRect();
      const count = Math.round(((Y0 - ((e.clientY - box.top) * VH) / box.height) / (Y0 - Y1)) * ymax);
      patch({ [which]: Math.max(which === "tbprd" ? 1 : 0, Math.min(65535, count)) });
    },
    onPointerUp: () => setHold(null),
    onPointerCancel: () => setHold(null),
  });

  // The active CMPA over time (it changes when a shadow value is loaded).
  const loadT = r.loads.length ? r.loads[0].t : Infinity;
  const writeT = s.cmpaNext !== null ? s.cmpaWriteAt : Infinity;
  const cmpaLine = s.cmpaNext !== null && loadT < tEnd
    ? `M${X0},${y(s.cmpa)} H${x(loadT)} V${y(s.cmpaNext)} H${X1}`
    : `M${X0},${y(s.cmpa)} H${X1}`;
  const lineLabel = (v: number) => (y(v) - 4 < Y1 - 12 ? y(v) + 11 : y(v) - 4);
  const over = (v: number) => (v > ymax ? " ↑" : "");

  const axis = (narrow ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((f) => ({ f, t: tStart + f * span }));
  const copy = () => {
    const text = lines.join("\n");
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => undefined);
  };

  // ---- small pieces of the controls ----
  const num = (label: string, value: number, max: number, set: (v: number) => void, cls = "") => (
    <input type="number" className={cls} min={0} max={max} value={value} aria-label={label} onChange={(e) => set(e.target.value === "" ? 0 : +e.target.value)} />
  );
  const pick = (label: string, value: number, options: string[], set: (v: number) => void) => (
    <select aria-label={label} value={value} onChange={(e) => set(+e.target.value)}>
      {options.map((o, i) => <option key={o} value={i}>{o}</option>)}
    </select>
  );
  const cmpMax = Math.min(65535, Math.max(10, Math.round(s.tbprd * 1.25)));
  const pctOf = (v: number) => (s.tbprd ? +((v / s.tbprd) * 100).toFixed(2) : 0);
  const compare = (name: "CMPA" | "CMPB", key: "cmpa" | "cmpb") => (
    <div>
      <span>{name}</span>
      <input type="range" min={0} max={cmpMax} value={Math.min(s[key], cmpMax)} aria-label={`${name}, the compare value, in counts`} onChange={(e) => patch({ [key]: +e.target.value })} />
      {num(`${name} in counts`, s[key], 65535, (v) => patch({ [key]: v }))}
      <span className="pair">
        <input type="number" className="pct" min={0} max={200} step={0.1} value={pctOf(s[key])} disabled={!s.tbprd} aria-label={`${name} as a percentage of TBPRD`} onChange={(e) => patch({ [key]: Math.round((+e.target.value / 100) * s.tbprd) })} />
        <span className="unit"> % of TBPRD</span>
      </span>
      <code>{name}.bit.{name} = {s[key]};</code>
    </div>
  );
  const aqRow = (reg: "AQCTLA" | "AQCTLB", key: "aqa" | "aqb", pin: string) => {
    const aq: Aq = s[key];
    return (
      <>
        <span className="r">{reg}</span>
        {EVENTS.map((e) => {
          const never = r.never.includes(e);
          const a = aq[e];
          return (
            <button
              key={e}
              className={never ? "never" : a ? "act" : ""}
              aria-label={`${pin} when ${eventWords(e)} (${e}): ${ACTIONS[a]}${never ? ". This event never happens with these settings" : ""}. Press to change.`}
              onClick={() => patch({ [key]: { ...aq, [e]: ((a + 1) % 4) as Action } })}
            >
              <b aria-hidden="true">{SYMBOL[a]}</b>
              <span>{ACTIONS[a]}</span>
            </button>
          );
        })}
      </>
    );
  };
  const trigRow = (name: "SOCA" | "SOCB" | "INT", en: "socaen" | "socben" | "inten", selKey: "socasel" | "socbsel" | "intsel", prdKey: "socaprd" | "socbprd" | "intprd") => (
    <div>
      <span>{name === "INT" ? "Interrupt" : name}</span>
      <button className="fig-opt" aria-pressed={s[en]} aria-label={`${name} enabled`} onClick={() => patch({ [en]: !s[en] })}>{s[en] ? "on" : "off"}</button>
      {pick(`${name}: which event`, s[selKey], ET_SEL_NAMES.map((n, i) => `${i}: ${i ? n : name === "INT" ? "reserved" : n}`), (v) => patch({ [selKey]: v }))}
      {pick(`${name}: how often`, s[prdKey], ["0: never", "1: every event", "2: every 2nd", "3: every 3rd"], (v) => patch({ [prdKey]: v }))}
      <code>ETSEL.bit.{name}EN = {s[en] ? 1 : 0}; ETSEL.bit.{name}SEL = {s[selKey]}; ETPS.bit.{name}PRD = {s[prdKey]};</code>
    </div>
  );
  const when = (label: string, value: number, set: (v: number) => void) => (
    <>
      <input type="range" min={0} max={120} value={Math.min(120, Math.round((value / unit) * 40))} aria-label={label} onChange={(e) => set(Math.round((+e.target.value / 40) * unit))} />
      <span className="unit">at {fmtTime(value * r.tickNs)}</span>
    </>
  );

  const duty = (st: typeof r.statOutA) => (st.switching ? fmtPct(st.duty) : st.level ? "100 %" : "0 %");
  const rates = [s.socaen ? `SOCA ${fmtHz(r.socaHz)}` : "", s.socben ? `SOCB ${fmtHz(r.socbHz)}` : "", s.inten ? `INT ${fmtHz(r.intHz)}` : ""].filter(Boolean);

  return (
    <figure className="figure pwmp" ref={root} aria-label="Interactive ePWM playground: counter, two compare values, both outputs, dead band and triggers">
      <style>{CSS}</style>
      <svg ref={svg} viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label={words.label}>
        {cycles.map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={Y1 - 4} y2={axisY - 9} stroke="var(--faint)" strokeWidth="1" />)}
        {/* counter */}
        <text x="4" y={Y1 + 4} className="fig-label">TBCTR</text>
        <text x="4" y={Y1 + 15} className="fig-label dim">counter</text>
        <line x1={X0} x2={X1} y1={Y0} y2={Y0} className="fig-wire" />
        <line x1={X0} x2={X0} y1={Y0} y2={Y1 - 6} className="fig-wire" />
        <path d={ctr} className="fig-trace dim" style={{ stroke: "var(--text)" }} />
        {/* TBPRD, CMPB, CMPA */}
        <line x1={X0} x2={X1} y1={y(s.tbprd)} y2={y(s.tbprd)} stroke="var(--info)" strokeWidth="1.3" strokeDasharray="6 3" />
        <text x={X1 - 2} y={y(s.cmpa) < y(s.tbprd) && Math.abs(lineLabel(s.cmpa) - lineLabel(s.tbprd)) < 11 ? Math.max(lineLabel(s.cmpa), y(s.tbprd)) + 11 : lineLabel(s.tbprd)} textAnchor="end" className="fig-value small pwmp-halo" style={{ fill: "var(--info)" }}>TBPRD = {s.tbprd}</text>
        <line x1={X0} x2={X1} y1={y(s.cmpb)} y2={y(s.cmpb)} stroke="var(--value)" strokeWidth="1.3" strokeDasharray="2 3" opacity={cmpbUsed ? 1 : 0.5} />
        {(cmpbUsed || (Math.abs(y(s.cmpb) - y(s.cmpa)) >= 12 && Math.abs(y(s.cmpb) - y(s.tbprd)) >= 12)) && (
          <text x={X1 - 96} y={!cmpbUsed || y(s.cmpa) >= y(s.cmpb) || y(s.cmpb) - y(s.cmpa) >= 12 ? lineLabel(s.cmpb) : y(s.cmpb) + 11} textAnchor="end" className="fig-value small pwmp-halo">CMPB = {s.cmpb}{over(s.cmpb)}</text>
        )}
        <path d={cmpaLine} fill="none" stroke="var(--value)" strokeWidth="1.3" strokeDasharray="6 3" />
        <text x={X1 - 2} y={y(s.cmpa) - y(s.tbprd) < 12 && y(s.cmpa) >= y(s.tbprd) ? y(s.cmpa) + 11 : lineLabel(s.cmpa)} textAnchor="end" className="fig-value small pwmp-halo">CMPA = {s.cmpa}{over(s.cmpa)}</text>
        {s.cmpaNext !== null && inView(writeT) && (
          <g>
            <line x1={x(writeT)} x2={x(writeT)} y1={Y1 - 2} y2={Y0} className="fig-sample" />
            {loadT > writeT && <line x1={x(writeT)} x2={x(Math.min(loadT, tEnd))} y1={y(s.cmpaNext)} y2={y(s.cmpaNext)} stroke="var(--value)" strokeWidth="1" strokeDasharray="1 4" />}
            <text x={x(writeT) + (x(writeT) > X1 - 70 ? -3 : 3)} y={Y1 + 4} textAnchor={x(writeT) > X1 - 70 ? "end" : "start"} className="fig-label pwmp-halo">write {s.cmpaNext}</text>
          </g>
        )}
        {r.syncs.filter(inView).slice(0, 20).map((t, i) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={Y1 - 4} y2={Y0} stroke="var(--info)" strokeWidth="1" strokeDasharray="3 2" />
            {i === 0 && <text x={x(t) + (x(t) > X1 - 30 ? -3 : 3)} y={Y0 - 3} textAnchor={x(t) > X1 - 30 ? "end" : "start"} className="fig-label pwmp-halo" style={{ fill: "var(--info)" }}>sync</text>}
          </g>
        ))}
        {marks.map((m, i) => {
          const hot = m.moved[0] || m.moved[1];
          return <circle key={i} cx={x(m.t)} cy={y(m.ctr)} r={hot ? 2.7 : 1.6} fill={hot ? "var(--accent)" : "var(--inset)"} stroke={hot ? "none" : "var(--dim)"} strokeWidth="1" />;
        })}
        {markLabels.map((l) => (
          <text key={l.text} x={l.x + (l.end ? -5 : 6)} y={l.y} textAnchor={l.end ? "end" : "start"} className="fig-label dim pwmp-halo">{l.text}</text>
        ))}
        <path d={`M${X0 - 5},${y(s.tbprd) - 4} L${X0 + 3},${y(s.tbprd)} L${X0 - 5},${y(s.tbprd) + 4} Z`} fill="var(--info)" />
        <path d={`M${X0 - 5},${y(s.cmpb) - 4} L${X0 + 3},${y(s.cmpb)} L${X0 - 5},${y(s.cmpb) + 4} Z`} fill="var(--inset)" stroke="var(--value)" />
        <path d={`M${X0 - 5},${y(s.cmpa) - 4} L${X0 + 3},${y(s.cmpa)} L${X0 - 5},${y(s.cmpa) + 4} Z`} fill="var(--value)" />
        <rect x={X0 - 10} y={y(s.tbprd) - 6} width={X1 - X0 + 10} height="12" className="pwmp-grab" {...drag("tbprd")}><title>Drag to change TBPRD</title></rect>
        <rect x={X0 - 10} y={y(s.cmpb) - 6} width={X1 - X0 + 10} height="12" className="pwmp-grab" {...drag("cmpb")}><title>Drag to change CMPB</title></rect>
        <rect x={X0 - 10} y={y(s.cmpa) - 6} width={X1 - X0 + 10} height="12" className="pwmp-grab" {...drag("cmpa")}><title>Drag to change CMPA</title></rect>
        {/* outputs */}
        {rows.map((row, k) => (
          <g key={row.name}>
            <text x="4" y={row.top + row.h / 2 + 3} className={`fig-label${row.dim ? " dim" : ""}`}>{row.name}</text>
            <path d={traces[k].fill} fill="var(--accent-soft)" opacity={row.dim ? 0.6 : 1} />
            <path d={traces[k].d} className={row.dim ? "fig-trace dim" : "fig-trace"} style={row.dim ? undefined : { stroke: "var(--hi)" }} />
            {traces[k].shown.slice(0, 60).map((e) => (
              <rect key={e.t} x={x(e.t) - 4} y={row.top - 3} width="8" height={row.h + 6} className="pwmp-hit" onPointerEnter={() => setSel({ row: k, t: e.t })} onClick={() => setSel({ row: k, t: e.t })}>
                <title>{e.why}</title>
              </rect>
            ))}
          </g>
        ))}
        {/* triggers */}
        {trig.map((tr) => (
          <g key={tr.name}>
            <text x="4" y={tr.y + 8} className="fig-label">{tr.name}</text>
            <line x1={X0} x2={X1} y1={tr.y + 9} y2={tr.y + 9} stroke="var(--faint)" strokeWidth="1" />
            {tr.times.filter(inView).slice(0, 80).map((t) => (
              <path key={t} d={`M${x(t)},${tr.y + 9} V${tr.y + 1} M${x(t) - 2.5},${tr.y + 4} L${x(t)},${tr.y + 1} L${x(t) + 2.5},${tr.y + 4}`} fill="none" stroke="var(--value)" strokeWidth="1.5" />
            ))}
          </g>
        ))}
        {!trig.length && <text x="4" y={yy - 4} className="fig-label dim">no trigger enabled</text>}
        {/* the picked edge */}
        {picked && (
          <g pointerEvents="none">
            <line x1={x(picked.e.t)} x2={x(picked.e.t)} y1={Y1 - 4} y2={rows[picked.row].top + rows[picked.row].h} className="fig-sample" />
            <rect
              x={x(picked.e.t) > (X0 + X1) / 2 ? x(picked.e.t) - 6 - picked.e.why.length * 5.4 : x(picked.e.t) + 2}
              y={rows[picked.row].top - 11}
              width={picked.e.why.length * 5.4 + 4}
              height="11"
              rx="2"
              fill="var(--inset)"
              opacity="0.92"
            />
            <text
              x={x(picked.e.t) + (x(picked.e.t) > (X0 + X1) / 2 ? -5 : 5)}
              y={rows[picked.row].top - 2}
              textAnchor={x(picked.e.t) > (X0 + X1) / 2 ? "end" : "start"}
              className="fig-label pwmp-halo"
              style={{ fontWeight: 700 }}
            >
              {picked.e.why}
            </text>
          </g>
        )}
        {axis.map(({ f, t }) => (
          <text key={f} x={X0 + f * (X1 - X0)} y={axisY} textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"} className="fig-label dim">{t === 0 ? "0" : fmtTime(t * r.tickNs)}</text>
        ))}
      </svg>
      <div className="pwmp-edge">
        <button className="fig-opt" onClick={() => step(-1)} disabled={!allEdges.length} aria-label="Previous edge">◀ edge</button>
        <button className="fig-opt" onClick={() => step(1)} disabled={!allEdges.length} aria-label="Next edge">edge ▶</button>
        <span aria-live="polite">
          {picked
            ? <>{rows[picked.row].full} goes {picked.e.level ? "high" : "low"} at {fmtTime(picked.e.t * r.tickNs) || "0"}: <b>{picked.e.why}</b></>
            : allEdges.length ? "Point at an edge of a pin, or step through the edges, to see what caused it." : "No pin changes in this view."}
        </span>
      </div>
      <div className="pwmp-read">
        <div>TBCLK<b>{fmtHz(r.tbclkHz)}</b>{fmtTime(r.tickNs)} per count</div>
        <div>Period<b>{len ? fmtTime(r.periodNs) : "none"}</b>{!len ? "counter stopped" : s.ctrmode === 2 ? `2 x ${s.tbprd} counts` : `(${s.tbprd} + 1) counts`}</div>
        <div>Frequency<b>{fmtHz(r.freqHz)}</b>of the counter</div>
        <div>Duty {A}<b>{duty(r.statOutA)}</b>{r.statOutA.switching ? `at ${fmtHz(r.statOutA.freqHz)}` : "does not switch"}</div>
        <div>Duty {B}<b>{duty(r.statOutB)}</b>{r.statOutB.switching ? `at ${fmtHz(r.statOutB.freqHz)}` : "does not switch"}</div>
        <div>Resolution<b>{len ? fmtPct(r.resolutionPct / 100) : "none"}</b>{len ? `one count: ${r.resolutionBits.toFixed(1)} bits` : "counter stopped"}</div>
        <div>Dead time<b>{db ? `${fmtTime(r.redNs)} / ${fmtTime(r.fedNs)}` : "off"}</b>{db ? "rising / falling edge" : "DBCTL.OUT_MODE = 0"}</div>
        <div>Trigger rate<b>{rates[0] ?? "off"}</b>{rates.length > 1 ? rates.slice(1).join(", ") : rates.length ? "pulses per second" : "nothing enabled"}</div>
      </div>
      <p className="fig-why" role="status">{words.why.join(" ")}</p>

      <div className="pwmp-presets" role="group" aria-label="Presets">
        <span>Start from</span>
        {PRESETS.map((p) => (
          <button key={p.id} className="fig-opt" aria-pressed={active?.id === p.id} onClick={() => load(p.id)}>{p.name}</button>
        ))}
      </div>
      <p className="pwmp-about">{active ? `${active.about} Code is printed for EPWM${mod}.` : `Your own settings, printed for EPWM${mod}.`}</p>
      <div className="fig-controls">
        <div>
          <span>View</span>
          <button className="fig-opt" onClick={() => setZoom(Math.max(0, z - 1))} disabled={z === 0} aria-label="Zoom in: show less time">+</button>
          <button className="fig-opt" onClick={() => setZoom(Math.min(ZOOMS.length - 1, z + 1))} disabled={z === ZOOMS.length - 1} aria-label="Zoom out: show more time">−</button>
          <span className="unit">{ZOOMS[z]} {ZOOMS[z] === 1 ? "period" : "periods"}, from</span>
          <input type="range" min={0} max={48} value={pan} aria-label="Start of the view, in eighths of a period" onChange={(e) => setPan(+e.target.value)} />
          <span className="unit">{fmtTime(tStart * r.tickNs)}</span>
        </div>
      </div>

      <Group id="clock" title="Clock and period" reg="TBCTL, TBPRD" open={!!open.clock} toggle={toggle}>
        <div className="fig-controls">
          <div>
            <span>Count</span>
            {["up", "down", "up-down", "freeze"].map((m, i) => (
              <button key={m} className="fig-opt" aria-pressed={s.ctrmode === i} onClick={() => patch({ ctrmode: i })}>{m}</button>
            ))}
            <code>TBCTL.bit.CTRMODE = {s.ctrmode};</code>
          </div>
          <div>
            <span>Period</span>
            <input type="range" min={0} max={65535} value={s.tbprd} aria-label="TBPRD, the period register" onChange={(e) => patch({ tbprd: +e.target.value })} />
            {num("TBPRD as a number", s.tbprd, 65535, (v) => patch({ tbprd: v }))}
            <code>TBPRD = {s.tbprd};</code>
          </div>
          <div>
            <span>Dividers</span>
            {pick("CLKDIV, the clock divider", s.clkdiv, [0, 1, 2, 3, 4, 5, 6, 7].map((c) => `CLKDIV ${c}: /${1 << c}`), (v) => patch({ clkdiv: v }))}
            {pick("HSPCLKDIV, the high-speed clock divider", s.hspclkdiv, HSPCLKDIV.map((d, c) => `HSPCLKDIV ${c}: /${d}`), (v) => patch({ hspclkdiv: v }))}
            <code>100 MHz / ({HSPCLKDIV[s.hspclkdiv]} x {1 << s.clkdiv}) = {fmtHz(r.tbclkHz)}</code>
          </div>
          <div>
            <span>Or ask for</span>
            <input type="number" min={1} value={target} aria-label="Wanted frequency in hertz" onChange={(e) => setTarget(e.target.value)} />
            <span className="unit">Hz</span>
            <button
              className="fig-opt"
              onClick={() => {
                const mode = s.ctrmode === 3 ? 0 : s.ctrmode;
                const p = propose(+target, mode);
                patch({ ctrmode: mode, hspclkdiv: p.hspclkdiv, clkdiv: p.clkdiv, tbprd: p.tbprd });
                setProposal(`${p.hspclkdiv !== s.hspclkdiv ? `HSPCLKDIV = ${p.hspclkdiv}, ` : ""}CLKDIV = ${p.clkdiv}, TBPRD = ${p.tbprd}: ${fmtHz(p.actualHz)}`);
              }}
            >
              Propose TBPRD and CLKDIV
            </button>
            {proposal && <span className="unit" role="status">{proposal}</span>}
          </div>
        </div>
      </Group>

      <Group id="compare" title="Compare" reg="CMPA, CMPB, CMPCTL" open={!!open.compare} toggle={toggle}>
        <div className="fig-controls">
          {compare("CMPA", "cmpa")}
          {compare("CMPB", "cmpb")}
          <div>
            <span>While running</span>
            <button className="fig-opt" aria-pressed={s.cmpaNext !== null} onClick={() => patch(s.cmpaNext === null ? { cmpaNext: Math.round(s.tbprd * 0.75), cmpaWriteAt: Math.round(unit * 0.5) } : { cmpaNext: null })}>write a new CMPA</button>
            {s.cmpaNext !== null && (
              <>
                {num("The new CMPA value", s.cmpaNext, 65535, (v) => patch({ cmpaNext: v }))}
                {when("When the new CMPA is written", s.cmpaWriteAt, (v) => patch({ cmpaWriteAt: v }))}
              </>
            )}
          </div>
          {s.cmpaNext !== null && (
            <div>
              <span>It is loaded</span>
              {pick("LOADAMODE: when the shadow value becomes active", s.loadamode, ["0: when the counter is 0", "1: when the counter equals TBPRD", "2: at 0 and at TBPRD", "3: never"], (v) => patch({ loadamode: v }))}
              <button className="fig-opt" aria-pressed={s.shdwamode === 1} onClick={() => patch({ shdwamode: s.shdwamode ? 0 : 1 })}>at once, no shadow</button>
              <code>CMPCTL.bit.LOADAMODE = {s.loadamode}; CMPCTL.bit.SHDWAMODE = {s.shdwamode};</code>
            </div>
          )}
        </div>
      </Group>

      <Group id="actions" title="What each event does" reg="AQCTLA, AQCTLB" open={!!open.actions} toggle={toggle}>
        <div className="pwmp-aq" role="group" aria-label="Action of each event on each output">
          <span />
          {EVENTS.map((e) => <span key={e} className="h" title={EVENT_HEAD[e]}>{e}</span>)}
          {aqRow("AQCTLA", "aqa", A)}
          {aqRow("AQCTLB", "aqb", B)}
        </div>
        <p className="pwmp-note">
          Press a cell to step through none (0), clear (1), set (2) and toggle (3). ZRO: counter = 0. PRD: counter = TBPRD. CAU, CAD: counter = CMPA going up, going down. CBU, CBD: the same for CMPB.
          {r.never.length > 0 && r.never.length < 6 ? ` Dashed cells: ${r.never.join(", ")} never ${r.never.length > 1 ? "happen" : "happens"} with these settings.` : ""}
        </p>
      </Group>

      <Group id="dead" title="Dead band" reg="DBCTL, DBRED, DBFED" open={!!open.dead} toggle={toggle}>
        <div className="fig-controls">
          <div>
            <span>Delays</span>
            {pick("OUT_MODE: which delays are used", s.dbOutMode, ["0: off, both pass through", "1: falling-edge delay on B", "2: rising-edge delay on A", "3: both delays"], (v) => patch({ dbOutMode: v }))}
            <code>DBCTL.bit.OUT_MODE = {s.dbOutMode};</code>
          </div>
          <div>
            <span>Polarity</span>
            {pick("POLSEL: which delayed signal is inverted", s.dbPolsel, ["0: none inverted (active high)", "1: A inverted (active low complementary)", "2: B inverted (active high complementary)", "3: both inverted (active low)"], (v) => patch({ dbPolsel: v }))}
            <code>DBCTL.bit.POLSEL = {s.dbPolsel};</code>
          </div>
          <div>
            <span>Inputs</span>
            {pick("IN_MODE: which signal feeds each delay", s.dbInMode, ["0: A feeds both delays", "1: B feeds the rising-edge delay", "2: B feeds the falling-edge delay", "3: B feeds both delays"], (v) => patch({ dbInMode: v }))}
            <code>DBCTL.bit.IN_MODE = {s.dbInMode};</code>
          </div>
          {([["Rising", "DBRED", "dbred"], ["Falling", "DBFED", "dbfed"]] as const).map(([word, reg, key]) => (
            <div key={reg}>
              <span>{word} edge</span>
              <input type="range" min={0} max={Math.max(200, Math.min(16383, Math.round(unit / 2)))} value={s[key]} aria-label={`${reg}: ${word.toLowerCase()}-edge delay in counts`} onChange={(e) => patch({ [key]: +e.target.value })} />
              {num(`${reg} in counts`, s[key], 16383, (v) => patch({ [key]: v }))}
              <span className="unit">counts = {fmtTime(s[key] * r.tickNs) || "0"}</span>
              <code>{reg}.bit.{reg} = {s[key]};</code>
            </div>
          ))}
        </div>
        {!db && <p className="pwmp-note">While OUT_MODE is 0 the other fields have no effect.</p>}
      </Group>

      <Group id="trig" title="Triggers and interrupt" reg="ETSEL, ETPS" open={!!open.trig} toggle={toggle}>
        <div className="fig-controls">
          {trigRow("SOCA", "socaen", "socasel", "socaprd")}
          {trigRow("SOCB", "socben", "socbsel", "socbprd")}
          {trigRow("INT", "inten", "intsel", "intprd")}
        </div>
        <p className="pwmp-note">SOCA and SOCB are the pulses that can start an ADC conversion. The interrupt is drawn as if the interrupt function clears its flag every time (ETCLR.bit.INT = 1).</p>
      </Group>

      <Group id="phase" title="Phase and sync" reg="TBCTL.PHSEN, TBPHS" open={!!open.phase} toggle={toggle}>
        <div className="fig-controls">
          <div>
            <span>Sync pulse</span>
            {(["none", "once", "every"] as const).map((k) => (
              <button key={k} className="fig-opt" aria-pressed={s.sync === k} onClick={() => patch({ sync: k, syncAt: s.syncAt || Math.round(unit * 0.4) })}>{k === "none" ? "none" : k === "once" ? "one pulse" : "every master period"}</button>
            ))}
            {s.sync === "once" && when("When the sync pulse arrives", s.syncAt, (v) => patch({ syncAt: v }))}
          </div>
          <div>
            <span>Load phase</span>
            <button className="fig-opt" aria-pressed={s.phsen} aria-label="PHSEN: load TBPHS into the counter on a sync pulse" onClick={() => patch({ phsen: !s.phsen })}>{s.phsen ? "on" : "off"}</button>
            <code>TBCTL.bit.PHSEN = {s.phsen ? 1 : 0};</code>
          </div>
          <div>
            <span>TBPHS</span>
            <input type="range" min={0} max={Math.max(1, s.tbprd)} value={Math.min(s.tbphs, s.tbprd)} aria-label="TBPHS, the value loaded into the counter" onChange={(e) => patch({ tbphs: +e.target.value })} />
            {num("TBPHS as a number", s.tbphs, 65535, (v) => patch({ tbphs: v }))}
            <code>TBPHS.bit.TBPHS = {s.tbphs};</code>
          </div>
          {s.ctrmode === 2 && (
            <div>
              <span>Then count</span>
              <button className="fig-opt" aria-pressed={s.phsdir === 0} onClick={() => patch({ phsdir: 0 })}>down</button>
              <button className="fig-opt" aria-pressed={s.phsdir === 1} onClick={() => patch({ phsdir: 1 })}>up</button>
              <code>TBCTL.bit.PHSDIR = {s.phsdir};</code>
            </div>
          )}
        </div>
        <p className="pwmp-note">A sync pulse comes from the module before this one in the chain (EPWM1 for EPWM2), usually when its counter is 0. "Every master period" is a master with the same period as this module.</p>
      </Group>

      <div className="pwmp-codebox">
        <div>
          <span>C lines for these settings (EPWM{mod}A on GPIO{pwmPin(mod, 0).pin}, EPWM{mod}B on GPIO{pwmPin(mod, 1).pin})</span>
          <button className="fig-opt" onClick={copy} disabled={!lines.length}>{copied ? "Copied" : "Copy"}</button>
        </div>
        <pre tabIndex={0} aria-label="C code for the current settings"><code>{lines.length ? lines.join("\n") : "// Nothing to write: every register has its reset value."}{s.cmpaNext !== null ? `\n// later, while the counter runs:\nEPwm${mod}Regs.CMPA.bit.CMPA = ${s.cmpaNext};` : ""}</code></pre>
      </div>
      <figcaption>
        One ePWM module from reset, with every register written before the counter starts ({MODE_NAMES[s.ctrmode]} now). Drag the three dashed lines, or use the sliders and number boxes: every control shows the register field it sets. Dots on the counter are events, and a large orange dot moved a pin. The code lists only the fields that differ from their reset value. The game's simulator has no dead-band unit, so in code levels make dead time with CMPA and CMPB. For one idea at a time, see "PWM counter and pin".
      </figcaption>
    </figure>
  );
}

export const figure = {
  id: "pwm-playground",
  title: "ePWM playground",
  description: "Set every part of one PWM module, from clock and period to both outputs, dead time and triggers, and watch the counter, the two pins and the trigger pulses on one time axis, with the C code for it.",
  Component: PwmPlayground,
};
