import { describe, expect, it } from "vitest";
import { Board } from "../src/sim/board";
import { runProgram } from "../src/sim/runner";
import type { PinChange } from "../src/sim/periph/gpio";
import {
  NO_ACTIONS, PRESETS, RESET, code, counterAt, levelAt, propose, pwmPin, simulate,
  type Aq, type OutStat, type PwmSettings, type Signal,
} from "../src/ui/figures/pwm-model";

// The model behind the "ePWM playground" figure, checked two ways: against
// cases worked out by hand from the Technical Reference Manual (SPRUHM8I,
// chapter 15), and against the game's simulator (src/sim/plugins/epwm.ts)
// running the C lines the figure prints.

const aq = (a: Partial<Aq>): Aq => ({ ...NO_ACTIONS, ...a });
const cfg = (p: Partial<PwmSettings>): PwmSettings => ({ ...RESET, ...p });
const pct = (x: OutStat) => +(x.duty * 100).toFixed(4);
/** Edge times and levels of a signal. */
const edges = (x: Signal) => x.edges.map((e) => [e.t, e.level]);

describe("pwm-model against the TRM", () => {
  it("TBCLK = EPWMCLK / (HSPCLKDIV x CLKDIV), 15.15.2.1", () => {
    expect(simulate(RESET, 0).tbclkHz).toBe(50e6); // HSPCLKDIV resets to /2
    expect(simulate(cfg({ hspclkdiv: 0 }), 0).tbclkHz).toBe(100e6);
    expect(simulate(cfg({ hspclkdiv: 3 }), 0).tickNs).toBeCloseTo(60, 9); // /6
    expect(simulate(cfg({ hspclkdiv: 7, clkdiv: 7 }), 0).tbclkHz).toBeCloseTo(100e6 / (14 * 128), 6);
    expect(simulate(cfg({ clkdiv: 5 }), 0).tbclkHz).toBe(1562500);
  });

  it("period: TBPRD + 1 counts up or down, 2 x TBPRD up-down (Figure 15-6, TBPRD = 4)", () => {
    expect(simulate(cfg({ ctrmode: 0, tbprd: 4 }), 20).cycleTicks).toBe(5);
    expect(simulate(cfg({ ctrmode: 1, tbprd: 4 }), 20).cycleTicks).toBe(5);
    expect(simulate(cfg({ ctrmode: 2, tbprd: 4 }), 20).cycleTicks).toBe(8);
    const up = simulate(cfg({ ctrmode: 0, tbprd: 4 }), 12);
    expect([0, 1, 2, 3, 4, 5, 6, 9, 10].map((t) => counterAt(up, t))).toEqual([0, 1, 2, 3, 4, 0, 1, 4, 0]);
    const ud = simulate(cfg({ ctrmode: 2, tbprd: 4 }), 20);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => counterAt(ud, t))).toEqual([0, 1, 2, 3, 4, 3, 2, 1, 0, 1]);
    // Down count: the counter is 0 after reset, then reloads TBPRD.
    const down = simulate(cfg({ ctrmode: 1, tbprd: 4 }), 12);
    expect([0, 1, 2, 3, 4, 5, 6].map((t) => counterAt(down, t))).toEqual([0, 4, 3, 2, 1, 0, 4]);
    // The course's numbers: TBPRD = 5000 at 50 MHz is 5001 counts, 9998 Hz.
    const led = simulate(PRESETS[0].settings, 0);
    expect(led.periodNs).toBe(100020);
    expect(led.freqHz).toBeCloseTo(9998.0004, 3);
  });

  it("freeze and TBPRD = 0: nothing moves, no NaN", () => {
    for (const s of [RESET, cfg({ ctrmode: 0 }), cfg({ ctrmode: 2 }), cfg({ ctrmode: 3, tbprd: 100, aqa: aq({ ZRO: 2 }) })]) {
      const r = simulate(s, 1000);
      expect(r.stopped).not.toBeNull();
      expect(r.a.edges).toEqual([]);
      expect(r.statA).toEqual({ switching: false, level: 0, duty: 0, freqHz: 0 });
      expect(r.freqHz).toBe(0);
    }
  });

  it("up count, set at zero and clear at CMPA: CMPA of TBPRD + 1 counts high", () => {
    const r = simulate(cfg({ ctrmode: 0, tbprd: 4999, cmpa: 1250, aqa: aq({ ZRO: 2, CAU: 1 }) }), 10000);
    expect(pct(r.statA)).toBe(25);
    expect(r.statA.freqHz).toBe(10000);
    expect(edges(r.a)).toEqual([[0, 1], [1250, 0], [5000, 1], [6250, 0]]);
    expect(r.a.edges[1].why).toBe("CAU: clear");
    expect(r.statB.switching).toBe(false);
  });

  it("up count, compare value above the period never matches (Table 15-7)", () => {
    const r = simulate(cfg({ ctrmode: 0, tbprd: 5000, cmpa: 5001, aqa: aq({ ZRO: 2, CAU: 1 }) }), 20000);
    expect(r.statA).toMatchObject({ switching: false, level: 1, duty: 1 });
    expect(r.never).toEqual(["CAD", "CBD", "CAU"]);
    expect(r.above).toEqual(["CMPA"]);
    // CMPA = TBPRD still matches: high for TBPRD of TBPRD + 1 counts.
    expect(simulate(cfg({ ctrmode: 0, tbprd: 4, cmpa: 4, aqa: aq({ ZRO: 2, CAU: 1 }) }), 20).statA.duty).toBeCloseTo(0.8, 12);
  });

  it("up count priorities (Table 15-5): PRD over CBU over CAU over ZRO", () => {
    // CMPA = 0: CAU and ZRO share count 0, CAU wins, the pin never goes high.
    const zero = simulate(cfg({ ctrmode: 0, tbprd: 5000, aqa: aq({ ZRO: 2, CAU: 1 }) }), 20000);
    expect(zero.statA).toMatchObject({ switching: false, level: 0 });
    expect(zero.clashes).toEqual([{ ctr: 0, out: "A", win: "CAU", action: 1, beat: ["ZRO"] }]);
    // CMPA = CMPB = TBPRD: all three on the last count; PRD wins.
    const top = simulate(cfg({ ctrmode: 0, tbprd: 4, cmpa: 4, cmpb: 4, aqa: aq({ PRD: 2, CBU: 1, CAU: 1, ZRO: 1 }) }), 40);
    expect(top.statA.duty).toBeCloseTo(0.2, 12);
    expect(top.clashes[0]).toMatchObject({ ctr: 4, win: "PRD", beat: ["CBU", "CAU"] });
    // CBU over CAU.
    const same = simulate(cfg({ ctrmode: 0, tbprd: 9, cmpa: 5, cmpb: 5, aqa: aq({ ZRO: 2, CAU: 1, CBU: 2 }) }), 40);
    expect(same.statA).toMatchObject({ switching: false, level: 1 });
  });

  it("an event with action 0 does not hide a lower one (the buzzer: CAU = 0 at CMPA = 0, ZRO = toggle)", () => {
    const r = simulate(cfg({ ctrmode: 0, clkdiv: 2, tbprd: 14204, aqa: aq({ ZRO: 3 }) }), 60000);
    expect(pct(r.statA)).toBe(50);
    expect(r.statA.freqHz).toBeCloseTo(12.5e6 / 14205 / 2, 6);
  });

  it("down count (Tables 15-6 and 15-7)", () => {
    // Counter 4 3 2 1 0: set at the period count, clear at CMPA = 2 going down: high for 2 of 5 counts.
    const r = simulate(cfg({ ctrmode: 1, tbprd: 4, cmpa: 2, aqa: aq({ PRD: 2, CAD: 1 }) }), 40);
    expect(r.statA.duty).toBeCloseTo(0.4, 12);
    expect(r.never).toEqual(["CAU", "CBU"]);
    // The up events never occur.
    expect(simulate(cfg({ ctrmode: 1, tbprd: 4, cmpa: 2, aqa: aq({ PRD: 2, CAU: 1 }) }), 40).statA).toMatchObject({ switching: false, level: 1 });
    // CMPA at or above TBPRD: CAD falls on the period count and beats PRD.
    for (const cmpa of [4, 9]) {
      const top = simulate(cfg({ ctrmode: 1, tbprd: 4, cmpa, aqa: aq({ PRD: 2, CAD: 1 }) }), 40);
      expect(top.statA).toMatchObject({ switching: false, level: 0 });
      expect(top.clashes).toEqual([{ ctr: 4, out: "A", win: "CAD", action: 1, beat: ["PRD"] }]);
    }
    // Zero beats a compare match at CMPA = 0.
    expect(simulate(cfg({ ctrmode: 1, tbprd: 4, cmpa: 0, aqa: aq({ ZRO: 2, CAD: 1, PRD: 1 }) }), 40).statA.duty).toBeCloseTo(0.2, 12);
  });

  it("up-down count, CAU = set, CAD = clear: Figure 15-24 (TBPRD = 4)", () => {
    const duty = (cmpa: number) => pct(simulate(cfg({ ctrmode: 2, tbprd: 4, cmpa, aqa: aq({ CAU: 2, CAD: 1 }) }), 64).statA);
    expect([4, 3, 2, 1, 0].map(duty)).toEqual([0, 25, 50, 75, 100]);
    // Above the period both events fall on the period count (Table 15-7): still 0 %.
    expect(duty(9)).toBe(0);
    // The pulse is centred on the peak.
    const r = simulate(cfg({ ctrmode: 2, tbprd: 1250, cmpa: 750, aqa: aq({ CAU: 2, CAD: 1 }) }), 5000);
    expect(edges(r.a)).toEqual([[750, 1], [1750, 0], [3250, 1], [4250, 0]]);
    expect(r.statA.freqHz).toBe(20000);
  });

  it("up-down count priorities (Table 15-4)", () => {
    // Incrementing: CBU over CAU. Decrementing: CBD over CAD.
    const r = simulate(cfg({ ctrmode: 2, tbprd: 10, cmpa: 4, cmpb: 4, aqa: aq({ CAU: 1, CBU: 2, CAD: 2, CBD: 1 }) }), 80);
    expect(r.statA.duty).toBeCloseTo(0.6, 12);
    expect(r.clashes.map((c) => [c.win, c.beat])).toEqual([["CBU", ["CAU"]], ["CBD", ["CAD"]]]);
    // At zero (incrementing) CAU is above ZRO; at the period (decrementing) CAD is above PRD.
    expect(simulate(cfg({ ctrmode: 2, tbprd: 10, cmpa: 0, aqa: aq({ ZRO: 1, CAU: 2, PRD: 1 }) }), 80).statA.duty).toBeCloseTo(0.5, 12);
    expect(simulate(cfg({ ctrmode: 2, tbprd: 10, cmpa: 10, aqa: aq({ PRD: 1, CAD: 2, ZRO: 1 }) }), 80).statA.duty).toBeCloseTo(0.5, 12);
  });

  it("both outputs share the counter and use either compare register (Figure 15-25)", () => {
    const r = simulate(cfg({ ctrmode: 0, tbprd: 9, cmpa: 3, cmpb: 7, aqa: aq({ ZRO: 2, CAU: 1 }), aqb: aq({ ZRO: 2, CBU: 1 }) }), 40);
    expect(r.statA.duty).toBeCloseTo(0.3, 12);
    expect(r.statB.duty).toBeCloseTo(0.7, 12);
    expect(r.statB.freqHz).toBe(r.statA.freqHz);
  });

  it("toggling twice per period keeps the frequency", () => {
    const r = simulate(cfg({ ctrmode: 2, tbprd: 1000, cmpa: 300, aqa: aq({ CAU: 3, CAD: 3 }) }), 8000);
    expect(pct(r.statA)).toBe(70);
    expect(r.statA.freqHz).toBe(25000);
  });

  it("shadow loading of CMPA (15.5.3, CMPCTL)", () => {
    const base = cfg({ ctrmode: 0, tbprd: 4999, cmpa: 1000, aqa: aq({ ZRO: 2, CAU: 1 }), cmpaNext: 3000, cmpaWriteAt: 500 });
    const falls = (s: PwmSettings) => simulate(s, 15000).a.edges.filter((e) => !e.level).map((e) => e.t);
    // Shadow, load at zero (reset): the pulse in progress keeps the old width.
    expect(falls(base)).toEqual([1000, 8000, 13000]);
    expect(simulate(base, 15000).loads).toEqual([{ t: 5000, cmpa: 3000 }]);
    // Load at the period count: in effect from the next cycle as well.
    expect(falls({ ...base, loadamode: 1 })).toEqual([1000, 8000, 13000]);
    expect(falls({ ...base, loadamode: 2 })).toEqual([1000, 8000, 13000]);
    // Freeze: the new value never arrives.
    expect(falls({ ...base, loadamode: 3 })).toEqual([1000, 6000, 11000]);
    // Immediate: the pulse in progress is stretched.
    expect(falls({ ...base, shdwamode: 1 })).toEqual([3000, 8000, 13000]);
    // Immediate, new value already passed: the pulse lasts until the next match.
    expect(falls({ ...base, cmpa: 3000, cmpaNext: 1000, cmpaWriteAt: 2000, shdwamode: 1 })).toEqual([6000, 11000]);
    expect(falls({ ...base, cmpa: 3000, cmpaNext: 1000, cmpaWriteAt: 2000 })).toEqual([3000, 6000, 11000]);
    // Up-down, load at the period count: the way down already uses the new value.
    const ud = cfg({ ctrmode: 2, tbprd: 1000, cmpa: 400, aqa: aq({ CAU: 2, CAD: 1 }), cmpaNext: 800, cmpaWriteAt: 100, loadamode: 1 });
    expect(edges(simulate(ud, 4000).a)).toEqual([[400, 1], [1200, 0], [2800, 1], [3200, 0]]);
    // The steady-state numbers ignore the write.
    expect(pct(simulate(base, 15000).statA)).toBe(20);
  });

  it("phase loading on a sync pulse (15.4.3.3)", () => {
    const base = cfg({ ctrmode: 0, tbprd: 4999, cmpa: 2500, aqa: aq({ ZRO: 2, CAU: 1 }), tbphs: 1000, sync: "once", syncAt: 2000 });
    // PHSEN = 0: the pulse is ignored.
    const off = simulate(base, 12000);
    expect(off.syncs).toEqual([2000]);
    expect(counterAt(off, 2000)).toBe(2000);
    // PHSEN = 1: TBCTR = TBPHS at the pulse, and the cycle continues from there.
    const on = simulate({ ...base, phsen: true }, 12000);
    expect([1999, 2000, 2001, 5999, 6000].map((t) => counterAt(on, t))).toEqual([1999, 1000, 1001, 4999, 0]);
    expect(edges(on.a)).toEqual([[0, 1], [3500, 0], [6000, 1], [8500, 0], [11000, 1]]);
    // A master with the same period: a constant shift of TBPRD + 1 - TBPHS counts.
    const every = simulate({ ...base, phsen: true, sync: "every" }, 12000);
    expect(every.a.edges.filter((e) => e.level).map((e) => e.t)).toEqual([4000, 9000]);
    // Up-down: PHSDIR chooses the direction after the load.
    const ud = cfg({ ctrmode: 2, tbprd: 1000, phsen: true, tbphs: 400, sync: "once", syncAt: 100 });
    expect([100, 101].map((t) => counterAt(simulate({ ...ud, phsdir: 1 }, 3000), t))).toEqual([400, 401]);
    expect([100, 101].map((t) => counterAt(simulate({ ...ud, phsdir: 0 }, 3000), t))).toEqual([400, 399]);
  });

  describe("dead band (15.7.3, Figure 15-33, Tables 15-8 and 15-10)", () => {
    // EPWMxA high from count 1000 to 3000 of a 5000-count period.
    const base = cfg({ ctrmode: 0, tbprd: 4999, cmpa: 1000, cmpb: 3000, aqa: aq({ CAU: 2, CBU: 1 }), dbred: 100, dbfed: 200 });
    const out = (p: Partial<PwmSettings>) => {
      const r = simulate({ ...base, ...p }, 5000);
      return [r.outA.init, edges(r.outA), r.outB.init, edges(r.outB)];
    };

    it("mode 1: OUT_MODE = 0 passes both through", () => {
      const r = simulate({ ...base, aqb: aq({ ZRO: 2, CAU: 1 }), dbPolsel: 3, dbInMode: 3 }, 5000);
      expect(r.outA).toBe(r.a);
      expect(r.outB).toBe(r.b);
      expect(r.redNs).toBe(0);
    });

    it("mode 2: active high complementary (POLSEL = 2, OUT_MODE = 3)", () => {
      // A rises DBRED late; B is the inverse of A with its falling edge delayed by DBFED.
      expect(out({ dbOutMode: 3, dbPolsel: 2 })).toEqual([0, [[1100, 1], [3000, 0]], 1, [[1000, 0], [3200, 1]]]);
      // Both are low for RED after B falls and for FED after A falls: never both high.
      const r = simulate({ ...base, dbOutMode: 3, dbPolsel: 2 }, 20000);
      for (let t = 0; t < 20000; t += 50) expect(levelAt(r.outA, t) & levelAt(r.outB, t)).toBe(0);
      expect(r.statOutA.duty).toBeCloseTo(1900 / 5000, 12);
      expect(r.statOutB.duty).toBeCloseTo(2800 / 5000, 12);
    });

    it("modes 3 to 5: ALC, AH, AL", () => {
      expect(out({ dbOutMode: 3, dbPolsel: 1 })).toEqual([1, [[1100, 0], [3000, 1]], 0, [[1000, 1], [3200, 0]]]);
      expect(out({ dbOutMode: 3, dbPolsel: 0 })).toEqual([0, [[1100, 1], [3000, 0]], 0, [[1000, 1], [3200, 0]]]);
      expect(out({ dbOutMode: 3, dbPolsel: 3 })).toEqual([1, [[1100, 0], [3000, 1]], 1, [[1000, 0], [3200, 1]]]);
    });

    it("modes 6 and 7: one delay bypassed", () => {
      // OUT_MODE = 1: A out = A in, B out = A in with the falling edge delayed.
      expect(out({ dbOutMode: 1 })).toEqual([0, [[1000, 1], [3000, 0]], 0, [[1000, 1], [3200, 0]]]);
      // OUT_MODE = 2: A out = A in with the rising edge delayed, B out = B in.
      expect(out({ dbOutMode: 2, aqb: aq({ ZRO: 2, CAU: 1 }) })).toEqual([0, [[1100, 1], [3000, 0]], 0, [[0, 1], [1000, 0]]]);
    });

    it("IN_MODE selects the source of each delay", () => {
      const b = { aqb: aq({ ZRO: 2, CAU: 1 }) }; // B high from 0 to 1000
      // 1: B feeds the rising-edge delay, A the falling-edge delay.
      expect(out({ ...b, dbOutMode: 3, dbInMode: 1 })).toEqual([0, [[100, 1], [1000, 0]], 0, [[1000, 1], [3200, 0]]]);
      // 2: A feeds the rising-edge delay, B the falling-edge delay.
      expect(out({ ...b, dbOutMode: 3, dbInMode: 2 })).toEqual([0, [[1100, 1], [3000, 0]], 0, [[0, 1], [1200, 0]]]);
      // 3: B feeds both.
      expect(out({ ...b, dbOutMode: 3, dbInMode: 3 })).toEqual([0, [[100, 1], [1000, 0]], 0, [[0, 1], [1200, 0]]]);
    });

    it("a pulse shorter than the rising-edge delay disappears", () => {
      const r = simulate({ ...base, dbOutMode: 3, dbPolsel: 2, dbred: 2000 }, 20000);
      expect(r.outA.edges).toEqual([]);
      expect(r.statOutA).toMatchObject({ switching: false, level: 0 });
      // ...and a gap shorter than the falling-edge delay is filled.
      expect(simulate({ ...base, dbOutMode: 1, dbfed: 3000 }, 20000).statOutB).toMatchObject({ switching: false, level: 1 });
    });

    it("delay = register value x TBCLK period (Table 15-10)", () => {
      const us = (hspclkdiv: number, clkdiv: number, n: number) => simulate({ ...base, hspclkdiv, clkdiv, dbOutMode: 3, dbred: n, dbfed: n }, 0).redNs / 1000;
      expect([1, 100, 1000].map((n) => us(0, 0, n))).toEqual([0.01, 1, 10]);
      expect([5, 400, 900].map((n) => us(1, 0, n))).toEqual([0.1, 8, 18]);
      expect([10, 600].map((n) => us(1, 1, n))).toEqual([0.4, 24]);
      expect(simulate({ ...base, dbOutMode: 1 }, 0)).toMatchObject({ redNs: 0, fedNs: 4000 });
    });
  });

  it("event trigger: selection and prescale (ETSEL, ETPS)", () => {
    const base = cfg({ ctrmode: 2, tbprd: 1000, cmpa: 300, cmpb: 600, socaen: true, socben: true, inten: true });
    const r = simulate({ ...base, socasel: 2, socaprd: 1, socbsel: 3, socbprd: 3, intsel: 1, intprd: 2 }, 8000);
    expect(r.soca).toEqual([1000, 3000, 5000, 7000]); // every period, at the peak
    expect(r.socb).toEqual([2000, 5000]); // zero and period: every third of 0, 1000, 2000, ...
    expect(r.int).toEqual([2000, 6000]); // every second zero (the one at t = 0 counts)
    expect([r.socaHz, r.socbHz, r.intHz]).toEqual([25000, 2 * 25000 / 3, 12500]);
    // The four compare events.
    const cmp = simulate({ ...base, socasel: 4, socaprd: 1, socbsel: 7, socbprd: 1, intsel: 5, intprd: 1 }, 2000);
    expect([cmp.soca, cmp.socb, cmp.int]).toEqual([[300], [1400], [1700]]);
    // A prescale of 0 passes nothing, and so does a selection of 0 or a cleared enable bit.
    const none = simulate({ ...base, socasel: 2, socaprd: 0, socbsel: 0, socbprd: 1, inten: false, intsel: 1, intprd: 1 }, 8000);
    expect([none.soca, none.socb, none.int, none.socaHz, none.socbHz, none.intHz]).toEqual([[], [], [], 0, 0, 0]);
    // An event that never occurs in this count mode gives no pulse.
    expect(simulate(cfg({ ctrmode: 0, tbprd: 999, cmpa: 300, socaen: true, socasel: 5, socaprd: 1 }), 8000).soca).toEqual([]);
  });

  it("resolution: one count of the period (Table 15-13: 20 kHz at 100 MHz is 0.02 %, 12.3 bits)", () => {
    const r = simulate(cfg({ ctrmode: 0, hspclkdiv: 0, tbprd: 4999 }), 0);
    expect(r.freqHz).toBe(20000);
    expect(r.resolutionPct).toBeCloseTo(0.02, 12);
    expect(r.resolutionBits).toBeCloseTo(12.3, 1);
  });

  it("proposes dividers and TBPRD for a frequency", () => {
    expect(propose(10000, 0)).toEqual({ hspclkdiv: 1, clkdiv: 0, tbprd: 4999, actualHz: 10000 });
    expect(propose(20000, 2)).toEqual({ hspclkdiv: 1, clkdiv: 0, tbprd: 1250, actualHz: 20000 });
    // 50 Hz does not fit at 50 MHz: the smallest divider that does.
    expect(propose(50, 0)).toEqual({ hspclkdiv: 1, clkdiv: 4, tbprd: 62499, actualHz: 50 });
    for (const f of [0, -1, NaN, 1e-9, 0.5, 1e12, Infinity]) {
      const p = propose(f, 0);
      expect(p.tbprd).toBeGreaterThanOrEqual(1);
      expect(p.tbprd).toBeLessThanOrEqual(65535);
      expect(Number.isFinite(p.actualHz)).toBe(true);
    }
  });

  it("no NaN or endless loop at any extreme", () => {
    const all: Aq = { ZRO: 3, PRD: 3, CAU: 3, CAD: 3, CBU: 3, CBD: 3 };
    const finite = (v: unknown, path: string): void => {
      if (typeof v === "number") expect(Number.isFinite(v), path).toBe(true);
      else if (Array.isArray(v)) v.slice(0, 50).forEach((x, i) => finite(x, `${path}[${i}]`));
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) finite(x, `${path}.${k}`);
    };
    for (const ctrmode of [0, 1, 2, 3])
      for (const tbprd of [0, 1, 2, 65535])
        for (const cmp of [0, 1, tbprd, 65535])
          for (const div of [0, 7]) {
            const s = cfg({
              ctrmode, tbprd, cmpa: cmp, cmpb: 65535 - cmp, hspclkdiv: div, clkdiv: div, aqa: all, aqb: aq({ ZRO: 2, CBU: 1, CBD: 1 }),
              phsen: true, tbphs: cmp, sync: "every", dbOutMode: 3, dbPolsel: 2, dbred: 16383, dbfed: cmp & 16383,
              socaen: true, socasel: 3, socaprd: 1, socben: true, socbsel: 6, socbprd: 3, inten: true, intsel: 7, intprd: 2,
              cmpaNext: tbprd >> 1, cmpaWriteAt: 3,
            });
            const r = simulate(s, 3 * Math.max(1, tbprd) * 2);
            finite(r, `mode ${ctrmode} prd ${tbprd} cmp ${cmp} div ${div}`);
            expect(code(s).length).toBeGreaterThan(0);
          }
    // Out-of-range and broken input is forced into range.
    const bad = simulate({ ...RESET, ctrmode: 0, tbprd: NaN, cmpa: -5, clkdiv: 99, hspclkdiv: -1, dbred: 1e9 }, Infinity);
    finite(bad, "bad");
  });

  it("prints only the lines that differ from reset", () => {
    expect(code(RESET)).toEqual([]);
    expect(code(PRESETS[0].settings, 12)).toEqual([
      "EPwm12Regs.TBCTL.bit.CTRMODE = 0;  // count up",
      "EPwm12Regs.TBPRD = 5000;",
      "EPwm12Regs.CMPA.bit.CMPA = 2500;",
      "EPwm12Regs.AQCTLA.bit.ZRO = 2;  // set",
      "EPwm12Regs.AQCTLA.bit.CAU = 1;  // clear",
      "GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 5);  // GPIO22 becomes EPWM12A",
    ]);
  });
});

