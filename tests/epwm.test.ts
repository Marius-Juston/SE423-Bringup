import { describe, expect, it } from "vitest";
import { Board } from "../src/sim/board";
import { runProgram, type Check, type RunResult } from "../src/sim/runner";
import { codes } from "./helpers";

// These tests run bare programs for one peripheral, without the InitSysCtrl() every real program starts with.
Board.expectInitSysCtrl = false;

// TRM chapter 15. TBCLK = EPWMCLK / (HSPCLKDIV x CLKDIV) = 50 MHz at reset
// (EPWMCLK 100 MHz, HSPCLKDIV /2), so one count is 20 ns.

const run = (source: string, durationMs: number, checks: Check[] = [], kit = "robot") => runProgram({ kit, source, durationMs, checks });

function ok(r: RunResult): void {
  expect(r.compileError, JSON.stringify(r.compileError)).toBeUndefined();
  expect(r.runtimeError, JSON.stringify(r.runtimeError)).toBeUndefined();
  for (const c of r.checks) expect(c.pass, `${c.label}: ${c.detail}`).toBe(true);
}

/** Lab 3's EPWM12A set-up on LED1 (GPIO22, mux 5). */
const lab3 = (tbprd: number, cmpa: number, extra = "") => `
    EPwm12Regs.TBCTL.bit.CTRMODE = 0;
    EPwm12Regs.TBCTL.bit.FREE_SOFT = 2;
    EPwm12Regs.TBCTL.bit.PHSEN = 0;
    EPwm12Regs.TBCTL.bit.CLKDIV = 0;
    EPwm12Regs.TBCTR = 0;
    EPwm12Regs.TBPRD = ${tbprd};
    EPwm12Regs.CMPA.bit.CMPA = ${cmpa};
    EPwm12Regs.AQCTLA.bit.CAU = 1;
    EPwm12Regs.AQCTLA.bit.ZRO = 2;
    EPwm12Regs.TBPHS.bit.TBPHS = 0;
    ${extra}
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 5);
    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO22 = 1;
    EDIS;`;

