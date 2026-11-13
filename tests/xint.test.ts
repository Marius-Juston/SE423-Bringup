import { describe, expect, it } from "vitest";
import { runProgram } from "../src/sim/runner";

const prog = (polarity: number) => `
uint32_t n = 0;
__interrupt void xint1_isr(void) { n++; PieCtrlRegs.PIEACK.all = PIEACK_GROUP1; }
void main(void) {
  InitSysCtrl(); InitGpio();
  GPIO_SetupPinMux(159, GPIO_MUX_CPU1, 0);
  GPIO_SetupPinOptions(159, GPIO_INPUT, GPIO_PULLUP);
  DINT; InitPieCtrl(); IER = 0; IFR = 0; InitPieVectTable();
  EALLOW; PieVectTable.XINT1_INT = &xint1_isr; EDIS;
  GPIO_SetupXINT1Gpio(159);
  XintRegs.XINT1CR.bit.POLARITY = ${polarity};
  XintRegs.XINT1CR.bit.ENABLE = 1;
  PieCtrlRegs.PIEIER1.bit.INTx4 = 1; IER |= M_INT1; EINT;
  while (1) {}
}`;
const stimuli = [
  { at: 2, press: "PB3" }, { at: 4, release: "PB3" },
  { at: 6, press: "PB3" }, { at: 8, release: "PB3" },
];

describe("XINT plugin", () => {
  it("counts presses on the falling edge, releases on the rising edge, both with polarity 3", () => {
    for (const [pol, want] of [[0, 2], [1, 2], [3, 4]] as const) {
      const r = runProgram({ kit: "robot", durationMs: 10, source: prog(pol), stimuli });
      expect(r.runtimeError).toBeUndefined();
      expect(r.diagnostics).toEqual([]);
      expect(r.board.readVar("n"), `polarity ${pol}`).toBe(want);
    }
  });
});
