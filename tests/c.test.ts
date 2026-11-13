import { describe, expect, it } from "vitest";
import { codes, compileError, main, out, run } from "./helpers";

describe("C on a 16-bit-int machine", () => {
  it("has C2000 type sizes (in 16-bit words)", () => {
    expect(out(main(`printf("%d %d %d %d %d", (int)sizeof(char), (int)sizeof(int), (int)sizeof(long), (int)sizeof(float), (int)sizeof(int *));`))).toBe("1 1 2 2 2");
  });
  it("wraps 16-bit arithmetic and warns", () => {
    const r = run(main(`int a = 200; int b = 1000; long c = a * b; printf("%ld", c);`));
    expect(r.console).toBe("3392");
    expect(codes(r)).toContain("int16-overflow");
  });
  it("computes in 32 bits when an operand is long", () => {
    expect(out(main(`int a = 200; long c = a * 1000L; printf("%ld", c);`))).toBe("200000");
  });
  it("types literals by the first type that fits", () => {
    expect(out(main(`printf("%d %d %d", (int)sizeof(32767), (int)sizeof(32768), (int)sizeof(0xFFFF));`))).toBe("1 2 1");
  });
  it("does integer division", () => {
    expect(out(main(`float x = 1/5000; float y = 1.0/5000; printf("%.4f %.4f %d %d", x, y, 7/2, -7/2);`))).toBe("0.0000 0.0002 3 -3");
  });
  it("truncates float to int", () => {
    expect(out(main(`float f = 345.67; Uint16 c = f; int n = -2.9; printf("%u %d", c, n);`))).toBe("345 -2");
  });
  it("handles two's complement and unsigned compare", () => {
    expect(out(main(`int16_t a = -1; uint16_t b = a; printf("%u %x %d", b, b, a < 1u);`))).toBe("65535 ffff 0");
  });
  it("does bitwise work", () => {
    expect(out(main(`uint16_t v = 0x00A5; v |= (1 << 9); v &= ~0x0004; v ^= 0x1; printf("%X %d %d", v, (v >> 5) & 1, 0xC492 >> 8);`))).toBe("2A0 1 196");
  });
  it("warns about 1 << 16 in a 16-bit int", () => {
    const r = run(main(`int n = 20; uint32_t m = 1 << n; uint32_t ok = 1UL << n; printf("%lu %lu", m, ok);`));
    expect(r.console).toBe("0 1048576");
    expect(codes(r)).toContain("shift-16");
  });
  it("accepts 1U << 15 and flags shifts by the full width", () => {
    const ok = run(main(`uint16_t p = 15; uint16_t v = 1U << p; printf("%x", v);`));
    expect(ok.console).toBe("8000");
    expect(codes(ok)).toEqual([]);
    const bad = run(main(`uint16_t p = 32; uint32_t m = (1UL << p) - 1; printf("%lx", m);`));
    expect(codes(bad)).toContain("shift-width");
  });
  it("prints 32-bit values wrongly with %d, as the board does", () => {
    const r = run(main(`int32_t big = 70000; printf("%d|%ld", big, big);`));
    expect(r.console.endsWith("|70000")).toBe(false);
    expect(codes(r)).toContain("printf-type");
    expect(out(main(`int32_t big = 70000; printf("%ld", big);`))).toBe("70000");
  });
  it("formats floats, widths, chars and strings", () => {
    expect(out(main(`char s[] = "hi"; printf("[%5.2f] [%-4d] [%04d] [%c] [%s] [%e] 100%%", 3.14159, 7, 42, 'A', s, 1234.5);`))).toBe("[ 3.14] [7   ] [0042] [A] [hi] [1.234500e+03] 100%");
  });
  it("runs loops, switch, functions, recursion, pointers, arrays, structs", () => {
    const src = `
typedef struct { float x; int n; } pt_t;
int fact(int n) { return n <= 1 ? 1 : n * fact(n - 1); }
void bump(int *p) { *p += 5; }
float avg(float *a, int n) { float s = 0; int i; for (i = 0; i < n; i++) s += a[i]; return s / n; }
enum { RED, GREEN = 5, BLUE };
void main(void) {
  int i, sum = 0, k = 0;
  float v[4] = {1, 2, 3, 6};
  pt_t p = {1.5, 2};
  pt_t *q = &p;
  int grid[2][3] = {{1,2,3},{4,5,6}};
  for (i = 0; i < 10; i++) { if (i == 3) continue; if (i == 8) break; sum += i; }
  do { k++; } while (k < 4);
  switch (k) { case 1: sum = -1; break; case 4: sum += 100; default: sum += 1000; }
  bump(&sum);
  q->n += fact(5);
  printf("%d %d %.1f %d %.2f %d %d", sum, k, avg(v, 4), q->n, p.x, grid[1][2], BLUE);
}`;
    expect(out(src)).toBe("1130 4 3.0 122 1.50 6 6");
  });
  it("supports #define, function-like macros and static locals", () => {
    const src = `
#define N 3
#define SQ(x) ((x)*(x))
#define LIMIT (N + 1)
int counter(void) { static int c = 0; c++; return c; }
void main(void) { counter(); counter(); printf("%d %d %d", SQ(N + 1), LIMIT, counter()); }`;
    expect(out(src)).toBe("16 4 3");
  });
  it("uses math functions and saturates like the HW1 helper", () => {
    const src = `
float saturate(float in, float lim) { if (in > lim) return lim; if (in < -lim) return -lim; return in; }
void main(void) { printf("%.3f %.1f %.1f", sin(3.14159265/2), saturate(12.5, 10), saturate(-99, 10)); }`;
    expect(out(src)).toBe("1.000 10.0 -10.0");
  });
});

