import { describe, expect, it } from "vitest";
import { runProgram, type Stimulus } from "../src/sim/runner";
import { ROOMS } from "../src/sim/plugins/lidar";
import { WHEEL_BASE } from "../src/sim/plugins/plant";
import { FT_PER_WHEEL_RAD, ROBOT_RADIUS_FT } from "../src/sim/plugins/robot_world";
import { LPR_ZERO_V, SHARP_CURVE, SHARP_MOUNTS, TOF_MOUNTS, coneDistance, lprVolts, mounted, sharpVolts, tofReading, type RobotSensors } from "../src/sim/plugins/robot_sensors";

// The range sensors and the analog gyro in the robot world
// (src/sim/plugins/robot_sensors.ts): the data sheets' numbers, each reading
// against the geometry of a known room while a program drives, out of range,
// a stimulus that wins, and the world switched off.

/** Reads everything through the chip: CAN-B frames, the DAN28027 over SPIB, the gyro on ADCC. */
const PROGRAM = (o: { left?: number; right?: number; extra?: string } = {}) => `
__interrupt void can_isr(void);
extern uint16_t rxMsgData[8];
uint32_t dis_1 = 9999, dis_2 = 9999, status_1 = 99, status_2 = 99, frames_1 = 0;
uint16_t junk = 0, dan1 = 0, dan2 = 0, c2 = 0, c3 = 0, c4 = 0, c5 = 0;
void main(void)
{
    InitSysCtrl();
    InitGpio();
    GPIO_SetupPinMux(17, GPIO_MUX_CPU1, 2);
    GPIO_SetupPinOptions(17, GPIO_INPUT, GPIO_ASYNC);
    GPIO_SetupPinMux(12, GPIO_MUX_CPU1, 2);
    GPIO_SetupPinOptions(12, GPIO_OUTPUT, GPIO_PUSHPULL);
    GPIO_SetupPinMux(29, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(29, GPIO_OUTPUT, GPIO_PUSHPULL);
    GpioDataRegs.GPASET.bit.GPIO29 = 1;
    InitCANB();
    setCANBitRate(200000000, 1000000);
    CanbRegs.CAN_CTL.bit.IE0 = 1;
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
    init_ADCsAndDACs();
    setupSpib();
    init_EPWM1and2();
    EINT;
    CANsetupMessageObject(CANB_BASE, 1, 0x060b0101, CAN_MSG_FRAME_EXT, CAN_MSG_OBJ_TYPE_RX, 0, CAN_MSG_OBJ_RX_INT_ENABLE, 8);
    CANsetupMessageObject(CANB_BASE, 2, 0x060b0102, CAN_MSG_FRAME_EXT, CAN_MSG_OBJ_TYPE_RX, 0, CAN_MSG_OBJ_RX_INT_ENABLE, 8);
    ${o.extra ?? ""}
    CanbRegs.CAN_CTL.bit.Init = 0;
    CanbRegs.CAN_CTL.bit.CCE = 0;
    setEPWM1A(${o.left ?? 0});
    setEPWM2A(${o.right ?? 0});
    while (1) {
        DELAY_US(5000);
        AdccRegs.ADCSOCFRC1.all = 0x000F;
        DELAY_US(100);
        c2 = AdccResultRegs.ADCRESULT0;
        c3 = AdccResultRegs.ADCRESULT1;
        c4 = AdccResultRegs.ADCRESULT2;
        c5 = AdccResultRegs.ADCRESULT3;
        SpibRegs.SPIFFCT.bit.TXDLY = 16;
        GpioDataRegs.GPACLEAR.bit.GPIO29 = 1;
        SpibRegs.SPITXBUF = 0x00DA;
        SpibRegs.SPITXBUF = 0;
        SpibRegs.SPITXBUF = 0;
        while (SpibRegs.SPIFFRX.bit.RXFFST != 3);
        GpioDataRegs.GPASET.bit.GPIO29 = 1;
        junk = SpibRegs.SPIRXBUF;
        dan1 = SpibRegs.SPIRXBUF;
        dan2 = SpibRegs.SPIRXBUF;
    }
}
__interrupt void can_isr(void)
{
    uint32_t cause = CANgetInterruptCause(CANB_BASE);
    if (cause == 1) {
        CANreadMessage(CANB_BASE, 1, rxMsgData);
        dis_1 = 256 * rxMsgData[1] + rxMsgData[0];
        status_1 = rxMsgData[2];
        frames_1++;
        CANclearInterruptStatus(CANB_BASE, 1);
    } else if (cause == 2) {
        CANreadMessage(CANB_BASE, 2, rxMsgData);
        dis_2 = 256 * rxMsgData[1] + rxMsgData[0];
        status_2 = rxMsgData[2];
        CANclearInterruptStatus(CANB_BASE, 2);
    }
    CANclearGlobalInterruptStatus(CANB_BASE, CAN_GLOBAL_INT_CANINT0);
    InterruptclearACKGroup(INTERRUPT_ACK_GROUP9);
}
`;

