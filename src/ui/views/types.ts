// Bench views: visualisations that appear next to the board when the
// running program uses the thing they show. Every file in this folder
// exports `view: BenchView` and is picked up automatically.
import type { ComponentType } from "react";
import type { Board } from "../../sim/board";
import type { Kit } from "../../sim/world/kits";

export interface ViewProps {
  board: Board;
  kit: Kit;
  /** Current simulation time, ms. */
  nowMs: number;
  /** Time window to draw, ms: [from, to]. */
  window: [number, number];
  /** True while the program is running live (false for a finished test run). */
  live: boolean;
}

export interface BenchView {
  id: string;
  title: string;
  /** Lower comes first (default 50). */
  order?: number;
  /** Show this view for the current board? Keep it cheap: it runs every frame. */
  relevant(board: Board, kit: Kit): boolean;
  Component: ComponentType<ViewProps>;
}
