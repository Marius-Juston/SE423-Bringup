// A pure model of one ePWM module, for the "ePWM playground" figure and its
// tests. No React here. Everything follows the Technical Reference Manual
// (SPRUHM8I) chapter 15; where the text leaves a case open, the game's
// simulator (src/sim/plugins/epwm.ts) is followed, and that is said below.
//
// Time base (15.4, TBCTL in 15.15.2.1)
//   TBCLK = EPWMCLK / (HSPCLKDIV x CLKDIV). EPWMCLK is 100 MHz in the course
//   (SYSCLK 200 MHz, EPWMCLKDIV /2). HSPCLKDIV: /1 /2 /4 /6 ... /14, /2 after
//   reset. CLKDIV: /1 ... /128. CTRMODE 0 up, 1 down, 2 up-down, 3 freeze
//   (reset). Period, Figure 15-6:
//     up or down count:  TPWM = (TBPRD + 1) x TTBCLK
//     up-down count:     TPWM = 2 x TBPRD x TTBCLK
// Counter compare (15.5.3) and action qualifier (15.6)
//   Events ZRO, PRD, CAU, CAD, CBU, CBD; actions 0 nothing, 1 clear, 2 set,
//   3 toggle (AQCTLA / AQCTLB, 15.15.2.23). Table 15-7: in up count a compare
//   value above TBPRD never matches and the down events never occur; in down
//   count the up events never occur and a value at or above TBPRD matches at
//   the period count; in up-down count a value at or above TBPRD matches at
//   the period count, for both directions. Priorities when events share a
//   count: Tables 15-4 (up-down), 15-5 (up), 15-6 (down). An event whose
//   action is "do nothing (action disabled)" leaves the count to the next
//   one. In up-down count the zero count is taken as incrementing and the
//   period count as decrementing: that is what reproduces Figure 15-24
//   (CAU = set, CAD = clear: CMPA = TBPRD is 0 %, CMPA = 0 is 100 %). The
//   sentence under that figure says the opposite; the figure and Table 15-4
//   agree with each other, so they are followed.
// Shadow registers (15.5.3, CMPCTL in 15.15.2.5)
//   CMPA is written to its shadow register (SHDWAMODE = 0, reset) and copied
//   to the active register at CTR = 0 (LOADAMODE = 0, reset), CTR = PRD (1),
//   either (2) or never (3); with SHDWAMODE = 1 a write goes straight to the
//   active register. As in the simulator, a load at the first count of a
//   cycle (and at the period count in up-down mode) already applies to the
//   events of that count; a load at the last count of a sawtooth applies
//   from the next cycle.
// Phase and sync (15.4.3.3)
//   With TBCTL.PHSEN = 1 a sync pulse loads TBCTR with TBPHS; in up-down mode
//   TBCTL.PHSDIR gives the direction afterwards (1 = up). The one TBCLK the
//   real load takes is not modelled, and TBPHS is limited to TBPRD.
// Dead band (15.7.3, Figure 15-33, DBCTL in 15.15.2.7)
//   IN_MODE bit 4 (S4) picks the input of the rising-edge delay, bit 5 (S5)
//   that of the falling-edge delay (0 = EPWMxA, 1 = EPWMxB from the action
//   qualifier). POLSEL bit 2 (S2) inverts the rising-edge-delayed signal,
//   bit 3 (S3) the falling-edge-delayed one. OUT_MODE bit 1 (S1) puts the
//   rising-edge-delayed signal on output A, bit 0 (S0) the falling-edge-
//   delayed one on output B; a 0 bit passes the input through. RED = DBRED x
//   TTBCLK, FED = DBFED x TTBCLK. OUTSWAP, DEDB_MODE and HALFCYCLE stay 0.
//   A pulse shorter than its delay disappears (the delay is restarted by
//   every edge).
// Event trigger (15.10, ETSEL 15.15.2.56, ETPS 15.15.2.57)
//   SOCASEL / SOCBSEL / INTSEL: 1 ZRO, 2 PRD, 3 ZRO or PRD, 4 CAU, 5 CAD,
//   6 CBU, 7 CBD (0 is a digital-compare event, or reserved for INTSEL: not
//   modelled, never fires). SOCAPRD / SOCBPRD / INTPRD: 0 no pulse, 1 every
//   event, 2 every second, 3 every third. The interrupt is drawn as if the
//   interrupt function clears ETFLG.INT every time.
// Resolution (15.14, above Table 15-13): one clock period out of the PWM
//   period, in percent, and log2(TPWM / Tclock) in bits; here with TBCLK.
// TBPRD = 0 is treated as "nothing moves", as the simulator does.

export const EPWMCLK_HZ = 100_000_000;
/** Divider selected by TBCTL.HSPCLKDIV. */
export const HSPCLKDIV = [1, 2, 4, 6, 8, 10, 12, 14];

