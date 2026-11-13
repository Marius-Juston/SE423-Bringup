import { describe, expect, it } from "vitest";
import { runProgram, type RunResult, type Stimulus } from "../src/sim/runner";
import type { CanState } from "../src/sim/plugins/can";
import { codes } from "./helpers";

// The CAN part of the final project starter, cut down to sensor 1 and 2 distances.
const GLOBALS = `
#define RX_MSG_DATA_LENGTH    8
#define RX_MSG_OBJ_ID_1       1
#define RX_MSG_OBJ_ID_2       2
__interrupt void can_isr(void);
volatile uint32_t rxMsgCount_1 = 0;
volatile uint32_t rxMsgCount_2 = 0;
extern uint16_t rxMsgData[8];
uint32_t dis_raw_1[2];
uint32_t dis_raw_2[2];
uint32_t dis_1 = 0;
uint32_t dis_2 = 0;
uint32_t measure_status_1 = 7;
uint32_t statusInts = 0;
`;

const ISR = (ack = "InterruptclearACKGroup(INTERRUPT_ACK_GROUP9);", clear = "CANclearInterruptStatus(CANB_BASE, RX_MSG_OBJ_ID_1);") => `
__interrupt void can_isr(void)
{
    int i = 0;
    uint32_t status;
    status = CANgetInterruptCause(CANB_BASE);
    if(status == CAN_INT_INT0ID_STATUS)
    {
        status = CANgetStatus(CANB_BASE);
        statusInts++;
    }
    else if(status == RX_MSG_OBJ_ID_1)
    {
        CANreadMessage(CANB_BASE, RX_MSG_OBJ_ID_1, rxMsgData);
        for(i = 0; i<2; i++)
        {
            dis_raw_1[i] = rxMsgData[i];
        }
        dis_1 = 256*dis_raw_1[1] + dis_raw_1[0];
        measure_status_1 = rxMsgData[2];
        ${clear}
        rxMsgCount_1++;
    }
    else if(status == RX_MSG_OBJ_ID_2)
    {
        CANreadMessage(CANB_BASE, RX_MSG_OBJ_ID_2, rxMsgData);
        for(i = 0; i<2; i++)
        {
            dis_raw_2[i] = rxMsgData[i];
        }
        dis_2 = 256*dis_raw_2[1] + dis_raw_2[0];
        CANclearInterruptStatus(CANB_BASE, RX_MSG_OBJ_ID_2);
        rxMsgCount_2++;
    }
    CANclearGlobalInterruptStatus(CANB_BASE, CAN_GLOBAL_INT_CANINT0);
    ${ack}
}`;

const PINS = `
    GPIO_SetupPinMux(17, GPIO_MUX_CPU1, 2);
    GPIO_SetupPinOptions(17, GPIO_INPUT, GPIO_ASYNC);
    GPIO_SetupPinMux(12, GPIO_MUX_CPU1, 2);
    GPIO_SetupPinOptions(12, GPIO_OUTPUT, GPIO_PUSHPULL);`;

const main = (o: { pins?: string; rate?: string; id1?: string; extra?: string; ctl?: string } = {}) => `
void main(void)
{
    InitSysCtrl();
    InitGpio();${o.pins ?? PINS}
    InitCANB();
    ${o.rate ?? "setCANBitRate(200000000, 1000000);"}
    ${o.ctl ?? "CanbRegs.CAN_CTL.bit.IE0= 1;\n    CanbRegs.CAN_CTL.bit.EIE= 1;"}
    DINT;
    InitPieCtrl();
    IER = 0x0000;
    IFR = 0x0000;
    InitPieVectTable();
    EALLOW;
    PieVectTable.CANB0_INT = &can_isr;
    EDIS;
    IER |= M_INT9;
    PieCtrlRegs.PIEIER9.bit.INTx7 = 1;
    CanbRegs.CAN_GLB_INT_EN.bit.GLBINT0_EN = 1;
    EINT;
    ERTM;
    CANsetupMessageObject(CANB_BASE, RX_MSG_OBJ_ID_1, ${o.id1 ?? "0x060b0101"}, CAN_MSG_FRAME_EXT,
                          CAN_MSG_OBJ_TYPE_RX, 0, CAN_MSG_OBJ_RX_INT_ENABLE,
                          RX_MSG_DATA_LENGTH);
    CANsetupMessageObject(CANB_BASE, RX_MSG_OBJ_ID_2, 0x060b0102, CAN_MSG_FRAME_EXT,
                          CAN_MSG_OBJ_TYPE_RX, 0, CAN_MSG_OBJ_RX_INT_ENABLE,
                          RX_MSG_DATA_LENGTH);
    ${o.extra ?? ""}
    CanbRegs.CAN_CTL.bit.Init = 0;
    CanbRegs.CAN_CTL.bit.CCE = 0;
    while(1)
    {
    }
}`;