// ---------- against the simulator ----------

const NS_MS = 1e6;

function program(lines: string[], extra = ""): string {
  return `void main(void)\n{\n    InitSysCtrl();\n    InitGpio();\n${lines.map((l) => `    ${l}`).join("\n")}\n${extra}\n    while (1) {\n    }\n}\n`;
}

interface Measured {
  switching: boolean;
  level: number;
  duty: number;
  periodNs: number;
}

/** Duty cycle and period of a pin trace between `from` and `to` (ns), over whole periods. */
function measure(trace: PinChange[] | undefined, from: number, to: number): Measured {
  const tr = trace ?? [];
  let level = 0;
  for (const c of tr) if (c.t <= from) level = c.level;
  const inside = tr.filter((c) => c.t > from && c.t < to);
  const rises = inside.filter((c) => c.level === 1);
  if (rises.length < 2) return { switching: inside.length > 0, level, duty: level, periodNs: 0 };
  const t0 = rises[0].t;
  const t1 = rises[rises.length - 1].t;
  let high = 0;
  let last = t0;
  let lv = 1;
  for (const c of inside) {
    if (c.t <= t0 || c.t > t1) continue;
    if (lv) high += c.t - last;
    lv = c.level;
    last = c.t;
  }
  return { switching: true, level, duty: high / (t1 - t0), periodNs: (t1 - t0) / (rises.length - 1) };
}

