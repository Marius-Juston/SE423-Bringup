import { describe, expect, it } from "vitest";
import { runProgram, type RunResult, type Stimulus } from "../src/sim/runner";
import { codes } from "./helpers";

import { Board } from "../src/sim/board";
// These tests run bare programs for one peripheral, without the InitSysCtrl() every real program starts with.
Board.expectInitSysCtrl = false;

// Regression tests for the peripheral audit: beginner mistakes that used to
// pass in silence, and register behaviour that disagreed with the TRM.

const run = (source: string, durationMs = 10, stimuli: Stimulus[] = [], kit = "robot"): RunResult => {
  const r = runProgram({ kit, source, durationMs, stimuli });
  expect(r.compileError, JSON.stringify(r.compileError)).toBeUndefined();
  return r;
};
const v = (r: RunResult, name: string) => r.board.readVar(name);

/** Timer 0 every 1 ms with the course's set-up. */
const timer = (isr: string, init = "", period = "1000") => `
uint32_t n = 0;
__interrupt void cpu_timer0_isr(void) { ${isr} }
void main(void) {
  InitSysCtrl();
  DINT; InitPieCtrl(); IER = 0; IFR = 0; InitPieVectTable();
  EALLOW; PieVectTable.TIMER0_INT = &cpu_timer0_isr; EDIS;
  InitCpuTimers();
  ConfigCpuTimer(&CpuTimer0, 200, ${period});
  CpuTimer0Regs.TCR.all = 0x4000;
  IER |= M_INT1;
  PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
  ${init}
  EINT;
  while (1) {}
}`;
const ACK = "n++; PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;";

