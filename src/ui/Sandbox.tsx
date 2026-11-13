import { useState } from "react";
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

export function Sandbox() {
  const [kit, setKit] = useState<CodeLevel["kit"]>("robot");
  return (
    <div className="level">
      <div className="level-head">
        <span className="badge">Sandbox</span>
        <h1 style={{ fontSize: "1.15rem" }}>Free board</h1>
        <span className="spacer" />
        <label style={{ fontSize: "0.9rem" }}>
          Board{" "}
          <select value={kit} onChange={(e) => setKit(e.target.value as CodeLevel["kit"])}>
            <option value="robot">Robot board</option>
            <option value="redboard">Homework red board</option>
            <option value="launchpad">LaunchPad only</option>
          </select>
        </label>
      </div>
      <div className="level-body code">
        <div className="pane">
          <Markdown
            text={`
Write any program and press **Run**. Hold the on-screen push buttons, type into the serial terminal, and watch the pins and registers.

The simulator covers what the released chapters use: GPIO, the three CPU timers, the interrupt controller (PIE), and the serial ports. Other peripherals have their registers but no behaviour yet.

Useful to know:
- The course helper functions are available: \`GPIO_SetupPinMux\`, \`GPIO_SetupPinOptions\`, \`InitCpuTimers\`, \`ConfigCpuTimer\`, \`init_serialSCIA\`, \`serial_printf\`, \`UART_printfLine\`, \`DELAY_US\`.
- \`printf\` output appears in its own console under the terminal.
- Time is simulated: a slower speed lets you watch fast signals.
`}
          />
        </div>
        <CodeLevelView key={kit} level={mk(kit)} onPass={() => {}} />
      </div>
    </div>
  );
}
