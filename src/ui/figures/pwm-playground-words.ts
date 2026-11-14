// The words of the ePWM playground: the sentence that reacts, the label of
// the drawing and number formats. Pure functions of the model's result
// (pwm-model.ts), so the figure file holds only the picture and the controls.
import { ET_SEL_NAMES, EVENTS, RESET, type Aq, type Ev, type OutStat, type PwmResult, type PwmSettings, type Signal } from "./pwm-model";

const trim = (x: string) => (x.includes(".") ? x.replace(/\.?0+$/, "") : x);
const group = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+$)/g, " ");

export function fmtHz(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 0) return "0 Hz";
  if (hz >= 1e6) return `${trim((hz / 1e6).toPrecision(4))} MHz`;
  if (hz >= 1e4) return `${trim((hz / 1e3).toPrecision(4))} kHz`;
  if (hz >= 100) return `${group(hz)} Hz`;
  return `${trim(hz.toPrecision(4))} Hz`;
}

export function fmtTime(ns: number): string {
  if (!Number.isFinite(ns) || ns === 0) return "0";
  const a = Math.abs(ns);
  if (a >= 1e9) return `${trim((ns / 1e9).toPrecision(4))} s`;
  if (a >= 1e6) return `${trim((ns / 1e6).toPrecision(4))} ms`;
  if (a >= 1e3) return `${trim((ns / 1e3).toPrecision(4))} µs`;
  return `${trim(ns.toPrecision(4))} ns`;
}

export function fmtPct(fraction: number): string {
  const p = fraction * 100;
  return `${trim(p.toFixed(p < 1 && p > 0 ? 3 : 2))} %`;
}

export const MODE_NAMES = ["up count", "down count", "up-down count", "freeze"];
const DOES = ["", "goes low", "goes high", "toggles"];
const EVERY = ["never", "every time", "every second time", "every third time"];
const EVENT_WORDS: Record<Ev, string> = {
  ZRO: "the counter is 0", PRD: "the counter equals TBPRD", CAU: "the counter passes CMPA going up", CAD: "the counter passes CMPA going down",
  CBU: "the counter passes CMPB going up", CBD: "the counter passes CMPB going down",
};
export const eventWords = (e: Ev) => EVENT_WORDS[e];

function whyNever(e: Ev, s: PwmSettings): string {
  if (s.ctrmode === 0 && (e === "CAD" || e === "CBD")) return "the counter never counts down in up count";
  if (s.ctrmode === 1 && (e === "CAU" || e === "CBU")) return "the counter never counts up in down count";
  const reg = e[1] === "A" ? "CMPA" : "CMPB";
  return `${reg} = ${reg === "CMPA" ? s.cmpa : s.cmpb} is above TBPRD = ${s.tbprd}, and the counter turns back before it gets there`;
}

function output(name: string, reg: string, aq: Aq, st: OutStat, o: 0 | 1, s: PwmSettings, r: PwmResult): string[] {
  const out: string[] = [];
  const acting = EVENTS.filter((e) => aq[e]);
  const dead = acting.filter((e) => r.never.includes(e));
  const clashes = r.clashes.filter((c) => c.out === (o ? "B" : "A"));
  const moves = r.cycle.filter((m) => m.moved[o]);
  if (!st.switching) {
    out.push(`${name} stays ${st.level ? "high: 100 %" : "low: 0 %"}.`);
    if (clashes.length) {
      const c = clashes[0];
      out.push(`${c.win} and ${c.beat.join(" and ")} fall on the same count (${c.ctr}). ${c.win} has priority there, so the pin ${DOES[c.action]} and the ${c.beat.join(" and ")} action is lost.`);
    }
    else if (dead.length) out.push(`${dead.join(" and ")} ${dead.length > 1 ? "have" : "has"} an action but never ${dead.length > 1 ? "happen" : "happens"}: ${whyNever(dead[0], s)}.`);
    else {
      const live = acting.filter((e) => !r.never.includes(e));
      const kinds = new Set(live.map((e) => aq[e]));
      if (kinds.size === 1 && !kinds.has(3)) out.push(`Every event with an action in ${reg} ${kinds.has(2) ? "sets" : "clears"} the pin, and nothing moves it back.`);
    }
    return out;
  }
  const half = Math.abs(st.freqHz - r.freqHz / 2) < r.freqHz * 1e-9;
  const w = (m: (typeof moves)[number]) => (o ? m.b : m.a)!;
  if (half) {
    out.push(`${name} toggles at ${w(moves[0]).ev}, once per counter period, so one high and one low take two periods: ${fmtHz(st.freqHz)}, half the counter's ${fmtHz(r.freqHz)}, at ${fmtPct(st.duty)}.`);
  }
  else if (moves.length === 2) {
    const rise = moves.find((m) => m.level[o] === 1) ?? moves[0];
    const fall = moves.find((m) => m !== rise) ?? moves[1];
    const high = Math.round(st.duty * r.cycleTicks);
    out.push(`${name} goes high at ${w(rise).ev} (count ${rise.ctr}) and low at ${w(fall).ev} (count ${fall.ctr}): high for ${high} of the ${r.cycleTicks} counts in a period, ${fmtPct(st.duty)}.`);
    if (s.ctrmode === 2 && ((w(rise).ev === "CAU" && w(fall).ev === "CAD") || (w(rise).ev === "CBU" && w(fall).ev === "CBD"))) out.push("The pulse sits around the peak of the triangle, centred in the period.");
    if (s.ctrmode === 2 && ((w(rise).ev === "CAD" && w(fall).ev === "CAU") || (w(rise).ev === "CBD" && w(fall).ev === "CBU"))) out.push("The pulse sits around the valley of the triangle.");
  }
  else out.push(`${name} changes ${moves.length} times per period (${moves.map((m) => `${w(m).ev}: ${DOES[w(m).action]}`).join(", ")}): high ${fmtPct(st.duty)} of the time.`);
  for (const c of clashes) out.push(`At count ${c.ctr} ${c.win} has priority over ${c.beat.join(" and ")}.`);
  if (dead.length) out.push(`${dead.join(" and ")} never ${dead.length > 1 ? "happen" : "happens"} here: ${whyNever(dead[0], s)}.`);
  return out;
}

