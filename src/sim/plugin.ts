// Extension point for peripherals and the things wired to them. Every file
// in src/sim/plugins/ that exports `plugin: SimPlugin` is loaded
// automatically, so a new peripheral never edits board.ts, kits.ts or the
// library.

import type { Board } from "./board";
import type { Part } from "./world/kits";

export interface SimPlugin {
  name: string;
  /**
   * C source added to the course library: typedefs, #defines, prototypes of
   * native functions, and helper functions written in C. Compiled after the
   * base library and before the student's file.
   */
  prelude?: string;
  /**
   * Called once for every new Board, after the core peripherals (GPIO, CPU
   * timers, PIE, SCI) exist and the library is compiled. Attach register
   * hooks, native functions (board.compiler.defineNative) and world models.
   */
  install?(b: Board): void;
  /** Extra parts on the course boards (knobs, meters, LEDs, buttons), per kit id. */
  parts?: Record<string, Part[]>;
  /** Run after everything else, lower first (default 0). */
  order?: number;
}

const modules = import.meta.glob<{ plugin?: SimPlugin }>("./plugins/*.ts", { eager: true });

export const PLUGINS: SimPlugin[] = Object.values(modules)
  .map((m) => m.plugin)
  .filter((p): p is SimPlugin => !!p)
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
