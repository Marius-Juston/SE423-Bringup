import { describe, expect, it } from "vitest";
import { CHAPTERS, findLevel } from "../src/levels/index";
import type { CodeLevel } from "../src/levels/types";
import { runProgram, type RunResult } from "../src/sim/runner";
import { benchLink, lessonBench } from "../src/sim/wiring/active";
import { HW_BOARD } from "../src/sim/wiring/board";
import { instances, optionsOf } from "../src/sim/wiring/bench";
import { highlightOf } from "../src/sim/wiring/nets";
import { lessonStore } from "../src/ui/wiring/store";
import { spread } from "../src/ui/wiring/BoardPicture";
import { TOURS } from "../src/ui/wiring/tours";
import { figureIdsIn } from "../src/ui/figures";

// Primer D: the board tour and the fault-finding levels on the wiring bench.

type Opts = Record<string, Record<string, string>>;
const level = (id: string) => findLevel(id)!.level as CodeLevel;

/** Runs a fault-finding level with a program and a set of repairs, as the level view does. */
function attempt(l: CodeLevel, repairs: Opts, source = l.starter): RunResult {
  Object.assign(benchLink, lessonBench(l.bench!.faults, repairs));
  try {
    return runProgram({ kit: l.kit, source, durationMs: l.durationMs, stimuli: l.stimuli, checks: l.checks, bonus: l.bonus });
  } finally {
    Object.assign(benchLink, { state: null, engine: null, changes: 0 });
  }
}
const stars = (r: RunResult) => r.bonus.filter((b) => b.pass).length;