const at = (x: number, y: number, th: number): Stimulus[] => [
  { at: 0, set: "LIDAR_ROOM", value: 0 },
  { at: 0, set: "ROBOT_START_X_FT", value: x },
  { at: 0, set: "ROBOT_START_Y_FT", value: y },
  { at: 0, set: "ROBOT_START_THETA_RAD", value: th },
  { at: 0, set: "ROBOT_WORLD", value: 1 },
];
const run = (source: string, durationMs: number, stimuli: Stimulus[]) => {
  const r = runProgram({ kit: "robot", source, durationMs, stimuli });
  expect(r.compileError, JSON.stringify(r.compileError)).toBeUndefined();
  expect(r.runtimeError, JSON.stringify(r.runtimeError)).toBeUndefined();
  return r;
};
type Run = ReturnType<typeof run>;
const v = (r: Run, name: string) => r.board.readVar(name) as number;
const out = (r: Run, name: string, tMs?: number) => r.board.output(name, tMs === undefined ? undefined : tMs * 1e6)!;
/** Counts of the DAN28027's 12-bit converter over 3.3 V. */
const danCounts = (volts: number) => Math.min(4095, Math.round((volts / 3.3) * 4096));
/** Counts of the F28379D's ADC over 3.0 V (TRM 11.4.5). */
const adcCounts = (volts: number) => Math.min(4095, Math.floor((volts / 3.0) * 4096));

