import { describe, expect, it } from "vitest";
import { Board } from "../src/sim/board";
import { runProgram } from "../src/sim/runner";
import { adcCode, triggerName } from "../src/sim/plugins/adc";
import { codes } from "./helpers";

// These tests run bare programs for one peripheral, without the InitSysCtrl() every real program starts with.
Board.expectInitSysCtrl = false;

// The course's ADC set-up (HW2, SE423Lib.c init_ADCsAndDACs), for ADCA.
const POWER = `
    EALLOW;
    AdcaRegs.ADCCTL2.bit.PRESCALE = 6;
    AdcSetMode(ADC_ADCA, ADC_RESOLUTION_12BIT, ADC_SIGNALMODE_SINGLE);
    AdcaRegs.ADCCTL1.bit.INTPULSEPOS = 1;
    AdcaRegs.ADCCTL1.bit.ADCPWDNZ = 1;
    DELAY_US(1000);
`;

const soc = (n: number, ch: number, trig: number, acqps = 99) => `
    AdcaRegs.ADCSOC${n}CTL.bit.CHSEL = ${ch};
    AdcaRegs.ADCSOC${n}CTL.bit.ACQPS = ${acqps};
    AdcaRegs.ADCSOC${n}CTL.bit.TRIGSEL = ${trig};`;

const ok = (r: ReturnType<typeof runProgram>) => {
  expect(r.compileError, JSON.stringify(r.compileError)).toBeUndefined();
  expect(r.runtimeError, JSON.stringify(r.runtimeError)).toBeUndefined();
  for (const c of r.checks) expect(c.pass, `${c.label}: ${c.detail}`).toBe(true);
};

/** Runs a program on a bare board (no kit knobs) with access to the trigger lines. */
function bare(source: string, ms: number, setup?: (b: Board) => void): Board {
  const b = new Board();
  b.load(source);
  setup?.(b);
  const gen = b.run();
  b.runUntil(gen, ms * 1e6);
  return b;
}

