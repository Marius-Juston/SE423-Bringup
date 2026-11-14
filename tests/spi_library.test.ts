import { describe, expect, it } from "vitest";
import { ch05 } from "../src/levels/chapters/ch05_interrupts";
import { ch12 } from "../src/levels/chapters/ch12_spi";
import { ch13 } from "../src/levels/chapters/ch13_spi_devices";
import { runProgram, type RunResult } from "../src/sim/runner";
import { codes } from "./helpers";

// The SPIB set-up is graded work in HW3 (exercise 3), so the game provides it
// as the library function setupSpib() and never prints it. These tests pin
// down what the library leaves in the registers, that a program may still
// define its own setupSpib(), and that no level of the SPI chapters shows the
// two values HW3 leaves blank.

// The block the levels used to print: the course's set-up, written out.
const WRITTEN_OUT = `
    GPIO_SetupPinMux(66, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(66, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
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
    SpibRegs.SPICTL.bit.CLK_PHASE = 1;
    SpibRegs.SPICCR.bit.CLKPOLARITY = 0;
    SpibRegs.SPICTL.bit.MASTER_SLAVE = 1;
    SpibRegs.SPICCR.bit.SPICHAR = 0xF;
    SpibRegs.SPICTL.bit.TALK = 1;
    SpibRegs.SPIPRI.bit.FREE = 1;
    SpibRegs.SPICTL.bit.SPIINTENA = 0;
    SpibRegs.SPIBRR.bit.SPI_BIT_RATE = 49;
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
    SpibRegs.SPIFFRX.bit.RXFFIL = 16;
`;

const run = (source: string, durationMs = 2, stimuli?: { at: number; set: string; value: number }[]) => runProgram({ kit: "robot", source, durationMs, stimuli });
const program = (setup: string, rest = "") => `uint16_t who = 0;\nvoid main(void)\n{\n    InitSysCtrl();\n    InitGpio();\n${setup}\n${rest}\n    while (1) {\n    }\n}\n`;
/** Every register of the chip that is not zero at the end of a run. */
const registers = (r: RunResult): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const name of r.board.dev.regs.keys()) {
    const v = r.board.dev.get(name);
    if (v) out[name] = v;
  }
  return out;
};
const ok = (r: RunResult) => {
  expect(r.compileError).toBeUndefined();
  expect(r.runtimeError).toBeUndefined();
  return r;
};

describe("setupSpib(), the course library's SPIB set-up", () => {
  it("leaves every register as the written-out course block does", () => {
    const lib = ok(run(program("    setupSpib();")));
    const own = ok(run(program(WRITTEN_OUT)));
    expect(lib.diagnostics).toEqual([]);
    expect(registers(lib)).toEqual(registers(own));
    expect(lib.board.dev.get("SpibRegs.SPIBRR", "SPI_BIT_RATE")).toBe(49);
    expect(lib.board.gpio.level[66]).toBe(1);
  });

  it("lets the MPU-9250 answer its identity", () => {
    const r = ok(run(program("    setupSpib();", `    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0xF500;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    who = SpibRegs.SPIRXBUF;`)));
    expect(r.diagnostics).toEqual([]);
    expect(r.board.readVar("who")).toBe(0x71);
  });

  it("is replaced by a program's own setupSpib(), as saved student code has it", () => {
    for (const proto of ["void setupSpib(void);\n", ""]) {
      const r = ok(run(`${proto}uint16_t mine = 0;
void setupSpib(void)
{
    mine = 7;
}
void main(void)
{
    InitSysCtrl();
    setupSpib();
    while (1) {
    }
}
`));
      expect(r.board.readVar("mine")).toBe(7);
      // The library's version did not run.
      expect(r.board.dev.get("SpibRegs.SPICCR", "SPISWRESET")).toBe(0);
    }
  });

  it("enableSpibInterrupt() lets the receive interrupt reach the program", () => {
    const r = ok(run(`__interrupt void SPIB_isr(void);
uint16_t got = 0;
uint16_t count = 0;
void main(void)
{
    InitSysCtrl();
    InitGpio();
    setupSpib();
    SpibRegs.SPICCR.bit.SPISWRESET = 0;
    SpibRegs.SPICCR.bit.SPILBK = 1;
    SpibRegs.SPICCR.bit.SPISWRESET = 1;
    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();
    EALLOW;
    PieVectTable.SPIB_RX_INT = &SPIB_isr;
    EDIS;
    enableSpibInterrupt();
    EINT;
    SpibRegs.SPIFFRX.bit.RXFFIL = 1;
    SpibRegs.SPITXBUF = 0x1234;
    while (1) {
    }
}
__interrupt void SPIB_isr(void)
{
    got = SpibRegs.SPIRXBUF;
    count++;
    SpibRegs.SPIFFRX.bit.RXFFINTCLR = 1;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP6;
}
`));
    expect(r.diagnostics).toEqual([]);
    expect(r.board.readVar("got")).toBe(0x1234);
    expect(r.board.readVar("count")).toBe(1);
  });

  it("a missing SPIB pin mux is reported without printing the mux position", () => {
    const r = run(program(WRITTEN_OUT.replace(/    GPIO_SetupPinMux\(6[345], GPIO_MUX_CPU1, 15\);\n/g, ""), `    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0xF500;`));
    const d = r.diagnostics.find((x) => x.code === "spi-mux-b");
    expect(d).toBeDefined();
    expect(d!.msg).toContain("setupSpib()");
    expect(d!.msg).not.toMatch(/15/);
  });
});

