import { describe, expect, it } from "vitest";
import { runProgram } from "../src/sim/runner";

describe("DAC plugin", () => {
  it("outputs DACVALA * 3.0 / 4096 once enabled, and needs EALLOW", () => {
    const r = runProgram({
      kit: "robot",
      durationMs: 3,
      source: `void main(void) {
  EALLOW;
  DacaRegs.DACCTL.bit.DACREFSEL = 1;
  DacaRegs.DACOUTEN.bit.DACOUTEN = 1;
  DacaRegs.DACVALS.bit.DACVALS = 2048;
  EDIS;
  DELAY_US(1000);
  EALLOW; DacaRegs.DACVALS.bit.DACVALS = 4095; EDIS;
  while (1) {}
}`,
      checks: [
        { kind: "signal", name: "DACA", at: 0.5, equals: 1.5, tol: 0.001, label: "half scale" },
        { kind: "signal", name: "DACA", equals: (4095 * 3) / 4096, tol: 0.001, label: "full scale" },
      ],
    });
    expect(r.runtimeError).toBeUndefined();
    expect(r.diagnostics).toEqual([]);
    for (const c of r.checks) expect(c.pass, c.detail).toBe(true);
    const locked = runProgram({ kit: "robot", durationMs: 1, source: `void main(void) { DacaRegs.DACVALS.bit.DACVALS = 2048; while (1) {} }` });
    expect(locked.diagnostics.map((d) => d.code)).toContain("eallow");
  });
});
