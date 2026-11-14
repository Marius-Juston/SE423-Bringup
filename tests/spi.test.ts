import { describe, expect, it } from "vitest";
import { Board } from "../src/sim/board";
import { runProgram } from "../src/sim/runner";
import { clockScheme, registerSpiDevice, spiBus, type SpiMode } from "../src/sim/plugins/spi";
import { codes } from "./helpers";

// These tests run bare programs for one peripheral, without the InitSysCtrl() every real program starts with.
Board.expectInitSysCtrl = false;

// SPIB set up as the course does (setupSpib in SE423Lib.c / HW3), with the
// values a test wants to vary as parameters.
const setup = (o: { brr?: number; char?: number; pol?: number; phase?: number; lbk?: number; rxffil?: number } = {}) => `
    GPIO_SetupPinMux(66, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(66, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    GPIO_SetupPinMux(29, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(29, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPASET.bit.GPIO29 = 1;
    GPIO_SetupPinMux(63, GPIO_MUX_CPU1, 15);
    GPIO_SetupPinMux(64, GPIO_MUX_CPU1, 15);
    GPIO_SetupPinMux(65, GPIO_MUX_CPU1, 15);
    EALLOW;
    GpioCtrlRegs.GPBPUD.bit.GPIO63 = 0;
    GpioCtrlRegs.GPCPUD.bit.GPIO64 = 0;
    GpioCtrlRegs.GPCPUD.bit.GPIO65 = 0;
    GpioCtrlRegs.GPBQSEL2.bit.GPIO63 = 3;
    GpioCtrlRegs.GPCQSEL1.bit.GPIO64 = 3;
    GpioCtrlRegs.GPCQSEL1.bit.GPIO65 = 3;
    EDIS;
    SpibRegs.SPICCR.bit.SPISWRESET = 0;
    SpibRegs.SPICTL.bit.CLK_PHASE = ${o.phase ?? 1};
    SpibRegs.SPICCR.bit.CLKPOLARITY = ${o.pol ?? 0};
    SpibRegs.SPICTL.bit.MASTER_SLAVE = 1;
    SpibRegs.SPICCR.bit.SPICHAR = ${o.char ?? 0xf};
    SpibRegs.SPICCR.bit.SPILBK = ${o.lbk ?? 0};
    SpibRegs.SPICTL.bit.TALK = 1;
    SpibRegs.SPIPRI.bit.FREE = 1;
    SpibRegs.SPICTL.bit.SPIINTENA = 0;
    SpibRegs.SPIBRR.bit.SPI_BIT_RATE = ${o.brr ?? 49};
    SpibRegs.SPISTS.all = 0x0000;
    SpibRegs.SPIFFTX.bit.SPIRST = 1;
    SpibRegs.SPIFFTX.bit.SPIFFENA = 1;
    SpibRegs.SPIFFTX.bit.TXFIFO = 0;
    SpibRegs.SPIFFTX.bit.TXFFINTCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFIFORESET = 0;
    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFIENA = 1;
    SpibRegs.SPIFFCT.bit.TXDLY = 0;
    SpibRegs.SPICCR.bit.SPISWRESET = 1;
    SpibRegs.SPIFFTX.bit.TXFIFO = 1;
    SpibRegs.SPIFFRX.bit.RXFIFORESET = 1;
    SpibRegs.SPICTL.bit.SPIINTENA = 1;
    SpibRegs.SPIFFRX.bit.RXFFIL = ${o.rxffil ?? 16};
`;

const run = (source: string, durationMs = 2) => {
  const r = runProgram({ kit: "robot", source, durationMs });
  expect(r.compileError, JSON.stringify(r.compileError)).toBeUndefined();
  expect(r.runtimeError, JSON.stringify(r.runtimeError)).toBeUndefined();
  return r;
};
const v = (r: ReturnType<typeof run>, name: string) => r.board.readVar(name);
const words = (r: ReturnType<typeof run>) => spiBus(r.board).log;