describe("data sheet numbers", () => {
  it("Sharp GP2Y0A41SK0F: the curve at its marked points and between them", () => {
    for (const [cm, volts] of SHARP_CURVE) expect(sharpVolts(cm)).toBe(volts);
    // Electro-optical characteristics: 0.4 V typical at 30 cm (0.25 to 0.55), and 2.25 V more at 4 cm (1.95 to 2.55).
    expect(sharpVolts(30)).toBeGreaterThan(0.25);
    expect(sharpVolts(30)).toBeLessThan(0.55);
    expect(sharpVolts(4) - sharpVolts(30)).toBeGreaterThan(1.95);
    expect(sharpVolts(4) - sharpVolts(30)).toBeLessThan(2.55);
    expect(sharpVolts(11)).toBeCloseTo(1.165, 4);
    expect(sharpVolts(27.5)).toBeCloseTo(0.48, 4);
  });

  it("Sharp: falls from 4 cm to 30 cm, turns back below 3 cm, flat beyond the curve's end", () => {
    for (let cm = 4; cm < 40; cm += 0.5) expect(sharpVolts(cm + 0.5)).toBeLessThan(sharpVolts(cm));
    // One voltage, two distances: 2 cm reads like a little over 5 cm.
    expect(sharpVolts(2)).toBe(2.22);
    expect(sharpVolts(5.375)).toBeCloseTo(2.22, 3);
    expect(sharpVolts(1)).toBeLessThan(sharpVolts(3));
    expect(sharpVolts(0)).toBe(0.03);
    expect([sharpVolts(40), sharpVolts(41), sharpVolts(500), sharpVolts(Infinity)]).toEqual([0.31, 0.31, 0.31, 0.31]);
  });

  it("SEN-36005: millimetres inside the mode's range, status 2 and 0 mm beyond it", () => {
    expect(tofReading(1)).toEqual({ mm: 305, status: 0 });
    expect(tofReading(1300 / 304.8)).toEqual({ mm: 1300, status: 0 });
    expect(tofReading(1301 / 304.8)).toEqual({ mm: 0, status: 2 });
    expect(tofReading(9, 1)).toEqual({ mm: 2743, status: 0 });
    expect(tofReading(9.6, 1)).toEqual({ mm: 0, status: 2 });
    expect(tofReading(13, 2)).toEqual({ mm: 3962, status: 0 });
    expect(tofReading(13.2, 2)).toEqual({ mm: 0, status: 2 });
    expect(tofReading(Infinity, 2)).toEqual({ mm: 0, status: 2 });
  });

  it("LPR510: 1.23 V at rest, 2.5 mV and 10 mV per deg/s, rising for a left turn", () => {
    expect(lprVolts(0, 0.0025)).toBe(LPR_ZERO_V);
    expect(lprVolts(400, 0.0025)).toBeCloseTo(2.23, 10);
    expect(lprVolts(-400, 0.0025)).toBeCloseTo(0.23, 10);
    expect(lprVolts(100, 0.01)).toBeCloseTo(2.23, 10);
    expect(lprVolts(-100, 0.01)).toBeCloseTo(0.23, 10);
    // Past its range an output stays at the end of the range.
    expect(lprVolts(400, 0.01)).toBeCloseTo(2.23, 10);
    expect(lprVolts(-400, 0.01)).toBeCloseTo(0.23, 10);
    expect(lprVolts(900, 0.0025)).toBeCloseTo(2.23, 10);
  });

  it("the cone of the CAN sensor sees a post beside its axis that a single ray misses", () => {
    const world = { ...ROOMS[0], posts: [{ x: 7, y: 5.3, r: 0.1 }] };
    const pose = { x: 5, y: 5, th: 0 };
    expect(coneDistance(world, pose, TOF_MOUNTS[0])).toBeCloseTo(10 - 5 - ROBOT_RADIUS_FT, 9);
    const d = coneDistance(world, pose, TOF_MOUNTS[0], 27, 9);
    expect(d).toBeGreaterThan(1.5);
    expect(d).toBeLessThan(1.7);
    // Mounts: front, right, left, rear, on the rim.
    expect(mounted(pose, TOF_MOUNTS[1])).toEqual({ x: 5, y: 5 - ROBOT_RADIUS_FT, angle: -Math.PI / 2 });
    expect(mounted(pose, SHARP_MOUNTS[0]).y).toBeCloseTo(5 + ROBOT_RADIUS_FT, 12);
    expect(mounted(pose, SHARP_MOUNTS[1]).x).toBeCloseTo(5 - ROBOT_RADIUS_FT, 12);
  });
});

