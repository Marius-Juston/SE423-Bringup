// ePWM modules 1 to 12. TRM chapter 15 "Enhanced Pulse Width Modulator
// (ePWM)" (SPRUHM8I). What is modelled, with the section it follows:
//
// - Time base (15.4, TBCTL in 15.15.2): TBCLK = EPWMCLK / (HSPCLKDIV x
//   CLKDIV) with EPWMCLK = 100 MHz. HSPCLKDIV resets to /2, so TBCLK is
//   50 MHz with CLKDIV = 0, the number the course uses. Count modes up,
//   down, up-down and freeze (the reset state). Period (15.4.3):
//     up or down count:  TPWM = (TBPRD + 1) x TTBCLK
//     up-down count:     TPWM = 2 x TBPRD x TTBCLK
//   TBCTR is computed from the time when it is read; nothing ticks.
// - Shadow registers (15.4.2, 15.5.2): TBPRD is loaded at CTR = 0 unless
//   TBCTL.PRDLD = 1; CMPA / CMPB are loaded as CMPCTL.LOADAMODE /
//   LOADBMODE say (CTR = 0 by default) unless SHDWAMODE / SHDWBMODE = 1.
//   Simplification: while the counter is frozen or the module has nothing
//   to do (no output action, no trigger), a write goes straight through.
// - Action qualifier (15.6): AQCTLA / AQCTLB actions on ZRO, PRD, CAU, CAD,
//   CBU, CBD (nothing, clear, set, toggle), with the event priorities of
//   Tables 15-4 to 15-6 and the compare-above-period rules of Table 15-7.
//   An event whose action is "do nothing" does not hide a lower-priority
//   event (the course's buzzer relies on this: CAU = 0 with CMPA = 0 and
//   ZRO = toggle). In up-down mode the period count belongs to the
//   decrementing half and zero to the incrementing half, which reproduces
//   Figure 15-24 (CAU = set, CAD = clear: CMPA = 0 is 100 %, CMPA = TBPRD
//   is 0 %). Software forcing: AQSFRC one-shot, AQCSFRC continuous.
// - Event trigger (15.10): ETSEL / ETPS select and prescale EPWMxSOCA,
//   EPWMxSOCB (trigger lines "EPWM<n>SOCA" / "EPWM<n>SOCB") and EPWMx_INT
//   (PIE INT3.n, Table 3-2). ETFLG.INT blocks further interrupts until
//   ETCLR.INT is written, with one interrupt kept pending; SOC pulses
//   continue while their flag is set.
// - Synchronisation (15.4.3.3, 15.4.4): a module with TBCTL.PHSEN = 1 loads
//   TBCTR from TBPHS on its sync input. Chains 1-2-3, 4-5-6, 7-8-9,
//   10-11-12; EPWM4, 7 and 10 take EPWM1's sync output (the reset value of
//   SYNCSELECT). The one or two TBCLK delay of the real load is not
//   modelled.
// - Pins (15.2 and the course pin mux table): EPWM1A..8B on GPIO0..15 at
//   mux 1, EPWM9A..12B on GPIO16..23 at mux 5, and the second copy on
//   GPIO145..168 at mux 1. An output reaches a pin only while that pin's
//   mux selects it.
//
// Not modelled: dead band, chopper, trip zone, digital compare, HRPWM,
// CMPC / CMPD, the ETPS count fields (they read as written).

import { EPWMCLK_HZ } from "../consts";
import type { Board } from "../board";
import type { SimPlugin } from "../plugin";

const EPWMCLK_NS = 1e9 / EPWMCLK_HZ;
const HSPCLKDIV = [1, 2, 4, 6, 8, 10, 12, 14];

// Time-base events.
const ZRO = 1;
const PRD = 2;
const CAU = 4;
const CAD = 8;
const CBU = 16;
const CBD = 32;
/** Bit position of each event's action in AQCTLA / AQCTLB. */
const AQ_SHIFT: Record<number, number> = { [ZRO]: 0, [PRD]: 2, [CAU]: 4, [CAD]: 6, [CBU]: 8, [CBD]: 10 };
/** Events selected by ETSEL.SOCASEL / SOCBSEL / INTSEL (0 is a digital-compare event or reserved). */
const ET_SEL = [0, ZRO, PRD, ZRO | PRD, CAU, CAD, CBU, CBD];

