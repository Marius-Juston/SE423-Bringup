// How long the simulator takes on two heavy levels: the test run of their
// reference solutions, as the page runs it. Not part of `npx vitest run`
// (a benchmark file is only run by `npm run bench`). Use it before and
// after a change to the simulator's inner loops, on a quiet machine.
//
// cap-x-trap: the capstone robot drives for 28 simulated seconds (timer and
// eQEP interrupts, PWM, the LIDAR and the robot world).
// bus-can-range: 6 simulated seconds of CAN messages and the robot world.
import { expect, test } from "vitest";
import { findLevel } from "../src/levels";
import { runProgram, type RunSpec } from "../src/sim/runner";

function specOf(id: string): RunSpec {
  const l = findLevel(id)?.level;
  if (!l || l.kind !== "code") throw new Error(`${id} is not a code level`);
  return { kit: l.kit, source: l.solution, durationMs: l.durationMs, stimuli: l.stimuli, checks: l.checks, bonus: l.bonus };
}

// One run takes from half a second to a few seconds: a handful of runs, and one to warm up.
const RUN = { iterations: 5, time: 0, warmupIterations: 1, warmupTime: 0 };

for (const id of ["cap-x-trap", "bus-can-range"]) {
  test(`test run of ${id}`, async ({ bench }) => {
    const spec = specOf(id);
    // A benchmark of a wrong program would measure nothing useful.
    expect(runProgram(spec).passed).toBe(true);
    await bench(id, () => {
      runProgram(spec);
    }).run(RUN);
  }, 300_000);
}
