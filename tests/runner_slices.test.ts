// The page runs a level's tests in slices so it stays responsive. A sliced
// run must give exactly the result of the single run, on every code level,
// for the solution and for the starter.
import { describe, expect, it } from "vitest";
import { CHAPTERS } from "../src/levels";
import { runProgram, runProgramSteps, type RunResult, type RunSpec } from "../src/sim/runner";
import { startTestRun, TEST_SLICE_MS } from "../src/ui/code/testrun";

const outcome = (r: RunResult) => ({
  ran: r.ran, passed: r.passed, checks: r.checks, bonus: r.bonus, diagnostics: r.diagnostics, serial: r.serial,
  console: r.console, lcd: r.lcd, runtimeError: r.runtimeError, compileError: r.compileError, endMs: r.endMs,
  now: r.board.now,
});

describe("a test run in slices", () => {
  for (const ch of CHAPTERS)
    for (const l of ch.levels) {
      if (l.kind !== "code") continue;
      it(`${l.id}: same result as the single run`, () => {
        for (const source of [l.solution, l.starter]) {
          const spec: RunSpec = { kit: l.kit, source, durationMs: l.durationMs, stimuli: l.stimuli, checks: l.checks, bonus: l.bonus };
          const steps = runProgramSteps(spec, TEST_SLICE_MS);
          let step = steps.next();
          let last = 0;
          const counted = [...(l.checks ?? []), ...(l.bonus ?? [])].some((c) => c.kind === "max-steps");
          while (!step.done) {
            expect(counted).toBe(false); // a level judged on its statement count runs in one piece
            // 0 while the board is built, then rising.
            if (step.value > 0 || last > 0) expect(step.value).toBeGreaterThan(last);
            expect(step.value).toBeLessThan(1);
            last = step.value;
            step = steps.next();
          }
          expect(outcome(step.value)).toEqual(outcome(runProgram(spec)));
        }
      });
    }
});

describe("a test on a global that a local hides", () => {
  it("says which line declares the other variable", () => {
    const source = "uint16_t c2;\nvoid main(void)\n{\n    uint16_t c2;\n    c2 = 5;\n    while (1) {}\n}\n";
    const r = runProgram({ kit: "launchpad", source, durationMs: 1, checks: [{ kind: "var", name: "c2", equals: 5, label: "c2 is 5" }] });
    expect(r.checks[0].pass).toBe(false);
    expect(r.checks[0].detail).toContain("Line 4 declares another variable named c2");
    const ok = runProgram({ kit: "launchpad", source: source.replace("    uint16_t c2;\n", ""), durationMs: 1, checks: [{ kind: "var", name: "c2", equals: 5, label: "c2 is 5" }] });
    expect(ok.checks[0].pass).toBe(true);
    expect(ok.checks[0].detail).not.toContain("declares another");
  });
});

describe("a live run", () => {
  it("sees a pin driven from outside between two slices while it polls in a loop", async () => {
    const { Board } = await import("../src/sim/board");
    const b = new Board("launchpad");
    b.load("uint16_t seen;\nvoid main(void)\n{\n    while (1) {\n        if (GpioDataRegs.GPADAT.bit.GPIO4 == 1) seen = 1;\n    }\n}\n");
    const gen = b.run();
    b.gpio.drive(4, 0, 0);
    b.runUntil(gen, 1_000_000);
    expect(b.readVar("seen")).toBe(0);
    b.gpio.drive(4, 1, b.now);
    b.runUntil(gen, 2_000_000);
    expect(b.readVar("seen")).toBe(1);
  });
});

describe("a test run in turns (the page's driver)", () => {
  const level = CHAPTERS.flatMap((c) => c.levels).find((l) => l.id === "bus-can-range");
  if (!level || level.kind !== "code") throw new Error("bus-can-range is not a code level");
  const spec: RunSpec = { kit: level.kit, source: level.solution, durationMs: level.durationMs, stimuli: level.stimuli, checks: level.checks, bonus: level.bonus };

  it("gives the browser a turn, reports progress and ends with the result of the single run", async () => {
    // A clock that advances 5 ms at every reading: each turn holds a few slices, whatever the machine.
    let clock = 0;
    let turns = 0;
    const seen: number[] = [];
    const run = startTestRun(spec, async () => void turns++, () => (clock += 5));
    run.subscribe(() => seen.push(run.fraction()));
    const r = await run.done;
    expect(r).not.toBeNull();
    expect(outcome(r!)).toEqual(outcome(runProgram(spec)));
    expect(turns).toBeGreaterThan(10);
    expect(seen.length).toBeGreaterThan(3);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    expect(seen.at(-1)).toBeLessThan(1);
  });

  it("stops at the next turn when it is cancelled, and when it is cancelled before it starts", async () => {
    let turns = 0;
    let clock = 0;
    const run = startTestRun(
      spec,
      async () => {
        if (++turns === 4) run.cancel();
      },
      () => (clock += 5),
    );
    expect(await run.done).toBeNull();
    expect(turns).toBe(4);
    const early = startTestRun(spec);
    early.cancel();
    expect(await early.done).toBeNull();
  });
});