// Priority, highest first (Tables 15-4, 15-5, 15-6).
const PRIO_UP = [PRD, CBU, CAU, ZRO];
const PRIO_DOWN = [ZRO, CBD, CAD, PRD];
const PRIO_UPDOWN_AT_ZERO = [CBU, CAU, ZRO, CBD, CAD];
const PRIO_UPDOWN_AT_PERIOD = [CBD, CAD, PRD, CBU, CAU];
const PRIO_UPDOWN = [CBU, CAU, CBD, CAD, ZRO, PRD];

/** A PWM faster than this (5 MHz), or with TBPRD = 0, is not simulated edge by edge. */
const MIN_CYCLE_NS = 200;
/** How long an output may toggle with no pin muxed to it before a warning. */
const UNMUXED_NS = 1_000_000;

/** Sync outputs feeding sync inputs. */
const SYNC_CHILDREN: Record<number, number[]> = { 1: [2, 4, 7, 10], 2: [3], 4: [5], 5: [6], 7: [8], 8: [9], 10: [11], 11: [12] };

interface Point {
  /** Position in the cycle, in TBCLK ticks from the cycle start. */
  p: number;
  /** Resolved action for EPWMxA and EPWMxB (0 nothing, 1 clear, 2 set, 3 toggle). */
  act: [number, number];
  /** Events at this position that the event trigger or the sync output needs. */
  ev: number;
  /** Shadow registers are loaded here. */
  load: boolean;
}

export interface EpwmModule {
  n: number;
  pre: string;
  /** TBCTL.CTRMODE: 0 up, 1 down, 2 up-down, 3 freeze. */
  mode: number;
  /** TBCLK period, ns. */
  tick: number;
  /** Active (not shadow) values. */
  prd: number;
  cmpa: number;
  cmpb: number;
  /** Start time of the current cycle, ns (while counting). */
  t0: number;
  /** Counter value and direction while frozen. */
  frozenCtr: number;
  frozenUp: boolean;
  /** Levels of EPWMxA and EPWMxB. */
  out: [0 | 1, 0 | 1];
  points: Point[];
  idx: number;
  ev: ReturnType<Board["at"]> | null;
  /** Time of the last processed point (a point is never processed twice). */
  doneT: number;
  wrapLoad: number;
  socCnt: [number, number];
  intCnt: number;
  intPending: boolean;
  everMuxed: boolean;
  unmuxedSince: number;
  aqLine: number;
}

interface PinRoute {
  pin: number;
  mux: number;
}

/** Pins that can carry EPWM<n>A (out = 0) or EPWM<n>B (out = 1), first the one the course boards use. */
export function epwmPins(n: number, out: 0 | 1): PinRoute[] {
  const first = n <= 8 ? { pin: (n - 1) * 2 + out, mux: 1 } : { pin: 16 + (n - 9) * 2 + out, mux: 5 };
  return [first, { pin: 145 + (n - 1) * 2 + out, mux: 1 }];
}

export class Epwm {
  mods: EpwmModule[] = [];
  /** Pins this peripheral currently drives. */
  private mine = new Set<number>();
  private source: string[] = [];

  constructor(private b: Board) {
    for (let n = 1; n <= 12; n++) this.mods.push(this.create(n));
    this.hookMux();
    // Keep the student's source: the float diagnostic looks at the line that wrote CMPA.
    const load = b.load.bind(b);
    b.load = (src: string) => {
      this.source = src.split("\n");
      load(src);
    };
  }

  mod(n: number): EpwmModule {
    return this.mods[n - 1];
  }

  /** PWM period the module is configured for, ns (0 while frozen). */
  periodNs(n: number): number {
    const m = this.mod(n);
    return m.mode === 3 ? 0 : this.cycle(m) * m.tick;
  }

