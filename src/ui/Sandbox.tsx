import { useMemo } from "react";
import { BENCH_MIN, benchWidth, useWinWidth } from "./LevelView";
import { Splitter } from "./Splitter";
import { Panel } from "./Panel";
import { usePref } from "./prefs";
import type { CodeLevel } from "../levels/types";
import { CodeLevelView } from "./code/CodeLevelView";
import { Markdown } from "./Markdown";
import { SANDBOX_STARTERS, sandboxWorld } from "./sandbox-starters";
import { BLINK_SOURCE, BLINK_WATCH } from "./sandbox-starters/blink";

/** "blink" is offered on every board; any other value is the id of a program in sandbox-starters. */
type Program = string;

// No starting program is the solution of a level, a lab or a homework:
// tests/sandbox_starters.test.ts runs each one against every code level.
const mk = (kit: CodeLevel["kit"], program: Program): CodeLevel => {
  const own = SANDBOX_STARTERS.find((x) => x.id === program && x.kit === kit);
  const stimuli = [...sandboxWorld(kit), ...(own?.stimuli ?? [])];
  if (own) return { ...BASE, id: `sandbox-${kit}-${own.id}`, kit, starter: own.source, solution: own.source, watch: own.watch, stimuli };
  return { ...BASE, id: `sandbox-${kit}`, kit, stimuli };
};

const BASE: CodeLevel = {
  id: "sandbox",
  kind: "code",
  mode: "write",
  title: "Sandbox",
  goal: "",
  brief: "",
  refs: [],
  kit: "robot",
  starter: BLINK_SOURCE,
  solution: BLINK_SOURCE,
  durationMs: 1000,
  checks: [],
  watch: BLINK_WATCH,
};

const ABOUT = `
Write any program and press **Run**. Hold the on-screen push buttons, type into the serial terminal, and watch the pins and registers.

- The course helper functions are available: \`GPIO_SetupPinMux\`, \`GPIO_SetupPinOptions\`, \`InitCpuTimers\`, \`ConfigCpuTimer\`, \`init_serialSCIA\`, \`serial_printf\`, \`UART_printfLine\`, \`DELAY_US\`.
- \`serial_printf\` prints to the serial terminal. On the robot board \`UART_printfLine(1, ...)\` and \`UART_printfLine(2, ...)\` write the two lines of its LCD, shown on the board; the other boards have no LCD.
- \`printf\` output appears in its own console under the terminal.
- Time is simulated: a slower speed lets you watch fast signals.
- The simulator models behaviour, not exact timing: confirm on the real board.
- The starting programs show what a board can do through its library. None of them is the answer to a level, a lab or a homework.
- On the robot board, the starting program **Robot arena** drives the robot in a circle. While it runs, the **Robot arena** panel lets you drag the robot, choose another room or a random maze, and put boxes and posts in the way.
`;

export function Sandbox() {
  // The board and the starting program are remembered, so coming back to the Sandbox finds them as they were left.
  const [kitPref, setKit] = usePref<CodeLevel["kit"]>("sandbox-kit", "robot");
  const kit: CodeLevel["kit"] = kitPref === "redboard" || kitPref === "launchpad" ? kitPref : "robot";
  const [programPref, setProgram] = usePref<Program>("sandbox-program", "blink");
  // The programs this board has: the blinking LED on every board, the others on the board they are written for.
  const programs: { id: Program; label: string; about?: string }[] = [
    { id: "blink", label: "Blink an LED" },
    ...SANDBOX_STARTERS.filter((x) => x.kit === kit).map((x) => ({ id: x.id, label: x.label, about: x.about })),
  ];
  const program = programs.some((x) => x.id === programPref) ? programPref : "blink";
  const about = programs.find((x) => x.id === program)?.about;
  const level = useMemo(() => mk(kit, program), [kit, program]);
  const winW = useWinWidth();
  const [scale] = usePref<number>("text-scale", 1);
  const [benchPref, setBenchW] = usePref<number | null>("w-bench", null);
  const wide = winW >= 760 * Math.max(1, scale);
  const { bench, max } = benchWidth(winW, 0, benchPref);
  return (
    <div className="level">
      <div className="level-head">
        <div className="crumbs">
          <span className="eyebrow">Sandbox</span>
          <h1>Free board</h1>
        </div>
        <span className="badge">Nothing is checked</span>
        <span className="spacer" />
        <label className="speed">
          Board{" "}
          <select value={kit} onChange={(e) => setKit(e.target.value as CodeLevel["kit"])}>
            <option value="robot">Robot board</option>
            <option value="redboard">Homework red board</option>
            <option value="launchpad">LaunchPad only</option>
          </select>
        </label>
        {programs.length > 1 && (
          <label className="speed">
            Starting program{" "}
            <select value={program} onChange={(e) => setProgram(e.target.value)}>
              {programs.map((x) => (
                <option key={x.id} value={x.id}>{x.label}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className={`level-body code ${wide ? "" : "stacked"}`} style={wide ? { gridTemplateColumns: `minmax(0, 1fr) 7px ${bench}px` } : undefined}>
        <CodeLevelView
          key={level.id}
          level={level}
          onPass={() => {}}
          splitter={<Splitter value={bench} onChange={setBenchW} min={BENCH_MIN} max={max} side="right" label="Resize the board pane" reset={440} />}
          benchTop={
            <Panel id="sandbox-about" title="About the sandbox">
              {about && <p><strong>This program.</strong> {about}</p>}
              <Markdown text={ABOUT} />
            </Panel>
          }
        />
      </div>
    </div>
  );
}
