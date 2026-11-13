import { describe, expect, it } from "vitest";
import { runProgram, type RunResult } from "../src/sim/runner";
import { Board } from "../src/sim/board";
import { dmaTriggerName } from "../src/sim/plugins/dma";

// The tests fire the trigger lines themselves (b.fireTrigger), so they do not
// need an ADC or ePWM model. "sample" plays the role of an ADC result register.

interface Fire {
  /** ms */
  at: number;
  line: string;
  /** Value stored in the global `sample` just before the trigger. */
  value?: number;
}

/**
 * Runs a program with trigger lines fired at given times. runProgram creates
 * the board itself, so the events are added right after the program loads.
 */
function run(source: string, fires: Fire[], durationMs = 5): RunResult {
  const load = Board.prototype.load;
  Board.prototype.load = function (this: Board, src: string) {
    load.call(this, src);
    for (const f of fires)
      this.at(f.at * 1e6, (t) => {
        if (f.value !== undefined) {
          const g = this.compiler.globals.get("sample");
          if (g) this.mem.poke(g.addr, 1, f.value);
        }
        this.fireTrigger(f.line, t);
      });
  };
  try {
    const r = runProgram({ kit: "robot", source, durationMs });
    expect(r.compileError, JSON.stringify(r.compileError)).toBeUndefined();
    expect(r.runtimeError, JSON.stringify(r.runtimeError)).toBeUndefined();
    return r;
  } finally {
    Board.prototype.load = load;
  }
}

const every = (line: string, n: number, startMs = 1, stepMs = 0.1, first = 100): Fire[] =>
  Array.from({ length: n }, (_, i) => ({ at: startMs + i * stepMs, line, value: first + i }));

const PIE = `    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();`;

/** The course's InitDma() (fftDMAstarter_main.c), with a 4-sample buffer. */
const COURSE = `#define N 4
uint16_t sample = 0;
uint16_t ping[N];
uint16_t pong[N];
uint16_t p0, p1, p2, p3, q0, q1, q2, q3;
uint16_t iPingPong = 0;
int16_t DMAcount = 0;
uint16_t beforePing = 9, beforePong = 9;
__interrupt void DMA_ISR(void);

void show(void) {
    p0 = ping[0]; p1 = ping[1]; p2 = ping[2]; p3 = ping[3];
    q0 = pong[0]; q1 = pong[1]; q2 = pong[2]; q3 = pong[3];
}

void InitDma(void)
{
    EALLOW;
    DmaRegs.DMACTRL.bit.HARDRESET = 1;
    asm(" NOP");
    DmaRegs.DEBUGCTRL.bit.FREE = 1;
    DmaRegs.PRIORITYCTRL1.bit.CH1PRIORITY = 0;
    DmaRegs.CH1.MODE.all = 0x8901;
    DmaClaSrcSelRegs.DMACHSRCSEL1.bit.CH1 = 6;
    DmaRegs.CH1.BURST_SIZE.bit.BURSTSIZE = 0;
    DmaRegs.CH1.TRANSFER_SIZE = N-1;
    DmaRegs.CH1.SRC_TRANSFER_STEP = 0;
    DmaRegs.CH1.SRC_ADDR_SHADOW = (Uint32)&sample;
    DmaRegs.CH1.DST_TRANSFER_STEP = 1;
    DmaRegs.CH1.DST_ADDR_SHADOW = (Uint32)ping;
    DmaRegs.CH1.CONTROL.all = 0x0091;
    EDIS;
    PieCtrlRegs.PIEIER7.bit.INTx1 = 1;
    IER |= M_INT7;
}

void main(void)
{
    InitSysCtrl();
${PIE}
    EALLOW;
    PieVectTable.DMA_CH1_INT = &DMA_ISR;
    EDIS;
    InitDma();
    EINT;
    while (1) { show(); }
}

__interrupt void DMA_ISR(void)
{
    PieCtrlRegs.PIEACK.all = PIEACK_GROUP7;
    if (DMAcount == 0) { beforePing = ping[1]; }
    if (iPingPong == 0) {
        EALLOW;
        DmaRegs.CH1.DST_ADDR_SHADOW = (Uint32)pong;
        EDIS;
        iPingPong = 1;
    } else {
        EALLOW;
        DmaRegs.CH1.DST_ADDR_SHADOW = (Uint32)ping;
        EDIS;
        iPingPong = 0;
    }
    DMAcount += 1;
}
`;