describe("PIE and CPU interrupt diagnostics", () => {
  it("a correct timer interrupt has no diagnostics", () => {
    const r = run(timer(ACK), 10.5);
    expect(r.diagnostics).toEqual([]);
    expect(v(r, "n")).toBe(10);
  });

  it("names the function that forgot PIEACK (TRM 3.4.5): the group stays blocked", () => {
    for (const isr of ["n++;", "n++; PieCtrlRegs.PIEACK.all = PIEACK_GROUP2;"]) {
      const r = run(timer(isr), 10.5);
      expect(v(r, "n")).toBe(1);
      const d = r.diagnostics.find((x) => x.code === "pie-no-ack")!;
      expect(d.line).toBe(3);
      expect(d.msg).toContain("PIEACK_GROUP1");
    }
  });

  it("explains an interrupt that is requested but never taken: PIEIER, IER, EINT", () => {
    const cases: [string, string][] = [
      ["PieCtrlRegs.PIEIER1.bit.INTx7 = 0;", "PIEIER1.bit.INTx7"],
      ["IER = 0;", "M_INT1"],
      ["while (1) {}", "EINT"],
    ];
    for (const [init, word] of cases) {
      const r = run(timer(ACK, init), 10.5);
      expect(v(r, "n")).toBe(0);
      const d = r.diagnostics.find((x) => x.code === "irq-blocked-TIMER0_INT")!;
      expect(d, init).toBeDefined();
      expect(d.line).toBe(3);
      expect(d.msg).toContain(word);
    }
  });

  it("takes the message back when the interrupt is enabled late (a slow set-up is not a mistake)", () => {
    const r = run(timer(ACK, "DELAY_US(5500);"), 10.5);
    expect(r.diagnostics).toEqual([]);
    expect(v(r, "n")).toBe(6);
  });

  it("explains timer 1, which has no PIE channel", () => {
    const r = run(`uint32_t n = 0;
__interrupt void t1(void) { n++; }
void main(void) {
  InitSysCtrl(); DINT; InitPieCtrl(); IER = 0; IFR = 0; InitPieVectTable();
  EALLOW; PieVectTable.TIMER1_INT = &t1; EDIS;
  InitCpuTimers(); ConfigCpuTimer(&CpuTimer1, 200, 1000); CpuTimer1Regs.TCR.all = 0x4000;
  EINT;
  while (1) {}
}`, 5.5);
    expect(codes(r)).toEqual(["irq-blocked-TIMER1_INT"]);
    expect(r.diagnostics[0].msg).toContain("M_INT13");
  });

  it("serves pending interrupts in priority order: INT1.1, INT1.7, INT3.5, INT13, INT14", () => {
    const r = run(`uint16_t ord[8]; uint16_t k = 0;
__interrupt void t0(void) { ord[k++] = 17; PieCtrlRegs.PIEACK.all = PIEACK_GROUP1; }
__interrupt void a1(void) { ord[k++] = 11; PieCtrlRegs.PIEACK.all = PIEACK_GROUP1; }
__interrupt void e5(void) { ord[k++] = 35; PieCtrlRegs.PIEACK.all = PIEACK_GROUP3; }
__interrupt void t1(void) { ord[k++] = 13; }
__interrupt void t2(void) { ord[k++] = 14; }
void main(void) {
  InitSysCtrl(); DINT; InitPieCtrl(); IER = 0; IFR = 0; InitPieVectTable();
  EALLOW; PieVectTable.TIMER0_INT = &t0; PieVectTable.ADCA1_INT = &a1; PieVectTable.EPWM5_INT = &e5;
  PieVectTable.TIMER1_INT = &t1; PieVectTable.TIMER2_INT = &t2; EDIS;
  PieCtrlRegs.PIEIER1.all = 0x41; PieCtrlRegs.PIEIER3.bit.INTx5 = 1;
  IER |= M_INT1 | M_INT3 | M_INT13 | M_INT14;
  PieCtrlRegs.PIEIFR1.all = 0x41; PieCtrlRegs.PIEIFR3.all = 0x10; IFR |= M_INT13 | M_INT14;
  EINT;
  while (1) {}
}`, 1);
    expect(r.diagnostics).toEqual([]);
    expect(r.board.readArray("ord")!.data.slice(0, 5)).toEqual([11, 17, 35, 13, 14]);
  });

  it("does not flood the event queue with a timer period of a few clock cycles", () => {
    const r = run(timer(ACK, "CpuTimer0Regs.PRD.all = 0; CpuTimer0Regs.TCR.bit.TRB = 1;"), 200);
    expect(codes(r)).toContain("timer-too-fast-0");
    expect(r.board.timers.expiries[0].length).toBe(0);
    const s = run(timer(ACK, "", "0.1"), 5);
    expect(codes(s)).toContain("timer-too-fast-0");
  });

  it("a prescaler written while the timer runs applies from that moment (TRM 3.8)", () => {
    // 1 ms period, half of it gone, then SYSCLK / 2: the rest takes 1 ms, later periods 2 ms.
    const r = run(timer(ACK, "DELAY_US(500); CpuTimer0Regs.TPR.all = 1;"), 6);
    const [first, second] = r.board.timers.expiries[0];
    expect(first / 1e6).toBeCloseTo(1.5, 2);
    expect((second - first) / 1e6).toBeCloseTo(2, 5);
  });

  it("does not report wait-forever for a waiting loop that was left with return", () => {
    const r = run(`uint16_t flag = 0;
void wait(void) {
  while (flag == 0) {
    if (CpuTimer0Regs.TCR.bit.TSS == 0) return;
  }
}
void main(void) {
  DELAY_US(10);
  wait();
  while (1) {}
}`, 5);
    expect(r.diagnostics).toEqual([]);
  });
});