export const EVENTS = ["ZRO", "PRD", "CAU", "CAD", "CBU", "CBD"] as const;
export type Ev = (typeof EVENTS)[number];
/** 0 nothing, 1 clear, 2 set, 3 toggle. */
export type Action = 0 | 1 | 2 | 3;
export const ACTIONS = ["none", "clear", "set", "toggle"] as const;
export type Aq = Record<Ev, Action>;
export type Level = 0 | 1;

export interface PwmSettings {
  /** TBCTL.HSPCLKDIV, the 3-bit code (1 after reset: divide by 2). */
  hspclkdiv: number;
  /** TBCTL.CLKDIV, the 3-bit code: divide by 2 to the power of it. */
  clkdiv: number;
  /** TBCTL.CTRMODE: 0 up, 1 down, 2 up-down, 3 freeze. */
  ctrmode: number;
  tbprd: number;
  cmpa: number;
  cmpb: number;
  aqa: Aq;
  aqb: Aq;
  /** TBCTL.PHSEN. */
  phsen: boolean;
  tbphs: number;
  /** TBCTL.PHSDIR: 1 = count up after a sync (up-down mode only). */
  phsdir: number;
  /** Sync pulses on EPWMxSYNCI: none, one at `syncAt`, or one at the start of every period of a master with the same period. */
  sync: "none" | "once" | "every";
  /** Time of the single sync pulse, in TBCLK counts from the start. */
  syncAt: number;
  /** DBCTL fields. */
  dbOutMode: number;
  dbPolsel: number;
  dbInMode: number;
  dbred: number;
  dbfed: number;
  /** ETSEL / ETPS fields. */
  socaen: boolean;
  socasel: number;
  socaprd: number;
  socben: boolean;
  socbsel: number;
  socbprd: number;
  inten: boolean;
  intsel: number;
  intprd: number;
  /** A write to CMPA while the counter runs: the new value, or null for none. */
  cmpaNext: number | null;
  /** When that write happens, in TBCLK counts from the start. */
  cmpaWriteAt: number;
  /** CMPCTL.SHDWAMODE: 0 shadow, 1 immediate. */
  shdwamode: number;
  /** CMPCTL.LOADAMODE: 0 at zero, 1 at period, 2 either, 3 never. */
  loadamode: number;
}

export const NO_ACTIONS: Aq = { ZRO: 0, PRD: 0, CAU: 0, CAD: 0, CBU: 0, CBD: 0 };

/** The register values after reset (15.15.2: TBCTL = 0x0083, everything else 0). */
export const RESET: PwmSettings = {
  hspclkdiv: 1, clkdiv: 0, ctrmode: 3, tbprd: 0, cmpa: 0, cmpb: 0, aqa: NO_ACTIONS, aqb: NO_ACTIONS,
  phsen: false, tbphs: 0, phsdir: 0, sync: "none", syncAt: 0,
  dbOutMode: 0, dbPolsel: 0, dbInMode: 0, dbred: 0, dbfed: 0,
  socaen: false, socasel: 0, socaprd: 0, socben: false, socbsel: 0, socbprd: 0, inten: false, intsel: 0, intprd: 0,
  cmpaNext: null, cmpaWriteAt: 0, shdwamode: 0, loadamode: 0,
};

export interface Edge {
  /** Time, in TBCLK counts from the start. */
  t: number;
  level: Level;
  /** What caused it, in the words of the registers: "CAU: clear". */
  why: string;
}

export interface Signal {
  /** Level before the first edge. */
  init: Level;
  edges: Edge[];
}

export interface Winner {
  ev: Ev;
  action: Action;
  /** Events at the same count whose action lost to this one. */
  beat: Ev[];
}

export interface Mark {
  t: number;
  /** Counter value at the event. */
  ctr: number;
  evs: Ev[];
  /** The action taken on EPWMxA / EPWMxB at this count, if any. */
  a: Winner | null;
  b: Winner | null;
  /** The pin changed level here. */
  moved: [boolean, boolean];
  /** Levels of EPWMxA and EPWMxB after the event. */
  level: [Level, Level];
}

export interface OutStat {
  /** The output changes level in the steady state. */
  switching: boolean;
  /** Level it rests at when it does not switch. */
  level: Level;
  /** Fraction of time high, 0 to 1. */
  duty: number;
  /** Rising edges per second. */
  freqHz: number;
}