  // ---------- set-up ----------

  private create(n: number): EpwmModule {
    const b = this.b;
    const dev = b.dev;
    const pre = `EPwm${n}Regs`;
    const m: EpwmModule = {
      n, pre, mode: 3, tick: EPWMCLK_NS * 2, prd: 0, cmpa: 0, cmpb: 0, t0: 0, frozenCtr: 0, frozenUp: true,
      out: [0, 0], points: [], idx: 0, ev: null, doneT: -1, wrapLoad: 0, socCnt: [0, 0], intCnt: 0, intPending: false,
      everMuxed: false, unmuxedSince: -1, aqLine: 0,
    };
    // Reset values (TBCTL register figure): HSPCLKDIV = 1 (/2), CTRMODE = 3 (freeze).
    dev.set(`${pre}.TBCTL`, 0x0083);

    const tbctl = dev.reg(`${pre}.TBCTL`).hook;
    tbctl.write = (v) => v & ~0x40; // SWFSYNC always reads 0
    tbctl.after = (v, before) => {
      const now = b.now;
      const ctr = this.counter(m, now);
      const up = this.countingUp(m, now);
      const wasFrozen = m.mode === 3;
      this.settle(m);
      m.mode = v & 3;
      m.tick = EPWMCLK_NS * HSPCLKDIV[(v >> 7) & 7] * (1 << ((v >> 10) & 7));
      if (m.mode === 3) {
        m.frozenCtr = ctr;
        m.frozenUp = up;
      } else {
        m.t0 = now - this.position(m, ctr, up) * m.tick;
        // A counter released at a count where an event sits produces that event.
        if (wasFrozen) m.doneT = -1;
      }
      if ((v ^ before) & 0x3f) for (const p of this.mods) if (SYNC_CHILDREN[p.n]?.includes(n)) this.reconfigure(p);
      this.reconfigure(m);
      if (v & 0x40) this.syncIn(m, now);
    };

    const tbctr = dev.reg(`${pre}.TBCTR`).hook;
    tbctr.live = true;
    tbctr.read = () => this.counter(m, b.now);
    tbctr.after = (v) => {
      this.settle(m);
      this.setCounter(m, v, true, b.now);
      this.reconfigure(m);
    };

    const tbsts = dev.reg(`${pre}.TBSTS`).hook;
    tbsts.live = true;
    tbsts.read = (stored) => (stored & ~1) | (this.countingUp(m, b.now) ? 1 : 0);
    tbsts.write = (v, stored) => stored & ~(v & 6);

    const changed = () => {
      this.settle(m);
      this.checkCompare(m);
      this.reconfigure(m);
    };
    dev.reg(`${pre}.TBPRD`).hook.after = changed;
    for (const c of ["CMPA", "CMPB"]) {
      dev.reg(`${pre}.${c}`).hook.after = () => {
        this.checkFloat(c);
        changed();
      };
    }
    dev.reg(`${pre}.CMPCTL`).hook.after = changed;
    for (const r of ["AQCTLA", "AQCTLB"]) {
      dev.reg(`${pre}.${r}`).hook.after = () => {
        if (!b.libDepth || !m.aqLine) m.aqLine = b.line;
        changed();
      };
    }

    // One-shot software force: OTSFA / OTSFB apply ACTSFA / ACTSFB once and read 0.
    const sfrc = dev.reg(`${pre}.AQSFRC`).hook;
    sfrc.write = (v) => v & ~0x24;
    sfrc.after = (v) => {
      if (v & 0x04) this.apply(m, 0, v & 3, b.now);
      if (v & 0x20) this.apply(m, 1, (v >> 3) & 3, b.now);
    };
    // Continuous software force: 1 forces low, 2 forces high, 0 and 3 release.
    dev.reg(`${pre}.AQCSFRC`).hook.after = (v) => {
      for (const i of [0, 1] as const) {
        const f = (v >> (2 * i)) & 3;
        if (f === 1 || f === 2) this.apply(m, i, f, b.now);
      }
      this.reconfigure(m);
    };

    const et = () => {
      m.socCnt = [0, 0];
      this.reconfigure(m);
    };
    dev.reg(`${pre}.ETSEL`).hook.after = et;
    dev.reg(`${pre}.ETPS`).hook.after = et;
    dev.reg(`${pre}.ETFLG`).hook.write = (_v, stored) => stored; // read only
    const etclr = dev.reg(`${pre}.ETCLR`).hook;
    etclr.write = () => 0;
    etclr.after = (v) => {
      dev.set(`${pre}.ETFLG`, dev.get(`${pre}.ETFLG`) & ~(v & 0xd));
      // An event that arrived while the flag was set was kept: it interrupts now.
      if (v & 1 && m.intPending) {
        m.intPending = false;
        this.interrupt(m);
      }
    };
    const etfrc = dev.reg(`${pre}.ETFRC`).hook;
    etfrc.write = () => 0;
    etfrc.after = (v) => {
      if (v & 1 && !dev.get(`${pre}.ETFLG`, "INT")) {
        dev.set(`${pre}.ETFLG`, 1, "INT");
        if (dev.get(`${pre}.ETSEL`, "INTEN")) b.pie.raise(3, n);
      }
      for (const [i, bit, name] of [[0, 4, "SOCA"], [1, 8, "SOCB"]] as const) {
        if (!(v & bit)) continue;
        dev.set(`${pre}.ETFLG`, 1, name);
        if (dev.get(`${pre}.ETSEL`, i ? "SOCBEN" : "SOCAEN")) b.fireTrigger(`EPWM${n}${name}`, b.now);
      }
    };

    dev.reg(`${pre}.DBCTL`).hook.after = (v) => {
      if (v & 3)
        b.warn(b.line, "epwm-deadband", `The dead-band generator of EPWM${n} is not simulated here: EPWM${n}A and EPWM${n}B come straight from the action qualifier. Leave DBCTL.OUT_MODE at 0 and shape both edges with CMPA and CMPB.`);
    };
    return m;
  }