describe("a program in the empty 10 ft box", () => {
  it("standing still: each sensor reads its wall", () => {
    // Nose to +x at (8, 1.2): front wall 1.65 ft from the rim, right wall 0.85 ft; left and rear walls far.
    const r = run(PROGRAM(), 300, at(8, 1.2, 0));
    expect(r.diagnostics).toEqual([]);
    expect([v(r, "dis_1"), v(r, "status_1")]).toEqual([Math.round(1.65 * 304.8), 0]);
    expect([v(r, "dis_2"), v(r, "status_2")]).toEqual([Math.round(0.85 * 304.8), 0]);
    expect([v(r, "dan1"), v(r, "dan2")]).toEqual([danCounts(0.31), danCounts(0.31)]);
    // The gyro at rest: 1.23 V on all four outputs.
    expect([v(r, "c2"), v(r, "c3"), v(r, "c4"), v(r, "c5")]).toEqual([1679, 1679, 1679, 1679]);
    expect(adcCounts(LPR_ZERO_V)).toBe(1679);
  });

  it("the Sharp sensors read the left and the rear wall", () => {
    // At (1, 9.2): left wall 0.45 ft = 13.716 cm from the rim, rear wall 0.65 ft = 19.812 cm.
    const r = run(PROGRAM(), 100, at(1, 9.2, 0));
    const left = sharpVolts(0.45 * 30.48);
    const rear = sharpVolts(0.65 * 30.48);
    expect(left).toBeCloseTo(0.9485, 3);
    expect(rear).toBeCloseTo(0.6675, 3);
    expect([v(r, "dan1"), v(r, "dan2")]).toEqual([danCounts(left), danCounts(rear)]);
    // The front wall is far, but the left wall is 0.8 ft beside the sensor: the edge of the 27 degree cone meets it.
    expect([v(r, "dis_1"), v(r, "status_1")]).toEqual([Math.round((0.8 / Math.sin((13.5 * Math.PI) / 180)) * 304.8), 0]);
    expect(v(r, "frames_1")).toBe(1);
    // In the middle of the box the front wall, 4.65 ft away, is beyond the 1.3 m of short mode.
    const mid = run(PROGRAM(), 100, at(5, 5, 0));
    expect([v(mid, "dis_1"), v(mid, "status_1"), v(mid, "dis_2"), v(mid, "status_2")]).toEqual([0, 2, 0, 2]);
  });

  it("long mode, asked for over CAN, reaches the far wall", () => {
    const extra = `CANsetupMessageObject(CANB_BASE, 10, 0x060b0401, CAN_MSG_FRAME_EXT, CAN_MSG_OBJ_TYPE_TX, 0, 0, 1);
    txMsgData[0] = 2;
    CANsendMessage(CANB_BASE, 10, 1, txMsgData);`;
    const r = run(PROGRAM({ extra }), 100, at(1, 5, 0));
    expect(out(r, "CAN_SENSOR1_MODE")).toBe(2);
    expect([v(r, "dis_1"), v(r, "status_1")]).toEqual([Math.round(8.65 * 304.8), 0]);
    // Sensor 2 was not asked: still short mode, the wall 4.65 ft to the right is out of range.
    expect([v(r, "dis_2"), v(r, "status_2")]).toEqual([0, 2]);
  });

  it("driving at a wall: the front reading shrinks and the rear reading grows with the robot's position", () => {
    const r = run(PROGRAM({ left: 3, right: -3 }), 1500, at(6.5, 5, 0));
    const x = out(r, "ROBOT_X_FT");
    expect(x).toBeGreaterThan(7);
    expect(out(r, "ROBOT_CRASHED")).toBe(0);
    // The last distance frame was measured at 1405 ms (5 ms, then every 100 ms).
    const seen = r.board.outputs.get("CAN_DIST1_MM")!;
    expect(seen.length).toBeGreaterThan(8);
    for (const s of seen.slice(2)) expect(Math.abs(s.v - (10 - out(r, "ROBOT_X_FT", s.t / 1e6) - ROBOT_RADIUS_FT) * 304.8)).toBeLessThan(1);
    expect(v(r, "dis_1")).toBe(seen[seen.length - 1].v);
    expect(v(r, "dis_1")).toBeLessThan(Math.round(3.15 * 304.8) - 100);
    // Sharp sensor 2 looks back at the wall x = 0, far away: 0.31 V all the way.
    expect(out(r, "DAN_ADC2")).toBe(0.31);
    // Driving straight: the gyro stays at its zero level (the wheels are alike).
    expect(Math.abs(v(r, "c5") - 1679)).toBeLessThanOrEqual(1);
  });

  it("backing up to a wall: the rear Sharp sensor follows its curve", () => {
    const r = run(PROGRAM({ left: -2, right: 2 }), 1500, at(1.3, 5, 0));
    const tr = r.board.outputs.get("DAN_ADC2")!;
    // Every value published is the curve at the distance from the rim to the wall x = 0 at that moment.
    // (The published position is rounded to 0.0001 ft, which is up to 0.01 V on the steep part.)
    for (const s of tr.slice(2)) expect(Math.abs(s.v - sharpVolts((out(r, "ROBOT_X_FT", s.t / 1e6) - ROBOT_RADIUS_FT) * 30.48))).toBeLessThan(0.02);
    expect(out(r, "ROBOT_CRASHED")).toBe(0);
    expect(Math.max(...tr.map((s) => s.v))).toBeGreaterThan(1);
    expect(v(r, "dan2")).toBe(danCounts(out(r, "DAN_ADC2")));
  });

  it("turning on the spot: the gyro's two Z outputs follow the turn rate, the X outputs stay at rest", () => {
    const r = run(PROGRAM({ left: -3, right: -3 }), 600, at(5, 5, 0));
    const vl = r.board.inputs.get("LEFT_WHEEL_RADPS")! * FT_PER_WHEEL_RAD;
    const vr = r.board.inputs.get("RIGHT_WHEEL_RADPS")! * FT_PER_WHEEL_RAD;
    const dps = (((vr - vl) / WHEEL_BASE) * 180) / Math.PI;
    expect(Math.abs(dps)).toBeGreaterThan(30);
    expect(out(r, "LPR510_Z_DPS")).toBeCloseTo(dps, 1);
    // The heading really changes at that rate.
    const dth = out(r, "ROBOT_THETA_RAD", 590) - out(r, "ROBOT_THETA_RAD", 490);
    expect((Math.atan2(Math.sin(dth), Math.cos(dth)) * 180) / Math.PI / 0.1).toBeCloseTo(dps, 0);
    expect(Math.abs(v(r, "c5") - adcCounts(1.23 + 0.0025 * dps))).toBeLessThanOrEqual(1);
    expect(Math.abs(v(r, "c4") - adcCounts(1.23 + Math.max(-1, Math.min(1, 0.01 * dps))))).toBeLessThanOrEqual(1);
    expect([v(r, "c2"), v(r, "c3")]).toEqual([1679, 1679]);
    // A left turn raises the voltage (data sheet 3.1).
    expect(Math.sign(v(r, "c5") - 1679)).toBe(Math.sign(dps));
  });

  it("a real gyro has a zero-rate error and noise, the same in every run", () => {
    const real: Stimulus[] = [...at(5, 5, 0), { at: 0, set: "LPR510_REAL", value: 1 }];
    const a = run(PROGRAM(), 200, real);
    const b = run(PROGRAM(), 200, real);
    expect([v(a, "c2"), v(a, "c3"), v(a, "c4"), v(a, "c5")]).toEqual([v(b, "c2"), v(b, "c3"), v(b, "c4"), v(b, "c5")]);
    // Z reads 3 deg/s too much: 7.5 mV and 30 mV; X 2 deg/s too little.
    expect(Math.abs(v(a, "c5") - adcCounts(1.2375))).toBeLessThanOrEqual(3);
    expect(Math.abs(v(a, "c4") - adcCounts(1.26))).toBeLessThanOrEqual(10);
    expect(v(a, "c3")).toBeLessThan(1679 - 15);
    const own = run(PROGRAM(), 200, [...real, { at: 0, set: "LPR510_ZERO_Z_DPS", value: -8 }]);
    expect(Math.abs(v(own, "c4") - adcCounts(1.15))).toBeLessThanOrEqual(10);
  });
});