describe("DMA plugin", () => {
  it("maps DMACHSRCSEL values to trigger lines as TRM Table 5-1 does", () => {
    expect(dmaTriggerName(0)).toBeNull();
    expect(dmaTriggerName(1)).toBe("ADCAINT1");
    expect(dmaTriggerName(4)).toBe("ADCAINT4");
    expect(dmaTriggerName(5)).toBeNull(); // ADCAEVT: not modelled
    expect(dmaTriggerName(6)).toBe("ADCBINT1");
    expect(dmaTriggerName(11)).toBe("ADCCINT1");
    expect(dmaTriggerName(19)).toBe("ADCDINT4");
    expect(dmaTriggerName(21)).toBeNull();
    expect(dmaTriggerName(36)).toBe("EPWM1SOCA");
    expect(dmaTriggerName(37)).toBe("EPWM1SOCB");
    expect(dmaTriggerName(48)).toBe("EPWM7SOCA");
    expect(dmaTriggerName(59)).toBe("EPWM12SOCB");
    expect(dmaTriggerName(68)).toBe("TINT0");
    expect(dmaTriggerName(70)).toBe("TINT2");
    expect(dmaTriggerName(71)).toBeNull();
  });

  it("runs the course's ping-pong setup: one word per trigger, interrupt at the start of each transfer, INT7.1", () => {
    // 10 ADCBINT1 pulses: samples 100..103 -> ping, 104..107 -> pong, 108, 109 -> ping again.
    const r = run(COURSE, every("ADCBINT1", 10));
    expect(r.diagnostics).toEqual([]);
    const v = (n: string) => r.board.readVar(n);
    expect([v("p0"), v("p1"), v("p2"), v("p3")]).toEqual([108, 109, 102, 103]);
    expect([v("q0"), v("q1"), v("q2"), v("q3")]).toEqual([104, 105, 106, 107]);
    // CHINTMODE = 0: the interrupt comes with the first trigger of each transfer (3 transfers started).
    expect(v("DMAcount")).toBe(3);
    expect(r.isrLog.map((x) => x.vector)).toEqual(["DMA_CH1_INT", "DMA_CH1_INT", "DMA_CH1_INT"]);
    expect(r.isrLog.map((x) => Math.round(x.t / 1e5) / 10)).toEqual([1, 1.4, 1.8]);
    expect(r.board.pie.vectorName(7, 1)).toBe("DMA_CH1_INT");
    // The first interrupt arrives when only ping[0] has been written.
    expect(v("beforePing")).toBe(0);
    const d = r.board.dev;
    expect(d.get("DmaRegs.CH1.CONTROL", "RUNSTS")).toBe(1); // continuous: still enabled
    expect(d.get("DmaRegs.CH1.CONTROL", "TRANSFERSTS")).toBe(1); // in the middle of the third transfer
    expect(d.get("DmaRegs.CH1.TRANSFER_COUNT")).toBe(1); // 3 at the start, 2 bursts done
    expect(d.get("DmaRegs.CH1.CONTROL", "RUN")).toBe(0); // command bits read 0
    // Shadow registers change only by software, active registers only by hardware.
    const ping = r.board.compiler.globals.get("ping")!.addr;
    expect(d.get("DmaRegs.CH1.DST_ADDR_SHADOW")).toBe(r.board.compiler.globals.get("pong")!.addr);
    expect(d.get("DmaRegs.CH1.DST_ADDR_ACTIVE")).toBe(ping + 2);
    expect(d.get("DmaRegs.CH1.SRC_ADDR_ACTIVE")).toBe(r.board.compiler.globals.get("sample")!.addr);
  });

  it("ignores triggers from other sources, and when PERINTE or RUN is missing", () => {
    const other = run(COURSE, every("ADCAINT1", 6));
    expect(other.board.readVar("DMAcount")).toBe(0);
    expect(other.board.readVar("p0")).toBe(0);
    const noPerinte = run(COURSE.replace("0x8901", "0x8801"), every("ADCBINT1", 6));
    expect(noPerinte.board.readVar("p0")).toBe(0);
    const noRun = run(COURSE.replace("0x0091", "0x0090"), every("ADCBINT1", 6));
    expect(noRun.board.readVar("p0")).toBe(0);
    // The trigger is latched while the channel is not running, and a second one is an overrun.
    expect(noRun.board.dev.get("DmaRegs.CH1.CONTROL", "PERINTFLG")).toBe(1);
    expect(noRun.board.dev.get("DmaRegs.CH1.CONTROL", "OVRFLG")).toBe(1);
  });

  it("warns when MODE.PERINTSEL is not the channel number, and nothing moves", () => {
    const r = run(COURSE.replace("0x8901", "0x8902"), every("ADCBINT1", 6));
    expect(r.diagnostics.map((d) => d.code)).toContain("dma-perintsel");
    expect(r.board.readVar("p0")).toBe(0);
  });

  it("needs EALLOW", () => {
    const r = run(`void main(void) { DmaRegs.CH1.TRANSFER_SIZE = 3; while (1) {} }`, []);
    expect(r.diagnostics.map((d) => d.code)).toContain("eallow");
    expect(r.board.dev.get("DmaRegs.CH1.TRANSFER_SIZE")).toBe(0);
  });

  it("stops after one transfer without CONTINUOUS and interrupts at the end with CHINTMODE = 1", () => {
    // 0x8301: CHINTE, CHINTMODE = 1 (end), PERINTE, PERINTSEL = 1.
    const r = run(COURSE.replace("0x8901", "0x8301"), every("ADCBINT1", 10));
    const v = (n: string) => r.board.readVar(n);
    expect([v("p0"), v("p1"), v("p2"), v("p3")]).toEqual([100, 101, 102, 103]);
    expect(v("q0")).toBe(0);
    expect(v("DMAcount")).toBe(1);
    expect(Math.round(r.isrLog[0].t / 1e5) / 10).toBe(1.3); // with the fourth sample
    expect(r.board.dev.get("DmaRegs.CH1.CONTROL", "RUNSTS")).toBe(0);
    expect(r.board.dev.get("DmaRegs.CH1.CONTROL", "TRANSFERSTS")).toBe(0);
  });

  it("copies (BURSTSIZE + 1) words per trigger, a whole transfer in one-shot mode, and forced triggers work", () => {
    const src = (mode: string, extra = "") => `uint16_t sample = 0;
uint16_t src[8] = {1, 2, 3, 4, 5, 6, 7, 8};
uint16_t dst[8];
uint16_t d0, d1, d2, d3, d4, d5, d6, d7;
void main(void)
{
    InitSysCtrl();
    EALLOW;
    DmaRegs.DMACTRL.bit.HARDRESET = 1;
    asm(" NOP");
    DmaRegs.CH2.MODE.all = ${mode};
    DmaClaSrcSelRegs.DMACHSRCSEL1.bit.CH2 = 48;   // EPWM7SOCA
    DmaRegs.CH2.BURST_SIZE.bit.BURSTSIZE = 1;      // 2 words per burst
    DmaRegs.CH2.SRC_BURST_STEP = 1;
    DmaRegs.CH2.DST_BURST_STEP = 1;
    DmaRegs.CH2.TRANSFER_SIZE = 3;                 // 4 bursts
    DmaRegs.CH2.SRC_TRANSFER_STEP = 1;
    DmaRegs.CH2.DST_TRANSFER_STEP = 1;
    DmaRegs.CH2.SRC_ADDR_SHADOW = (Uint32)src;
    DmaRegs.CH2.DST_ADDR_SHADOW = (Uint32)dst;
    DmaRegs.CH2.CONTROL.all = 0x0091;
    ${extra}
    EDIS;
    while (1) {
        d0 = dst[0]; d1 = dst[1]; d2 = dst[2]; d3 = dst[3];
        d4 = dst[4]; d5 = dst[5]; d6 = dst[6]; d7 = dst[7];
    }
}`;
    const got = (r: RunResult) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => r.board.readVar(`d${i}`));
    // One burst per trigger: 3 triggers move 6 words.
    expect(got(run(src("0x0102"), [{ at: 1, line: "EPWM7SOCA" }, { at: 2, line: "EPWM7SOCA" }, { at: 3, line: "EPWM7SOCA" }]))).toEqual([1, 2, 3, 4, 5, 6, 0, 0]);
    // One-shot: a single trigger moves all (1 + 1) x (3 + 1) = 8 words, then the channel stops.
    const one = run(src("0x0502"), [{ at: 1, line: "EPWM7SOCA" }]);
    expect(got(one)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(one.board.dev.get("DmaRegs.CH2.CONTROL", "RUNSTS")).toBe(0);
    // Software trigger: PERINTFRC.
    const forced = run(src("0x0502", "DmaRegs.CH2.CONTROL.bit.PERINTFRC = 1;"), []);
    expect(got(forced)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Channel 2 is INT7.2.
    expect(one.board.pie.vectorName(7, 2)).toBe("DMA_CH2_INT");
  });

  it("moves 32-bit data two words at a time (Table 5-2) and wraps the source address", () => {
    const r = run(
      `uint16_t sample = 0;
float in[2] = {1.5, -2.25};
float out[4];
float o0, o1, o2, o3;
void main(void)
{
    InitSysCtrl();
    EALLOW;
    DmaRegs.CH3.MODE.all = 0x4503;                 // DATASIZE = 32 bit, ONESHOT, PERINTE, channel 3
    DmaClaSrcSelRegs.DMACHSRCSEL1.bit.CH3 = 68;   // TINT0
    DmaRegs.CH3.BURST_SIZE.bit.BURSTSIZE = 1;      // one 32-bit value per burst
    DmaRegs.CH3.TRANSFER_SIZE = 3;                 // 4 bursts
    DmaRegs.CH3.SRC_TRANSFER_STEP = 2;
    DmaRegs.CH3.DST_TRANSFER_STEP = 2;
    DmaRegs.CH3.SRC_WRAP_SIZE = 1;                 // back to the start after 2 bursts
    DmaRegs.CH3.SRC_WRAP_STEP = 0;
    DmaRegs.CH3.SRC_BEG_ADDR_SHADOW = (Uint32)in;
    DmaRegs.CH3.SRC_ADDR_SHADOW = (Uint32)in;
    DmaRegs.CH3.DST_ADDR_SHADOW = (Uint32)out;
    DmaRegs.CH3.CONTROL.all = 0x0091;
    EDIS;
    while (1) { o0 = out[0]; o1 = out[1]; o2 = out[2]; o3 = out[3]; }
}`,
      [{ at: 1, line: "TINT0" }],
    );
    expect(r.diagnostics).toEqual([]);
    expect(["o0", "o1", "o2", "o3"].map((n) => r.board.readVar(n))).toEqual([1.5, -2.25, 1.5, -2.25]);
  });

  it("HARDRESET clears the channel registers and the DMACTRL bits read 0", () => {
    const r = run(
      `uint16_t sample = 0;
uint16_t a = 9, b = 9, c = 9;
void main(void)
{
    InitSysCtrl();
    EALLOW;
    DmaRegs.CH1.MODE.all = 0x8901;
    DmaRegs.CH1.TRANSFER_SIZE = 77;
    DmaRegs.CH1.CONTROL.bit.RUN = 1;
    EDIS;
    a = DmaRegs.CH1.CONTROL.bit.RUNSTS;
    EALLOW;
    DmaRegs.DMACTRL.bit.HARDRESET = 1;
    EDIS;
    b = DmaRegs.CH1.CONTROL.bit.RUNSTS + DmaRegs.CH1.MODE.all + DmaRegs.CH1.TRANSFER_SIZE;
    c = DmaRegs.DMACTRL.all;
    while (1) {}
}`,
      [],
    );
    expect(r.board.readVar("a")).toBe(1);
    expect(r.board.readVar("b")).toBe(0);
    expect(r.board.readVar("c")).toBe(0);
    // Started without addresses: the student is told.
    expect(r.diagnostics.map((d) => d.code)).toContain("dma-address");
  });
});
