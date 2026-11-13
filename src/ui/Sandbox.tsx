import { useMemo, useState } from "react";
import { BENCH_MIN, benchWidth, useWinWidth } from "./LevelView";
import { Splitter } from "./Splitter";
import { Panel } from "./Panel";
import { usePref } from "./prefs";
import type { CodeLevel } from "../levels/types";
import { CodeLevelView } from "./code/CodeLevelView";
import { Markdown } from "./Markdown";

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

const mk = (kit: CodeLevel["kit"]): CodeLevel => ({
  id: `sandbox-${kit}`,
  kind: "code",
  mode: "write",
  title: "Sandbox",
  goal: "",
  brief: "",
  refs: [],
  kit,
  starter: STARTER,
  solution: STARTER,
  durationMs: 1000,
  checks: [],
  watch: ["numTimer0calls"],
});

const ABOUT = `
Write any program and press **Run**. Hold the on-screen push buttons, type into the serial terminal, and watch the pins and registers.

- The course helper functions are available: \`GPIO_SetupPinMux\`, \`GPIO_SetupPinOptions\`, \`InitCpuTimers\`, \`ConfigCpuTimer\`, \`init_serialSCIA\`, \`serial_printf\`, \`UART_printfLine\`, \`DELAY_US\`.
- \`printf\` output appears in its own console under the terminal.
- Time is simulated: a slower speed lets you watch fast signals.
- The simulator models behaviour, not exact timing: confirm on the real board.
`;

export function Sandbox() {
  const [kit, setKit] = useState<CodeLevel["kit"]>("robot");
  const level = useMemo(() => mk(kit), [kit]);
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
      </div>
      <div className={`level-body code ${wide ? "" : "stacked"}`} style={wide ? { gridTemplateColumns: `minmax(0, 1fr) 7px ${bench}px` } : undefined}>
        <CodeLevelView
          key={kit}
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