describe("primer D: the homework board", () => {
  const ch = CHAPTERS.find((c) => c.id === "primer-d-board")!;

  it("stands after primer C and before chapter 0, and moves no other chapter", () => {
    const order = CHAPTERS.map((c) => c.id);
    expect(order.indexOf("primer-d-board")).toBe(order.indexOf("primer-c-hardware") + 1);
    expect(CHAPTERS[order.indexOf("primer-d-board") + 1].number).toBe(0);
    expect(ch.label).toBe("D");
    expect(ch.levels.map((l) => l.id)).toEqual(["brd-tour", "brd-follow", "brd-led", "brd-button", "brd-jumpers", "brd-fault-led", "brd-fault-pullup", "brd-fault-jumper", "brd-fault-servo"]);
  });

  it("asks in the tour only what the board data says", () => {
    // Each answer the tour's questions give is what the picture's sentence says for that part or pin.
    const says = (p: Parameters<typeof highlightOf>[1]) => highlightOf(lessonBench({}).state, p)!.words;
    expect(says({ t: "pin", n: 21 })).toMatch(/^Pin 21, J3\.1: 5V\./);
    expect(says({ t: "pin", n: 58 })).toMatch(/^Pin 58, J6\.8: /);
    expect(says({ t: "part", id: "LED9" })).toContain("LED9: GPIO26, pin 53, J6.3 through IC2.");
    expect(says({ t: "pin", n: 48 })).toBe("Pin 48, J5.8: GPIO52. Nothing connected. Free for a device of yours.");
    expect(says({ t: "part", id: "LED1" })).toContain("LED1: GPIO22, pin 8, J1.8 through IC1.");
    expect(says({ t: "part", id: "PB3" })).toContain("PB3: GPIO6, pin 80, J8.10.");
    expect(says({ t: "part", id: "JIMU3" })).toMatch(/^IMU jumper MISO: GPIO64, /);
    expect(HW_BOARD.launchpad.pins.find((p) => p[3] === 1)![2]).toBe(HW_BOARD.nets.indexOf("3V3"));
  });

  it("names in each tour lesson's figure what its questions ask about", () => {
    const embeds = (id: string) => figureIdsIn(findLevel(id)!.level.brief);
    expect(embeds("brd-tour")).toEqual(["board-headers"]);
    expect(embeds("brd-follow")).toEqual(["board-leds"]);
    expect(embeds("brd-button")).toEqual(["board-buttons"]);
    expect(embeds("brd-jumpers")).toEqual(["board-jumpers"]);
    // The headers: pin 1 and its neighbour 21, and both ends of J6 around pin 58. It opens on the lesson's own example.
    expect(TOURS.headers.pins).toEqual(expect.arrayContaining([1, 10, 21, 30, 51, 60, 71, 80]));
    expect(TOURS.headers.start).toEqual({ t: "pin", n: 8 });
    // The LEDs: all 16, the three chips, and the pins the lesson follows (LED1 to pin 8, LED9 to pin 53).
    expect(Object.keys(TOURS.leds.parts)).toEqual(expect.arrayContaining(["LED1", "LED9", "LED16", "IC1", "IC2", "IC3"]));
    expect(TOURS.leds.pins).toHaveLength(16);
    expect(TOURS.leds.pins).toEqual(expect.arrayContaining([8, 53]));
    expect(TOURS.leds.pins).not.toContain(48);
    // The buttons: PB3 is on pin 80.
    expect(Object.keys(TOURS.buttons.parts)).toEqual(["PB1", "PB2", "PB3", "PB4"]);
    expect(TOURS.buttons.pins).toContain(80);
    // The jumpers: each IMU jumper's name ends with the pin it carries; the buzzer's pin is named at the LaunchPad.
    expect(TOURS.jumpers.parts.JIMU3).toBe("MISO: GPIO64");
    expect(Object.entries(TOURS.jumpers.parts).filter(([id]) => id.startsWith("JIMU")).map(([, words]) => words).sort()).toEqual(["MISO: GPIO64", "MOSI: GPIO63", "NCS: GPIO66", "SCLK: GPIO65"]);
    expect(TOURS.jumpers.pins).toContain(33);
    // Every region lies on the board, and what a figure opens with is in its first region.
    for (const [name, tour] of Object.entries(TOURS)) {
      for (const v of tour.views) for (const c of [v.crop, ...("narrow" in v ? [v.narrow] : [])]) expect(c[0] >= 0 && c[1] >= 0 && c[0] + c[2] <= HW_BOARD.w + 1e-9 && c[1] + c[3] <= HW_BOARD.h + 1e-9, name).toBe(true);
      const at = tour.start.t === "part" ? HW_BOARD.parts.find((p) => p.id === (tour.start as { id: string }).id)!.box : HW_BOARD.launchpad.pins.find((p) => p[3] === (tour.start as { n: number }).n)!;
      const c = tour.views[0].crop;
      expect(at[0] > c[0] && at[0] < c[0] + c[2] && at[1] > c[1] && at[1] < c[1] + c[3], name).toBe(true);
    }
  });

  it("moves names in a column apart, each as near its own row as it can be", () => {
    expect(spread([10, 20, 30], 5, 0, 100)).toEqual([10, 20, 30]);
    expect(spread([10, 12, 14], 5, 0, 100)).toEqual([7, 12, 17]);
    expect(spread([10, 12, 40], 5, 0, 100)).toEqual([8.5, 13.5, 40]);
    // Kept inside the picture.
    expect(spread([1, 2], 5, 0, 100)).toEqual([0, 5]);
    expect(spread([], 5, 0, 100)).toEqual([]);
  });

  it("keeps briefs short", () => {
    for (const l of ch.levels) {
      const words = l.brief.replace(/\{\{figure:[^}]+\}\}/g, "").split(/\s+/).filter(Boolean).length;
      expect(words, l.id).toBeLessThanOrEqual(360);
      expect(l.hints === undefined || l.hints.length === 3, l.id).toBe(true);
    }
  });

  it("does not say on the page what the fault is", () => {
    for (const l of ch.levels) {
      if (l.kind !== "code" || !l.bench) continue;
      // The bench of a level shows no fault and offers every repair from a neutral start.
      const store = lessonStore(l.bench.faults);
      expect(store.touched!()).toEqual({});
      // Choosing what the board already is counts as no change, so the star cannot be used to probe.
      for (const [id, o] of Object.entries(l.bench.faults)) for (const [k, v] of Object.entries(o)) store.repair!(id, k, v);
      expect(lessonBench(l.bench.faults, store.touched!()).changes).toBe(0);
      // Every option the reference repair uses exists on that part.
      const all = instances(lessonBench(l.bench.faults).state);
      for (const [id, o] of Object.entries(l.bench.repair)) {
        const inst = all.find((i) => i.id === id)!;
        for (const [k, v] of Object.entries(o)) expect(optionsOf(inst).find((x) => x.id === k)!.choices.some((c) => c.id === v), `${l.id} ${id}.${k}`).toBe(true);
      }
    }
  });
});