export interface PwmResult {
  tbclkHz: number;
  tickNs: number;
  /** Counts in one counter period (0 when the counter does not run). */
  cycleTicks: number;
  periodNs: number;
  /** Counter frequency, Hz (0 when it does not run). */
  freqHz: number;
  /** Why nothing moves, if so. */
  stopped: "frozen" | "tbprd0" | null;
  /** Counter as a line: corners (t in counts, value). */
  counter: { t: number; c: number }[];
  marks: Mark[];
  /** EPWMxA and EPWMxB as the action qualifier makes them. */
  a: Signal;
  b: Signal;
  /** The two outputs after the dead band (the pins). */
  outA: Signal;
  outB: Signal;
  soca: number[];
  socb: number[];
  int: number[];
  /** Sync pulses that arrived (whether or not PHSEN let them act). */
  syncs: number[];
  /** Moments the active CMPA changed. */
  loads: { t: number; cmpa: number }[];
  /** Steady-state numbers (no sync pulse, no CMPA write). */
  statA: OutStat;
  statB: OutStat;
  statOutA: OutStat;
  statOutB: OutStat;
  resolutionPct: number;
  resolutionBits: number;
  redNs: number;
  fedNs: number;
  socaHz: number;
  socbHz: number;
  intHz: number;
  /** Events that cannot occur with this count mode and these compare values. */
  never: Ev[];
  /** Compare registers above TBPRD. */
  above: ("CMPA" | "CMPB")[];
  /** Counts of one steady period at which an action beat another one. */
  clashes: { ctr: number; out: "A" | "B"; win: Ev; action: Action; beat: Ev[] }[];
  /** The actions of one steady period, in time order. */
  cycle: Mark[];
}

// Priority, highest first (Tables 15-5, 15-6, 15-4).
const PRIO_UP: Ev[] = ["PRD", "CBU", "CAU", "ZRO"];
const PRIO_DOWN: Ev[] = ["ZRO", "CBD", "CAD", "PRD"];
const PRIO_UPDOWN_AT_ZERO: Ev[] = ["CBU", "CAU", "ZRO", "CBD", "CAD"];
const PRIO_UPDOWN_AT_PERIOD: Ev[] = ["CBD", "CAD", "PRD", "CBU", "CAU"];
const PRIO_UPDOWN: Ev[] = ["CBU", "CAU", "CBD", "CAD", "ZRO", "PRD"];
/** Events selected by SOCASEL / SOCBSEL / INTSEL. */
const ET_SEL: Ev[][] = [[], ["ZRO"], ["PRD"], ["ZRO", "PRD"], ["CAU"], ["CAD"], ["CBU"], ["CBD"]];
export const ET_SEL_NAMES = ["DCxEVT1 (not drawn)", "ZRO", "PRD", "ZRO or PRD", "CAU", "CAD", "CBU", "CBD"];

const int = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : lo);

/** The settings with every field forced into its register's range. */
export function clean(s: PwmSettings): PwmSettings {
  const aq = (a: Aq): Aq => Object.fromEntries(EVENTS.map((e) => [e, int(a[e], 0, 3)])) as Aq;
  return {
    ...s,
    hspclkdiv: int(s.hspclkdiv, 0, 7), clkdiv: int(s.clkdiv, 0, 7), ctrmode: int(s.ctrmode, 0, 3),
    tbprd: int(s.tbprd, 0, 65535), cmpa: int(s.cmpa, 0, 65535), cmpb: int(s.cmpb, 0, 65535), aqa: aq(s.aqa), aqb: aq(s.aqb),
    tbphs: int(s.tbphs, 0, 65535), phsdir: int(s.phsdir, 0, 1), syncAt: int(s.syncAt, 0, 1e9),
    dbOutMode: int(s.dbOutMode, 0, 3), dbPolsel: int(s.dbPolsel, 0, 3), dbInMode: int(s.dbInMode, 0, 3),
    dbred: int(s.dbred, 0, 16383), dbfed: int(s.dbfed, 0, 16383),
    socasel: int(s.socasel, 0, 7), socaprd: int(s.socaprd, 0, 3), socbsel: int(s.socbsel, 0, 7), socbprd: int(s.socbprd, 0, 3),
    intsel: int(s.intsel, 0, 7), intprd: int(s.intprd, 0, 3),
    cmpaNext: s.cmpaNext === null ? null : int(s.cmpaNext, 0, 65535), cmpaWriteAt: int(s.cmpaWriteAt, 0, 1e9),
    shdwamode: int(s.shdwamode, 0, 1), loadamode: int(s.loadamode, 0, 3),
  };
}

/** TBCLK in Hz. */
export function tbclk(s: Pick<PwmSettings, "hspclkdiv" | "clkdiv">): number {
  return EPWMCLK_HZ / (HSPCLKDIV[s.hspclkdiv & 7] * (1 << (s.clkdiv & 7)));
}

/** Counts in one period (15.4.3). 0 when the counter does not run. */
export function cycleTicks(mode: number, prd: number): number {
  if (mode === 3 || prd <= 0) return 0;
  return mode === 2 ? 2 * prd : prd + 1;
}

/** Counter value at a position in the cycle. */
function ctrAt(mode: number, prd: number, p: number): number {
  if (mode === 0) return p;
  if (mode === 1) return prd - p;
  return p <= prd ? p : 2 * prd - p;
}

