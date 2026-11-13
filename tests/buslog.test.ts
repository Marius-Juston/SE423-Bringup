import { describe, expect, it } from "vitest";
import { runProgram, type RunResult } from "../src/sim/runner";
import { RECEIVED_MAX, type CanState } from "../src/sim/plugins/can";
import { spiBus } from "../src/sim/plugins/spi";
import { groupSpi } from "../src/ui/views/bus-log";

// What the bus traffic view (src/ui/views/bus-log.tsx) reads from the
// plugins: the frames a CAN module stored (can.ts `received`) and the
// chip-select frame number of every SPI word (spi.ts `frame`).

function run(source: string, durationMs: number): RunResult {
  const r = runProgram({ kit: "robot", durationMs, source });
  expect(r.compileError, JSON.stringify(r.compileError)).toBeUndefined();
  expect(r.runtimeError, JSON.stringify(r.runtimeError)).toBeUndefined();
  return r;
}

// CAN-B as in the final project starter, polling instead of an interrupt.
const CAN = `
void main(void)
{
    InitSysCtrl();
    InitGpio();
    GPIO_SetupPinMux(17, GPIO_MUX_CPU1, 2);
    GPIO_SetupPinOptions(17, GPIO_INPUT, GPIO_ASYNC);
    GPIO_SetupPinMux(12, GPIO_MUX_CPU1, 2);
    GPIO_SetupPinOptions(12, GPIO_OUTPUT, GPIO_PUSHPULL);
    InitCANB();
    setCANBitRate(200000000, 1000000);
    CANsetupMessageObject(CANB_BASE, 1, 0x060b0101, CAN_MSG_FRAME_EXT,
                          CAN_MSG_OBJ_TYPE_RX, 0, CAN_MSG_OBJ_NO_FLAGS, 8);
    CANsetupMessageObject(CANB_BASE, 2, 0x060b0102, CAN_MSG_FRAME_EXT,
                          CAN_MSG_OBJ_TYPE_RX, 0, CAN_MSG_OBJ_NO_FLAGS, 8);
    CanbRegs.CAN_CTL.bit.Init = 0;
    CanbRegs.CAN_CTL.bit.CCE = 0;
    while(1)
    {
    }
}`;

// SPIB as the course sets it up (setupSpib), then three transfers with the
// MPU-9250's chip select (GPIO66): two words, one word, and after a pause
// one more word. The first two follow each other without any gap.
const SPI = `uint16_t dummy;
void main(void)
{
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
    SpibRegs.SPICCR.bit.SPICHAR = 0xF;
    SpibRegs.SPICTL.bit.TALK = 1;
    SpibRegs.SPIPRI.bit.FREE = 1;
    SpibRegs.SPIBRR.bit.SPI_BIT_RATE = 49;
    SpibRegs.SPIFFTX.bit.SPIRST = 1;
    SpibRegs.SPIFFTX.bit.SPIFFENA = 1;
    SpibRegs.SPIFFTX.bit.TXFIFO = 0;
    SpibRegs.SPIFFRX.bit.RXFIFORESET = 0;
    SpibRegs.SPICCR.bit.SPISWRESET = 1;
    SpibRegs.SPIFFTX.bit.TXFIFO = 1;
    SpibRegs.SPIFFRX.bit.RXFIFORESET = 1;

    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0xBA00;
    SpibRegs.SPITXBUF = 0x0000;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 2);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0xF500;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 3);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    DELAY_US(200);
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0xF500;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 4);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    while (1) {}
}`;

describe("what the bus traffic view reads", () => {
  it("CAN keeps the frames it stored: time, identifier, data bytes and message object", () => {
    const r = run(CAN, 250);
    const m = (r.board.plugins.get("can") as CanState).b;
    // Sensor 1 measures at 5, 105, 205 ms; sensor 2 at 30, 130, 230 ms.
    expect(m.stored).toBe(6);
    expect(m.received.length).toBe(6);
    expect(m.received.map((f) => f.obj)).toEqual([1, 2, 1, 2, 1, 2]);
    expect(m.received.map((f) => f.id)).toEqual([0x060b0101, 0x060b0102, 0x060b0101, 0x060b0102, 0x060b0101, 0x060b0102]);
    for (const f of m.received) {
      expect(f.extended).toBe(true);
      expect(f.data.length).toBe(8);
      for (const x of f.data) expect(x).toBeGreaterThanOrEqual(0), expect(x).toBeLessThanOrEqual(255);
    }
    expect(m.received[0].t / 1e6).toBeGreaterThan(5.13);
    expect(m.received[0].t / 1e6).toBeLessThan(5.14);
    // The last frame stored in object 1 is what the object holds now.
    const last = m.received.filter((f) => f.obj === 1).pop()!;
    expect(m.objs[1].data.slice(0, 8)).toEqual(last.data);
    for (let i = 1; i < m.received.length; i++) expect(m.received[i].t).toBeGreaterThan(m.received[i - 1].t);
  });

  it("the CAN receive history is bounded", () => {
    const r = run(CAN, 40);
    const m = (r.board.plugins.get("can") as CanState).b;
    expect(RECEIVED_MAX).toBe(200);
    for (let i = 0; i < 450; i++) m.receive({ id: 0x060b0101, extended: true, data: [i & 0xff, i >> 8] });
    expect(m.received.length).toBe(RECEIVED_MAX);
    const end = m.received[RECEIVED_MAX - 1];
    expect(end.data).toEqual([449 & 0xff, 449 >> 8]);
    expect(m.received[0].data).toEqual([250, 0]);
    expect(end.obj).toBe(1);
  });

  it("SPI words carry a chip-select frame number, and the view groups by it", () => {
    const r = run(SPI, 2);
    expect(r.diagnostics).toEqual([]);
    const log = spiBus(r.board).log;
    expect(log.length).toBe(4);
    expect(log.map((w) => w.device)).toEqual(Array(4).fill(log[0].device));
    expect(log[0].device).not.toBeNull();
    const [a, b, c, d] = log.map((w) => w.frame);
    expect(a).toBeGreaterThanOrEqual(1);
    expect(b).toBe(a);
    expect(c).toBe(a + 1);
    expect(d).toBe(a + 2);
    // Words 2 and 3 follow each other as closely as words 1 and 2 do:
    // only the chip select tells the transfers apart.
    expect(groupSpi(log).map((g) => g.map((w) => w.out))).toEqual([[0xba00, 0x0000], [0xf500], [0xf500]]);
    // A long transfer is cut into lines of at most maxWords words.
    expect(groupSpi(log, 1).length).toBe(4);
  });
});