describe("a peripheral flag the interrupt function did not clear", () => {
  const adc = (isr: string) => `
uint32_t n = 0; uint16_t res = 0;
__interrupt void ADCA_ISR(void) { res = AdcaResultRegs.ADCRESULT0; n++; ${isr} PieCtrlRegs.PIEACK.all = PIEACK_GROUP1; }
void main(void) {
  InitSysCtrl(); DINT; InitPieCtrl(); IER = 0; IFR = 0; InitPieVectTable();
  EALLOW; PieVectTable.ADCA1_INT = &ADCA_ISR;
  EPwm5Regs.TBCTL.bit.CTRMODE = 3; EPwm5Regs.ETSEL.bit.SOCASEL = 2; EPwm5Regs.ETPS.bit.SOCAPRD = 1;
  EPwm5Regs.TBCTR = 0; EPwm5Regs.TBPRD = 50000; EPwm5Regs.ETSEL.bit.SOCAEN = 1; EPwm5Regs.TBCTL.bit.CTRMODE = 0;
  AdcaRegs.ADCCTL2.bit.PRESCALE = 6;
  AdcSetMode(ADC_ADCA, ADC_RESOLUTION_12BIT, ADC_SIGNALMODE_SINGLE);
  AdcaRegs.ADCCTL1.bit.INTPULSEPOS = 1; AdcaRegs.ADCCTL1.bit.ADCPWDNZ = 1;
  DELAY_US(1000);
  AdcaRegs.ADCSOC0CTL.bit.CHSEL = 4; AdcaRegs.ADCSOC0CTL.bit.ACQPS = 99; AdcaRegs.ADCSOC0CTL.bit.TRIGSEL = 13;
  AdcaRegs.ADCINTSEL1N2.bit.INT1SEL = 0; AdcaRegs.ADCINTSEL1N2.bit.INT1E = 1; AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
  EDIS;
  IER |= M_INT1; PieCtrlRegs.PIEIER1.bit.INTx1 = 1;
  EINT;
  while (1) {}
}`;
  const stim: Stimulus[] = [{ at: 0, set: "ADCINA4", value: 1.5 }];

  it("ADC: ADCINTFLG", () => {
    const good = run(adc("AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;"), 20, stim);
    expect(good.diagnostics).toEqual([]);
    expect(v(good, "n")).toBe(18);
    const bad = run(adc(""), 20, stim);
    expect(v(bad, "n")).toBe(1);
    expect(codes(bad)).toEqual(["irq-flag-ADCA1_INT"]);
    expect(bad.diagnostics[0].msg).toContain("ADCINTFLGCLR.bit.ADCINT1 = 1;");
  });

  it("ADC: a wrong PIEIER bit is reported as the cause, not the flag", () => {
    const r = run(adc("AdcaRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;").replace("PIEIER1.bit.INTx1", "PIEIER1.bit.INTx2"), 20, stim);
    expect(codes(r)).toEqual(["irq-blocked-ADCA1_INT"]);
    expect(r.diagnostics[0].msg).toContain("PIEIER1.bit.INTx1");
  });

  const epwm = (isr: string) => `
uint32_t n = 0;
__interrupt void EPWM5_ISR(void) { n++; ${isr} PieCtrlRegs.PIEACK.all = PIEACK_GROUP3; }
void main(void) {
  InitSysCtrl(); DINT; InitPieCtrl(); IER = 0; IFR = 0; InitPieVectTable();
  EALLOW; PieVectTable.EPWM5_INT = &EPWM5_ISR; EDIS;
  EPwm5Regs.TBCTL.bit.CTRMODE = 3; EPwm5Regs.TBCTR = 0; EPwm5Regs.TBPRD = 50000;
  EPwm5Regs.ETSEL.bit.INTSEL = 1; EPwm5Regs.ETSEL.bit.INTEN = 1; EPwm5Regs.ETPS.bit.INTPRD = 1;
  EPwm5Regs.TBCTL.bit.CTRMODE = 0;
  IER |= M_INT3; PieCtrlRegs.PIEIER3.bit.INTx5 = 1;
  EINT;
  while (1) {}
}`;
  it("ePWM: ETFLG.INT", () => {
    const good = run(epwm("EPwm5Regs.ETCLR.bit.INT = 1;"), 20);
    expect(good.diagnostics).toEqual([]);
    expect(v(good, "n")).toBe(20);
    const bad = run(epwm(""), 20);
    expect(v(bad, "n")).toBe(1);
    expect(codes(bad)).toEqual(["irq-flag-EPWM5_INT"]);
  });
});

