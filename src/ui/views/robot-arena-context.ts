// What the robot arena needs beyond a bench view's props: the level's
// stimuli and checks (for the replay), the live session (for the
// playground) and a way to ask for a new frame after it changed the world
// while the program is paused. CodeLevelView provides it; without it the
// arena is a plain read-only view.
import { createContext } from "react";
import type { LiveSession } from "../../sim/live";

export interface ArenaInfo {
  /** The level's stimuli: where things stand at each moment of its test. */
  stimuli: readonly unknown[];
  /** The level's checks and their results (after Run tests), for the marks on the replay slider. */
  checks: readonly unknown[];
  results?: readonly { pass: boolean }[];
  /** Global variables the level watches. */
  watch: readonly string[];
  /** The running program, when there is one: the playground acts on it. */
  session: LiveSession | null;
  /** Redraw after the playground changed something. */
  redraw(): void;
  /** Length of the test run, ms. */
  durationMs: number;
}

export const ArenaContext = createContext<ArenaInfo | null>(null);
