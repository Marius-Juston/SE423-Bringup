import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runProgram } from "../src/sim/runner";

// The course starter project must run unchanged. It lives outside this repo
// (TI and course copyright), so the test is skipped when it is not present.
const FILE = "SE423Spring26/C2000Ware_4_01_00_00/device_support/f2837xd/examples/cpu1/LABstarter/cpu01/LABstarter_main.c";
const PATH =
  process.env.LABSTARTER ?? [`./${FILE}`, `../SE-423---Class-Material/${FILE}`].find((p) => existsSync(p)) ?? `./${FILE}`;

describe.skipIf(!existsSync(PATH))("LABstarter_main.c", () => {
  it("blinks the LEDs and counts interrupts as on the board", () => {
    const source = readFileSync(PATH, "latin1");
    const r = runProgram({
      kit: "robot",
      source,
      durationMs: 1000,
      checks: [
        // Timer 0 fires every 10 ms and the red LED toggles every 5th call: 100 ms period.
        { kind: "blink", led: "RED", periodMs: 100, label: "red" },
        // Timer 2 fires every 40 ms and toggles the blue LED: 80 ms period.
        { kind: "blink", led: "BLUE", periodMs: 80, label: "blue" },
        { kind: "var", name: "numTimer0calls", min: 99, max: 100, label: "timer0 count" },
        { kind: "lcd", line: 1, matches: "^Timer2 Calls 20$", label: "lcd" },
        { kind: "lcd", line: 2, matches: "^T0 \\d+,T1 \\d+$", label: "lcd2" },
        { kind: "reg", reg: "CpuTimer0Regs.PRD", equals: 1999999, label: "prd" },
      ],
    });
    expect(r.compileError).toBeUndefined();
    expect(r.runtimeError).toBeUndefined();
    expect(r.diagnostics).toEqual([]);
    for (const c of r.checks) expect(c.pass, `${c.label}: ${c.detail}`).toBe(true);
  });
});