describe("ePWM", () => {
  it("warns when CMPA.all puts the value in CMPAHR", () => {
    const r = run(`void main(void) {
  EPwm12Regs.TBPRD = 2500;
  EPwm12Regs.CMPA.all = 1250;
  while (1) {}
}`, 1);
    expect(codes(r)).toEqual(["cmp-all"]);
    expect(r.board.dev.get("EPwm12Regs.CMPA", "CMPA")).toBe(0);
    const ok = run(`void main(void) { EPwm12Regs.TBPRD = 2500; EPwm12Regs.CMPA.bit.CMPA = 1250; while (1) {} }`, 1);
    expect(ok.diagnostics).toEqual([]);
  });
});

describe("GPIO diagnostics", () => {
  const m = (body: string) => `void main(void) {\n InitSysCtrl(); InitGpio();\n${body}\n while (1) {} }`;

  it("a latch write to an input pin, or to a pin muxed to a peripheral, is reported", () => {
    const a = run(m("GpioDataRegs.GPASET.bit.GPIO31 = 1;"), 1);
    expect(codes(a)).toEqual(["gpio-not-output-31"]);
    expect(a.diagnostics[0].msg).toContain("GPADIR");
    const b = run(m("GPIO_SetupPinMux(31, GPIO_MUX_CPU1, 1); GPIO_SetupPinOptions(31, GPIO_OUTPUT, GPIO_PUSHPULL);\n GpioDataRegs.GPASET.bit.GPIO31 = 1;"), 1);
    expect(codes(b)).toEqual(["gpio-not-output-31"]);
    expect(b.diagnostics[0].msg).toContain("mux");
  });

  it("setting the latch before the direction is fine", () => {
    const r = run(m("GpioDataRegs.GPASET.bit.GPIO31 = 1;\n EALLOW; GpioCtrlRegs.GPADIR.bit.GPIO31 = 1; EDIS;"), 1);
    expect(r.diagnostics).toEqual([]);
    expect(r.board.gpio.level[31]).toBe(1);
  });

  it("a mask that reaches an output pin is not reported; one that reaches none names its lowest pin once", () => {
    const ok = run(m("EALLOW; GpioCtrlRegs.GPADIR.bit.GPIO31 = 1; EDIS;\n GpioDataRegs.GPACLEAR.all = 0xFFFFFFFF;"), 1);
    expect(ok.diagnostics).toEqual([]);
    const bad = run(m("GpioDataRegs.GPACLEAR.all = 0xC0000000;"), 1);
    expect(codes(bad)).toEqual(["gpio-not-output-30"]);
  });

  it("GPxSET.bit.GPIOn = 0 does nothing and says so; a computed mask of 0 is not a mistake", () => {
    const r = run(m("EALLOW; GpioCtrlRegs.GPADIR.bit.GPIO31 = 1; EDIS;\n GpioDataRegs.GPASET.bit.GPIO31 = 1;\n DELAY_US(10);\n GpioDataRegs.GPASET.bit.GPIO31 = 0;"), 1);
    expect(codes(r)).toEqual(["gpio-write-zero"]);
    expect(r.board.gpio.level[31]).toBe(1);
    const ok = run(m("Uint32 mask = 0;\n GpioDataRegs.GPASET.all = mask;\n GpioDataRegs.GPACLEAR.all = mask & 0x80000000;"), 1);
    expect(ok.diagnostics).toEqual([]);
  });
});