describe("helpful compile errors", () => {
  it("suggests register names", () => {
    expect(compileError(main(`GpioDataRegs.GPASET.bit.GPIO34 = 1;`))).toMatch(/port B \(GPIO32 to GPIO63\).*GPBSET/);
    expect(compileError(main(`EPwm1Regs.TBCTL.bit.CLKDV = 1;`))).toMatch(/Did you mean 'CLKDIV'/);
    expect(compileError(main(`GpioDataReg.GPASET.bit.GPIO31 = 1;`))).toMatch(/Did you mean 'GpioDataRegs'/);
  });
  it("explains .bit and .all", () => {
    expect(compileError(main(`GpioDataRegs.GPASET.GPIO31 = 1;`))).toMatch(/\.bit\.GPIO31/);
    expect(compileError(main(`GpioDataRegs.GPASET = 1;`))).toMatch(/\.all/);
  });
  it("reports a missing semicolon on the right line", () => {
    expect(compileError(`void main(void) {\n  int a = 1\n  a = 2;\n}`)).toMatch(/^2: Missing ;/);
  });
  it("catches quote mix-ups and undeclared names", () => {
    expect(compileError(main(`char c = 'ab';`))).toMatch(/single character/);
    expect(compileError(main(`countr = 1;`, "int counter;"))).toMatch(/Did you mean 'counter'/);
  });
});