describe("who drives an input", () => {
  it("a stimulus wins over the room, from the moment it is set", () => {
    const r = run(PROGRAM(), 400, [
      ...at(8, 1.2, 0),
      { at: 0, set: "CAN_DIST2_MM", value: 1200 },
      { at: 150, set: "CAN_DIST1_MM", value: 3210 },
      { at: 150, set: "DAN_ADC1", value: 1.65 },
      { at: 150, set: "ADCINC5", value: 2.0 },
    ]);
    // Sensor 2 was set at time 0 to its knob's own position: still a stimulus.
    expect([v(r, "dis_2"), v(r, "status_2")]).toEqual([1200, 0]);
    expect(v(r, "dis_1")).toBe(3210);
    expect(out(r, "CAN_DIST1_MM", 140)).toBe(Math.round(1.65 * 304.8));
    expect(v(r, "dan1")).toBe(2048);
    expect(v(r, "dan2")).toBe(danCounts(0.31));
    expect(v(r, "c5")).toBe(adcCounts(2.0));
    expect(v(r, "c4")).toBe(1679);
    const st = r.board.plugins.get("robot-sensors") as RobotSensors;
    expect(st.tof[0]).toBeUndefined();
    expect(st.sharp[0]).toBeUndefined();
    expect(st.sharp[1]).toEqual({ cm: expect.any(Number), volts: 0.31 });
  });

  it("world off: knobs and stimuli only, exactly as before", () => {
    const r = run(PROGRAM({ left: 3, right: -3 }), 300, [{ at: 100, set: "DAN_ADC2", value: 3.3 }]);
    expect([v(r, "dis_1"), v(r, "status_1"), v(r, "dis_2"), v(r, "status_2")]).toEqual([500, 0, 1200, 0]);
    expect([v(r, "dan1"), v(r, "dan2")]).toEqual([0, 4095]);
    expect([v(r, "c2"), v(r, "c3"), v(r, "c4"), v(r, "c5")]).toEqual([0, 0, 0, 0]);
    for (const name of ["CAN_DIST1_MM", "CAN_DIST2_MM", "DAN_ADC1", "DAN_ADC2", "LPR510_Z_DPS"]) expect(r.board.outputs.has(name)).toBe(false);
    expect((r.board.plugins.get("robot-sensors") as RobotSensors).on).toBe(false);
  });
});