describe("SCI (TRM chapter 19)", () => {
  const raw = (o: { brr?: number; ccr?: string; fifo?: string; rel?: string; wait?: string } = {}) => `
uint16_t fftx = 0; uint16_t ffrx = 0;
void main(void) {
  uint16_t i;
  InitSysCtrl(); InitGpio();
  fftx = SciaRegs.SCIFFTX.all; ffrx = SciaRegs.SCIFFRX.all;
  EALLOW; GpioCtrlRegs.GPBGMUX1.bit.GPIO42 = 3; GpioCtrlRegs.GPBMUX1.bit.GPIO42 = 3; EDIS;
  SciaRegs.SCICTL1.bit.SWRESET = 0;
  SciaRegs.SCICCR.all = ${o.ccr ?? "0x0007"};
  SciaRegs.SCIHBAUD.all = 0;
  SciaRegs.SCILBAUD.all = ${o.brr ?? 53};
  ${o.fifo ?? "SciaRegs.SCIFFTX.bit.SCIFFENA = 1;"}
  SciaRegs.SCICTL1.bit.TXENA = 1;
  ${o.rel ?? "SciaRegs.SCICTL1.bit.SWRESET = 1;"}
  for (i = 0; i < 5; i++) { ${o.wait ?? ""} SciaRegs.SCITXBUF.all = 'A' + i; }
  while (1) {}
}`;

  it("resets SCIFFTX to A000h and SCIFFRX to 201Fh, and sends through the FIFO", () => {
    const r = run(raw(), 8, [], "launchpad");
    expect(r.diagnostics).toEqual([]);
    expect(v(r, "fftx")).toBe(0xa000);
    expect(v(r, "ffrx")).toBe(0x201f);
    expect(r.serial[0]).toBe("ABCDE");
  });

  it("sends nothing while SWRESET is 0, its value after reset", () => {
    const r = run(raw({ rel: "" }), 8, [], "launchpad");
    expect(r.serial[0]).toBe("");
    expect(codes(r)).toEqual(["sci-in-reset-0"]);
  });

  it("drops characters written while the transmit FIFO is held in reset", () => {
    const r = run(raw({ fifo: "SciaRegs.SCIFFTX.bit.SCIFFENA = 1; SciaRegs.SCIFFTX.bit.TXFIFORESET = 0;" }), 8, [], "launchpad");
    expect(r.serial[0]).toBe("");
    expect(codes(r)).toEqual(["sci-txfifo-reset-0"]);
  });

  it("without the FIFO there is one buffer behind the shifter: TXRDY paces it, a blind write replaces the waiting character", () => {
    const paced = run(raw({ fifo: "", wait: "while (SciaRegs.SCICTL2.bit.TXRDY == 0) {}" }), 8, [], "launchpad");
    expect(paced.diagnostics).toEqual([]);
    expect(paced.serial[0]).toBe("ABCDE");
    const blind = run(raw({ fifo: "" }), 8, [], "launchpad");
    expect(blind.serial[0]).toBe("AE");
    expect(codes(blind)).toEqual(["sci-tx-overwrite"]);
  });

  it("reports a baud rate or frame the terminal cannot read; BRR = 0 is LSPCLK / 16", () => {
    const slow = run(raw({ brr: 650 }), 8, [], "launchpad");
    expect(codes(slow)).toEqual(["sci-baud-0"]);
    expect(slow.passed).toBe(false);
    const seven = run(raw({ ccr: "0x0006" }), 8, [], "launchpad");
    expect(codes(seven)).toEqual(["sci-frame-0"]);
    const zero = run(raw({ brr: 0 }), 1, [], "launchpad");
    expect(zero.board.sci.baud(0)).toBe(50e6 / 16);
  });

  const rx = (isr: string, extra = "") => `
uint16_t n = 0; uint16_t last = 0; uint16_t txn = 0;
__interrupt void rxisr(void) { ${isr} }
__interrupt void txisr(void) { txn++; if (txn <= 3) SciaRegs.SCITXBUF.all = '0' + txn; else SciaRegs.SCIFFTX.bit.TXFFIENA = 0; SciaRegs.SCIFFTX.bit.TXFFINTCLR = 1; PieCtrlRegs.PIEACK.all = PIEACK_GROUP9; }
void main(void) {
  InitSysCtrl(); InitGpio();
  DINT; InitPieCtrl(); IER = 0; IFR = 0; InitPieVectTable();
  init_serialSCIA(&SerialA, 115200);
  EALLOW; PieVectTable.SCIA_RX_INT = &rxisr; PieVectTable.SCIA_TX_INT = &txisr; EDIS;
  IER |= M_INT9; PieCtrlRegs.PIEIER9.bit.INTx1 = 1;
  ${extra}
  EINT;
  while (1) {}
}`;
  const typed: Stimulus[] = [{ at: 1, type: "hello world, this is a long line\r" }];
  const DONE = "SciaRegs.SCIFFRX.bit.RXFFINTCLR = 1; PieCtrlRegs.PIEACK.all = PIEACK_GROUP9;";

  it("receives one character per interrupt", () => {
    const r = run(rx(`last = SciaRegs.SCIRXBUF.all; n++; ${DONE}`), 20, typed);
    expect(r.diagnostics).toEqual([]);
    expect(v(r, "n")).toBe(33);
    expect(v(r, "last")).toBe(13);
  });

  it("names the function that did not clear RXFFINT", () => {
    const r = run(rx("last = SciaRegs.SCIRXBUF.all; n++; PieCtrlRegs.PIEACK.all = PIEACK_GROUP9;"), 20, typed);
    expect(v(r, "n")).toBe(1);
    expect(codes(r)).toContain("irq-flag-SCIA_RX_INT");
    expect(r.board.dev.get("SciaRegs.SCIFFRX", "RXFFOVF")).toBe(1);
  });

  it("stops with a clear message when the function clears the flag without reading SCIRXBUF", () => {
    const r = run(rx(`n++; ${DONE}`), 20, typed);
    expect(r.runtimeError?.msg).toContain("SCIRXBUF was not read");
    expect(codes(r)).toContain("sci-rx-not-drained-0");
  });

  it("RXFIFORESET = 0 empties the receive FIFO", () => {
    const r = run(rx(`n++; SciaRegs.SCIFFRX.bit.RXFIFORESET = 0; SciaRegs.SCIFFRX.bit.RXFIFORESET = 1; ${DONE}`), 20, typed);
    expect(r.runtimeError).toBeUndefined();
    expect(r.diagnostics).toEqual([]);
    expect(v(r, "n")).toBe(33);
    expect(r.board.dev.get("SciaRegs.SCIFFRX", "RXFFST")).toBe(0);
  });

  it("requests the transmit FIFO interrupt while TXFFST <= TXFFIL", () => {
    const r = run(rx(`last = SciaRegs.SCIRXBUF.all; ${DONE}`, "PieCtrlRegs.PIEIER9.bit.INTx2 = 1; SciaRegs.SCIFFTX.bit.TXFFIENA = 1;"), 5);
    expect(r.runtimeError).toBeUndefined();
    expect(r.serial[0]).toBe("123");
    // Level sensitive: it comes again each time the FIFO is empty, until the function switches it off.
    expect(v(r, "txn")).toBe(4);
    expect(r.diagnostics).toEqual([]);
    // Left on with nothing to send, it would never end: the run stops with the reason.
    const stuck = run(rx(`last = SciaRegs.SCIRXBUF.all; ${DONE}`, "PieCtrlRegs.PIEIER9.bit.INTx2 = 1; SciaRegs.SCIFFTX.bit.TXFFIENA = 1;").replace("else SciaRegs.SCIFFTX.bit.TXFFIENA = 0;", ""), 5);
    expect(stuck.runtimeError?.msg).toContain("TXFFIENA = 0");
  });
});