/** Runs the C lines the figure prints and compares both pins with the model's action-qualifier outputs. */
function compare(s: PwmSettings, n: number, allow: string[] = []) {
  const m = simulate(s, 0);
  const lines = code(s, n);
  // Twelve counter periods after a settling time; a toggling pin needs two periods for one of its own.
  const settle = 3 * m.periodNs;
  const span = 12.4 * m.periodNs;
  const r = runProgram({ kit: "robot", source: program(lines), durationMs: (settle + span) / NS_MS + 0.01 });
  expect(r.compileError, JSON.stringify(r.compileError)).toBeUndefined();
  expect(r.runtimeError, JSON.stringify(r.runtimeError)).toBeUndefined();
  expect(r.diagnostics.map((d) => d.code).filter((c) => !allow.includes(c))).toEqual([]);
  for (const [out, st] of [[0, m.statA], [1, m.statB]] as [0 | 1, OutStat][]) {
    const got = measure(r.traces.get(pwmPin(n, out).pin), settle, settle + span);
    const what = `EPWM${n}${out ? "B" : "A"}`;
    expect(got.switching, `${what} switches`).toBe(st.switching);
    if (st.switching) {
      expect(got.periodNs / (1e9 / st.freqHz), `${what} period`).toBeCloseTo(1, 7);
      // A pin that only toggles has no fixed polarity: which half is high depends on the
      // first event after the action is written, and the program writes AQCTLx after it
      // releases the counter. Either polarity is the same waveform.
      const aqx = Object.values(out ? s.aqb : s.aqa);
      const free = aqx.includes(3) && !aqx.includes(1) && !aqx.includes(2);
      const duty = free && Math.abs(got.duty - st.duty) > 1e-6 ? 1 - got.duty : got.duty;
      expect(duty, `${what} duty`).toBeCloseTo(st.duty, 7);
    }
    else if (EVENTS_USED(s, out)) expect(got.level, `${what} level`).toBe(st.level);
  }
  return { model: m, run: r, lines };
}