describe("ePWM time base and action qualifier", () => {
  it("runs Lab 3's EPWM12A: (TBPRD + 1) x 20 ns period, CMPA / (TBPRD + 1) duty", () => {
    const r = run(`void main(void) {${lab3(2500, 1250)}\n while (1) {} }`, 10, [
      { kind: "blink", led: "LED1", periodMs: 0.05, tolPct: 0.1, label: "20 kHz" },
      { kind: "duty", led: "LED1", pct: (100 * 1250) / 2501, tolPct: 0.2, from: 1, label: "50 %" },
      { kind: "reg", reg: "EPwm12Regs.TBCTL", field: "HSPCLKDIV", equals: 1, label: "HSPCLKDIV resets to /2" },
    ]);
    ok(r);
    expect(r.diagnostics).toEqual([]);
    const rises = r.traces.get(22)!.filter((x) => x.level === 1);
    expect(rises[5].t - rises[4].t).toBe(2501 * 20);
  });

  it("is frozen at reset and leaves LED1 a plain GPIO while the mux is 0", () => {
    const r = run(
      `void main(void) {
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPASET.bit.GPIO22 = 1;
    EPwm12Regs.TBPRD = 2500;
    EPwm12Regs.AQCTLA.bit.ZRO = 3;
    while (1) {} }`,
      5,
      [
        { kind: "steady", led: "LED1", from: 0.1, to: 5, on: true, label: "LED1 stays on" },
        { kind: "reg", reg: "EPwm12Regs.TBCTL", field: "CTRMODE", equals: 3, label: "CTRMODE resets to freeze" },
      ],
    );
    ok(r);
    expect(r.diagnostics).toEqual([]);
  });

  it("divides the clock with CLKDIV and HSPCLKDIV", () => {
    // 100 MHz / (HSPCLKDIV /10 x CLKDIV /16) = 625 kHz; toggling on zero gives 2 x 625 counts per period.
    const r = run(
      `void main(void) {
    EPwm12Regs.TBCTL.bit.HSPCLKDIV = 5;
    EPwm12Regs.TBCTL.bit.CLKDIV = 4;
    EPwm12Regs.TBPRD = 624;
    EPwm12Regs.AQCTLA.bit.ZRO = 3;
    EPwm12Regs.TBCTL.bit.CTRMODE = 0;
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 5);
    while (1) {} }`,
      20,
      [{ kind: "blink", led: "LED1", periodMs: 2, tolPct: 0.01, label: "500 Hz" }],
    );
    ok(r);
  });

  it("gives 0 % at CMPA = 0 and never matches CMPA above TBPRD (Table 15-7)", () => {
    const zero = run(`void main(void) {${lab3(2500, 0)}\n while (1) {} }`, 3, [{ kind: "duty", led: "LED1", pct: 0, tolPct: 0.01, from: 0.5, label: "0 %" }]);
    ok(zero);
    expect(zero.diagnostics).toEqual([]);
    const over = run(`void main(void) {${lab3(2500, 3000)}\n while (1) {} }`, 3, [{ kind: "duty", led: "LED1", pct: 100, tolPct: 0.01, from: 0.5, label: "100 %" }]);
    ok(over);
    expect(codes(over)).toContain("cmp-over-period");
  });

  it("counts up-down with period 2 x TBPRD and the priorities of Figure 15-24", () => {
    const src = (cmpa: number) => `void main(void) {
    EPwm12Regs.TBCTL.bit.CTRMODE = 2;
    EPwm12Regs.TBPRD = 1000;
    EPwm12Regs.CMPA.bit.CMPA = ${cmpa};
    EPwm12Regs.AQCTLA.bit.CAU = 2;
    EPwm12Regs.AQCTLA.bit.CAD = 1;
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 5);
    while (1) {} }`;
    ok(
      run(src(250), 2, [
        { kind: "blink", led: "LED1", periodMs: 2 * 0.01 * 2, tolPct: 60, label: "edges" },
        { kind: "duty", led: "LED1", pct: 75, tolPct: 0.5, from: 0.5, label: "CMPA = TBPRD / 4 is 75 %" },
      ]),
    );
    // One full cycle is 2 x 1000 x 20 ns = 40 us: high from CMPA up to CMPA down.
    const r = run(src(500), 1);
    const tr = r.traces.get(22)!.filter((x) => x.level === 1);
    expect(tr[2].t - tr[1].t).toBe(40_000);
    ok(run(src(0), 2, [{ kind: "duty", led: "LED1", pct: 100, tolPct: 0.01, from: 0.5, label: "CMPA = 0 is 100 %" }]));
    ok(run(src(1000), 2, [{ kind: "duty", led: "LED1", pct: 0, tolPct: 0.01, from: 0.5, label: "CMPA = TBPRD is 0 %" }]));
  });

  it("counts down from TBPRD", () => {
    const r = run(
      `void main(void) {
    EPwm12Regs.TBCTL.bit.CTRMODE = 1;
    EPwm12Regs.TBPRD = 999;
    EPwm12Regs.CMPA.bit.CMPA = 250;
    EPwm12Regs.AQCTLA.bit.PRD = 2;
    EPwm12Regs.AQCTLA.bit.CAD = 1;
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 5);
    while (1) {} }`,
      2,
      [
        { kind: "blink", led: "LED1", periodMs: 0.02, tolPct: 60, label: "edges" },
        // High from the period (999) down to CMPA (250): 749 of 1000 counts.
        { kind: "duty", led: "LED1", pct: 74.9, tolPct: 0.3, from: 0.5, label: "74.9 %" },
      ],
    );
    ok(r);
  });

  it("reads TBCTR live and keeps it while frozen", () => {
    const r = run(
      `uint16_t a = 0; uint16_t b = 0; uint16_t c = 0; uint16_t d = 0;
void main(void) {
    EPwm1Regs.TBPRD = 49999;
    EPwm1Regs.TBCTR = 0;
    EPwm1Regs.TBCTL.bit.CTRMODE = 0;
    DELAY_US(100);
    a = EPwm1Regs.TBCTR;
    DELAY_US(100);
    b = EPwm1Regs.TBCTR;
    EPwm1Regs.TBCTL.bit.CTRMODE = 3;
    c = EPwm1Regs.TBCTR;
    DELAY_US(100);
    d = EPwm1Regs.TBCTR;
    while (1) {} }`,
      2,
    );
    ok(r);
    const v = (n: string) => r.board.readVar(n)!;
    // 100 us is 5000 counts of 20 ns.
    expect(v("b") - v("a")).toBeGreaterThanOrEqual(5000);
    expect(v("b") - v("a")).toBeLessThan(5020);
    expect(v("c")).toBeGreaterThanOrEqual(v("b"));
    expect(v("d")).toBe(v("c"));
  });

  it("loads CMPA from its shadow at CTR = 0, or at once with SHDWAMODE = 1", () => {
    // 1 ms period. CMPA is rewritten 0.1 ms into a cycle, before the compare match at 0.2 ms.
    const src = (immediate: number) => `void main(void) {
    EPwm12Regs.TBPRD = 49999;
    EPwm12Regs.CMPA.bit.CMPA = 10000;
    EPwm12Regs.CMPCTL.bit.SHDWAMODE = ${immediate};
    EPwm12Regs.AQCTLA.bit.ZRO = 2;
    EPwm12Regs.AQCTLA.bit.CAU = 1;
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 5);
    EPwm12Regs.TBCTR = 0;
    EPwm12Regs.TBCTL.bit.CTRMODE = 0;
    DELAY_US(2100);
    EPwm12Regs.CMPA.bit.CMPA = 40000;
    while (1) {} }`;
    const firstFall = (r: RunResult) => Math.round((r.traces.get(22)!.find((x) => x.level === 0 && x.t > 2.11e6)!.t % 1e6) / 1e4);
    // Shadowed: the cycle in progress still falls at the old 0.2 ms.
    expect(firstFall(run(src(0), 5))).toBe(20);
    // Immediate: the new value is used in the cycle in progress, which falls at 0.8 ms.
    expect(firstFall(run(src(1), 5))).toBe(80);
    // Either way the following cycles use the new value.
    for (const r of [run(src(0), 5), run(src(1), 5)]) expect(Math.round((r.traces.get(22)!.filter((x) => x.level === 0 && x.t > 3e6)[0].t % 1e6) / 1e4)).toBe(80);
  });

  it("forces the output by software (AQCSFRC)", () => {
    const r = run(`void main(void) {${lab3(2500, 1250)}\n DELAY_US(1000);\n EPwm12Regs.AQCSFRC.bit.CSFA = 2;\n while (1) {} }`, 4, [
      { kind: "steady", led: "LED1", from: 1.5, to: 4, on: true, label: "held high" },
    ]);
    ok(r);
  });
});