/** Cycle position of a counter value. */
function position(mode: number, prd: number, ctr: number, up: boolean): number {
  const c = Math.min(ctr, prd);
  if (mode === 1) return prd - c;
  if (mode === 2 && !up && c > 0 && c < prd) return 2 * prd - c;
  return c;
}

interface Pt {
  p: number;
  evs: Ev[];
}

/** The counts of one cycle at which events occur (Table 15-7 for compare values above the period). */
function points(mode: number, prd: number, cmpa: number, cmpb: number): Pt[] {
  const at = new Map<number, Ev[]>();
  const add = (ev: Ev, p: number) => {
    const l = at.get(p);
    if (l) l.push(ev);
    else at.set(p, [ev]);
  };
  if (mode === 0) {
    add("ZRO", 0);
    add("PRD", prd);
    if (cmpa <= prd) add("CAU", cmpa);
    if (cmpb <= prd) add("CBU", cmpb);
  }
  else if (mode === 1) {
    add("PRD", 0);
    add("ZRO", prd);
    add("CAD", cmpa < prd ? prd - cmpa : 0);
    add("CBD", cmpb < prd ? prd - cmpb : 0);
  }
  else {
    add("ZRO", 0);
    add("PRD", prd);
    for (const [c, up, down] of [[cmpa, "CAU", "CAD"], [cmpb, "CBU", "CBD"]] as [number, Ev, Ev][]) {
      add(up, c < prd ? c : prd);
      add(down, c >= prd ? prd : c === 0 ? 0 : 2 * prd - c);
    }
  }
  return [...at].map(([p, evs]) => ({ p, evs })).sort((x, y) => x.p - y.p);
}

function winner(prio: Ev[], evs: Ev[], aq: Aq): Winner | null {
  let w: Winner | null = null;
  for (const e of prio) {
    if (!evs.includes(e) || !aq[e]) continue;
    if (!w) w = { ev: e, action: aq[e], beat: [] };
    else w.beat.push(e);
  }
  return w;
}

interface Raw {
  a: Signal;
  b: Signal;
  marks: Mark[];
  soca: number[];
  socb: number[];
  int: number[];
  syncs: number[];
  loads: { t: number; cmpa: number }[];
  /** Changes of the cycle start: from time t the cycle position is pos. */
  phases: { t: number; pos: number }[];
}