  /** Re-drives the outputs when a pin's mux changes, after the GPIO model has seen the write. */
  private hookMux(): void {
    const b = this.b;
    for (const port of ["A", "E", "F"]) {
      for (const r of ["MUX1", "MUX2", "GMUX1", "GMUX2"]) {
        const reg = b.dev.regs.get(`GpioCtrlRegs.GP${port}${r}`);
        if (!reg) continue;
        const prev = reg.hook.after;
        reg.hook.after = (v, before) => {
          prev?.(v, before);
          for (const m of this.mods) for (const i of [0, 1] as const) this.drive(m, i, b.now, true);
        };
      }
    }
  }

  // ---------- time base ----------

  /** Length of one PWM cycle in TBCLK ticks (TRM 15.4.3). */
  private cycle(m: EpwmModule): number {
    return m.mode === 2 ? Math.max(1, 2 * m.prd) : m.prd + 1;
  }

  /** Cycle position of a counter value. */
  private position(m: EpwmModule, ctr: number, up: boolean): number {
    const c = Math.min(ctr, m.prd);
    if (m.mode === 1) return m.prd - c;
    if (m.mode === 2 && !up && c > 0 && c < m.prd) return 2 * m.prd - c;
    return m.mode === 2 && m.prd === 0 ? 0 : c;
  }

  private pos(m: EpwmModule, t: number): number {
    const len = this.cycle(m);
    const k = Math.floor((t - m.t0) / m.tick) % len;
    return k < 0 ? k + len : k;
  }

  /** TBCTR at time t. */
  counter(m: EpwmModule, t: number): number {
    if (m.mode === 3) return m.frozenCtr;
    const p = this.pos(m, t);
    if (m.mode === 0) return p;
    if (m.mode === 1) return m.prd - p;
    return p <= m.prd ? p : 2 * m.prd - p;
  }

  /** TBSTS.CTRDIR. */
  private countingUp(m: EpwmModule, t: number): boolean {
    if (m.mode === 3) return m.frozenUp;
    if (m.mode === 0) return true;
    if (m.mode === 1) return false;
    return this.pos(m, t) < m.prd;
  }

