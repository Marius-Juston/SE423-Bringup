import { useMemo, useState } from "react";
import { BENCH_MIN, benchWidth, useWinWidth } from "./LevelView";
import { Splitter } from "./Splitter";
import { Panel } from "./Panel";
import { usePref } from "./prefs";
import type { CodeLevel } from "../levels/types";
import { CodeLevelView } from "./code/CodeLevelView";
import { Markdown } from "./Markdown";
import { findLevel } from "../levels/index";

const STARTER = `// Free play: nothing is checked here.
__interrupt void cpu_timer0_isr(void);

uint32_t numTimer0calls = 0;

void main(void)
{
    InitSysCtrl();
    InitGpio();

    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
    GPIO_SetupPinOptions(157, GPIO_INPUT, GPIO_PULLUP);    // PB1

    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();
    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    EDIS;

    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, 100000);   // 100 ms
    CpuTimer0Regs.TCR.all = 0x4000;
    init_serialSCIA(&SerialA, 115200);

    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    EINT;

    while (1) {
        if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) {
            GpioDataRegs.GPASET.bit.GPIO22 = 1;     // hold PB1: LED1 stays on
        }
    }
}

__interrupt void cpu_timer0_isr(void)
{
    numTimer0calls++;
    GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`;

type Program = "blink" | "arena";

// The "Robot arena" program: the reference solution of the capstone level
// "cap-wall" (PI speed control on both motors, dead reckoning to a goal, and
// a stop when the LIDAR sees something close ahead), in that level's room.
// Its stimuli switch the robot world on, so the arena's playground works
// here without a level.
const arenaLevel = (): CodeLevel | undefined => {
  const l = findLevel("cap-wall")?.level;
  return l?.kind === "code" ? l : undefined;
};

const mk = (kit: CodeLevel["kit"], program: Program): CodeLevel => {
  const arena = program === "arena" && kit === "robot" ? arenaLevel() : undefined;
  if (arena) return { ...BASE, id: "sandbox-robot-arena", kit, starter: arena.solution, solution: arena.solution, stimuli: arena.stimuli, watch: arena.watch };
  return { ...BASE, id: `sandbox-${kit}`, kit };
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
  starter: STARTER,
  solution: STARTER,
  durationMs: 1000,
  checks: [],
  watch: ["numTimer0calls"],
};

const ABOUT = `
Write any program and press **Run**. Hold the on-screen push buttons, type into the serial terminal, and watch the pins and registers.

- The course helper functions are available: \`GPIO_SetupPinMux\`, \`GPIO_SetupPinOptions\`, \`InitCpuTimers\`, \`ConfigCpuTimer\`, \`init_serialSCIA\`, \`serial_printf\`, \`UART_printfLine\`, \`DELAY_US\`.
- \`printf\` output appears in its own console under the terminal.
- Time is simulated: a slower speed lets you watch fast signals.
- The simulator models behaviour, not exact timing: confirm on the real board.
- On the robot board, the starting program **Robot arena** drives the robot through a room. While it runs, the **Robot arena** panel lets you drag the robot and the goal, choose another room or a random maze, and put boxes and posts in the way.
`;

export function Sandbox() {
  const [kit, setKit] = useState<CodeLevel["kit"]>("robot");
  const [program, setProgram] = useState<Program>("blink");
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
        {kit === "robot" && (
          <label className="speed">
            Starting program{" "}
            <select value={program} onChange={(e) => setProgram(e.target.value as Program)}>
              <option value="blink">Blink an LED</option>
              <option value="arena">Robot arena</option>
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
              <Markdown text={ABOUT} />
            </Panel>
          }
        />
      </div>
    </div>
  );
}