describe("one LED stays dark", () => {
  const l = level("brd-fault-led");
  it("passes with the LED turned round, and gives the star for that one change", () => {
    const r = attempt(l, { LED4: { way: "ok" } });
    expect(r.passed).toBe(true);
    expect(stars(r)).toBe(1);
    expect(r.diagnostics).toEqual([]);
  });
  it("fails the likely wrong repairs, and says why LED4 is dark", () => {
    const untouched = attempt(l, {});
    expect(untouched.passed).toBe(false);
    expect(untouched.diagnostics.map((d) => d.msg).join(" ")).toMatch(/LED4 is soldered the wrong way round/);
    // Soldering it again the same way, soldering its inverter chip again, turning another LED round.
    expect(attempt(l, { LED4: { fitted: "yes" } }).passed).toBe(false);
    expect(attempt(l, { IC1: { fitted: "yes" } }).passed).toBe(false);
    expect(attempt(l, { LED3: { way: "rev" } }).passed).toBe(false);
    expect(attempt(l, { LED4: { way: "ok" }, LED3: { way: "rev" } }).passed).toBe(false);
  });
  it("passes a repair with a needless extra change, without the star", () => {
    const r = attempt(l, { LED4: { way: "ok", fitted: "yes" }, IC2: { fitted: "no" } });
    expect(r.passed).toBe(true);
    expect(stars(r)).toBe(0);
  });
});

describe("a button that presses itself", () => {
  const l = level("brd-fault-pullup");
  it("passes with the pull-up switched on in the code, and gives the star for leaving the board alone", () => {
    const r = attempt(l, {}, l.solution);
    expect(r.passed).toBe(true);
    expect(stars(r)).toBe(1);
    expect(attempt(l, { PB4: { fitted: "yes" } }, l.solution).passed).toBe(true);
    expect(stars(attempt(l, { LED11: { way: "rev" } }, l.solution))).toBe(0);
  });
  it("fails the likely wrong repairs", () => {
    expect(attempt(l, {}).passed).toBe(false);
    // Soldering the button again; inverting the test in the code; taking the button off.
    expect(attempt(l, { PB4: { fitted: "yes" } }).passed).toBe(false);
    expect(attempt(l, {}, l.starter.replace("GPIO7 == 0", "GPIO7 == 1")).passed).toBe(false);
    expect(attempt(l, { PB4: { fitted: "no" } }, l.solution).passed).toBe(false);
    // Another correct program: the pull-up through the register.
    const reg = l.starter.replace("    while (1) {", "    EALLOW;\n    GpioCtrlRegs.GPAPUD.bit.GPIO7 = 0;\n    EDIS;\n    while (1) {");
    expect(attempt(l, {}, reg).passed).toBe(true);
  });
});

describe("the buzzer is silent", () => {
  const l = level("brd-fault-jumper");
  it("passes with the jumper on the GPIO16 position", () => {
    const r = attempt(l, { JBUZ: { pos: "pin" } });
    expect(r.passed).toBe(true);
    expect(stars(r)).toBe(1);
  });
  it("fails the likely wrong repairs, and names the jumper", () => {
    const untouched = attempt(l, {});
    expect(untouched.passed).toBe(false);
    expect(untouched.diagnostics.map((d) => d.msg).join(" ")).toMatch(/jumper joins the buzzer's input to GND/);
    // Taking the jumper off; soldering the buzzer or its inverter chip again.
    expect(attempt(l, { JBUZ: { pos: "off" } }).passed).toBe(false);
    expect(attempt(l, { B1: { fitted: "yes" } }).passed).toBe(false);
    expect(attempt(l, { IC3: { fitted: "yes" } }).passed).toBe(false);
  });
});

describe("the servo does not move", () => {
  const l = level("brd-fault-servo");
  it("passes with the battery pack on the board", () => {
    const r = attempt(l, { BAT: { fitted: "yes" } });
    expect(r.passed).toBe(true);
    expect(stars(r)).toBe(1);
  });
  it("fails the likely wrong repairs, and names the battery pack", () => {
    const untouched = attempt(l, {});
    expect(untouched.passed).toBe(false);
    expect(untouched.diagnostics.map((d) => d.msg).join(" ")).toMatch(/battery pack is not on the board/);
    expect(attempt(l, { RC2: { fitted: "yes" } }).passed).toBe(false);
    expect(attempt(l, { RC1: { fitted: "yes" } }).passed).toBe(false);
    // A longer pulse in the code does not move a servo without power.
    expect(attempt(l, {}, l.starter.replace("DELAY_US(1200)", "DELAY_US(2000)")).passed).toBe(false);
  });
});