/** The output has an action, so the figure's code muxes its pin. */
const EVENTS_USED = (s: PwmSettings, out: 0 | 1) => Object.values(out ? s.aqb : s.aqa).some((a) => a !== 0);

/** Times (ns) of a trigger line while the lines run for `ms`. */
function triggers(lines: string[], line: string, ms: number): number[] {
  const b = new Board();
  const times: number[] = [];
  b.onTrigger(line, (t) => times.push(t));
  b.load(program(lines));
  b.runUntil(b.run(), ms * NS_MS);
  return times;
}

describe("pwm-model against the simulator", () => {
  const cases: [string, PwmSettings, string[]?][] = [
    ["up count, A: set at zero, clear at CMPA", cfg({ ctrmode: 0, tbprd: 5000, cmpa: 1250, aqa: aq({ ZRO: 2, CAU: 1 }) })],
    ["up count, active low: clear at zero, set at CMPA (75 % of 5000 counts)", cfg({ ctrmode: 0, tbprd: 4999, cmpa: 1250, aqa: aq({ ZRO: 1, CAU: 2 }) })],
    ["up count, A on CMPA and B on CMPB", cfg({ ctrmode: 0, tbprd: 2500, cmpa: 700, cmpb: 1900, aqa: aq({ ZRO: 2, CAU: 1 }), aqb: aq({ CBU: 2, PRD: 1 }) })],
    ["up count, B placed between CMPA and CMPB", cfg({ ctrmode: 0, tbprd: 2499, cmpa: 500, cmpb: 2000, aqb: aq({ CAU: 2, CBU: 1 }) })],
    ["down count", cfg({ ctrmode: 1, tbprd: 4999, cmpa: 1000, cmpb: 4000, aqa: aq({ PRD: 2, CAD: 1 }), aqb: aq({ CBD: 2, ZRO: 1 }) })],
    ["up-down count, centred pulse on A, valley pulse on B", cfg({ ctrmode: 2, tbprd: 1250, cmpa: 500, cmpb: 450, aqa: aq({ CAU: 2, CAD: 1 }), aqb: aq({ CBU: 1, CBD: 2 }) })],
    ["up-down count, CMPA = 0 (100 %) and CMPB = TBPRD (0 %)", cfg({ ctrmode: 2, tbprd: 1250, cmpa: 0, cmpb: 1250, aqa: aq({ CAU: 2, CAD: 1 }), aqb: aq({ CBU: 2, CBD: 1 }) })],
    ["toggle at the period count: half the frequency", cfg({ ctrmode: 0, clkdiv: 2, tbprd: 14204, aqa: aq({ PRD: 3 }) })],
    ["toggle at zero with CAU = 0 at CMPA = 0", cfg({ ctrmode: 0, tbprd: 9999, aqa: aq({ ZRO: 3 }), aqb: aq({ ZRO: 3, PRD: 3 }) })],
    ["toggle on the way up and on the way down", cfg({ ctrmode: 2, tbprd: 1000, cmpa: 300, aqa: aq({ CAU: 3, CAD: 3 }) })],
    ["CMPA = 0 in up count: the compare match beats zero", cfg({ ctrmode: 0, tbprd: 5000, cmpa: 0, aqa: aq({ ZRO: 2, CAU: 1 }) })],
    ["CMPA above TBPRD in up count: stuck high", cfg({ ctrmode: 0, tbprd: 5000, cmpa: 6000, aqa: aq({ ZRO: 2, CAU: 1 }) }), ["cmp-over-period"]],
    ["CMPA above TBPRD in up-down count: match at the period", cfg({ ctrmode: 2, tbprd: 1000, cmpa: 1500, cmpb: 200, aqa: aq({ CAU: 2, CAD: 1, CBU: 2 }) }), ["cmp-over-period"]],
    ["priority: CBU beats CAU on the same count", cfg({ ctrmode: 0, tbprd: 999, cmpa: 400, cmpb: 400, aqa: aq({ ZRO: 2, CAU: 1, CBU: 2, PRD: 1 }) })],
    ["slow clock: CLKDIV /32, a 20 ms servo frame", cfg({ ctrmode: 0, clkdiv: 5, tbprd: 31250, cmpa: 2500, aqa: aq({ ZRO: 2, CAU: 1 }) })],
    ["HSPCLKDIV /6 and CLKDIV /4", cfg({ ctrmode: 0, hspclkdiv: 3, clkdiv: 2, tbprd: 999, cmpa: 100, aqa: aq({ ZRO: 2, CAU: 1 }) })],
    ["TBPRD = 65535 with the largest dividers set aside", cfg({ ctrmode: 2, tbprd: 65535, cmpa: 65535, cmpb: 1, aqa: aq({ ZRO: 2, CAD: 1 }), aqb: aq({ CBU: 2, CBD: 1 }) })],
  ];
  for (const [name, s, allow] of cases) it(name, () => void compare(s, 1, allow));

  it("every preset: the printed C lines run unchanged and give the model's waveform", () => {
    for (const p of PRESETS) {
      // The simulator has no dead band (it says so with a warning): its pins carry the action-qualifier outputs.
      const { run, model, lines } = compare(p.settings, p.module, p.settings.dbOutMode ? ["epwm-deadband"] : []);
      if (p.settings.dbOutMode) {
        expect(run.diagnostics.map((d) => d.code)).toContain("epwm-deadband");
        expect(model.statOutA.duty).toBeLessThan(model.statA.duty);
      }
      if (p.id === "reset") expect(lines).toEqual([]);
      else expect(lines.length).toBeGreaterThan(3);
    }
  });

  it("the chapter's own EPWM12A lines agree with the LED preset", () => {
    const chapter = [
      "EPwm12Regs.TBCTL.bit.CTRMODE = 0;", "EPwm12Regs.TBCTL.bit.FREE_SOFT = 2;", "EPwm12Regs.TBCTL.bit.PHSEN = 0;",
      "EPwm12Regs.TBCTL.bit.CLKDIV = 0;", "EPwm12Regs.TBCTR = 0;", "EPwm12Regs.TBPRD = 5000;", "EPwm12Regs.CMPA.bit.CMPA = 2500;",
      "EPwm12Regs.AQCTLA.bit.CAU = 1;", "EPwm12Regs.AQCTLA.bit.ZRO = 2;", "EPwm12Regs.TBPHS.bit.TBPHS = 0;",
      "GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 5);",
    ];
    const m = simulate(PRESETS[0].settings, 0);
    const r = runProgram({ kit: "robot", source: program(chapter), durationMs: 2 });
    const got = measure(r.traces.get(22), 0.3 * NS_MS, 1.9 * NS_MS);
    expect(got.periodNs).toBeCloseTo(m.periodNs, 6);
    expect(got.duty).toBeCloseTo(m.statA.duty, 9);
  });

  it("SOCA and SOCB pulses: selection and prescale", () => {
    const sets: PwmSettings[] = [
      cfg({ ctrmode: 2, tbprd: 1250, cmpa: 750, aqa: aq({ CAU: 2, CAD: 1 }), socaen: true, socasel: 2, socaprd: 1 }),
      cfg({ ctrmode: 2, tbprd: 1250, cmpa: 750, cmpb: 300, aqa: aq({ CAU: 2, CAD: 1 }), socaen: true, socasel: 3, socaprd: 3, socben: true, socbsel: 7, socbprd: 2 }),
      cfg({ ctrmode: 0, tbprd: 49999, cmpa: 100, cmpb: 20000, socaen: true, socasel: 1, socaprd: 2, socben: true, socbsel: 6, socbprd: 1 }),
      cfg({ ctrmode: 1, tbprd: 9999, cmpa: 4000, socaen: true, socasel: 5, socaprd: 1, socben: true, socbsel: 4, socbprd: 1 }),
      cfg({ ctrmode: 0, tbprd: 9999, socaen: true, socasel: 2, socaprd: 0, socben: false, socbsel: 1, socbprd: 1 }),
    ];
    for (const s of sets) {
      const periods = 24;
      const m = simulate(s, periods * cycleLen(s));
      const ms = (periods * m.periodNs) / NS_MS;
      for (const [name, model, hz] of [["SOCA", m.soca, m.socaHz], ["SOCB", m.socb, m.socbHz]] as [string, number[], number][]) {
        const got = triggers(code(s, 4), `EPWM4${name}`, ms);
        // The program starts the counter a few statements after t = 0, so one pulse may fall outside.
        expect(Math.abs(got.length - model.length), `${name} count: simulator ${got.length}, model ${model.length}`).toBeLessThanOrEqual(1);
        if (got.length > 2) {
          const spacing = (got[got.length - 1] - got[0]) / (got.length - 1);
          expect(spacing / (1e9 / hz), `${name} spacing`).toBeCloseTo(1, 7);
        }
        else expect(hz === 0 || model.length <= 3).toBe(true);
      }
    }
  });

  it("the SOCA pulse of the centred preset falls in the middle of the high pulse", () => {
    const p = PRESETS.find((x) => x.id === "centre")!;
    const b = new Board();
    const soc: number[] = [];
    b.onTrigger(`EPWM${p.module}SOCA`, (t) => soc.push(t));
    b.load(program(code(p.settings, p.module)));
    b.runUntil(b.run(), 1 * NS_MS);
    const tr = b.gpio.trace.get(pwmPin(p.module, 0).pin) ?? [];
    const rise = tr.filter((c) => c.level === 1).map((c) => c.t);
    const fall = tr.filter((c) => c.level === 0 && c.t > rise[0]).map((c) => c.t);
    const mids = rise.slice(0, fall.length).map((t, k) => (t + fall[k]) / 2);
    expect(soc.length).toBeGreaterThan(10);
    for (const t of soc.slice(1, 10)) expect(mids).toContain(t);
    // The model says the same.
    const m = simulate(p.settings, 5000);
    expect(m.soca).toEqual([1250, 3750]);
    expect(m.a.edges.map((e) => e.t)).toEqual([750, 1750, 3250, 4250]);
  });

  it("the ePWM interrupt with a prescale of 2", () => {
    const s = cfg({ ctrmode: 0, tbprd: 4999, inten: true, intsel: 1, intprd: 2 });
    const lines = code(s, 5);
    const src = `__interrupt void epwm5_isr(void);
uint32_t ticks = 0;
void main(void)
{
    InitSysCtrl();
    InitGpio();
    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();
    EALLOW;
    PieVectTable.EPWM5_INT = &epwm5_isr;
    EDIS;
${lines.map((l) => `    ${l}`).join("\n")}
    PieCtrlRegs.PIEIER3.bit.INTx5 = 1;
    IER |= M_INT3;
    EINT;
    ERTM;
    while (1) {
    }
}
__interrupt void epwm5_isr(void)
{
    ticks++;
    EPwm5Regs.ETCLR.bit.INT = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP3;
}
`;
    const r = runProgram({ kit: "robot", source: src, durationMs: 10.02 });
    expect(r.compileError).toBeUndefined();
    const m = simulate(s, 100 * 5000);
    expect(m.intHz).toBe(5000);
    expect(Math.abs((r.board.readVar("ticks") ?? 0) - m.int.length)).toBeLessThanOrEqual(1);
    expect(m.int.length).toBe(50);
  });

  it("shadow and immediate loading of CMPA: the same pulse widths", () => {
    // Counter period 100 us. CMPA goes from 3000 to 1000 while the counter is near 2000 in the third period.
    const s = cfg({ ctrmode: 0, tbprd: 4999, cmpa: 3000, aqa: aq({ ZRO: 2, CAU: 1 }), cmpaNext: 1000, cmpaWriteAt: 12000 });
    const widths = (shdwamode: number) => {
      const lines = code({ ...s, shdwamode }, 1);
      const r = runProgram({ kit: "robot", source: program(lines, "    DELAY_US(240);\n    EPwm1Regs.CMPA.bit.CMPA = 1000;"), durationMs: 0.75 });
      expect(r.compileError).toBeUndefined();
      const tr = r.traces.get(0) ?? [];
      const sim: number[] = [];
      tr.forEach((c, k) => {
        if (c.level === 1 && tr[k + 1]) sim.push(Math.round((tr[k + 1].t - c.t) / 20));
      });
      const e = simulate({ ...s, shdwamode }, 35000).a.edges;
      const model: number[] = [];
      e.forEach((c, k) => {
        if (c.level === 1 && e[k + 1]) model.push(e[k + 1].t - c.t);
      });
      return { sim, model };
    };
    // The program releases the counter before AQCTLA is written, so the simulator's
    // first pulse starts one period later than the model's: drop the model's first.
    // Shadow: every pulse has the old or the new width.
    const sh = widths(0);
    expect(sh.model).toEqual([3000, 3000, 3000, 1000, 1000, 1000, 1000]);
    expect(sh.sim).toEqual(sh.model.slice(1));
    // Immediate: the match at 1000 has passed, so that pulse runs into the next period.
    const im = widths(1);
    expect(im.model).toEqual([3000, 3000, 6000, 1000, 1000, 1000]);
    expect(im.sim.length).toBe(im.model.length - 1);
    im.sim.forEach((w, k) => expect(Math.abs(w - im.model[k + 1]), `pulse ${k}`).toBeLessThanOrEqual(1));
  });

  it("an immediate-mode CMPA write does not move the time base", () => {
    // TRM 15.5.3: with CMPCTL.SHDWAMODE = 1 a write goes to the active compare register.
    // Nothing in 15.4 lets a compare write touch TBCTR, so rising edges (set at zero) must
    // stay exactly TBPRD + 1 = 5000 counts = 100 000 ns apart across the write.
    const s = cfg({ ctrmode: 0, tbprd: 4999, cmpa: 3000, aqa: aq({ ZRO: 2, CAU: 1 }) });
    const spacing = (shdwamode: number) => {
      const r = runProgram({ kit: "robot", source: program(code({ ...s, shdwamode }, 1), "    DELAY_US(240);\n    EPwm1Regs.CMPA.bit.CMPA = 1000;"), durationMs: 0.75 });
      const rises = (r.traces.get(0) ?? []).filter((c) => c.level === 1).map((c) => c.t);
      return rises.slice(1).map((t, k) => t - rises[k]);
    };
    expect(spacing(0)).toEqual([100000, 100000, 100000, 100000, 100000, 100000]);
    // Immediate: the stretched pulse hides one rising edge, so one spacing is two periods.
    for (const d of spacing(1)) expect(d % 100000).toBe(0);
  });

  it("phase loading from a master with the same period", () => {
    // EPWM1 sends a sync pulse at zero; EPWM2 loads TBPHS = 1000 there.
    const master = cfg({ ctrmode: 0, tbprd: 4999, cmpa: 2500, aqa: aq({ ZRO: 2, CAU: 1 }) });
    const slave: PwmSettings = { ...master, phsen: true, tbphs: 1000, sync: "every" };
    const lines = [...code(master, 1), "EPwm1Regs.TBCTL.bit.SYNCOSEL = 1;", ...code(slave, 2)];
    const r = runProgram({ kit: "robot", source: program(lines), durationMs: 1 });
    expect(r.compileError).toBeUndefined();
    const rises = (pin: number) => (r.traces.get(pin) ?? []).filter((c) => c.level === 1 && c.t > 0.3 * NS_MS).map((c) => c.t);
    const m1 = rises(0);
    const m2 = rises(2);
    const lag = (m2.find((t) => t >= m1[0])! - m1[0]) / 20;
    const model = simulate(slave, 20000).a.edges.filter((e) => e.level).map((e) => e.t);
    expect(lag).toBe(model[0]); // 4000 counts: TBPRD + 1 - TBPHS
    expect(model[1] - model[0]).toBe(5000);
  });
});

function cycleLen(s: PwmSettings): number {
  return s.ctrmode === 2 ? 2 * s.tbprd : s.tbprd + 1;
}