  private setCounter(m: EpwmModule, ctr: number, up: boolean, t: number): void {
    if (m.mode === 3) {
      m.frozenCtr = ctr & 0xffff;
      m.frozenUp = up;
    } else m.t0 = t - this.position(m, ctr, up) * m.tick;
    m.doneT = -1;
    this.b.mem.writes++;
  }

  // ---------- shadow registers ----------

  private shadow(m: EpwmModule): { prd: number; cmpa: number; cmpb: number } {
    const dev = this.b.dev;
    return { prd: dev.get(`${m.pre}.TBPRD`), cmpa: dev.get(`${m.pre}.CMPA`, "CMPA"), cmpb: dev.get(`${m.pre}.CMPB`, "CMPB") };
  }

  /** Copies shadow values to the active registers on the given events (all of them when `on` is -1). */
  private load(m: EpwmModule, on: number): boolean {
    const dev = this.b.dev;
    const s = this.shadow(m);
    const tbctl = dev.get(`${m.pre}.TBCTL`);
    const cmpctl = dev.get(`${m.pre}.CMPCTL`);
    const all = on === -1;
    let changed = false;
    if (s.prd !== m.prd && (all || tbctl & 8 || on & ZRO)) {
      m.prd = s.prd;
      changed = true;
    }
    const when = (mode: number) => [ZRO, PRD, ZRO | PRD, 0][mode];
    if (s.cmpa !== m.cmpa && (all || cmpctl & 0x10 || on & when(cmpctl & 3))) {
      m.cmpa = s.cmpa;
      changed = true;
    }
    if (s.cmpb !== m.cmpb && (all || cmpctl & 0x40 || on & when((cmpctl >> 2) & 3))) {
      m.cmpb = s.cmpb;
      changed = true;
    }
    if (changed) this.b.mem.writes++;
    return changed;
  }

  /**
   * After a register write: values in immediate mode go through, and so does
   * everything while nothing is scheduled (frozen, or no output and no
   * trigger in use). The counter keeps its value.
   */
  private settle(m: EpwmModule): void {
    const now = this.b.now;
    const idle = m.mode === 3 || !m.ev;
    const ctr = this.counter(m, now);
    const up = this.countingUp(m, now);
    const was = { mode: m.mode, tick: m.tick, prd: m.prd };
    if (!this.load(m, idle ? -1 : 0)) return;
    // A write that leaves the time base alone (a new compare value, an
    // action) must not move the cycle: re-anchoring from the whole-number
    // counter would shift it by part of a count.
    if (m.mode === was.mode && m.tick === was.tick && m.prd === was.prd && m.mode !== 3) return;
    if (m.mode !== 3) m.t0 = now - this.position(m, ctr, up) * m.tick;
  }

  // ---------- events ----------