/** Runs the module from reset (counter 0, both outputs low) until `end` counts. */
function run(s: PwmSettings, end: number, externals: boolean): Raw {
  const raw: Raw = { a: { init: 0, edges: [] }, b: { init: 0, edges: [] }, marks: [], soca: [], socb: [], int: [], syncs: [], loads: [], phases: [] };
  const mode = s.ctrmode;
  const prd = s.tbprd;
  const len = cycleTicks(mode, prd);
  if (!len || end <= 0) return raw;

  let cmpa = s.cmpa;
  let shadow = s.cmpa;
  let pts = points(mode, prd, cmpa, s.cmpb);
  const start = position(mode, prd, 0, true);
  let t0 = -start;
  let i = pts.findIndex((x) => x.p >= start);
  if (i < 0) i = pts.length;
  raw.phases.push({ t: 0, pos: start });

  const ext: { t: number; kind: "write" | "sync" }[] = [];
  if (externals) {
    if (s.cmpaNext !== null && s.cmpaWriteAt < end) ext.push({ t: s.cmpaWriteAt, kind: "write" });
    if (s.sync === "once" && s.syncAt < end) ext.push({ t: s.syncAt, kind: "sync" });
    if (s.sync === "every") for (let t = 0, n = 0; t < end && n < 400; t += len, n++) ext.push({ t, kind: "sync" });
    ext.sort((x, y) => x.t - y.t);
  }
  let xi = 0;
  let wrapLoad = false;
  const level: [Level, Level] = [0, 0];
  const cnt = [0, 0, 0];
  const et: [boolean, number, number, number[]][] = [
    [s.socaen, s.socasel, s.socaprd, raw.soca],
    [s.socben, s.socbsel, s.socbprd, raw.socb],
    [s.inten, s.intsel, s.intprd, raw.int],
  ];
  const loadOn: Ev[] = s.loadamode === 0 ? ["ZRO"] : s.loadamode === 1 ? ["PRD"] : s.loadamode === 2 ? ["ZRO", "PRD"] : [];

  for (let guard = 0; guard < 20000; guard++) {
    if (i >= pts.length) {
      t0 += len;
      i = 0;
      if (wrapLoad) {
        wrapLoad = false;
        cmpa = shadow;
        raw.loads.push({ t: t0, cmpa });
        pts = points(mode, prd, cmpa, s.cmpb);
      }
    }
    const tp = t0 + pts[i].p;
    const x = ext[xi];
    if (x && x.t <= tp) {
      xi++;
      if (x.kind === "write") {
        shadow = s.cmpaNext ?? shadow;
        if (s.shdwamode === 1 && shadow !== cmpa) {
          cmpa = shadow;
          raw.loads.push({ t: x.t, cmpa });
          pts = points(mode, prd, cmpa, s.cmpb);
          const pos = x.t - t0;
          i = pts.findIndex((q) => q.p >= pos);
          if (i < 0) i = pts.length;
        }
      }
      else {
        raw.syncs.push(x.t);
        if (s.phsen) {
          const pos = position(mode, prd, s.tbphs, mode === 2 ? s.phsdir === 1 : mode !== 1);
          // Already in step: nothing changes.
          if ((((x.t - pos - t0) % len) + len) % len !== 0) {
            t0 = x.t - pos;
            raw.phases.push({ t: x.t, pos });
            i = pts.findIndex((q) => q.p >= pos);
            if (i < 0) i = pts.length;
          }
        }
      }
      continue;
    }
    if (tp >= end) break;
    let pt = pts[i];
    if (shadow !== cmpa && s.shdwamode === 0 && pt.evs.some((e) => loadOn.includes(e))) {
      if (pt.p === 0 || mode === 2) {
        cmpa = shadow;
        raw.loads.push({ t: tp, cmpa });
        pts = points(mode, prd, cmpa, s.cmpb);
        i = pts.findIndex((q) => q.p === pt.p);
        pt = pts[i];
      }
      else wrapLoad = true;
    }
    const prio = mode === 0 ? PRIO_UP : mode === 1 ? PRIO_DOWN : pt.p === 0 ? PRIO_UPDOWN_AT_ZERO : pt.p === prd ? PRIO_UPDOWN_AT_PERIOD : PRIO_UPDOWN;
    const wins = [winner(prio, pt.evs, s.aqa), winner(prio, pt.evs, s.aqb)];
    const moved: [boolean, boolean] = [false, false];
    wins.forEach((w, o) => {
      if (!w) return;
      const next: Level = w.action === 1 ? 0 : w.action === 2 ? 1 : ((level[o] ^ 1) as Level);
      if (next === level[o]) return;
      level[o] = next;
      moved[o] = true;
      (o ? raw.b : raw.a).edges.push({ t: tp, level: next, why: `${w.ev}: ${ACTIONS[w.action]}` });
    });
    raw.marks.push({ t: tp, ctr: ctrAt(mode, prd, pt.p), evs: pt.evs, a: wins[0], b: wins[1], moved, level: [level[0], level[1]] });
    et.forEach(([en, sel, every, out], k) => {
      if (!en || !every || !pt.evs.some((e) => ET_SEL[sel].includes(e))) return;
      if (++cnt[k] < every) return;
      cnt[k] = 0;
      out.push(tp);
    });
    i++;
  }
  return raw;
}

const invert = (x: Signal): Signal => ({
  init: (x.init ^ 1) as Level,
  edges: x.edges.map((e) => ({ t: e.t, level: (e.level ^ 1) as Level, why: `inverted ${e.why}` })),
});

/**
 * Delays the edges that go to `to` by `delay` counts; the other edges pass
 * at once. A pulse shorter than the delay is swallowed.
 */
function delayEdge(x: Signal, delay: number, to: Level, reg: string): Signal {
  const out: Signal = { init: x.init, edges: [] };
  let level = x.init;
  x.edges.forEach((e, k) => {
    if (e.level === to) {
      const next = x.edges[k + 1];
      if (delay > 0 && next && next.t <= e.t + delay) return;
      out.edges.push({ t: e.t + delay, level: to, why: `${reg} ${delay} after ${e.why}` });
      level = to;
    }
    else if (level === to) {
      out.edges.push({ t: e.t, level: e.level, why: e.why });
      level = e.level;
    }
  });
  return out;
}

/** The dead-band path of Figure 15-33 (OUTSWAP = 0, DEDB_MODE = 0). */
export function deadBand(a: Signal, b: Signal, s: Pick<PwmSettings, "dbOutMode" | "dbPolsel" | "dbInMode" | "dbred" | "dbfed">): [Signal, Signal] {
  if (!s.dbOutMode) return [a, b];
  let red = delayEdge(s.dbInMode & 1 ? b : a, s.dbred, 1, "DBRED");
  let fed = delayEdge(s.dbInMode & 2 ? b : a, s.dbfed, 0, "DBFED");
  if (s.dbPolsel & 1) red = invert(red);
  if (s.dbPolsel & 2) fed = invert(fed);
  return [s.dbOutMode & 2 ? red : a, s.dbOutMode & 1 ? fed : b];
}

/** Level of a signal at time t (after an edge at t). */
export function levelAt(x: Signal, t: number): Level {
  let l = x.init;
  for (const e of x.edges) {
    if (e.t > t) break;
    l = e.level;
  }
  return l;
}

