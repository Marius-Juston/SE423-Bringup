import { expect, it } from "vitest";
import { PROGRAMS, expectSolvesNoLevel } from "./sandbox_guard";

// See sandbox_starters.test.ts. This program has a file of its own because
// running it against every level takes half a minute.
it("the starting program \"final\" passes no level when pasted into it", () => {
  const p = PROGRAMS.find((x) => x.id === "final");
  expect(p).toBeDefined();
  const n = expectSolvesNoLevel(p!);
  console.info(`final: pasted into ${n} code levels, none passes.`);
  expect(n).toBeGreaterThan(200);
});
