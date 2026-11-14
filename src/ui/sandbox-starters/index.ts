// Starting programs the Sandbox offers besides its own two. Every file in
// this folder is one program:
//   export const starter = { id, label, kit, about, source, watch };
// It shows in the "Starting program" menu of the board it is written for.
// The course's own starter projects are not copied here (they are not
// public): each program is the game's own, with the same structure.
import type { CodeLevel } from "../../levels/types";

export interface SandboxStarter {
  /** Part of the name the student's edits are saved under: never change it. */
  id: string;
  /** What the menu shows. */
  label: string;
  /** The board the program is written for. */
  kit: CodeLevel["kit"];
  /** One plain sentence for the About panel: what it does and what to try. */
  about: string;
  source: string;
  /** Global variables worth watching while it runs. */
  watch: string[];
  /** The world the program starts in (the robot arena switched on, a room), as in a level. */
  stimuli?: CodeLevel["stimuli"];
}

const modules = import.meta.glob<{ starter?: SandboxStarter }>("./*.ts", { eager: true });

export const SANDBOX_STARTERS: SandboxStarter[] = Object.entries(modules)
  .filter(([path]) => !path.endsWith("/index.ts"))
  .flatMap(([, m]) => (m.starter ? [m.starter] : []))
  .sort((a, b) => a.label.localeCompare(b.label));