function stat(x: Signal, from: number, to: number, tbclkHz: number): OutStat {
  let level = levelAt(x, from - 0.5);
  let last = from;
  let high = 0;
  let rises = 0;
  let moved = false;
  for (const e of x.edges) {
    if (e.t < from || e.t >= to) continue;
    if (level) high += e.t - last;
    if (e.level && !level) rises++;
    moved = true;
    level = e.level;
    last = e.t;
  }
  if (level) high += to - last;
  const span = to - from;
  return { switching: moved, level, duty: span > 0 ? high / span : level, freqHz: moved && span > 0 ? (rises * tbclkHz) / span : 0 };
}

/**
 * The module's behaviour over `ticks` TBCLK counts from reset, and its
 * steady-state numbers.
 */
export function simulate(settings: PwmSettings, ticks: number): PwmResult {
  const s = clean(settings);
  const tbclkHz = tbclk(s);
  const tickNs = 1e9 / tbclkHz;
  const len = cycleTicks(s.ctrmode, s.tbprd);
  const end = Math.max(0, Math.min(Number.isFinite(ticks) ? ticks : 0, 400 * Math.max(len, 1)));
  const raw = run(s, end, true);
  const [outA, outB] = deadBand(raw.a, raw.b, s);

  // Steady state: periods 7 and 8 after reset (a toggle needs two periods to repeat).
  const st = run(s, 8 * len + 1, false);
  const [stA, stB] = deadBand(st.a, st.b, s);
  const from = 6 * len;
  const to = 8 * len;
  const cycle = st.marks.filter((m) => m.t >= from && m.t < from + len);
  const clashes: PwmResult["clashes"] = [];
  for (const m of cycle)
    for (const [w, out] of [[m.a, "A"], [m.b, "B"]] as [Winner | null, "A" | "B"][])
      if (w && w.beat.length) clashes.push({ ctr: m.ctr, out, win: w.ev, action: w.action, beat: w.beat });

  const never: Ev[] = [];
  if (s.ctrmode === 3 || !len) never.push(...EVENTS);
  else if (s.ctrmode === 0) {
    never.push("CAD", "CBD");
    if (s.cmpa > s.tbprd) never.push("CAU");
    if (s.cmpb > s.tbprd) never.push("CBU");
  }
  else if (s.ctrmode === 1) never.push("CAU", "CBU");
  const above: PwmResult["above"] = [];
  if (len && s.cmpa > s.tbprd) above.push("CMPA");
  if (len && s.cmpb > s.tbprd) above.push("CMPB");

  // Counter corners.
  const counter: { t: number; c: number }[] = [];
  if (len) {
    raw.phases.forEach((ph, k) => {
      const stop = Math.min(end, raw.phases[k + 1]?.t ?? end);
      let t = ph.t;
      let p = ph.pos;
      counter.push({ t, c: ctrAt(s.ctrmode, s.tbprd, p) });
      for (let n = 0; t < stop && n < 1000; n++) {
        // Next corner of the cycle: the period count in up-down mode, else the wrap.
        const corner = s.ctrmode === 2 && p < s.tbprd ? s.tbprd : len;
        const dt = Math.min(corner - p, stop - t);
        t += dt;
        p += dt;
        if (s.ctrmode === 2) counter.push({ t, c: ctrAt(2, s.tbprd, p % len) });
        else {
          // A sawtooth reaches its last value one count before the wrap.
          counter.push({ t, c: ctrAt(s.ctrmode, s.tbprd, Math.min(p, len - 1)) });
          if (p >= len) counter.push({ t, c: ctrAt(s.ctrmode, s.tbprd, 0) });
        }
        if (p >= len) p -= len;
      }
    });
  }
  else counter.push({ t: 0, c: 0 }, { t: end, c: 0 });

  const freqHz = len ? tbclkHz / len : 0;
  const rate = (en: boolean, sel: number, every: number) => {
    if (!en || !every || !len) return 0;
    const n = cycle.filter((m) => m.evs.some((e) => ET_SEL[sel].includes(e))).length;
    return (freqHz * n) / every;
  };
  return {
    tbclkHz, tickNs, cycleTicks: len, periodNs: len * tickNs, freqHz,
    stopped: s.ctrmode === 3 ? "frozen" : !len ? "tbprd0" : null,
    counter, marks: raw.marks, a: raw.a, b: raw.b, outA, outB,
    soca: raw.soca, socb: raw.socb, int: raw.int, syncs: raw.syncs, loads: raw.loads,
    statA: stat(st.a, from, to, tbclkHz), statB: stat(st.b, from, to, tbclkHz),
    statOutA: stat(stA, from, to, tbclkHz), statOutB: stat(stB, from, to, tbclkHz),
    resolutionPct: len ? 100 / len : 0, resolutionBits: len ? Math.log2(len) : 0,
    redNs: s.dbOutMode & 2 ? s.dbred * tickNs : 0, fedNs: s.dbOutMode & 1 ? s.dbfed * tickNs : 0,
    socaHz: rate(s.socaen, s.socasel, s.socaprd), socbHz: rate(s.socben, s.socbsel, s.socbprd), intHz: rate(s.inten, s.intsel, s.intprd),
    never, above, clashes, cycle,
  };
}

