import { describe, expect, it } from "vitest";
import { ch21 } from "../src/levels/chapters/ch21_capstone";
import { runProgram } from "../src/sim/runner";
import type { CodeLevel } from "../src/levels/types";

// The capstone is one program that grows: each code level continues an
// earlier one. These tests guard the chain. tests/levels.test.ts checks the
// rest (solutions pass, starters compile and fail).

const code = ch21.levels.filter((l): l is CodeLevel => l.kind === "code");
const byId = new Map(code.map((l) => [l.id, l]));
const withoutTodos = (src: string) =>
  src
    .split("\n")
    .filter((line) => !line.trim().startsWith("// TODO"))
    .join("\n");

describe("capstone chain", () => {
  it("has one root and every other code level continues an earlier one", () => {
    expect(code.filter((l) => !l.continues).map((l) => l.id)).toEqual(["cap-open"]);
    for (const l of code.slice(1)) {
      const prev = byId.get(l.continues!);
      expect(prev, `${l.id} continues ${l.continues}`).toBeDefined();
      expect(code.indexOf(prev!)).toBeLessThan(code.indexOf(l));
    }
  });

  for (const l of code.filter((x) => x.continues)) {
    const prev = byId.get(l.continues!)!;
    describe(`${l.id} continues ${prev.id}`, () => {
      it("starts from the earlier level's reference solution plus TODO comments", () => {
        expect(l.starter).not.toBe(prev.solution);
        expect(withoutTodos(l.starter)).toBe(prev.solution);
      });
      it("is not already passed by the earlier level's solution", () => {
        const r = runProgram({ kit: l.kit, source: prev.solution, durationMs: l.durationMs, stimuli: l.stimuli, checks: l.checks });
        expect(r.compileError).toBeUndefined();
        expect(r.runtimeError).toBeUndefined();
        expect(r.passed).toBe(false);
      });
    });
  }

  it("keeps every solution line within 100 characters", () => {
    for (const l of code) for (const line of l.solution.split("\n")) expect(line.length, `${l.id}: ${line}`).toBeLessThanOrEqual(100);
  });
});
