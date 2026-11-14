import { describe, expect, it } from "vitest";
import { LiveSession } from "../src/sim/live";
import { runProgram } from "../src/sim/runner";

const BLINK = `void main(void) {
    InitSysCtrl();
    InitGpio();
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
    while (1) {
        GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;
        DELAY_US(500000);
    }
}`;

describe("DELAY_US and run slices", () => {
  it("a live run passes as much simulated time as it was given, also inside a long delay", () => {
    const s = new LiveSession("robot", BLINK);
    // A step may do less than asked on a busy machine (it has a time budget), never more.
    let most = 0;
    for (let i = 0; i < 5000 && s.timeMs < 1600; i++) {
      const before = s.timeMs;
      s.step(16);
      most = Math.max(most, s.timeMs - before);
    }
    expect(most).toBeLessThan(16.2);
    expect(s.timeMs).toBeGreaterThanOrEqual(1600);
    expect(s.timeMs).toBeLessThan(1617);
    // The pin becoming an output, then toggles at 0, 500, 1000 and 1500 ms: no more.
    expect(s.board.gpio.trace.get(22)!.length).toBe(5);
  });
  it("a test run ends at its duration when a delay straddles the end", () => {
    const r = runProgram({ kit: "robot", source: BLINK.replace("500000", "70000"), durationMs: 150, stimuli: [], checks: [] });
    expect(r.board!.now).toBe(150e6);
    // The pin becoming an output, then toggles at 0, 70 and 140 ms.
    expect(r.board!.gpio.trace.get(22)!.length).toBe(4);
  });
  it("statements after a delay wait for all of it", () => {
    const src = `uint32_t n = 0;
void main(void) {
    InitSysCtrl();
    while (1) {
        DELAY_US(1000);
        n++;
    }
}`;
    const s = new LiveSession("robot", src);
    for (let i = 0; i < 5000 && s.timeMs < 100; i++) s.step(10);
    const n = s.board.readVar("n")!;
    expect(n).toBeGreaterThanOrEqual(98);
    expect(n).toBeLessThanOrEqual(110);
  });
});

describe("long live runs", () => {
  it("keep the serial output and the interrupt log bounded, and the terminal text readable", () => {
    const src = `__interrupt void cpu_timer0_isr(void);
uint32_t n = 0;
void main(void) {
    InitSysCtrl();
    InitGpio();
    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();
    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    EDIS;
    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, 100);
    CpuTimer0Regs.TCR.all = 0x4000;
    init_serialSCIA(&SerialA, 115200);
    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    EINT;
    while (1) {
        serial_printf(&SerialA, "0123456789 0123456789 0123456789\\r\\n");
        DELAY_US(4000);
    }
}
__interrupt void cpu_timer0_isr(void) {
    n++;
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}`;
    const s = new LiveSession("robot", src);
    s.speed = 10;
    for (let i = 0; i < 100000 && s.timeMs < 20000; i++) s.step(50);
    expect(s.error).toBeNull();
    const b = s.board;
    expect(b.isrLog.length).toBeLessThanOrEqual(60_000);
    expect(b.isrLog.length + b.isrDropped).toBeGreaterThan(190_000);
    expect(b.sci.tx[0].length).toBeLessThanOrEqual(60_000);
    const text = b.sci.text(0);
    expect(text.length).toBe(b.sci.tx[0].length);
    expect(text).toContain("0123456789 0123456789");
  }, 120_000);
});

describe("a check timed at the end of the run", () => {
  it("reads the final value", () => {
    const src = `int n = 0;
void main(void) {
    InitSysCtrl();
    n = 3;
    while (1) {}
}`;
    const r = runProgram({ kit: "robot", source: src, durationMs: 20, stimuli: [], checks: [{ kind: "var", name: "n", at: 25, equals: 3, label: "n" }] });
    expect(r.checks[0].detail).toBe("n is 3.");
    expect(r.checks[0].pass).toBe(true);
  });
});