describe("SPI, I2C and DAC diagnostics", () => {
  const SPI = `
    GPIO_SetupPinMux(66, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(66, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    GPIO_SetupPinMux(63, GPIO_MUX_CPU1, 15);
    GPIO_SetupPinMux(64, GPIO_MUX_CPU1, 15);
    GPIO_SetupPinMux(65, GPIO_MUX_CPU1, 15);
    SpibRegs.SPICCR.bit.SPISWRESET = 0;
    SpibRegs.SPICTL.bit.CLK_PHASE = 1;
    SpibRegs.SPICCR.bit.CLKPOLARITY = 0;
    SpibRegs.SPICTL.bit.MASTER_SLAVE = 1;
    SpibRegs.SPICCR.bit.SPICHAR = %CHAR%;
    SpibRegs.SPICTL.bit.TALK = 1;
    SpibRegs.SPIBRR.bit.SPI_BIT_RATE = 49;
    SpibRegs.SPIFFTX.bit.SPIFFENA = 1;
    SpibRegs.SPICCR.bit.SPISWRESET = 1;`;
  const spi = (char: number, body: string) => `uint16_t rx = 0;\nvoid main(void) {${SPI.replace("%CHAR%", String(char))}\n${body}\n while (1) {} }`;
  const WAIT = "while (SpibRegs.SPIFFRX.bit.RXFFST == 0) {}\n rx = SpibRegs.SPIRXBUF;\n GpioDataRegs.GPCSET.bit.GPIO66 = 1;";

  it("reads WHO_AM_I with the chip select low, and says so when no chip select is low", () => {
    const good = run(spi(15, ` GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;\n SpibRegs.SPITXBUF = 0xF500;\n ${WAIT}`), 2);
    expect(good.diagnostics).toEqual([]);
    expect(v(good, "rx")! & 0xff).toBe(0x71);
    const bad = run(spi(15, ` SpibRegs.SPITXBUF = 0xF500;\n ${WAIT}`), 2);
    expect(codes(bad)).toEqual(["spi-no-cs-b"]);
    expect(v(bad, "rx")).toBe(0xffff);
  });

  it("warns when an 8-bit word is written right-justified (TRM 18.3.4)", () => {
    const r = run(spi(7, ` GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;\n SpibRegs.SPITXBUF = 0xF5;\n ${WAIT}`), 2);
    // (The MPU-9250 also says that eight clocks are no transfer: it needs an address byte and a data byte.)
    expect(codes(r)).toEqual(["spi-left-justify-b", "mpu-short-frame"]);
    const ok = run(spi(7, ` GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;\n SpibRegs.SPITXBUF = 0xF5 << 8;\n SpibRegs.SPITXBUF = 0;\n while (SpibRegs.SPIFFRX.bit.RXFFST != 2) {}\n rx = SpibRegs.SPIRXBUF;\n ${WAIT}`), 2);
    expect(ok.diagnostics).toEqual([]);
  });

  it("I2C: an 8-bit address in I2CSAR is explained when nothing answers", () => {
    const r = run(`uint16_t nack = 0;
void main(void) {
    GPIO_SetupPinMux(40, GPIO_MUX_CPU1, 6);
    GPIO_SetupPinOptions(40, GPIO_INPUT, GPIO_PULLUP);
    GPIO_SetupPinMux(41, GPIO_MUX_CPU1, 6);
    GPIO_SetupPinOptions(41, GPIO_INPUT, GPIO_PULLUP);
    I2cbRegs.I2CMDR.bit.IRS = 0;
    I2cbRegs.I2CPSC.all = 19;
    I2cbRegs.I2CCLKL = 45;
    I2cbRegs.I2CCLKH = 45;
    I2cbRegs.I2CMDR.bit.IRS = 1;
    I2cbRegs.I2CSAR.all = 0x90;
    I2cbRegs.I2CCNT = 2;
    I2cbRegs.I2CMDR.all = 0x2C20;
    DELAY_US(500);
    nack = I2cbRegs.I2CSTR.bit.NACK;
    I2cbRegs.I2CMDR.bit.STP = 1;
    while (1) {}
}`, 3);
    expect(v(r, "nack")).toBe(1);
    expect(codes(r)).toEqual(["i2c-address"]);
    expect(r.diagnostics[0].msg).toContain("0x48");
  });

  it("DAC: a value written with the output off is reported, unless the output is enabled afterwards", () => {
    const off = run(`void main(void) { EALLOW; DacaRegs.DACCTL.bit.DACREFSEL = 1; EDIS; DacaRegs.DACVALS.bit.DACVALS = 2048; while (1) {} }`, 1);
    expect(codes(off)).toEqual(["dac-off-a"]);
    const on = run(`void main(void) { EALLOW; DacaRegs.DACCTL.bit.DACREFSEL = 1; EDIS; DacaRegs.DACVALS.bit.DACVALS = 2048;
 EALLOW; DacaRegs.DACOUTEN.bit.DACOUTEN = 1; EDIS; while (1) {} }`, 1);
    expect(on.diagnostics).toEqual([]);
    expect(on.board.output("DACA")).toBe(1.5);
  });
});
