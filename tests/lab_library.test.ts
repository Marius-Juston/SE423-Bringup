import { describe, expect, it } from "vitest";
import { ch05 } from "../src/levels/chapters/ch05_interrupts";
import { ch07 } from "../src/levels/chapters/ch07_dac";
import { ch08 } from "../src/levels/chapters/ch08_adc";
import { ch17 } from "../src/levels/chapters/ch17_sensors";
import type { CodeLevel } from "../src/levels/types";
import { runProgram, type RunResult } from "../src/sim/runner";

// Lab 4 has students fill in the scaling line of setDACA() and setDACB() and
// look up the PIE channel of ADCC1; Lab 6 has them tune the wall follower.
// The game provides the two DAC functions and enableAdccInterrupt() from the
// library and never prints those lines. These tests pin down what the library
// does, that a program may still define the functions itself (saved student
// code does), and that the levels do not show what the labs leave blank.

const run = (source: string, durationMs = 2, stimuli?: { at: number; set: string; value: number }[]) => runProgram({ kit: "robot", source, durationMs, stimuli });
const ok = (r: RunResult) => {
  expect(r.compileError).toBeUndefined();
  expect(r.runtimeError).toBeUndefined();
  return r;
};

const DAC_ON = (ch: string) => `    EALLOW;
    Dac${ch}Regs.DACCTL.bit.DACREFSEL = 1;
    Dac${ch}Regs.DACOUTEN.bit.DACOUTEN = 1;
    EDIS;`;

describe("setDACA() and setDACB(), the course library's DAC functions", () => {
  // volts asked for, number expected in DACVALS: a straight line from 0 V = 0 to 3 V = 4095,
  // fraction cut off, limited at both ends.
  const TABLE: [number, number][] = [
    [0, 0],
    [0.75, 1023],
    [1.5, 2047],
    [2.25, 3071],
    [3.0, 4095],
    [3.2, 4095],
    [5.0, 4095],
    [-1.0, 0],
  ];

  for (const ch of ["a", "b"]) {
    const fn = `setDAC${ch.toUpperCase()}`;
    it(`${fn} limits to 0 V ... 3 V and scales to 0 ... 4095`, () => {
      const r = ok(
        run(`uint16_t got[${TABLE.length}];
float v[${TABLE.length}] = {${TABLE.map(([x]) => x.toFixed(2)).join(", ")}};
void main(void)
{
    int16_t i;
    InitSysCtrl();
${DAC_ON(ch)}
    for (i = 0; i < ${TABLE.length}; i++) {
        ${fn}(v[i]);
        got[i] = Dac${ch}Regs.DACVALS.bit.DACVALS;
    }
    ${fn}(1.5);
    while (1) {
    }
}
`),
      );
      expect(r.diagnostics).toEqual([]);
      TABLE.forEach(([volts, counts], i) => expect(r.board.readVar(`got[${i}]`), `${fn}(${volts})`).toBe(counts));
      expect(r.board.output(`DAC${ch.toUpperCase()}`)).toBeCloseTo((2047 * 3) / 4096, 6);
    });
  }

  it("takes simulated time, as the C function would", () => {
    const src = (n: number) => `void main(void)
{
    int16_t i;
    InitSysCtrl();
${DAC_ON("a")}
    for (i = 0; i < ${n}; i++) {
        setDACA(1.0);
    }
    GpioDataRegs.GPATOGGLE.bit.GPIO31 = 1;
    while (1) {
    }
}
`;
    const steps = (n: number) => ok(run(src(n))).board.steps;
    // Two tests and one assignment for each call, on top of the call itself.
    expect(steps(110) - steps(10)).toBeGreaterThanOrEqual(100 * 4);
  });

  it("reports a DAC that is switched off on the line of the call", () => {
    const r = ok(run(`void main(void)\n{\n    InitSysCtrl();\n    setDACA(1.0);\n    while (1) {\n    }\n}\n`));
    const d = r.diagnostics.find((x) => x.code === "dac-off-a");
    expect(d).toBeDefined();
    expect(d!.line).toBe(4);
  });

  it("is replaced by a program's own definition, as saved student code has it", () => {
    for (const proto of ["void setDACA(float dacouta0);\n", ""]) {
      const r = ok(
        run(`${proto}void setDACA(float dacouta0)
{
    DacaRegs.DACVALS.bit.DACVALS = 77;
}
void main(void)
{
    InitSysCtrl();
${DAC_ON("a")}
    setDACA(2.0);
    setDACB(2.0);
    while (1) {
    }
}
`),
      );
      // The program's setDACA ran; setDACB is still the library's.
      expect(r.board.dev.get("DacaRegs.DACVALS", "DACVALS")).toBe(77);
      expect(r.board.dev.get("DacbRegs.DACVALS", "DACVALS")).toBe(2730);
    }
  });

  it("a program saved before the library had setDACA still passes its level", () => {
    const level = ch07.levels.find((l) => l.id === "dac-ramp") as CodeLevel;
    // The student's own function of the time: any body that does the job, here with integer steps.
    const own = `void setDACA(float volts)
{
    float counts = volts * 1365.0;
    if (counts > 4095.0) counts = 4095.0;
    if (counts < 0.0) counts = 0.0;
    DacaRegs.DACVALS.bit.DACVALS = counts;
}
`;
    const source = level.solution.replace("void main(void)", `${own}\nvoid main(void)`);
    const r = runProgram({ kit: level.kit, source, durationMs: level.durationMs, stimuli: level.stimuli, checks: level.checks, bonus: level.bonus });
    expect(r.compileError).toBeUndefined();
    for (const c of r.checks) expect(c.pass, `${c.label}: ${c.detail}`).toBe(true);
  });
});