describe("ePWM event trigger", () => {
  const hw2 = `
    EALLOW;
    EPwm4Regs.ETSEL.bit.SOCAEN = 0;
    EPwm4Regs.TBCTL.bit.CTRMODE = 3;
    EPwm4Regs.ETSEL.bit.SOCASEL = 2;
    EPwm4Regs.ETPS.bit.SOCAPRD = 1;
    EPwm4Regs.TBCTR = 0x0;
    EPwm4Regs.TBPHS.bit.TBPHS = 0x0000;
    EPwm4Regs.TBCTL.bit.PHSEN = 0;
    EPwm4Regs.TBCTL.bit.CLKDIV = 0;
    EPwm4Regs.TBPRD = 50000;
    EPwm4Regs.ETSEL.bit.SOCAEN = 1;
    EPwm4Regs.TBCTL.bit.CTRMODE = 0;
    EDIS;`;

  const triggers = (source: string, ms: number, line: string): number[] => {
    const b = new Board();
    const times: number[] = [];
    b.onTrigger(line, (t) => times.push(t));
    b.load(source);
    b.runUntil(b.run(), ms * 1e6);
    expect([...b.diagnostics.values()]).toEqual([]);
    return times;
  };

  it("fires EPWM4SOCA every period with HW2's set-up", () => {
    const t = triggers(`void main(void) {${hw2}\n while (1) {} }`, 10.5, "EPWM4SOCA");
    // TBPRD = 50000 at 50 MHz: 50001 counts = 1.00002 ms; the first period match is 50000 counts in.
    expect(t.length).toBe(10);
    expect(t[1] - t[0]).toBe(50001 * 20);
    expect(t[0]).toBeGreaterThan(1_000_000 - 2000);
    expect(t[0]).toBeLessThan(1_000_000 + 2000);
  });

  it("prescales with ETPS and fires SOCB separately", () => {
    const src = `void main(void) {${hw2}
    EPwm4Regs.ETPS.bit.SOCAPRD = 3;
    EPwm4Regs.ETSEL.bit.SOCBSEL = 1;
    EPwm4Regs.ETPS.bit.SOCBPRD = 2;
    EPwm4Regs.ETSEL.bit.SOCBEN = 1;
    while (1) {} }`;
    expect(triggers(src, 12.5, "EPWM4SOCA").length).toBe(4);
    expect(triggers(src, 12.5, "EPWM4SOCB").length).toBe(6);
  });

  const isr = (clear: string) => `
uint32_t count = 0;
__interrupt void epwm5_isr(void) {
    count++;
    ${clear}
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP3;
}
void main(void) {
    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();
    EALLOW;
    PieVectTable.EPWM5_INT = &epwm5_isr;
    EDIS;
    EPwm5Regs.TBCTL.bit.CTRMODE = 0;
    EPwm5Regs.TBCTL.bit.CLKDIV = 0;
    EPwm5Regs.TBPRD = 49999;
    EPwm5Regs.ETSEL.bit.INTSEL = 1;
    EPwm5Regs.ETPS.bit.INTPRD = 1;
    EPwm5Regs.ETSEL.bit.INTEN = 1;
    PieCtrlRegs.PIEIER3.bit.INTx5 = 1;
    IER |= M_INT3;
    EINT;
    while (1) {}
}`;

  it("interrupts through PIE INT3.n once per event while ETCLR.INT is written", () => {
    const r = run(isr("EPwm5Regs.ETCLR.bit.INT = 1;"), 10.5, [{ kind: "isr", fn: "epwm5_isr", min: 10, max: 11, label: "1 kHz" }]);
    ok(r);
    expect(r.diagnostics).toEqual([]);
    expect(r.isrLog[0].vector).toBe("EPWM5_INT");
  });

  it("stops interrupting while ETFLG.INT stays set", () => {
    const r = run(isr(""), 10.5, [
      { kind: "isr", fn: "epwm5_isr", min: 1, max: 1, label: "only once" },
      { kind: "reg", reg: "EPwm5Regs.ETFLG", field: "INT", equals: 1, label: "flag still set" },
    ]);
    ok(r);
  });
});