  /** The points of one cycle at which something happens. */
  private build(m: EpwmModule): void {
    m.points = [];
    if (m.mode === 3) return;
    const dev = this.b.dev;
    const prd = m.prd;
    const at = new Map<number, number>();
    const add = (ev: number, p: number) => at.set(p, (at.get(p) ?? 0) | ev);
    if (m.mode === 0) {
      add(ZRO, 0);
      add(PRD, prd);
      // Table 15-7: a compare value above the period never matches.
      if (m.cmpa <= prd) add(CAU, m.cmpa);
      if (m.cmpb <= prd) add(CBU, m.cmpb);
    } else if (m.mode === 1) {
      add(PRD, 0);
      add(ZRO, prd);
      add(CAD, m.cmpa < prd ? prd - m.cmpa : 0);
      add(CBD, m.cmpb < prd ? prd - m.cmpb : 0);
    } else {
      add(ZRO, 0);
      add(PRD, prd);
      for (const [c, upEv, downEv] of [[m.cmpa, CAU, CAD], [m.cmpb, CBU, CBD]]) {
        add(upEv, c < prd ? c : prd);
        add(downEv, c >= prd ? prd : c === 0 ? 0 : 2 * prd - c);
      }
    }

    const etsel = dev.get(`${m.pre}.ETSEL`);
    const etps = dev.get(`${m.pre}.ETPS`);
    let need = 0;
    if (etsel & 0x0008 && etps & 0x0003) need |= ET_SEL[etsel & 7];
    if (etsel & 0x0800 && etps & 0x0300) need |= ET_SEL[(etsel >> 8) & 7];
    if (etsel & 0x8000 && etps & 0x3000) need |= ET_SEL[(etsel >> 12) & 7];
    const syncosel = (dev.get(`${m.pre}.TBCTL`) >> 4) & 3;
    if (this.syncWanted(m)) need |= syncosel === 1 ? ZRO : syncosel === 2 ? CBU | CBD : 0;

    const aq = [dev.get(`${m.pre}.AQCTLA`), dev.get(`${m.pre}.AQCTLB`)];
    const csf = dev.get(`${m.pre}.AQCSFRC`);
    const forced = [(csf & 3) === 1 || (csf & 3) === 2, ((csf >> 2) & 3) === 1 || ((csf >> 2) & 3) === 2];
    const s = this.shadow(m);
    const pending = s.prd !== m.prd || s.cmpa !== m.cmpa || s.cmpb !== m.cmpb;
    const used = (aq[0] | aq[1]) !== 0 && !(forced[0] && forced[1]);

    for (const [p, evs] of at) {
      const prio = m.mode === 0 ? PRIO_UP : m.mode === 1 ? PRIO_DOWN : p === 0 ? PRIO_UPDOWN_AT_ZERO : p === prd ? PRIO_UPDOWN_AT_PERIOD : PRIO_UPDOWN;
      const act: [number, number] = [0, 0];
      for (const i of [0, 1]) {
        if (forced[i]) continue;
        for (const e of prio) {
          const a = evs & e ? (aq[i] >> AQ_SHIFT[e]) & 3 : 0;
          if (a) {
            act[i] = a;
            break;
          }
        }
      }
      const load = pending && (evs & (ZRO | PRD)) !== 0;
      if (act[0] || act[1] || evs & need || load) m.points.push({ p, act, ev: evs, load });
    }
    m.points.sort((x, y) => x.p - y.p);

    if (m.points.length && (m.prd === 0 || this.cycle(m) * m.tick < MIN_CYCLE_NS)) {
      // TBPRD = 0 is the course's "note off": the output just stops there.
      if (m.prd !== 0 && used)
        this.b.warn(this.b.line, "epwm-too-fast", `EPWM${m.n} is set to a period of ${this.cycle(m) * m.tick} ns (TBPRD = ${m.prd}). That is too fast to be useful and is not simulated: check TBPRD and CLKDIV.`);
      m.points = [];
    }
  }

  private syncWanted(m: EpwmModule): boolean {
    for (const c of SYNC_CHILDREN[m.n] ?? []) {
      const tbctl = this.b.dev.get(`EPwm${c}Regs.TBCTL`);
      if (tbctl & 4) return true;
      if (((tbctl >> 4) & 3) === 0 && this.syncWanted(this.mod(c))) return true;
    }
    return false;
  }

  /** Rebuilds the points and schedules the next one after time `from`. */
  private reconfigure(m: EpwmModule, from = this.b.now): void {
    const b = this.b;
    b.cancel(m.ev);
    m.ev = null;
    b.mem.writes++;
    this.build(m);
    if (!m.points.length) return;
    const len = this.cycle(m);
    let k = Math.ceil((from - m.t0) / m.tick);
    if (k >= len || k < 0) {
      const c = Math.floor(k / len);
      m.t0 += c * len * m.tick;
      k -= c * len;
    }
    if (m.t0 + k * m.tick <= m.doneT) k++;
    let i = m.points.findIndex((pt) => pt.p >= k);
    if (i < 0) {
      m.t0 += len * m.tick;
      i = 0;
    }
    m.idx = i;
    m.ev = b.at(m.t0 + m.points[i].p * m.tick, (t) => this.fire(m, t));
  }