describe("ADC plugin", () => {
  it("follows the TRM formulas (Table 11-2 and Table 11-32)", () => {
    expect(adcCode(0)).toBe(0);
    expect(adcCode(-0.2)).toBe(0);
    expect(adcCode(1.5)).toBe(2048);
    expect(adcCode(1.2)).toBe(1638);
    expect(adcCode(3.0)).toBe(4095);
    expect(adcCode(3.3)).toBe(4095);
    expect(adcCode(3.0 / 4096)).toBe(1);
    expect(triggerName(0)).toBeNull();
    expect(triggerName(1)).toBe("TINT0");
    expect(triggerName(3)).toBe("TINT2");
    expect(triggerName(5)).toBe("EPWM1SOCA");
    expect(triggerName(10)).toBe("EPWM3SOCB");
    expect(triggerName(11)).toBe("EPWM4SOCA");
    expect(triggerName(17)).toBe("EPWM7SOCA");
    expect(triggerName(28)).toBe("EPWM12SOCB");
  });

  it("converts a software-triggered SOC and follows the input", () => {
    const r = runProgram({
      kit: "robot",
      durationMs: 6,
      stimuli: [{ at: 0, set: "ADCINA4", value: 1.2 }, { at: 3, set: "ADCINA4", value: 2.999 }],
      source: `uint16_t first = 0; uint16_t second = 0; float volts = 0;
void main(void) {
${POWER}${soc(0, 4, 0)}
    AdcaRegs.ADCINTSEL1N2.bit.INT1SEL = 0;
    AdcaRegs.ADCINTSEL1N2.bit.INT1E = 1;
    AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
    EDIS;
    AdcaRegs.ADCSOCFRC1.bit.SOC0 = 1;
    while (AdcaRegs.ADCINTFLG.bit.ADCINT1 == 0) {}
    first = AdcaResultRegs.ADCRESULT0;
    volts = first * 3.0 / 4096.0;
    AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
    DELAY_US(3000);
    AdcaRegs.ADCSOCFRC1.all = 0x0001;
    while (AdcaRegs.ADCINTFLG.bit.ADCINT1 == 0) {}
    DELAY_US(1);
    second = AdcaResultRegs.ADCRESULT0;
    while (1) {}
}`,
      checks: [
        { kind: "var", name: "first", equals: 1638, label: "1.2 V" },
        { kind: "var", name: "volts", min: 1.199, max: 1.2, label: "back to volts" },
        { kind: "var", name: "second", equals: 4094, label: "2.999 V" },
        { kind: "reg", reg: "AdcaRegs.ADCSOCFRC1", equals: 0, label: "ADCSOCFRC1 reads 0" },
        { kind: "reg", reg: "AdcaRegs.ADCINTFLG", field: "ADCINT1", equals: 1, label: "flag set again" },
        { kind: "reg", reg: "AdcaRegs.ADCCTL1", field: "ADCBSY", equals: 0, label: "not busy" },
      ],
    });
    ok(r);
    expect(r.diagnostics).toEqual([]);
  });

  it("times a conversion as (ACQPS + 1) + tEOC SYSCLK cycles, result latched at tLAT (Table 11-12)", () => {
    const pulses: number[] = [];
    let atPulse = -1;
    let afterLatch = -1;
    const b = bare(
      `void main(void) {
${POWER}${soc(0, 4, 2, 19)}
    AdcaRegs.ADCINTSEL1N2.bit.INT1SEL = 0;
    AdcaRegs.ADCINTSEL1N2.bit.INT1E = 1;
    EDIS;
    CpuTimer1Regs.PRD.all = 199999;
    CpuTimer1Regs.TCR.all = 0x4020;
    while (1) {}
}`,
      3.5,
      (bd) => {
        bd.setInput("ADCINA4", 0.75);
        bd.onTrigger("ADCAINT1", (t) => {
          if (!pulses.length) {
            atPulse = bd.dev.get("AdcaResultRegs.ADCRESULT0");
            bd.at(t + 3 * 5, () => (afterLatch = bd.dev.get("AdcaResultRegs.ADCRESULT0")));
          }
          pulses.push(t);
        });
      },
    );
    const trig = b.timers.expiries[1][0];
    // PRESCALE = 6: tEOC = tINT(late) = 41 cycles, tLAT = 44 cycles of 5 ns.
    expect(pulses[0] - trig).toBe((20 + 41) * 5);
    expect(atPulse).toBe(0);
    expect(afterLatch).toBe(1024);
    expect(b.dev.get("AdcaRegs.ADCINTOVF", "ADCINT1")).toBe(1);
    expect([...b.diagnostics.values()]).toEqual([]);
  });

  it("sets the flag at the end of the S+H window with INTPULSEPOS = 0", () => {
    const pulses: number[] = [];
    const b = bare(
      `void main(void) {
    EALLOW;
    AdcbRegs.ADCCTL2.bit.PRESCALE = 6;
    AdcbRegs.ADCCTL1.bit.ADCPWDNZ = 1;
    DELAY_US(1000);
    AdcbRegs.ADCSOC3CTL.bit.CHSEL = 2;
    AdcbRegs.ADCSOC3CTL.bit.ACQPS = 99;
    AdcbRegs.ADCSOC3CTL.bit.TRIGSEL = 3;
    AdcbRegs.ADCINTSEL1N2.bit.INT2SEL = 3;
    AdcbRegs.ADCINTSEL1N2.bit.INT2E = 1;
    EDIS;
    CpuTimer2Regs.PRD.all = 199999;
    CpuTimer2Regs.TCR.all = 0x4020;
    while (1) {}
}`,
      2.5,
      (bd) => {
        bd.setInput("ADCINB2", 3);
        bd.onTrigger("ADCBINT2", (t) => pulses.push(t));
      },
    );
    expect(pulses[0] - b.timers.expiries[2][0]).toBe(100 * 5);
    expect(b.dev.get("AdcbResultRegs.ADCRESULT3")).toBe(4095);
    // ADCB2 is INT10.6.
    expect(b.dev.get("PieCtrlRegs.PIEIFR10")).toBe(1 << 5);
  });

  it("converts pending SOCs in round-robin order, one after the other", () => {
    const order: number[] = [];
    const b = bare(
      `void main(void) {
${POWER}${soc(0, 2, 0)}${soc(1, 3, 0)}${soc(2, 4, 0)}${soc(5, 5, 0)}
    AdcaRegs.ADCINTSEL1N2.bit.INT1SEL = 2;
    AdcaRegs.ADCINTSEL1N2.bit.INT1E = 1;
    AdcaRegs.ADCINTSEL1N2.bit.INT2SEL = 5;
    AdcaRegs.ADCINTSEL1N2.bit.INT2E = 1;
    AdcaRegs.ADCINTSEL3N4.bit.INT3SEL = 0;
    AdcaRegs.ADCINTSEL3N4.bit.INT3E = 1;
    EDIS;
    AdcaRegs.ADCSOCFRC1.all = 0x0024;
    DELAY_US(10);
    AdcaRegs.ADCSOCFRC1.all = 0x0007;
    while (1) {}
}`,
      1.5,
      (bd) => {
        bd.setInput("ADCINA2", 0.5);
        bd.setInput("ADCINA3", 1.0);
        bd.setInput("ADCINA4", 2.0);
        bd.setInput("ADCINA5", 2.5);
        for (const n of [1, 2, 3]) bd.onTrigger(`ADCAINT${n}`, (t) => order.push(n, t));
      },
    );
    const res = (n: number) => b.dev.get(`AdcaResultRegs.ADCRESULT${n}`);
    expect([res(0), res(1), res(2), res(5)]).toEqual([adcCode(0.5), adcCode(1.0), adcCode(2.0), adcCode(2.5)]);
    // First burst: SOC2 then SOC5 (INT1 then INT2), 141 cycles apart.
    expect(order[0]).toBe(1);
    expect(order[2]).toBe(2);
    expect(order[3] - order[1]).toBe(141 * 5);
    // Second burst: the pointer is at SOC5, so SOC0 (INT3) converts before SOC1 and SOC2 (INT1, overflow: flag still set).
    expect(order[4]).toBe(3);
    expect(order.length).toBe(6);
    expect(b.dev.get("AdcaRegs.ADCINTOVF")).toBe(1);
    expect(b.dev.get("AdcaRegs.ADCSOCPRICTL", "RRPOINTER")).toBe(2);
    expect(b.dev.get("AdcaRegs.ADCSOCFLG1")).toBe(0);
  });

  const isrProgram = (opts: { clear: boolean; cont?: boolean; intsel?: number }) => `
int16_t adca4result = 0; int32_t numADCA = 0;
__interrupt void ADCA_ISR(void) {
    adca4result = AdcaResultRegs.ADCRESULT0;
    numADCA++;
    ${opts.clear ? "AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;" : ""}
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
void main(void) {
    InitSysCtrl();
    DINT; InitPieCtrl(); IER = 0; IFR = 0; InitPieVectTable();
    EALLOW; PieVectTable.ADCA1_INT = &ADCA_ISR; EDIS;
    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer1, 200, 1000);
    CpuTimer1Regs.TCR.all = 0x4000;
${POWER}${soc(0, 4, 2)}
    AdcaRegs.ADCINTSEL1N2.bit.INT1SEL = ${opts.intsel ?? 0};
    AdcaRegs.ADCINTSEL1N2.bit.INT1E = 1;
    AdcaRegs.ADCINTSEL1N2.bit.INT1CONT = ${opts.cont ? 1 : 0};
    AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
    EDIS;
    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx1 = 1;
    EINT;
    while (1) {}
}`;

  it("calls the ADCA1 interrupt (INT1.1) on every timer-triggered conversion", () => {
    const r = runProgram({
      kit: "robot",
      durationMs: 12,
      stimuli: [{ at: 0, set: "ADCINA4", value: 0.3 }, { at: 6.5, set: "ADCINA4", value: 2.4 }],
      source: isrProgram({ clear: true }),
      checks: [
        { kind: "isr", fn: "ADCA_ISR", min: 9, max: 11, label: "1 kHz" },
        { kind: "var", name: "adca4result", at: 6, equals: adcCode(0.3), label: "0.3 V" },
        { kind: "var", name: "adca4result", equals: adcCode(2.4), label: "2.4 V" },
        { kind: "reg", reg: "AdcaRegs.ADCINTOVF", equals: 0, label: "no overflow" },
      ],
    });
    ok(r);
    expect(r.diagnostics).toEqual([]);
  });

  it("stops after one interrupt when ADCINTFLG is never cleared, unless INT1CONT = 1", () => {
    const once = runProgram({ kit: "robot", durationMs: 12, source: isrProgram({ clear: false }) });
    expect(once.isrLog.filter((x) => x.name === "ADCA_ISR").length).toBe(1);
    expect(once.board.dev.get("AdcaRegs.ADCINTOVF", "ADCINT1")).toBe(1);
    const cont = runProgram({ kit: "robot", durationMs: 12, source: isrProgram({ clear: false, cont: true }) });
    expect(cont.isrLog.filter((x) => x.name === "ADCA_ISR").length).toBeGreaterThanOrEqual(9);
    expect(cont.board.dev.get("AdcaRegs.ADCINTOVF", "ADCINT1")).toBe(1);
    // INT1SEL pointing at a SOC that never converts: no interrupt at all.
    const wrong = runProgram({ kit: "robot", durationMs: 12, source: isrProgram({ clear: true, intsel: 1 }) });
    expect(wrong.isrLog.length).toBe(0);
    expect(wrong.board.dev.get("AdcaResultRegs.ADCRESULT0")).toBe(adcCode(1.5));
  });

  it("starts SOCs from the ePWM trigger lines (TRIGSEL 11 = EPWM4 SOCA, 10 = EPWM3 SOCB)", () => {
    const b = bare(
      `void main(void) {
${POWER}${soc(0, 4, 11)}${soc(1, 2, 10)}
    EDIS;
    while (1) {}
}`,
      3,
      (bd) => {
        bd.setInput("ADCINA4", 1.0);
        bd.setInput("ADCINA2", 2.0);
        bd.at(2e6, (t) => bd.fireTrigger("EPWM4SOCA", t));
        bd.at(2.5e6, (t) => bd.fireTrigger("EPWM3SOCA", t));
      },
    );
    expect(b.dev.get("AdcaResultRegs.ADCRESULT0")).toBe(adcCode(1.0));
    expect(b.dev.get("AdcaResultRegs.ADCRESULT1")).toBe(0);
    const gen2 = bare(
      `void main(void) {
${POWER}${soc(1, 2, 10)}
    EDIS;
    while (1) {}
}`,
      3,
      (bd) => {
        bd.setInput("ADCINA2", 2.0);
        bd.at(2e6, (t) => bd.fireTrigger("EPWM3SOCB", t));
      },
    );
    expect(gen2.dev.get("AdcaResultRegs.ADCRESULT1")).toBe(adcCode(2.0));
  });

  it("records a missed hardware trigger in ADCSOCOVF1", () => {
    const b = bare(
      `void main(void) {
${POWER}${soc(0, 4, 11, 511)}
    EDIS;
    while (1) {}
}`,
      3,
      (bd) => {
        // Three triggers 1 us apart: the second is queued behind the running conversion, the third is lost.
        bd.at(2e6, (t) => bd.fireTrigger("EPWM4SOCA", t));
        bd.at(2e6 + 1000, (t) => bd.fireTrigger("EPWM4SOCA", t));
        bd.at(2e6 + 2000, (t) => bd.fireTrigger("EPWM4SOCA", t));
      },
    );
    expect(b.dev.get("AdcaRegs.ADCSOCOVF1")).toBe(1);
    expect(b.dev.get("AdcaRegs.ADCSOCFLG1")).toBe(0);
  });

  it("reads the DAC output on the shared pin ADCINA0 / DACOUTA", () => {
    const r = runProgram({
      kit: "robot",
      durationMs: 3,
      source: `uint16_t result = 0;
void main(void) {
${POWER}${soc(0, 0, 0)}
    DacaRegs.DACCTL.bit.DACREFSEL = 1;
    DacaRegs.DACOUTEN.bit.DACOUTEN = 1;
    DacaRegs.DACVALS.bit.DACVALS = 1000;
    EDIS;
    DELAY_US(100);
    AdcaRegs.ADCSOCFRC1.bit.SOC0 = 1;
    DELAY_US(10);
    result = AdcaResultRegs.ADCRESULT0;
    while (1) {}
}`,
      checks: [{ kind: "var", name: "result", equals: 1000, label: "loopback" }],
    });
    ok(r);
    expect(r.diagnostics).toEqual([]);
  });

  it("reports the mistakes the real chip hides", () => {
    const locked = runProgram({ kit: "robot", durationMs: 1, source: `void main(void) { AdcaRegs.ADCCTL1.bit.ADCPWDNZ = 1; while (1) {} }` });
    expect(codes(locked)).toContain("eallow");

    const down = runProgram({
      kit: "robot",
      durationMs: 1,
      source: `uint16_t x = 0;
void main(void) {
    EALLOW;${soc(0, 4, 0)}
    EDIS;
    AdcaRegs.ADCSOCFRC1.bit.SOC0 = 1;
    DELAY_US(10);
    x = AdcaResultRegs.ADCRESULT0;
    while (1) {}
}`,
    });
    expect(codes(down)).toContain("adc-powerdown");
    expect(down.passed).toBe(false);
    expect(down.board.readVar("x")).toBe(0);

    const early = runProgram({
      kit: "robot",
      durationMs: 1,
      source: `uint16_t x = 0;
void main(void) {
    EALLOW;
    AdcaRegs.ADCCTL2.bit.PRESCALE = 6;
    AdcaRegs.ADCCTL1.bit.ADCPWDNZ = 1;${soc(0, 4, 0, 9)}
    EDIS;
    x = AdcaResultRegs.ADCRESULT0;
    AdcaRegs.ADCSOCFRC1.bit.SOC0 = 1;
    while (1) {}
}`,
    });
    expect(codes(early).sort()).toEqual(["adc-acqps", "adc-no-result", "adc-powerup"]);
    expect(early.diagnostics.find((d) => d.code === "adc-acqps")!.msg).toContain("Set ACQPS to 14 or more");
  });

  it("puts the HW2 circuit on the boards", () => {
    for (const kit of ["robot", "redboard"]) {
      const r = runProgram({ kit, durationMs: 1, source: `void main(void) { while (1) {} }` });
      const knobs = r.kit.parts.filter((p) => p.kind === "knob").map((p) => (p.kind === "knob" ? p.input : ""));
      expect(knobs).toEqual(expect.arrayContaining(["ADCINA4", "ADCINA2", "ADCINA3"]));
      expect(r.board.input("ADCINA4")).toBe(1.5);
    }
  });
});