describe("ePWM synchronisation", () => {
  it("loads TBPHS into a module with PHSEN on the upstream module's zero", () => {
    const r = run(
      `void main(void) {
    EPwm1Regs.TBPRD = 2499;
    EPwm1Regs.CMPA.bit.CMPA = 1250;
    EPwm1Regs.AQCTLA.bit.ZRO = 2;
    EPwm1Regs.AQCTLA.bit.CAU = 1;
    EPwm1Regs.TBCTL.bit.SYNCOSEL = 1;
    EPwm2Regs.TBPRD = 2499;
    EPwm2Regs.CMPA.bit.CMPA = 1250;
    EPwm2Regs.AQCTLA.bit.ZRO = 2;
    EPwm2Regs.AQCTLA.bit.CAU = 1;
    EPwm2Regs.TBPHS.bit.TBPHS = 1875;
    EPwm2Regs.TBCTL.bit.PHSEN = 1;
    GPIO_SetupPinMux(0, GPIO_MUX_CPU1, 1);
    GPIO_SetupPinMux(2, GPIO_MUX_CPU1, 1);
    EPwm2Regs.TBCTL.bit.CTRMODE = 0;
    EPwm1Regs.TBCTL.bit.CTRMODE = 0;
    while (1) {} }`,
      2,
    );
    ok(r);
    expect(r.diagnostics).toEqual([]);
    const rise = (pin: number) => r.traces.get(pin)!.filter((x) => x.level === 1 && x.t > 1e6)[0].t;
    // EPWM2 is 1875 counts ahead, so its rising edge comes 625 counts (12.5 us) after EPWM1's.
    expect((((rise(2) - rise(0)) % 50_000) + 50_000) % 50_000).toBe(625 * 20);
  });
});