describe("registers", () => {
  it("ignores protected writes outside EALLOW and says so", () => {
    const r = run(main(`GpioCtrlRegs.GPADIR.bit.GPIO31 = 1;`));
    expect(codes(r)).toContain("eallow");
    expect(r.board.dev.get("GpioCtrlRegs.GPADIR", "GPIO31")).toBe(0);
    const ok = run(main(`EALLOW; GpioCtrlRegs.GPADIR.bit.GPIO31 = 1; EDIS;`));
    expect(codes(ok)).toEqual([]);
    expect(ok.board.dev.get("GpioCtrlRegs.GPADIR", "GPIO31")).toBe(1);
  });
  it("puts registers at their real addresses", () => {
    expect(out(main(`printf("%lx %lx %lx", (uint32_t)&GpioDataRegs.GPASET, (uint32_t)&CpuTimer0Regs.TCR, (uint32_t)&PieVectTable.TIMER0_INT);`))).toBe("7f02 c04 d4c");
  });
  it("drives pins through SET, CLEAR and TOGGLE; .all and .bit agree", () => {
    const src = main(`
  GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0); GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
  GpioDataRegs.GPASET.all = 0x00400000; DELAY_US(1);
  printf("%d", (int)GpioDataRegs.GPADAT.bit.GPIO22);
  GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1; DELAY_US(1);
  printf("%d", (int)GpioDataRegs.GPADAT.bit.GPIO22);
  GpioDataRegs.GPASET.bit.GPIO22 = 1; GpioDataRegs.GPACLEAR.bit.GPIO22 = 1; DELAY_US(1);
  printf("%d", (int)GpioDataRegs.GPADAT.bit.GPIO22);`);
    expect(out(src)).toBe("100");
  });
  it("loses a change when GPxDAT bits are written back to back (TRM 8.3)", () => {
    const setup = `GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0); GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
  GPIO_SetupPinMux(25, GPIO_MUX_CPU1, 0); GPIO_SetupPinOptions(25, GPIO_OUTPUT, GPIO_PUSHPULL);
  GpioDataRegs.GPACLEAR.all = 0x02400000; n = 0; n = 1;`;
    const bad = run(main(`${setup}
  GpioDataRegs.GPADAT.bit.GPIO22 = 1;
  GpioDataRegs.GPADAT.bit.GPIO25 = 1;`, "int n;"));
    expect(codes(bad)).toContain("dat-rmw");
    expect(bad.board.gpio.level[22]).toBe(0);
    expect(bad.board.gpio.level[25]).toBe(1);
    const good = run(main(`${setup}
  GpioDataRegs.GPASET.bit.GPIO22 = 1;
  GpioDataRegs.GPASET.bit.GPIO25 = 1;`, "int n;"));
    expect(codes(good)).toEqual([]);
    expect(good.board.gpio.level[22]).toBe(1);
    expect(good.board.gpio.level[25]).toBe(1);
  });
  it("reads a button: 1 with the pull-up, 0 when pressed", () => {
    const src = main(`
  GPIO_SetupPinMux(157, GPIO_MUX_CPU1, 0); GPIO_SetupPinOptions(157, GPIO_INPUT, GPIO_PULLUP);
  while (1) { if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) pressed = 1; }`, "int pressed = 0;");
    const r = runProgramWithPress(src);
    expect(r.board.readVar("pressed")).toBe(1);
  });
  it("warns when a field value is too wide", () => {
    const r = run(main(`EPwm1Regs.TBCTL.bit.CTRMODE = 5;`));
    expect(codes(r)).toContain("field-overflow");
  });
});