/** Counter value during count `tick` (for a staircase drawing and for tests). */
export function counterAt(r: PwmResult, tick: number): number {
  const c = r.counter;
  for (let k = c.length - 1; k >= 0; k--) {
    if (c[k].t > tick) continue;
    const n = c[k + 1];
    if (!n || n.t === c[k].t) return c[k].c;
    // On a slope every count changes the value by one.
    return c[k].c + Math.sign(n.c - c[k].c) * (tick - c[k].t);
  }
  return 0;
}

/**
 * Dividers and TBPRD for a wanted counter frequency. HSPCLKDIV stays at its
 * reset value (/2), as in the course, unless even CLKDIV = 7 is not enough.
 */
export function propose(freqHz: number, mode: number): { hspclkdiv: number; clkdiv: number; tbprd: number; actualHz: number } {
  const f = Number.isFinite(freqHz) && freqHz > 0 ? freqHz : 1;
  const prdFor = (clk: number) => (mode === 2 ? Math.round(clk / (2 * f)) : Math.round(clk / f) - 1);
  const tries: [number, number][] = [];
  for (let c = 0; c < 8; c++) tries.push([1, c]);
  for (let h = 2; h < 8; h++) tries.push([h, 7]);
  let pick = tries[tries.length - 1];
  for (const t of tries) {
    if (prdFor(tbclk({ hspclkdiv: t[0], clkdiv: t[1] })) <= 65535) {
      pick = t;
      break;
    }
  }
  const clk = tbclk({ hspclkdiv: pick[0], clkdiv: pick[1] });
  const tbprd = Math.max(1, Math.min(65535, prdFor(clk)));
  return { hspclkdiv: pick[0], clkdiv: pick[1], tbprd, actualHz: clk / cycleTicks(mode === 2 ? 2 : 0, tbprd) };
}

/** Pin and mux index of EPWM<n>A (out 0) or EPWM<n>B (out 1) on the course boards. */
export function pwmPin(n: number, out: 0 | 1): { pin: number; mux: number } {
  return n <= 8 ? { pin: (n - 1) * 2 + out, mux: 1 } : { pin: 16 + (n - 9) * 2 + out, mux: 5 };
}

/**
 * The C lines for these settings in the course's style: only fields that
 * differ from their reset value, plus the pin mux of every output in use.
 */