/** Is t the middle of a high pulse of x? */
function midPulse(x: Signal, t: number): boolean {
  const e = x.edges;
  for (let k = 0; k + 1 < e.length; k++) if (e[k].level === 1 && e[k].t < t && e[k + 1].t > t) return Math.abs((e[k].t + e[k + 1].t) / 2 - t) <= 1;
  return false;
}

/** The sentences under the drawing and the drawing's aria-label. */
export function describe(s: PwmSettings, r: PwmResult, n: number): { why: string[]; label: string } {
  const A = `EPWM${n}A`;
  const B = `EPWM${n}B`;
  const why: string[] = [];
  if (r.stopped === "frozen") {
    const reset = JSON.stringify(s) === JSON.stringify(RESET);
    why.push(
      reset
        ? "This is the module after reset. TBCTL.CTRMODE is 3, freeze: the counter stands still at 0, so no event ever happens. TBPRD is 0 and both action registers are 0 as well. Nothing moves until you choose a count mode, a period and at least one action."
        : "CTRMODE = 3 freezes the counter. No event happens, so both pins keep their level. Choose up, down or up-down to start it.",
    );
    return { why, label: `Counter frozen. ${A} and ${B} stay low.` };
  }
  if (r.stopped === "tbprd0") {
    why.push("TBPRD = 0: the counter has nowhere to count to, so nothing is drawn. Give it a period. (The course writes TBPRD = 0 to switch the buzzer off.)");
    return { why, label: `TBPRD is 0. ${A} and ${B} stay low.` };
  }
  const hasA = EVENTS.some((e) => s.aqa[e]);
  const hasB = EVENTS.some((e) => s.aqb[e]);
  if (!hasA && !hasB) why.push(`The counter runs at ${fmtHz(r.freqHz)}, but AQCTLA and AQCTLB are 0: no event does anything to a pin, so both stay low.`);
  if (hasA) why.push(...output(A, "AQCTLA", s.aqa, r.statA, 0, s, r));
  if (hasB) why.push(...output(B, "AQCTLB", s.aqb, r.statB, 1, s, r));
  else if (hasA && !(s.dbOutMode & 1)) why.push(`${B} has no action in AQCTLB and stays low.`);

  const used = (reg: "A" | "B") =>
    EVENTS.some((e) => e[1] === reg && (s.aqa[e] || s.aqb[e])) || [s.socaen && s.socasel, s.socben && s.socbsel, s.inten && s.intsel].some((x) => (reg === "A" ? x === 4 || x === 5 : x === 6 || x === 7));
  if (s.ctrmode !== 0) for (const reg of r.above) if (used(reg[3] as "A" | "B")) why.push(`${reg} is above TBPRD, so its events happen at the period count instead.`);

  if (s.dbOutMode) {
    const red = `${s.dbred} counts (${fmtTime(s.dbred * r.tickNs)})`;
    const fed = `${s.dbfed} counts (${fmtTime(s.dbfed * r.tickNs)})`;
    if (s.dbOutMode === 3 && s.dbPolsel === 2 && s.dbInMode === 0)
      why.push(`Dead band, active high complementary: the pin ${A} is the signal above with each rising edge ${red} late. The pin ${B} is its inverse, and rises ${fed} after it falls. In those gaps both pins are low, so the two transistors never conduct together.`);
    else {
      const pa = s.dbOutMode & 2 ? `the pin ${A} is ${s.dbInMode & 1 ? "B" : "A"} with each rising edge ${red} late${s.dbPolsel & 1 ? ", then inverted" : ""}` : `the pin ${A} is passed through`;
      const pb = s.dbOutMode & 1 ? `the pin ${B} is ${s.dbInMode & 2 ? "B" : "A"} with each falling edge ${fed} late${s.dbPolsel & 2 ? ", then inverted" : ""}` : `the pin ${B} is passed through`;
      why.push(`Dead band: ${pa}; ${pb}.`);
    }
    const src = (bit: number) => (s.dbInMode & bit ? r.statB : r.statA);
    if (s.dbOutMode & 2 && src(1).switching && !r.statOutA.switching) why.push(`The pulse is shorter than the rising-edge delay, so it never reaches the pin ${A}.`);
    if (s.dbOutMode & 1 && src(2).switching && !r.statOutB.switching) why.push(`The gap is shorter than the falling-edge delay, so the pin ${B} never changes.`);
  }

  for (const [x, en, sel, every, hz, times] of [
    ["SOCA", s.socaen, s.socasel, s.socaprd, r.socaHz, r.soca], ["SOCB", s.socben, s.socbsel, s.socbprd, r.socbHz, r.socb], ["INT", s.inten, s.intsel, s.intprd, r.intHz, r.int],
  ] as [string, boolean, number, number, number, number[]][]) {
    if (!en) continue;
    const what = x === "INT" ? "The interrupt" : `The ${x} pulse`;
    if (!every) why.push(`${what} is enabled, but ${x}PRD = 0 passes no event: nothing is sent.`);
    else if (!sel) why.push(`${x}SEL = 0 does not select a counter event, so ${what.toLowerCase()} never comes here.`);
    else if (!hz) {
      const ev = ["CAU", "CAD", "CBU", "CBD"].includes(ET_SEL_NAMES[sel]) ? (ET_SEL_NAMES[sel] as Ev) : null;
      why.push(ev ? `${what} waits for ${ev}, which never happens here: ${whyNever(ev, s)}.` : `${what} waits for ${ET_SEL_NAMES[sel]}, which never happens in ${MODE_NAMES[s.ctrmode]}.`);
    }
    else {
      const mid = times.length > 0 && sel === 2 && s.ctrmode === 2 && midPulse(r.a, times[times.length - 1]);
      why.push(`${what} comes at ${ET_SEL_NAMES[sel]}, ${EVERY[every]}: ${fmtHz(hz)}.${mid ? ` That is the middle of ${A}'s pulse.` : ""}`);
    }
  }

  if (s.sync !== "none") {
    if (!s.phsen) why.push("A sync pulse arrives, but PHSEN = 0, so the counter ignores it.");
    else {
      const dir = s.ctrmode === 2 ? `, counting ${s.phsdir ? "up" : "down"} from there` : "";
      why.push(`${s.sync === "every" ? "Each sync pulse" : "The sync pulse"} loads the counter with TBPHS = ${Math.min(s.tbphs, s.tbprd)}${dir}.${s.sync === "every" ? " With a master of the same period, that is a constant shift against the master." : ""}`);
    }
  }
  if (s.cmpaNext !== null) {
    const at = fmtTime(s.cmpaWriteAt * r.tickNs);
    if (s.shdwamode) why.push(`CMPA = ${s.cmpaNext} is written at ${at} with SHDWAMODE = 1: it takes effect at once, in the middle of a period.`);
    else if (s.loadamode === 3) why.push(`CMPA = ${s.cmpaNext} is written at ${at}, but LOADAMODE = 3 never copies the shadow register: the old value stays.`);
    else why.push(`CMPA = ${s.cmpaNext} is written at ${at}. It waits in the shadow register until ${["the counter is 0", "the counter equals TBPRD", "the counter is 0 or equals TBPRD"][s.loadamode]}, so the period in progress keeps the old value.`);
  }

  const pin = (name: string, st: OutStat) => `${name} ${st.switching ? `high ${fmtPct(st.duty).replace(" %", " percent")} of the time at ${fmtHz(st.freqHz)}` : `stays ${st.level ? "high" : "low"}`}`;
  const trig = [s.socaen && r.socaHz ? `SOCA ${fmtHz(r.socaHz)}` : "", s.socben && r.socbHz ? `SOCB ${fmtHz(r.socbHz)}` : "", s.inten && r.intHz ? `interrupt ${fmtHz(r.intHz)}` : ""].filter(Boolean);
  const label = `${MODE_NAMES[s.ctrmode]}, TBPRD ${s.tbprd}, CMPA ${s.cmpa}, CMPB ${s.cmpb}: counter period ${fmtTime(r.periodNs)}. ${pin(A, r.statOutA)}. ${pin(B, r.statOutB)}.${s.dbOutMode ? " Dead band on." : ""}${trig.length ? ` Triggers: ${trig.join(", ")}.` : ""}`;
  return { why, label: label[0].toUpperCase() + label.slice(1) };
}