describe("enableAdccInterrupt(), the enables of the ADCC1 interrupt", () => {
  const program = (enable: string, extra = "") => `__interrupt void ADCC_ISR(void);
uint16_t count = 0;
uint16_t mine = 0;
${extra}
void main(void)
{
    InitSysCtrl();
    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();
    EALLOW;
    PieVectTable.ADCC1_INT = &ADCC_ISR;
    AdccRegs.ADCCTL2.bit.PRESCALE = 6;
    AdcSetMode(ADC_ADCC, ADC_RESOLUTION_12BIT, ADC_SIGNALMODE_SINGLE);
    AdccRegs.ADCCTL1.bit.INTPULSEPOS = 1;
    AdccRegs.ADCCTL1.bit.ADCPWDNZ = 1;
    DELAY_US(1000);
    AdccRegs.ADCSOC0CTL.bit.CHSEL = 5;
    AdccRegs.ADCSOC0CTL.bit.ACQPS = 99;
    AdccRegs.ADCSOC0CTL.bit.TRIGSEL = 1;    // CPU timer 0
    AdccRegs.ADCINTSEL1N2.bit.INT1SEL = 0;
    AdccRegs.ADCINTSEL1N2.bit.INT1E = 1;
    AdccRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
    EDIS;
    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, 1000);
    CpuTimer0Regs.TCR.all = 0x4000;
${enable}
    EINT;
    while (1) {
    }
}
__interrupt void ADCC_ISR(void)
{
    count++;
    AdccRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}
`;

  it("lets the ADCC1 interrupt reach the program", () => {
    const r = ok(run(program("    enableAdccInterrupt();"), 12));
    expect(r.diagnostics).toEqual([]);
    expect(r.board.readVar("count")).toBeGreaterThanOrEqual(9);
  });

  it("without it the interrupt never runs, and the message names the call, not the bit", () => {
    const r = ok(run(program("    IER |= M_INT1;"), 12));
    expect(r.board.readVar("count")).toBe(0);
    const d = r.diagnostics.find((x) => x.code === "irq-blocked-ADCC1_INT");
    expect(d).toBeDefined();
    expect(d!.msg).toContain("enableAdccInterrupt();");
    expect(d!.msg).toContain("Table 3-2");
    expect(d!.msg).not.toMatch(/INTx\d/);
  });

  it("a missing enable of another interrupt still names its bit", () => {
    const r = ok(run(program("    IER |= M_INT1;").replace(/ADCC1_INT/g, "ADCA1_INT").replace(/Adcc/g, "Adca").replace("ADC_ADCC", "ADC_ADCA"), 12));
    const d = r.diagnostics.find((x) => x.code === "irq-blocked-ADCA1_INT");
    expect(d).toBeDefined();
    expect(d!.msg).toContain("PieCtrlRegs.PIEIER1.bit.INTx1 = 1;");
  });

  it("is replaced by a program's own enableAdccInterrupt()", () => {
    const r = ok(run(program("    enableAdccInterrupt();", "void enableAdccInterrupt(void)\n{\n    mine = 7;\n}"), 12));
    expect(r.board.readVar("mine")).toBe(7);
    // The library's version did not run.
    expect(r.board.readVar("count")).toBe(0);
  });
});

describe("what Labs 4 and 6 leave blank is not printed", () => {
  const text = (level: object) => JSON.stringify(level);

  it("no level of the DAC and ADC chapters shows the body of setDACA or setDACB", () => {
    for (const level of [...ch07.levels, ...ch08.levels]) {
      const t = text(level);
      expect(t, level.id).not.toMatch(/void setDAC[AB]\s*\(/);
      expect(t, level.id).not.toMatch(/dacouta\d|DACOutInt/);
      expect(t, level.id).not.toMatch(/\* ?4095\.0 ?\/ ?3\.0\b/);
    }
  });

  it("no level shows the PIE channel of ADCC1", () => {
    for (const level of [...ch05.levels, ...ch08.levels]) {
      const t = text(level);
      expect(t, level.id).not.toMatch(/PIEIER1\.bit\.INTx3|INT1\.3|3 ADCC1/);
    }
  });

  it("the gyro level does not use the scale of the lab robot's gyro", () => {
    for (const level of ch08.levels) expect(text(level), level.id).not.toMatch(/\* ?400(\.0)?\b|400 degrees per second/);
  });

  it("the wall follower does not carry the tuned values of the final project starter", () => {
    for (const level of ch17.levels) {
      const t = text(level);
      expect(t, level.id).not.toMatch(/Kp_right_wal = -4\.0|ref_right_wall = 1\.1|turn_saturation = 2\.5|Kp_front_wall = -2\.0/);
      expect(t, level.id).not.toMatch(/left_turn_Start_threshold = 1\.3|left_turn_Stop_threshold = 3\.5|front_turn_velocity = 0\.2/);
    }
  });
});