  private fire(m: EpwmModule, t: number): void {
    const b = this.b;
    m.ev = null;
    m.doneT = t;
    let pt: Point | undefined = m.points[m.idx];
    const p = pt.p;
    if (pt.load) {
      const on = pt.ev & (ZRO | PRD);
      // Loads at the first count of a cycle (and at the period in up-down
      // mode) apply to the cycle that follows; a load at the last count is
      // applied when the cycle wraps.
      if (p === 0 || m.mode === 2) {
        if (this.load(m, on)) {
          this.build(m);
          pt = m.points.find((x) => x.p === p);
        }
      } else m.wrapLoad |= on;
    }
    if (pt) {
      for (const i of [0, 1] as const) if (pt.act[i]) this.apply(m, i, pt.act[i], t);
      this.trigger(m, pt.ev, t);
    }
    let i = m.points.findIndex((x) => x.p > p);
    if (i < 0) {
      m.t0 += this.cycle(m) * m.tick;
      if (m.wrapLoad) {
        if (this.load(m, m.wrapLoad)) this.build(m);
        m.wrapLoad = 0;
      }
      i = 0;
    }
    // The handlers above may have rescheduled or stopped the module (sync, a trigger listener).
    if (m.ev || !m.points.length || m.mode === 3) return;
    m.idx = i;
    m.ev = b.at(m.t0 + m.points[i].p * m.tick, (tt) => this.fire(m, tt));
  }

  /** Action-qualifier action on output i: 1 clear, 2 set, 3 toggle. */
  private apply(m: EpwmModule, i: 0 | 1, action: number, t: number): void {
    const next = action === 1 ? 0 : action === 2 ? 1 : action === 3 ? ((m.out[i] ^ 1) as 0 | 1) : m.out[i];
    if (next !== m.out[i]) {
      m.out[i] = next;
      this.b.mem.writes++;
    }
    this.drive(m, i, t, false);
  }

  private drive(m: EpwmModule, i: 0 | 1, t: number, muxChange: boolean): void {
    const gpio = this.b.gpio;
    let routed = false;
    for (const r of epwmPins(m.n, i)) {
      if (gpio.mux(r.pin) === r.mux) {
        routed = true;
        this.mine.add(r.pin);
        gpio.drivePeripheral(r.pin, m.out[i], t);
      } else if (this.mine.delete(r.pin)) gpio.drivePeripheral(r.pin, null, t);
    }
    if (routed) m.everMuxed = true;
    else if (!muxChange && !m.everMuxed) {
      if (m.unmuxedSince < 0) m.unmuxedSince = t;
      else if (t - m.unmuxedSince > UNMUXED_NS) {
        const r = epwmPins(m.n, i)[0];
        const ab = i ? "B" : "A";
        this.b.warn(
          m.aqLine,
          "pwm-mux",
          `EPWM${m.n}${ab} is producing a waveform, but no pin is connected to it: GPIO${r.pin} is still a plain GPIO. Select the PWM signal in the pin mux: GPIO_SetupPinMux(${r.pin}, GPIO_MUX_CPU1, ${r.mux});`,
        );
      }
    }
  }

  // ---------- event trigger ----------

  private trigger(m: EpwmModule, evs: number, t: number): void {
    const b = this.b;
    const dev = b.dev;
    const etsel = dev.get(`${m.pre}.ETSEL`);
    const etps = dev.get(`${m.pre}.ETPS`);
    for (const i of [0, 1]) {
      const sh = 8 + 4 * i;
      if (!((etsel >> (sh + 3)) & 1) || !(evs & ET_SEL[(etsel >> sh) & 7])) continue;
      const every = (etps >> sh) & 3;
      if (!every) continue;
      if (++m.socCnt[i] < every) continue;
      m.socCnt[i] = 0;
      const name = i ? "SOCB" : "SOCA";
      dev.set(`${m.pre}.ETFLG`, 1, name);
      b.fireTrigger(`EPWM${m.n}${name}`, t);
    }
    if (etsel & 8 && evs & ET_SEL[etsel & 7]) {
      const every = etps & 3;
      if (every) {
        if (m.intCnt < every) m.intCnt++;
        if (m.intCnt >= every) {
          if (dev.get(`${m.pre}.ETFLG`, "INT")) m.intPending = true;
          else this.interrupt(m);
        }
      }
    }
    const syncosel = (dev.get(`${m.pre}.TBCTL`) >> 4) & 3;
    if ((syncosel === 1 && evs & ZRO) || (syncosel === 2 && evs & (CBU | CBD))) this.syncOut(m, t);
  }