describe("SPI plugin (TRM chapter 18)", () => {
  it("resets SPIFFTX to 0xA000 and SPIFFRX to 0x201F (18.5.2.9, 18.5.2.10)", () => {
    const r = run(`uint16_t tx, rx; void main(void) { tx = SpibRegs.SPIFFTX.all; rx = SpibRegs.SPIFFRX.all; while (1) {} }`);
    expect(v(r, "tx")).toBe(0xa000);
    expect(v(r, "rx")).toBe(0x201f);
  });

  it("queues words in the FIFO, receives one word per word sent, and the course's busy-wait works", () => {
    const r = run(`uint16_t a, b2, c, queued, left;
void main(void) {
${setup({ lbk: 1 })}
    SpibRegs.SPITXBUF = 0x1234;
    SpibRegs.SPITXBUF = 0xABCD;
    SpibRegs.SPITXBUF = 0x0F0F;
    queued = SpibRegs.SPIFFTX.bit.TXFFST;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 3);
    a = SpibRegs.SPIRXBUF; b2 = SpibRegs.SPIRXBUF; c = SpibRegs.SPIRXBUF;
    left = SpibRegs.SPIFFRX.bit.RXFFST;
    while (1) {}
}`);
    expect(r.diagnostics).toEqual([]);
    // The first word goes straight to the shift register; two wait in the FIFO.
    expect(v(r, "queued")).toBe(2);
    expect([v(r, "a"), v(r, "b2"), v(r, "c")]).toEqual([0x1234, 0xabcd, 0x0f0f]);
    expect(v(r, "left")).toBe(0);
    expect(r.board.output("SPIB_WORDS")).toBe(3);
  });

  it("baud = LSPCLK / (SPIBRR + 1) for 3..127 and LSPCLK / 4 for 0..2 (18.3.5)", () => {
    for (const [brr, hz] of [[49, 1e6], [127, 50e6 / 128], [3, 12.5e6], [2, 12.5e6], [0, 12.5e6], [4, 10e6]]) {
      const r = run(`void main(void) {
${setup({ lbk: 1, brr })}
    SpibRegs.SPITXBUF = 1; SpibRegs.SPITXBUF = 2;
    while (1) {}
}`, 1);
      const w = words(r);
      expect(w.length).toBe(2);
      // Two 16-bit words back to back: 16 bit times apart.
      expect(w[1].t - w[0].t, `SPIBRR ${brr}`).toBeCloseTo((16 / hz) * 1e9, 3);
    }
  });

  it("waits TXDLY clock cycles between FIFO words (18.3.7)", () => {
    const r = run(`void main(void) {
${setup({ lbk: 1 })}
    SpibRegs.SPIFFCT.bit.TXDLY = 16;
    SpibRegs.SPITXBUF = 1; SpibRegs.SPITXBUF = 2; SpibRegs.SPITXBUF = 3;
    while (1) {}
}`, 1);
    const w = words(r);
    expect(w[1].t - w[0].t).toBeCloseTo(32000, 3);
    expect(w[2].t - w[1].t).toBeCloseTo(32000, 3);
  });

  it("sends left-justified and receives right-justified when SPICHAR < 15 (18.3.4)", () => {
    const r = run(`uint16_t a, b2;
void main(void) {
${setup({ lbk: 1, char: 7 })}
    SpibRegs.SPITXBUF = 0xA500;          // left-justified: 0xA5 goes out
    SpibRegs.SPITXBUF = 0x00A5;          // right-justified by mistake: 0x00 goes out
    while (SpibRegs.SPIFFRX.bit.RXFFST != 2);
    a = SpibRegs.SPIRXBUF; b2 = SpibRegs.SPIRXBUF;
    while (1) {}
}`);
    const w = words(r);
    expect(w.map((x) => [x.bits, x.out])).toEqual([[8, 0xa5], [8, 0x00]]);
    expect(v(r, "a")).toBe(0x00a5);
    // Example 18-1: what was left in SPIDAT stays above the received bits.
    expect(v(r, "b2")).toBe(0xa500);
  });

  it("raises SPIB_RX (INT6.3) when RXFFST >= RXFFIL, and again while the level still holds", () => {
    const r = run(`__interrupt void SPIB_isr(void);
uint16_t got[4]; uint16_t n = 0; uint16_t calls = 0;
void main(void) {
    DINT; InitPieCtrl(); IER = 0; IFR = 0; InitPieVectTable();
    EALLOW; PieVectTable.SPIB_RX_INT = &SPIB_isr; EDIS;
${setup({ lbk: 1, rxffil: 2 })}
    PieCtrlRegs.PIEIER6.bit.INTx3 = 1;
    IER |= M_INT6;
    EINT;
    SpibRegs.SPITXBUF = 0x4A3B;
    SpibRegs.SPITXBUF = 0xB517;
    while (calls == 0);
    SpibRegs.SPITXBUF = 0x0001;          // one word: below the level, no interrupt
    while (1) {}
}
__interrupt void SPIB_isr(void) {
    calls++;
    got[n++] = SpibRegs.SPIRXBUF;
    got[n++] = SpibRegs.SPIRXBUF;
    SpibRegs.SPIFFRX.bit.RXFFOVFCLR = 1;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}`);
    expect(r.diagnostics).toEqual([]);
    expect(v(r, "calls")).toBe(1);
    expect(r.isrLog.map((x) => x.vector)).toEqual(["SPIB_RX_INT"]);
    expect(r.board.dev.get("SpibRegs.SPIFFRX", "RXFFST")).toBe(1);
    expect(r.board.dev.get("SpibRegs.SPIFFRX", "RXFFINT")).toBe(0);
    // The interrupt came after the second word: 32 us at 1 MHz.
    expect(r.isrLog[0].t - words(r)[0].t).toBeLessThan(18000);
    expect(r.isrLog[0].t).toBeGreaterThanOrEqual(words(r)[1].t);

    // Not draining the FIFO: the flag sets again as soon as it is cleared.
    const again = runProgram({ kit: "robot", durationMs: 1, source: `__interrupt void SPIB_isr(void);
uint16_t calls = 0;
void main(void) {
    DINT; InitPieCtrl(); IER = 0; IFR = 0; InitPieVectTable();
    EALLOW; PieVectTable.SPIB_RX_INT = &SPIB_isr; EDIS;
${setup({ lbk: 1, rxffil: 1 })}
    PieCtrlRegs.PIEIER6.bit.INTx3 = 1;
    IER |= M_INT6;
    EINT;
    SpibRegs.SPITXBUF = 0x4A3B;
    while (1) {}
}
__interrupt void SPIB_isr(void) {
    calls++;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}` });
    expect(codes(again)).toContain("spi-rx-not-drained-b");
    expect(again.runtimeError?.msg).toMatch(/fires again at once/);
    expect(again.board.readVar("calls")).toBeGreaterThan(5);
  });

  it("draws the four clocking schemes of Table 18-3 / Figure 18-7 on the pins at low bit rates", () => {
    const byte = 0xa6;
    for (const m of [{ polarity: 0, phase: 0 }, { polarity: 0, phase: 1 }, { polarity: 1, phase: 0 }, { polarity: 1, phase: 1 }] as SpiMode[]) {
      const r = run(`void main(void) {
${setup({ brr: 127, char: 7, pol: m.polarity, phase: m.phase })}
    DELAY_US(100);
    SpibRegs.SPITXBUF = 0x${byte.toString(16)}00;
    while (1) {}
}`, 1);
      // No chip select is low: the word goes out to nobody, and the model says so.
      expect(codes(r)).toEqual(["spi-no-cs-b"]);
      const g = r.board.gpio;
      const s = clockScheme(m);
      const clk = (g.trace.get(65) ?? []).filter((x) => x.t > 50000);
      // Rests at the polarity level before the first edge and after the last.
      expect(g.levelAt(65, 99000), s.name).toBe(m.polarity);
      expect(g.level[65], s.name).toBe(m.polarity);
      expect(clk.length, s.name).toBe(16);
      expect(clk[0].level).toBe(1 - m.polarity);
      // Read SIMO on the latching edges: that must give the byte back.
      const latch = clk.filter((x) => (x.level === 1) === (s.latches === "rising"));
      expect(latch.length).toBe(8);
      // "With delay": the first edge after idle is a latching edge.
      expect(latch[0] === clk[0], s.name).toBe(s.latchOnFirstEdge);
      const read = latch.reduce((acc, x) => (acc << 1) | g.levelAt(63, x.t + 1), 0);
      expect(read, s.name).toBe(byte);
      // SIMO never changes on a latching edge.
      const simo = (g.trace.get(63) ?? []).filter((x) => x.t > 50000);
      for (const x of simo) expect(latch.some((l) => Math.abs(l.t - x.t) < 10), s.name).toBe(false);
      // Bit time: 128 / 50 MHz = 2.56 us between latching edges.
      expect(latch[1].t - latch[0].t).toBeCloseTo(2560, 3);
    }
    expect(clockScheme({ polarity: 0, phase: 1 })).toMatchObject({ name: "rising edge with delay", idle: 0, changes: "falling", latches: "rising" });
    expect(clockScheme({ polarity: 0, phase: 0 })).toMatchObject({ name: "rising edge without delay", changes: "rising", latches: "falling" });
    expect(clockScheme({ polarity: 1, phase: 0 })).toMatchObject({ name: "falling edge without delay", idle: 1, changes: "falling", latches: "rising" });
    expect(clockScheme({ polarity: 1, phase: 1 })).toMatchObject({ name: "falling edge with delay", changes: "rising", latches: "falling" });
  });

  it("draws no per-bit waveform at the course's 1 MHz", () => {
    const r = run(`void main(void) {
${setup({ lbk: 1 })}
    SpibRegs.SPITXBUF = 0xA5A5;
    while (1) {}
}`, 1);
    expect((r.board.gpio.trace.get(65) ?? []).length).toBeLessThanOrEqual(2);
  });

  it("reads 0xFFFF with no device selected, and reports missing pin muxes", () => {
    const r = run(`uint16_t a;
void main(void) {
${setup()}
    SpibRegs.SPITXBUF = 0x1234;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    a = SpibRegs.SPIRXBUF;
    while (1) {}
}`);
    expect(v(r, "a")).toBe(0xffff);
    expect(codes(r)).toEqual(["spi-no-cs-b"]);
    expect(r.diagnostics[0].msg).toContain("GPIO66");
    const nomux = run(`void main(void) {
${setup().replace(/GPIO_SetupPinMux\(6[345], GPIO_MUX_CPU1, 15\);/g, "")}
    SpibRegs.SPITXBUF = 0x1234;
    while (1) {}
}`);
    expect(codes(nomux)).toContain("spi-mux-b");
  });

  it("reports the mistakes the hardware hides", () => {
    const body = (extra: string, after = "") => `uint16_t a;
void main(void) {
${setup({ lbk: 1 })}
${extra}
    SpibRegs.SPITXBUF = 0x1234;
${after}
    while (1) {}
}`;
    expect(codes(run(body("SpibRegs.SPICCR.bit.SPISWRESET = 0;")))).toContain("spi-in-reset-b");
    expect(codes(run(body("SpibRegs.SPICCR.bit.SPISWRESET = 0; SpibRegs.SPICTL.bit.MASTER_SLAVE = 0; SpibRegs.SPICCR.bit.SPISWRESET = 1;")))).toContain("spi-slave-b");
    expect(codes(run(body("SpibRegs.SPIFFTX.bit.TXFIFO = 0;")))).toContain("spi-txfifo-reset-b");
    expect(codes(run(body("SpibRegs.SPICCR.bit.CLKPOLARITY = 1;")))).toContain("spi-config-live-b");
    expect(codes(run(body("", "a = SpibRegs.SPIRXBUF;")))).toContain("spi-rx-empty-b");
    expect(codes(run(body("int i; for (i = 0; i < 20; i++) SpibRegs.SPITXBUF = i;")))).toContain("spi-tx-overflow-b");
    const ovf = run(body("int i; for (i = 0; i < 17; i++) { SpibRegs.SPITXBUF = i; DELAY_US(20); }"));
    expect(codes(ovf)).toContain("spi-rx-overflow-b");
    expect(ovf.board.dev.get("SpibRegs.SPIFFRX", "RXFFOVF")).toBe(1);
    expect(ovf.board.dev.get("SpibRegs.SPIFFRX", "RXFFST")).toBe(16);
  });

  it("works without the FIFO: INT_FLAG, SPIRXBUF and the overrun flag (18.3.2, 18.5.2.3)", () => {
    const r = run(`uint16_t a, flagBefore, flagAfter, ovr;
void main(void) {
    SpibRegs.SPICCR.bit.SPISWRESET = 0;
    SpibRegs.SPICTL.bit.CLK_PHASE = 1;
    SpibRegs.SPICTL.bit.MASTER_SLAVE = 1;
    SpibRegs.SPICCR.bit.SPICHAR = 0xF;
    SpibRegs.SPICCR.bit.SPILBK = 1;
    SpibRegs.SPICTL.bit.TALK = 1;
    SpibRegs.SPIBRR.bit.SPI_BIT_RATE = 49;
    SpibRegs.SPICCR.bit.SPISWRESET = 1;
    SpibRegs.SPITXBUF = 0xBEEF;
    while (SpibRegs.SPISTS.bit.INT_FLAG == 0);
    flagBefore = SpibRegs.SPISTS.bit.INT_FLAG;
    a = SpibRegs.SPIRXBUF;
    flagAfter = SpibRegs.SPISTS.bit.INT_FLAG;
    SpibRegs.SPITXBUF = 1; DELAY_US(20);
    SpibRegs.SPITXBUF = 2; DELAY_US(20);
    ovr = SpibRegs.SPISTS.bit.OVERRUN_FLAG;
    SpibRegs.SPISTS.bit.OVERRUN_FLAG = 1;
    while (1) {}
}`);
    expect(r.diagnostics).toEqual([]);
    expect([v(r, "a"), v(r, "flagBefore"), v(r, "flagAfter"), v(r, "ovr")]).toEqual([0xbeef, 1, 0, 1]);
    expect(r.board.dev.get("SpibRegs.SPISTS", "OVERRUN_FLAG")).toBe(0);
  });

  it("exchanges words with a registered device only while its chip select is low, and checks its clock mode", () => {
    const program = (pol: number, phase: number) => `uint16_t a, b2, c;
void main(void) {
${setup({ pol, phase })}
    GpioDataRegs.GPCCLEAR.bit.GPIO67 = 1;
    SpibRegs.SPITXBUF = 0x1111;
    SpibRegs.SPITXBUF = 0x2222;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 2);
    GpioDataRegs.GPCSET.bit.GPIO67 = 1;
    a = SpibRegs.SPIRXBUF; b2 = SpibRegs.SPIRXBUF;
    SpibRegs.SPITXBUF = 0x3333;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    c = SpibRegs.SPIRXBUF;
    while (1) {}
}`.replace("EALLOW;", "GPIO_SetupPinMux(67, GPIO_MUX_CPU1, 0); GPIO_SetupPinOptions(67, GPIO_OUTPUT, GPIO_PUSHPULL); GpioDataRegs.GPCSET.bit.GPIO67 = 1; EALLOW;");
    const go = (pol: number, phase: number) => {
      const b = new Board();
      const seen: number[] = [];
      const events: string[] = [];
      registerSpiDevice(b, {
        name: "test device", csPin: 67, mode: { polarity: 0, phase: 1 },
        transfer: (w) => (seen.push(w), ~w & 0xffff),
        select: () => events.push("select"),
        deselect: () => events.push("deselect"),
      });
      b.load(program(pol, phase));
      b.runUntil(b.run(), 2e6);
      return { b, seen, events, diag: [...b.diagnostics.values()] };
    };
    const ok = go(0, 1);
    // The third word is sent with the chip select high again.
    expect(ok.diag.map((d) => d.code)).toEqual(["spi-no-cs-b"]);
    expect(ok.seen).toEqual([0x1111, 0x2222]);
    expect([ok.b.readVar("a"), ok.b.readVar("b2"), ok.b.readVar("c")]).toEqual([0xeeee, 0xdddd, 0xffff]);
    expect(ok.events.slice(-2)).toEqual(["select", "deselect"]);
    const bad = go(0, 0);
    expect([...new Set(bad.diag.map((d) => d.code))]).toEqual(["spi-mode-b", "spi-no-cs-b"]);
    expect(bad.diag[0].severity).toBe("error");
    expect(bad.seen).toEqual([0x1111 >> 1, (0x2222 >> 1) | 0x8000]);
    expect(bad.b.readVar("a")).not.toBe(0xeeee);
  });

  it("reports a chip select raised before the word has finished", () => {
    const r = run(`void main(void) {
${setup()}
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0xF500;
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    while (1) {}
}`);
    expect(codes(r)).toContain("spi-cs-early-b");
  });
});