function run(source: string, durationMs = 250, stimuli: Stimulus[] = []): RunResult {
  const r = runProgram({ kit: "robot", durationMs, source, stimuli });
  expect(r.compileError, JSON.stringify(r.compileError)).toBeUndefined();
  expect(r.runtimeError, JSON.stringify(r.runtimeError)).toBeUndefined();
  return r;
}
const can = (r: RunResult) => (r.board.plugins.get("can") as CanState).b;
const v = (r: RunResult, name: string) => r.board.readVar(name);

describe("CAN plugin (TRM chapter 22) with the course library", () => {
  it("runs the final project's receive path: distances from both sensors every 100 ms", () => {
    const r = run(GLOBALS + ISR() + main(), 250, [
      { at: 50, set: "CAN_DIST1_MM", value: 1234 },
      { at: 50, set: "CAN_DIST2_MM", value: 77 },
    ]);
    expect(r.diagnostics).toEqual([]);
    // Sensor 1 measures at 5, 105, 205 ms; sensor 2 at 30, 130, 230 ms.
    expect(v(r, "rxMsgCount_1")).toBe(3);
    expect(v(r, "rxMsgCount_2")).toBe(3);
    expect(v(r, "dis_1")).toBe(1234);
    expect(v(r, "dis_2")).toBe(77);
    expect(v(r, "measure_status_1")).toBe(0);
    expect(v(r, "statusInts")).toBe(0);
    const isr = r.isrLog.filter((x) => x.name === "can_isr");
    expect(isr.length).toBe(6);
    expect(isr[0].vector).toBe("CANB0_INT");
    // An extended frame with 8 data bytes is 128 bit times at 1 Mbit/s, 131 with the gap.
    expect(isr[0].t / 1e6).toBeGreaterThan(5.13);
    expect(isr[0].t / 1e6).toBeLessThan(5.14);
    expect(isr[2].t - isr[0].t).toBeCloseTo(100e6, -3);
    // Quality (0x060B02ss) and heartbeat frames match no message object.
    expect(r.board.output("CAN_RX_FRAMES")).toBe(6);
    expect(r.board.dev.get("CanbRegs.CAN_INT")).toBe(0);
    expect(r.board.dev.get("CanbRegs.CAN_NDAT_21")).toBe(0);
    expect(r.board.dev.get("CanbRegs.CAN_MVAL_21")).toBe(3);
  });

  it("programs CAN_BTR as the course's setCANBitRate does (TRM 22.12.1)", () => {
    const r = run(`uint32_t got = 0; uint32_t slow = 0;
void main(void) { InitCANB(); got = setCANBitRate(200000000, 1000000); slow = CanbRegs.CAN_BTR.all;
  setCANBitRate(200000000, 125000); while (1) {} }`, 1);
    expect(v(r, "got")).toBe(1000000);
    // 200 = 20 * 10: prescaler 20 (BRP = 19), 10 time quanta (TSEG1 = 4, TSEG2 = 3, SJW = 1).
    expect(v(r, "slow")).toBe(0x3453);
    expect(can(r).bitRate()).toBe(125000);
    expect(r.board.output("CAN_BITRATE")).toBe(125000);
    // 1600 = 123 * 13 + 1 -> 1600 = 160 * 10: BRP = 159 = 0x9F -> BRP 0x1F, BRPE 2.
    expect(r.board.dev.get("CanbRegs.CAN_BTR", "BRPE")).toBe(2);
    expect(r.board.dev.get("CanbRegs.CAN_CTL", "Init")).toBe(1);
  });

  it("stores a frame only in an object whose identifier matches", () => {
    const r = run(GLOBALS + ISR() + main({ id1: "0x060b0103" }));
    expect(r.diagnostics).toEqual([]);
    expect(v(r, "rxMsgCount_1")).toBe(0);
    expect(v(r, "dis_1")).toBe(0);
    expect(v(r, "rxMsgCount_2")).toBe(3);
    expect(v(r, "dis_2")).toBe(1200);
  });

  it("applies the identifier mask when CAN_MSG_OBJ_USE_ID_FILTER is given", () => {
    // Object 3 takes any 0x060B02ss frame (quality, both sensors); the low byte is a don't care.
    const r = run(
      GLOBALS +
        ISR() +
        main({
          extra: `CANsetupMessageObject(CANB_BASE, 3, 0x060b0200, CAN_MSG_FRAME_EXT, CAN_MSG_OBJ_TYPE_RX,
                          0x1FFFFF00, CAN_MSG_OBJ_USE_ID_FILTER, 8);`,
        }),
      120,
    );
    expect(r.diagnostics).toEqual([]);
    const o = can(r).objs[3];
    // The stored identifier is the one received last: sensor 1's quality frame at 105 ms.
    expect(o.arb & 0x1fffffff).toBe(0x060b0201);
    // Two were stored without being read: NewDat and MsgLst are set.
    expect(o.mctl & 0xc000).toBe(0xc000);
    // Standard deviation 1.5 mm * 65536, little-endian, in bytes 4 to 7.
    expect(o.data.slice(4)).toEqual([0x00, 0x80, 0x01, 0x00]);
    expect(r.board.dev.get("CanbRegs.CAN_NDAT_21")).toBe(4);
  });

  it("fires once only when the PIE group is not acknowledged", () => {
    const r = run(GLOBALS + ISR("") + main());
    expect(r.isrLog.filter((x) => x.name === "can_isr").length).toBe(1);
    expect(r.board.dev.get("PieCtrlRegs.PIEACK") & 0x100).toBe(0x100);
  });

  it("keeps interrupting while IntPnd is not cleared, and says so", () => {
    const r = run(GLOBALS + ISR(undefined, "") + main(), 20);
    expect(codes(r)).toEqual(["can-int-stuck"]);
    expect(r.board.dev.get("CanbRegs.CAN_INT")).toBe(1);
  });

  it("hears nothing in initialization mode, with the wrong pin mux or the wrong bit rate", () => {
    const init = run(GLOBALS + ISR() + main().replace("CanbRegs.CAN_CTL.bit.Init = 0;", ""));
    expect(init.diagnostics).toEqual([]);
    expect(v(init, "rxMsgCount_1")).toBe(0);
    const mux = run(GLOBALS + ISR() + main({ pins: "" }));
    expect(codes(mux)).toEqual(["can-rx-mux"]);
    expect(v(mux, "rxMsgCount_1")).toBe(0);
    const tx = run(GLOBALS + ISR() + main({ pins: "\n    GPIO_SetupPinMux(17, GPIO_MUX_CPU1, 2);" }));
    expect(codes(tx)).toEqual(["can-tx-mux"]);
    expect(v(tx, "rxMsgCount_1")).toBe(3);
    const rate = run(GLOBALS + ISR() + main({ rate: "setCANBitRate(200000000, 500000);" }));
    expect(codes(rate)).toEqual(["can-bitrate"]);
    expect(v(rate, "rxMsgCount_1")).toBe(0);
  });

  it("refuses CAN_BTR writes outside Init + CCE", () => {
    const r = run(`void main(void) { CanbRegs.CAN_CTL.bit.Init = 0; CanbRegs.CAN_BTR.all = 0x3453; while (1) {} }`, 1);
    expect(codes(r)).toEqual(["can-btr-locked"]);
    expect(r.board.dev.get("CanbRegs.CAN_BTR")).toBe(0x2301);
  });

  it("gives a status interrupt (0x8000) per frame when SIE is set, cleared by reading CAN_ES", () => {
    const r = run(GLOBALS + ISR() + main({ ctl: "CanbRegs.CAN_CTL.bit.IE0 = 1;\n    CanbRegs.CAN_CTL.bit.SIE = 1;" }), 60);
    expect(r.diagnostics).toEqual([]);
    // Frames by 60 ms: distance + quality from sensor 1 (5 ms) and sensor 2 (30 ms).
    expect(v(r, "statusInts")).toBe(4);
    expect(v(r, "rxMsgCount_1")).toBe(1);
    expect(v(r, "rxMsgCount_2")).toBe(1);
    expect(r.board.dev.get("CanbRegs.CAN_ES")).toBe(7);
  });

  it("can be polled without interrupts through the IF registers", () => {
    const r = run(`
uint32_t d = 0;
uint32_t id = 0;
uint16_t polls = 0;
void main(void)
{${PINS}
    InitCANB();
    setCANBitRate(200000000, 1000000);
    CANsetupMessageObject(CANB_BASE, 5, 0x060b0102, CAN_MSG_FRAME_EXT, CAN_MSG_OBJ_TYPE_RX, 0, 0, 8);
    CanbRegs.CAN_CTL.bit.Init = 0;
    while (1) {
        if (CanbRegs.CAN_NDAT_21 & 0x10) {
            // Arb + Control + ClrIntPnd + NewDat + Data A + Data B, message object 5
            CanbRegs.CAN_IF2CMD.all = 0x007F0005;
            d = CanbRegs.CAN_IF2DATA.bit.Data_0 + 256 * CanbRegs.CAN_IF2DATA.bit.Data_1;
            id = CanbRegs.CAN_IF2ARB.bit.ID;
            polls++;
        }
    }
}`, 140);
    expect(r.diagnostics).toEqual([]);
    expect(v(r, "polls")).toBe(2);
    expect(v(r, "d")).toBe(1200);
    expect(v(r, "id")).toBe(0x060b0102);
    expect(r.board.dev.get("CanbRegs.CAN_IF2MCTL", "NewDat")).toBe(1);
    expect(can(r).objs[5].mctl & 0x8000).toBe(0);
  });

  it("sends a frame with CANsendMessage; the sensor takes a new sample period from it", () => {
    const r = run(
      GLOBALS +
        ISR() +
        main({
          extra: `CANsetupMessageObject(CANB_BASE, 10, 0x060b0401, CAN_MSG_FRAME_EXT, CAN_MSG_OBJ_TYPE_TX, 0, 0, 3);
    txMsgData[0] = 0xFF; txMsgData[1] = 25; txMsgData[2] = 0;
    CANsendMessage(CANB_BASE, 10, 3, txMsgData);`,
        }),
      250,
    );
    expect(r.diagnostics).toEqual([]);
    expect(can(r).sent.map((f) => [f.id, f.data])).toEqual([[0x060b0401, [0xff, 25, 0]]]);
    expect(r.board.output("CAN_SENSOR1_PERIOD_MS")).toBe(25);
    expect(v(r, "rxMsgCount_1")).toBeGreaterThanOrEqual(9);
    expect(v(r, "rxMsgCount_2")).toBe(3);
    expect(r.board.dev.get("CanbRegs.CAN_TXRQ_21")).toBe(0);
  });

  it("stops hearing a sensor that is unplugged (negative distance input)", () => {
    const r = run(GLOBALS + ISR() + main(), 450, [{ at: 150, set: "CAN_DIST2_MM", value: -1 }]);
    expect(v(r, "rxMsgCount_1")).toBe(5);
    expect(v(r, "rxMsgCount_2")).toBe(2);
  });

  it("leaves programs that never start CAN alone", () => {
    const r = run(`void main(void) { while (1) {} }`, 2000);
    expect(r.board.steps).toBeLessThan(20);
    expect(r.diagnostics).toEqual([]);
  });
});