  private interrupt(m: EpwmModule): void {
    m.intCnt = 0;
    this.b.dev.set(`${m.pre}.ETFLG`, 1, "INT");
    this.b.pie.raise(3, m.n);
  }

  // ---------- synchronisation ----------

  private syncOut(m: EpwmModule, t: number): void {
    for (const c of SYNC_CHILDREN[m.n] ?? []) this.syncIn(this.mod(c), t);
  }

  private syncIn(m: EpwmModule, t: number): void {
    const dev = this.b.dev;
    const tbctl = dev.get(`${m.pre}.TBCTL`);
    if (tbctl & 4) {
      const phs = dev.get(`${m.pre}.TBPHS`, "TBPHS");
      const up = m.mode === 2 ? (tbctl & 0x2000) !== 0 : m.mode !== 1;
      if (m.mode === 3) this.setCounter(m, phs, up, t);
      else {
        const span = this.cycle(m) * m.tick;
        const t0 = t - this.position(m, phs, up) * m.tick;
        // Already in step: nothing to do.
        if ((((t0 - m.t0) % span) + span) % span !== 0) {
          this.setCounter(m, phs, up, t);
          this.reconfigure(m, t);
        }
      }
    }
    if (((tbctl >> 4) & 3) === 0) this.syncOut(m, t);
  }

  // ---------- diagnostics ----------

  private checkCompare(m: EpwmModule): void {
    const b = this.b;
    const dev = b.dev;
    const s = this.shadow(m);
    if (s.prd === 0) return;
    const aq = dev.get(`${m.pre}.AQCTLA`) | dev.get(`${m.pre}.AQCTLB`);
    for (const [name, value, mask] of [["CMPA", s.cmpa, 0x0f0], ["CMPB", s.cmpb, 0xf00]] as const) {
      if (value <= s.prd || !(aq & mask)) continue;
      b.warn(
        b.line,
        "cmp-over-period",
        `EPWM${m.n}: ${name} is ${value} but TBPRD is ${s.prd}. The counter never reaches ${name}, so the compare action never happens and the output stops switching. Keep ${name} between 0 and TBPRD.`,
      );
    }
  }

  /** A fractional float assigned to CMPA / CMPB is cut off, not rounded. */
  private checkFloat(reg: string): void {
    const b = this.b;
    const text = this.source[b.line - 1];
    if (!text) return;
    const m = new RegExp(`\\.${reg}\\.bit\\.${reg}\\s*=\\s*([^;=]+);`).exec(text);
    if (!m) return;
    const rhs = m[1].trim();
    let v: number | undefined;
    if (/^(\d+\.\d*|\.\d+)[fF]?$/.test(rhs)) v = parseFloat(rhs);
    else if (/^[A-Za-z_]\w*$/.test(rhs) && b.compiler.globals.get(rhs)?.t.k === "float") v = b.readVar(rhs);
    if (v === undefined || !Number.isFinite(v) || v === Math.trunc(v)) return;
    b.warn(
      b.line,
      "cmp-float",
      `${reg} is a 16-bit integer: the float value ${+v.toPrecision(6)} was cut off to ${Math.trunc(v)} (C truncates, it does not round). ${Math.abs(v) < 1 ? `If ${rhs} is a duty cycle between 0 and 1, multiply it by TBPRD.` : "That is fine if you meant it."}`,
      "info",
    );
  }
}

export const plugin: SimPlugin = {
  name: "epwm",
  install(b) {
    b.plugins.set("epwm", new Epwm(b));
  },
};