describe("the jumper wire on SPIC", () => {
  const spic = (talk = 1, somi = true) => program(`    GPIO_SetupPinMux(122, GPIO_MUX_CPU1, 6);
${somi ? "    GPIO_SetupPinMux(123, GPIO_MUX_CPU1, 6);" : ""}
    GPIO_SetupPinMux(124, GPIO_MUX_CPU1, 6);
    SpicRegs.SPICCR.bit.SPISWRESET = 0;
    SpicRegs.SPICTL.bit.CLK_PHASE = 1;
    SpicRegs.SPICTL.bit.MASTER_SLAVE = 1;
    SpicRegs.SPICCR.bit.SPICHAR = 0xF;
    SpicRegs.SPICTL.bit.TALK = ${talk};
    SpicRegs.SPIBRR.bit.SPI_BIT_RATE = 99;
    SpicRegs.SPIFFTX.bit.SPIRST = 1;
    SpicRegs.SPIFFTX.bit.SPIFFENA = 1;
    SpicRegs.SPICCR.bit.SPISWRESET = 1;
    SpicRegs.SPIFFTX.bit.TXFIFO = 1;
    SpicRegs.SPIFFRX.bit.RXFIFORESET = 1;`, `    SpicRegs.SPITXBUF = 0x4B3C;
    while (SpicRegs.SPIFFRX.bit.RXFFST != 1);
    who = SpicRegs.SPIRXBUF;`);

  it("brings a word back through the pins while it is fitted", () => {
    const r = ok(run(spic(), 2, [{ at: 0, set: "SPIC_JUMPER", value: 1 }]));
    expect(r.diagnostics).toEqual([]);
    expect(r.board.readVar("who")).toBe(0x4b3c);
  });
  it("without it the pull-up gives all 1s", () => {
    expect(ok(run(spic(), 2, [{ at: 0, set: "SPIC_JUMPER", value: 0 }])).board.readVar("who")).toBe(0xffff);
  });
  it("needs TALK and the SOMI pin", () => {
    const quiet = ok(run(spic(0), 2, [{ at: 0, set: "SPIC_JUMPER", value: 1 }]));
    expect(quiet.board.readVar("who")).toBe(0xffff);
    expect(codes(quiet)).toContain("spi-talk-c");
    const nopin = run(spic(1, false), 2, [{ at: 0, set: "SPIC_JUMPER", value: 1 }]);
    expect(codes(nopin)).toContain("spi-mux-c");
  });
});

describe("what HW3 leaves blank is not printed", () => {
  // HW3 exercise 3: the mux position of GPIO63, 64 and 65, and the PIE channel of SPIB_RX.
  const text = (level: object) => JSON.stringify(level);
  it("no level of the SPI chapters shows the SPIB mux position or its PIE channel", () => {
    for (const level of [...ch12.levels, ...ch13.levels]) {
      const t = text(level);
      expect(t, level.id).not.toMatch(/GPIO_SetupPinMux\(6[345], GPIO_MUX_CPU1, (?!0\))/);
      expect(t, level.id).not.toMatch(/INT6\.3|PIEIER6\.bit\.INTx3|PIEIER6\.INTx3/);
      expect(t, level.id).not.toMatch(/GPIO6[345][^.]{0,60}mux position 15|[Mm]ux position 15/);
      expect(t, level.id).not.toMatch(/SpibRegs\.SPIBRR\.bit\.SPI_BIT_RATE = 49/);
    }
  });
  it("the PIE table of the interrupts chapter does not list SPIB's channel", () => {
    for (const level of ch05.levels) expect(text(level), level.id).not.toMatch(/3 SPIB_RX/);
  });
});