export function code(settings: PwmSettings, n = 1): string[] {
  const s = clean(settings);
  const r = `EPwm${n}Regs`;
  const out: string[] = [];
  const line = (lhs: string, v: number, was: number, note = "") => {
    if (v !== was) out.push(`${r}.${lhs} = ${v};${note ? `  // ${note}` : ""}`);
  };
  line("TBCTL.bit.CTRMODE", s.ctrmode, 3, ["count up", "count down", "count up and down", ""][s.ctrmode]);
  line("TBCTL.bit.HSPCLKDIV", s.hspclkdiv, 1, `divide by ${HSPCLKDIV[s.hspclkdiv]}`);
  line("TBCTL.bit.CLKDIV", s.clkdiv, 0, `divide by ${1 << s.clkdiv}`);
  line("TBCTL.bit.PHSEN", s.phsen ? 1 : 0, 0, "load TBPHS on a sync pulse");
  if (s.phsen) {
    line("TBCTL.bit.PHSDIR", s.phsdir, 0, "count up after a sync");
    line("TBPHS.bit.TBPHS", s.tbphs, 0);
  }
  line("TBPRD", s.tbprd, 0);
  line("CMPCTL.bit.SHDWAMODE", s.shdwamode, 0, "CMPA writes take effect at once");
  if (!s.shdwamode) line("CMPCTL.bit.LOADAMODE", s.loadamode, 0, ["", "load CMPA at the period count", "load CMPA at zero and at the period count", "never load CMPA"][s.loadamode]);
  line("CMPA.bit.CMPA", s.cmpa, 0);
  line("CMPB.bit.CMPB", s.cmpb, 0);
  const act = ["", "clear", "set", "toggle"];
  for (const [reg, aq] of [["AQCTLA", s.aqa], ["AQCTLB", s.aqb]] as [string, Aq][]) for (const e of EVENTS) line(`${reg}.bit.${e}`, aq[e], 0, act[aq[e]]);
  if (s.dbOutMode) {
    line("DBCTL.bit.IN_MODE", s.dbInMode, 0);
    line("DBCTL.bit.POLSEL", s.dbPolsel, 0, ["", "invert A", "invert B", "invert both"][s.dbPolsel]);
    line("DBRED.bit.DBRED", s.dbred, 0, "rising-edge delay, counts");
    line("DBFED.bit.DBFED", s.dbfed, 0, "falling-edge delay, counts");
    line("DBCTL.bit.OUT_MODE", s.dbOutMode, 0);
  }
  for (const [x, en, sel, every] of [["SOCA", s.socaen, s.socasel, s.socaprd], ["SOCB", s.socben, s.socbsel, s.socbprd], ["INT", s.inten, s.intsel, s.intprd]] as [string, boolean, number, number][]) {
    if (!en) continue;
    line(`ETSEL.bit.${x}SEL`, sel, 0, `at ${ET_SEL_NAMES[sel]}`);
    line(`ETPS.bit.${x}PRD`, every, 0, ["", "every event", "every second event", "every third event"][every]);
    line(`ETSEL.bit.${x}EN`, 1, 0);
  }
  for (const [o, aq] of [[0, s.aqa], [1, s.aqb]] as [0 | 1, Aq][]) {
    // With the dead band on, output B can be made from A alone.
    const used = EVENTS.some((e) => aq[e]) || (o === 1 && (s.dbOutMode & 1) !== 0) || (o === 0 && (s.dbOutMode & 2) !== 0 && (s.dbInMode & 1) !== 0 && EVENTS.some((e) => s.aqb[e]));
    if (!used) continue;
    const p = pwmPin(n, o);
    out.push(`GPIO_SetupPinMux(${p.pin}, GPIO_MUX_CPU1, ${p.mux});  // GPIO${p.pin} becomes EPWM${n}${o ? "B" : "A"}`);
  }
  return out;
}

export interface Preset {
  id: string;
  name: string;
  /** What it is, in a sentence or two. */
  about: string;
  /** The ePWM module the course uses for it. */
  module: number;
  settings: PwmSettings;
}

const aq = (a: Partial<Aq>): Aq => ({ ...NO_ACTIONS, ...a });

/** Whole configurations. Numbers are the chapters' (ch09, ch10), not those of the graded labs. */
export const PRESETS: Preset[] = [
  {
    id: "led", name: "LED dimmer", module: 12,
    about: "Chapter 9's LED1 on EPWM12A: up count, 10 kHz, the pin set at zero and cleared at CMPA. CMPA is the brightness.",
    settings: { ...RESET, ctrmode: 0, tbprd: 5000, cmpa: 2500, aqa: aq({ ZRO: 2, CAU: 1 }) },
  },
  {
    id: "motor", name: "Motor, 20 kHz", module: 2,
    about: "Chapter 10's motor drive: 20 kHz, above what you can hear. The amplifier reads 50 % as stopped, more as forward, less as backward, so CMPA starts at half of TBPRD.",
    settings: { ...RESET, ctrmode: 0, tbprd: 2500, cmpa: 1250, aqa: aq({ ZRO: 2, CAU: 1 }) },
  },
  {
    id: "servo", name: "RC servo", module: 8,
    about: "A servo wants one pulse every 20 ms. A million counts do not fit in TBPRD, so CLKDIV slows the counter down. The pulse is 8 % of the period for the middle position.",
    settings: { ...RESET, ctrmode: 0, clkdiv: 5, tbprd: 31250, cmpa: 2500, aqa: aq({ ZRO: 2, CAU: 1 }) },
  },
  {
    id: "buzzer", name: "Buzzer tone", module: 9,
    about: "A tone needs no duty cycle: the pin toggles each time the counter reaches TBPRD, so one high and one low take two counter periods. TBPRD sets the pitch: 440 Hz here.",
    settings: { ...RESET, ctrmode: 0, clkdiv: 2, tbprd: 14204, aqa: aq({ PRD: 3 }) },
  },
  {
    id: "pair", name: "Pair with dead time", module: 6,
    about: "Two transistors of a half bridge must never conduct together. The dead-band unit makes both signals from EPWMxA: B is the inverse of A, and each rising edge is delayed by 2 us.",
    settings: { ...RESET, ctrmode: 2, tbprd: 1250, cmpa: 625, aqa: aq({ CAU: 2, CAD: 1 }), dbOutMode: 3, dbPolsel: 2, dbred: 100, dbfed: 100 },
  },
  {
    id: "centre", name: "Centred, triggers ADC", module: 4,
    about: "Up-down count puts the pulse around the peak of the triangle. SOCA fires at the peak, the middle of the pulse, far from both switching edges: the quiet moment to measure a motor current.",
    settings: { ...RESET, ctrmode: 2, tbprd: 1250, cmpa: 750, aqa: aq({ CAU: 2, CAD: 1 }), socaen: true, socasel: 2, socaprd: 1 },
  },
  {
    id: "reset", name: "After reset", module: 1,
    about: "Every register at its reset value.",
    settings: RESET,
  },
];