describe("reading an array element by name", () => {
  it("follows the indexes, and refuses one outside the array", () => {
    const src = `uint16_t a[3] = { 7, 8, 9 };
float m[2][2] = { { 1.5, 2.5 }, { 3.5, 4.5 } };
void main(void) { while (1) {} }`;
    const r = runProgram({ kit: "robot", source: src, durationMs: 1, stimuli: [], checks: [] });
    const b = r.board!;
    expect(b.readVar("a[2]")).toBe(9);
    expect(b.readVar("m[1][0]")).toBe(3.5);
    expect(b.readVar("a[3]")).toBeUndefined();
    expect(b.readVar("a")).toBeUndefined();
  });
});

describe("a program without InitSysCtrl()", () => {
  const body = `    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPASET.bit.GPIO22 = 1;
    while (1) {}
}`;
  const codes = (src: string) => runProgram({ kit: "robot", source: src, durationMs: 1, stimuli: [], checks: [] }).diagnostics.map((d) => d.code);
  it("is told once, on the first register it writes", () => {
    expect(codes(`void main(void) {\n${body}`).filter((c) => c === "no-initsysctrl")).toHaveLength(1);
  });
  it("is not told when it calls InitSysCtrl() first", () => {
    expect(codes(`void main(void) {\n    InitSysCtrl();\n${body}`)).not.toContain("no-initsysctrl");
  });
});

describe("an interrupt function slower than its period", () => {
  const src = (us: number) => `__interrupt void cpu_timer0_isr(void);
uint32_t n = 0;
void main(void) {
    InitSysCtrl();
    InitGpio();
    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();
    EALLOW;
    PieVectTable.TIMER0_INT = &cpu_timer0_isr;
    EDIS;
    InitCpuTimers();
    ConfigCpuTimer(&CpuTimer0, 200, 1000);
    CpuTimer0Regs.TCR.all = 0x4000;
    IER |= M_INT1;
    PieCtrlRegs.PIEIER1.bit.INTx7 = 1;
    EINT;
    while (1) {}
}
__interrupt void cpu_timer0_isr(void) {
    n++;
    DELAY_US(${us});
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;
}`;
  it("ends at the end of the test and is told that main() is starved", () => {
    for (const us of [3000, 20000]) {
      const r = runProgram({ kit: "robot", source: src(us), durationMs: 100, stimuli: [], checks: [] });
      expect(r.board!.now / 1e6).toBeLessThan(100 + us / 1000 + 1);
      expect(r.diagnostics.map((d) => d.code)).toContain("isr-starves-main-TIMER0_INT");
    }
  });
  it("is not reported for a function that fits in its period", () => {
    const r = runProgram({ kit: "robot", source: src(500), durationMs: 100, stimuli: [], checks: [] });
    expect(r.diagnostics.map((d) => d.code)).toEqual([]);
    expect(r.board!.readVar("n")).toBe(99);
  });
});

describe("UART_printfLine and the robot board's LCD", () => {
  const src = `void main(void) {
    InitSysCtrl();
    UART_printfLine(1, "Count %d", 7);
    UART_printfLine(2, "A line that is longer than twenty characters");
    while (1) {}
}`;
  it("writes the two lines of the robot's LCD, 20 characters each", () => {
    const r = runProgram({ kit: "robot", source: src, durationMs: 1, stimuli: [], checks: [] });
    expect(r.diagnostics).toEqual([]);
    expect(r.board!.lcd).toEqual(["Count 7", "A line that is longe"]);
  });
  it("says that a board without an LCD shows nothing", () => {
    for (const kit of ["redboard", "launchpad"]) {
      const r = runProgram({ kit, source: src, durationMs: 1, stimuli: [], checks: [] });
      // One message per line that calls it.
      expect(r.diagnostics.map((d) => d.code)).toEqual(["lcd-no-screen", "lcd-no-screen"]);
      expect(r.board!.lcd).toEqual(["", ""]);
    }
  });
});