describe("interrupts", () => {
  const prog = (extra: string, isrTail = "PieCtrlRegs.PIEACK.all = PIEACK_GROUP1;") => `
uint32_t n = 0;
__interrupt void t0(void) { n++; ${isrTail} }
void main(void) {
  InitPieCtrl(); IER = 0; IFR = 0; InitPieVectTable();
  EALLOW; PieVectTable.TIMER0_INT = &t0; EDIS;
  InitCpuTimers();
  ConfigCpuTimer(&CpuTimer0, 200, 1000);
  CpuTimer0Regs.TCR.all = 0x4000;
  ${extra}
  while (1) {}
}`;
  const all = "IER |= M_INT1; PieCtrlRegs.PIEIER1.bit.INTx7 = 1; EINT;";
  it("fires a 1 ms timer 10 times in 10 ms", () => {
    expect(run(prog(all), 10.5).board.readVar("n")).toBe(10);
  });
  it("fires once when the ISR forgets PIEACK", () => {
    expect(run(prog(all, ""), 10.5).board.readVar("n")).toBe(1);
  });
  it("never fires without IER, PIEIER or EINT", () => {
    expect(run(prog("PieCtrlRegs.PIEIER1.bit.INTx7 = 1; EINT;"), 10.5).board.readVar("n")).toBe(0);
    expect(run(prog("IER |= M_INT1; EINT;"), 10.5).board.readVar("n")).toBe(0);
    expect(run(prog("IER |= M_INT1; PieCtrlRegs.PIEIER1.bit.INTx7 = 1;"), 10.5).board.readVar("n")).toBe(0);
  });
  it("stops with a clear message when the vector was never set", () => {
    const r = run(prog(all).replace("PieVectTable.TIMER0_INT = &t0;", ""), 10.5);
    expect(r.runtimeError?.msg).toMatch(/PieVectTable\.TIMER0_INT/);
  });
  it("maps PIE channels to the vectors the TI header names", () => {
    const board = run("void main(void) {}").board;
    const pie = board.pie;
    // 32 legacy vectors + 12 groups x 16 channels, two words each, from 0x0D00.
    const table = board.dev.instances.find((i) => i.name === "PieVectTable")!;
    expect(table.type.fields.length).toBe(224);
    expect(table.type.size).toBe(448);
    expect(board.dev.reg("PieVectTable.EMIF_ERROR_INT").addr).toBe(0x0d00 + 2 * (128 + 11 * 8));
    expect(pie.vectorName(1, 7)).toBe("TIMER0_INT");
    expect(pie.vectorName(9, 1)).toBe("SCIA_RX_INT");
    expect(pie.vectorName(12, 9)).toBe("EMIF_ERROR_INT");
    expect(pie.vectorName(1, 1)).toBe("ADCA1_INT");
    expect(pie.vectorName(6, 3)).toBe("SPIB_RX_INT");
  });
  it("runs a software interrupt posted through PIEIFR12 (course SWI)", () => {
    const r = run(`
uint32_t n = 0;
__interrupt void swi(void) { n++; PieCtrlRegs.PIEACK.all = PIEACK_GROUP12; }
void main(void) {
  InitPieCtrl(); IER = 0; IFR = 0; InitPieVectTable();
  EALLOW; PieVectTable.EMIF_ERROR_INT = &swi; EDIS;
  IER |= M_INT12; PieCtrlRegs.PIEIER12.bit.INTx9 = 1; EINT;
  PieCtrlRegs.PIEIFR12.bit.INTx9 = 1;
  PieCtrlRegs.PIEIFR12.bit.INTx9 = 1;
  while (1) {}
}`, 1);
    expect(r.runtimeError).toBeUndefined();
    expect(r.board.readVar("n")).toBe(2);
  });
  it("keeps a polling loop that drives a pin fast to simulate", () => {
    const t = Date.now();
    const r = run(`void main(void) {
  InitGpio();
  GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0); GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);
  GPIO_SetupPinOptions(157, GPIO_INPUT, GPIO_PULLUP);
  while (1) {
    if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) GpioDataRegs.GPASET.bit.GPIO22 = 1;
    else GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;
  }
}`, 5000);
    expect(r.runtimeError).toBeUndefined();
    expect(Date.now() - t).toBeLessThan(2000);
  });
  it("warns when a floating pin's own bit is read", () => {
    const r = run(`int v; void main(void) { InitGpio(); v = GpioDataRegs.GPEDAT.bit.GPIO157; while (1) {} }`);
    expect(codes(r)).toContain("floating-157");
    const ok = run(`int v; void main(void) { InitGpio(); GPIO_SetupPinOptions(157, GPIO_INPUT, GPIO_PULLUP);
      v = GpioDataRegs.GPEDAT.bit.GPIO157; while (1) {} }`);
    expect(codes(ok)).toEqual([]);
    expect(ok.board.readVar("v")).toBe(1);
  });
  it("skips idle time: one simulated minute runs quickly", () => {
    const t = Date.now();
    expect(run(prog(all), 60000).board.readVar("n")).toBe(59999);
    expect(Date.now() - t).toBeLessThan(5000);
  });
});

import { runProgram } from "../src/sim/runner";
function runProgramWithPress(source: string) {
  return runProgram({ kit: "robot", source, durationMs: 5, stimuli: [{ at: 2, press: "PB1" }] });
}