describe("ePWM diagnostics", () => {
  it("warns when a running PWM has no pin muxed to it", () => {
    const src = `void main(void) {
    EPwm12Regs.TBCTL.bit.CTRMODE = 0;
    EPwm12Regs.TBPRD = 2500;
    EPwm12Regs.CMPA.bit.CMPA = 1250;
    EPwm12Regs.AQCTLA.bit.CAU = 1;
    EPwm12Regs.AQCTLA.bit.ZRO = 2;
    while (1) {} }`;
    const r = run(src, 3, [{ kind: "led", led: "LED1", at: 2, on: false, label: "LED1 dark" }]);
    ok(r);
    const d = r.diagnostics.find((x) => x.code === "pwm-mux")!;
    expect(d.msg).toContain("GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 5)");
    expect(d.line).toBe(6);
  });

  it("does not warn for the unused B output of the course's init code", () => {
    const r = run(
      `void main(void) {
    EPwm1Regs.TBCTL.bit.CTRMODE = 0;
    EPwm1Regs.TBPRD = 2500;
    EPwm1Regs.CMPA.bit.CMPA = 1250;
    EPwm1Regs.AQCTLA.bit.CAU = 1;
    EPwm1Regs.AQCTLA.bit.ZRO = 2;
    EPwm1Regs.AQCTLB.bit.CBU = 1;
    EPwm1Regs.AQCTLB.bit.ZRO = 2;
    GPIO_SetupPinMux(0, GPIO_MUX_CPU1, 1);
    while (1) {} }`,
      3,
    );
    expect(r.diagnostics).toEqual([]);
  });

  it("mentions a fractional float written to CMPA once, as information", () => {
    const r = run(`float duty = 0.25;\nvoid main(void) {${lab3(2500, 1250)}\n    EPwm12Regs.CMPA.bit.CMPA = duty;\n while (1) {} }`, 2);
    const d = r.diagnostics.find((x) => x.code === "cmp-float")!;
    expect(d.severity).toBe("info");
    expect(d.msg).toContain("0.25");
    expect(r.board.dev.get("EPwm12Regs.CMPA", "CMPA")).toBe(0);
    const fine = run(`float duty = 0.25;\nvoid main(void) {${lab3(2500, 1250)}\n    EPwm12Regs.CMPA.bit.CMPA = duty * 2500;\n while (1) {} }`, 2);
    expect(fine.diagnostics).toEqual([]);
  });

  it("does not simulate a 12.5 MHz square wave (TBPRD = 0, the buzzer's note off)", () => {
    const r = run(
      `void main(void) {
    EPwm9Regs.TBCTL.bit.CTRMODE = 0;
    EPwm9Regs.TBCTL.bit.CLKDIV = 1;
    EPwm9Regs.AQCTLA.bit.ZRO = 3;
    GPIO_SetupPinMux(16, GPIO_MUX_CPU1, 5);
    while (1) {} }`,
      50,
    );
    ok(r);
    expect(r.diagnostics).toEqual([]);
    expect((r.traces.get(16) ?? []).length).toBeLessThan(3);
  });
});
