// Starting programs the Sandbox offers besides the blinking LED (blink.ts).
// Every file in this folder that exports `starter` is one program:
//   export const starter = { id, label, kit, about, source, watch };
// It shows in the "Starting program" menu of the board it is written for.
//
// A starting program shows what the board can do through its library. It is
// never the answer to a level, a lab or a homework: no speed controller, no
// steering law, no pose, no way points, no wall following, no filter, no
// set-up a handout has the student fill in. Keep each one short and
// commented for a beginner. tests/sandbox_starters.test.ts enforces this:
// it runs every program against every code level and none may pass.
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
  // "Robot arena" first on its board, then by label.
  .sort((a, b) => Number(b.id === "arena") - Number(a.id === "arena") || a.label.localeCompare(b.label));

/**
 * The world every Sandbox program on a board starts in, pasted code included. On the robot board the
 * MPU-9250 behaves like a real part (IMU_REAL, src/sim/plugins/spi_devices.ts): each axis has a small
 * offset and every sample has noise. Levels leave that off unless they are about it.
 */
export const sandboxWorld = (kit: CodeLevel["kit"]): NonNullable<CodeLevel["stimuli"]> => (kit === "robot" ? [{ at: 0, set: "IMU_REAL", value: 1 }] : []);
