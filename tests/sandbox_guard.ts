import { expect } from "vitest";
import { CHAPTERS } from "../src/levels/index";
import type { CodeLevel } from "../src/levels/types";
import { runProgram } from "../src/sim/runner";
import { SANDBOX_STARTERS } from "../src/ui/sandbox-starters";
import { BLINK_SOURCE, BLINK_WATCH } from "../src/ui/sandbox-starters/blink";

// Shared by the sandbox_starters*.test.ts files: the Sandbox's starting
// programs, and the check that none of them is the answer to a level.

export interface Program {
  id: string;
  /** The boards whose menu offers it. */
  kits: CodeLevel["kit"][];
  source: string;
  watch: string[];
  stimuli?: CodeLevel["stimuli"];
}

/** Every program of the "Starting program" menu: the blinking LED on every board, the others on their own. */
export const PROGRAMS: Program[] = [
  { id: "blink", kits: ["robot", "redboard", "launchpad"], source: BLINK_SOURCE, watch: BLINK_WATCH },
  ...SANDBOX_STARTERS.map((s) => ({ id: s.id, kits: [s.kit], source: s.source, watch: s.watch, stimuli: s.stimuli })),
];

/**
 * Programs that keep the robot's motors and sensors busy take half a minute
 * each to run against every level, so each has a test file of its own
 * (sandbox_starters_<id>.test.ts) and the test files run side by side.
 */
export const OWN_FILE = ["arena", "final"];

export const CODE_LEVELS: CodeLevel[] = CHAPTERS.flatMap((c) => c.levels).filter((l): l is CodeLevel => l.kind === "code");

/**
 * Pastes the program into every code level of its boards, with the level's
 * own stimuli and checks. No level may pass: a pass means the starting
 * program hands out that level's solution. Returns how many levels it ran.
 */
export function expectSolvesNoLevel(p: Program): number {
  const passed: string[] = [];
  let n = 0;
  for (const l of CODE_LEVELS) {
    if (!p.kits.includes(l.kit)) continue;
    n++;
    const r = runProgram({ kit: l.kit, source: p.source, durationMs: l.durationMs, stimuli: l.stimuli, checks: l.checks, bonus: l.bonus });
    if (r.passed) passed.push(l.id);
  }
  expect(passed, `the starting program "${p.id}" passes these levels`).toEqual([]);
  return n;
}
