// What the course's final project starter (FinalProjectwithCANAprilStarter)
// expects besides the serial, LADAR and CAN libraries: the robot library
// SE423Lib.h, MatrixMath.h, xy.h, OptiTrack.h and the camera variables of
// its serial library. Written for this game from what the functions do on
// the robot; the course's files are not copied. Every function here may be
// defined again in a student's file (levels have students write several of
// them): the student's own then takes the name.
//
// Set-up functions (C in the prelude, so the registers change through CPU
// writes and every peripheral model and diagnostic sees them):
// - InitSE423DefaultGPIO(): the two LaunchPad LEDs off, LED1 to LED5 and the
//   pins GPIO130, 131, 25, 26, 27 outputs at 0, the push buttons GPIO157 to
//   160 inputs with pull-ups, the chip selects GPIO19, 29, 66, 125 outputs
//   at 1.
// - init_eQEPs(): eQEP1 (GPIO20/21, left wheel), eQEP2 (GPIO54/55, right
//   wheel), eQEP3 (GPIO6/7, hand wheel) in quadrature count mode, QPOSMAX =
//   0xFFFFFFFF, counter at 0, enabled (TRM 17.4.1, 17.5.1).
// - init_EPWM1and2(): EPWM1A (GPIO0) and EPWM2A (GPIO2) at 20 kHz (TBPRD =
//   2500 at 50 MHz, count up), 50 % duty (TRM 15.4, 15.6).
// - init_RCServoPWM_3AB_5AB_6A(): EPWM3A/3B (GPIO4/5), EPWM5A/5B (GPIO8/9)
//   and EPWM6A (GPIO10) at 50 Hz (CLKDIV = 16, TBPRD = 62500), 8 % duty.
// - init_ADCsAndDACs(): all four ADCs powered up; ADCC converts channels 2,
//   3, 4, 5 on SOC0 to SOC3 when EPWM4 SOCA fires, ADCC interrupt 1 after
//   SOC3 (TRM 11.5, 11.9); DACA and DACB outputs on (TRM 12).
// - readbuttons(): bit 0 to 3 are 1 while PB1 to PB4 (GPIO157 to 160) are
//   held.
// - PostSWI1(), PostSWI2(), PostSWI3(): set PIEIFR12 bit 9, 10, 11 (TRM
//   3.4.3: an interrupt flag set by software requests the interrupt), the
//   three unused vectors the course uses as software interrupts.
//
// Formulas and algorithms (native, so the game holds no C copy of work the
// labs grade):
// - readEncLeft(), readEncRight(), readEncWheel(): the eQEP counter as a
//   signed number, in radians of the wheel (40000 counts per turn; the left
//   one counts down going forward) or of the hand wheel (4000 per turn).
// - setEPWM3A_RCServo(angle) and the 3B, 5A, 5B, 6A ones: -90 to 90 degrees
//   to a pulse of 0.8 to 2.4 ms (4 % to 12 % of 62500 counts).
// - PIcontrol(&uLeft, &uRight, vref, turn, LeftWheel, RightWheel): called
//   every 1 ms. Wheel speeds in ft/s from the change of the wheel angles;
//   a PI speed controller per wheel coupled so that right speed minus left
//   speed follows -turn; friction compensation; outputs limited to -10..10
//   with the integrals leaking while saturated.
// - xy_control(&vref, &turn, turn_thres, x, y, x_des, y_des, theta, radius,
//   radius_near): steers to a point. vref is the distance, at most 1, turn
//   is proportional to the heading error; inside radius_near the robot
//   stops turning (and backs up if it overshot), inside radius it stops;
//   when |turn| is above turn_thres vref is 0 (turn on the spot). Returns 1
//   inside radius_near.
// - MatrixMath.h: Matrix3x3_Invert, _Trans, _Mult, _Add, Matrix1x3_Mult,
//   Matrix3x1_Mult, Matrix3x1_Add, Matrix3x2_Mult on float arrays.
// - UpdateOptitrackStates(pose, &flag): the last OptiTrack packet as a pose
//   in feet and radians, with the heading brought to the turn count of the
//   pose passed in; sets *flag to 1 when the packet holds a tracked pose.
//
// World: while the robot world is on (input ROBOT_WORLD = 1) the MPU-9250
// feels the robot's motion. That is the IMU's model (spi_devices.ts), for
// every program, not something this library adds.
//
// Not modelled (inert: the variables exist and never change):
// - OptiTrack: no packet ever arrives, new_optitrack stays 0.
// - The Raspberry Pi camera on SCIA (colour blobs and AprilTags): the
//   NewCAMData... flags stay 0.
// - LabVIEW and the Linux commands on SCID: nothing arrives, and what the
//   program sends there goes nowhere.
// - Outside the robot world the LPR510 analog gyro's pins (ADCINC2 to 5) read
//   what their signal-bus inputs say (0 V unless set). In the robot world
//   they follow the robot's turn rate (robot_sensors.ts).
// - setupSpib() is the library's (plugins/spi.ts) and sets the port only. The
//   MPU-9250 configuration the final project's own version writes is not
//   sent over SPI; only the accelerometer's 4 g range, which the project
//   scales for, is selected (by InitSE423DefaultGPIO). The gyro range is
//   250 deg/s either way.
// - The time the native functions take is nominal (one statement each for
//   the short ones, twenty for PIcontrol, xy_control and the 3 x 3 products).

import type { Board } from "../board";
import { bitsFloat, floatBits } from "../cc/compile";
import type { SimPlugin } from "../plugin";
import { FT_PER_WHEEL_RAD } from "./robot_world";

const PRELUDE = `
// ---- course camera link (SCIA, Raspberry Pi): never receives anything here
#define CAMNUM_FROM_FLOATS 9
typedef union { uint16_t rawData[CAMNUM_FROM_FLOATS*2]; float floatData[CAMNUM_FROM_FLOATS]; } CAMRecFloats_t;
uint16_t NewCAMDataThreshold1 = 0;
float fromCAMvaluesThreshold1[CAMNUM_FROM_FLOATS];
uint16_t NewCAMDataThreshold2 = 0;
float fromCAMvaluesThreshold2[CAMNUM_FROM_FLOATS];
uint16_t NewCAMDataAprilTag1 = 0;
float fromCAMvaluesAprilTag1[CAMNUM_FROM_FLOATS];

// ---- xy.h, MatrixMath.h
int xy_control(float *vref, float *turn, float turn_thres, float x_pos, float y_pos, float x_desired,
               float y_desired, float thetaabs, float target_radius, float target_radius_near);
void Matrix3x3_Invert(float mat[3][3], float inverse[3][3]);
void Matrix3x3_Trans(float mat[3][3], float trans[3][3]);
void Matrix3x3_Mult(float A[3][3], float B[3][3], float X[3][3]);
void Matrix1x3_Mult(float A[1][3], float B[3][3], float X[1][3]);
void Matrix3x1_Mult(float A[3][3], float B[3][1], float X[3][1]);
void Matrix3x2_Mult(float A[3][2], float B[2][1], float X[3][1]);
void Matrix3x1_Add(float A[3][1], float B[3][1], float X[3][1], float scaleA, float scaleB);
void Matrix3x3_Add(float A[3][3], float B[3][3], float X[3][3], float scaleA, float scaleB);

// ---- OptiTrack.h
#define FEETINONEMETER 3.28083989501312
void __optitrack(float *out, float theta, int16_t *flag);
pose UpdateOptitrackStates(pose localROBOTps, int16_t *flag)
{
    pose p;
    float v[3];
    __optitrack(v, localROBOTps.theta, flag);
    p.x = v[0];
    p.y = v[1];
    p.theta = v[2];
    return p;
}

// ---- SE423Lib.h
float readEncLeft(void);
float readEncRight(void);
float readEncWheel(void);
void setEPWM3A_RCServo(float angle);
void setEPWM3B_RCServo(float angle);
void setEPWM5A_RCServo(float angle);
void setEPWM5B_RCServo(float angle);
void setEPWM6A_RCServo(float angle);
void PIcontrol(float *uLeftlocal, float *uRightlocal, float vreflocal, float turnlocal,
               float LeftWheellocal, float RightWheellocal);
void __se423_imu(void);
void __se423_out(Uint16 pin, Uint16 level)
{
    GPIO_SetupPinMux(pin, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(pin, GPIO_OUTPUT, GPIO_PUSHPULL);
    GPIO_WritePin(pin, level);
}
void InitSE423DefaultGPIO(void)
{
    Uint16 pin;
    __se423_out(31, 1); __se423_out(34, 1);
    __se423_out(22, 0); __se423_out(94, 0); __se423_out(95, 0); __se423_out(97, 0); __se423_out(111, 0);
    __se423_out(130, 0); __se423_out(131, 0); __se423_out(25, 0); __se423_out(26, 0); __se423_out(27, 0);
    for (pin = 157; pin <= 160; pin++) {
        GPIO_SetupPinMux(pin, GPIO_MUX_CPU1, 0);
        GPIO_SetupPinOptions(pin, GPIO_INPUT, GPIO_PULLUP);
    }
    __se423_out(19, 1); __se423_out(29, 1); __se423_out(66, 1); __se423_out(125, 1);
    __se423_imu();
}
uint16_t readbuttons(void)
{
    uint16_t held = 0;
    if (GpioDataRegs.GPEDAT.bit.GPIO157 == 0) held |= 1;
    if (GpioDataRegs.GPEDAT.bit.GPIO158 == 0) held |= 2;
    if (GpioDataRegs.GPEDAT.bit.GPIO159 == 0) held |= 4;
    if (GpioDataRegs.GPFDAT.bit.GPIO160 == 0) held |= 8;
    return held;
}
void PostSWI1(void) { PieCtrlRegs.PIEIFR12.bit.INTx9 = 1; }
void PostSWI2(void) { PieCtrlRegs.PIEIFR12.bit.INTx10 = 1; }
void PostSWI3(void) { PieCtrlRegs.PIEIFR12.bit.INTx11 = 1; }
void __se423_qep(volatile struct EQEP_REGS *q)
{
    q->QEPCTL.bit.QPEN = 0;
    q->QDECCTL.bit.QSRC = 0;
    q->QPOSCTL.all = 0;
    q->QCAPCTL.all = 0;
    q->QEINT.all = 0;
    q->QPOSMAX = 0xFFFFFFFF;
    q->QEPCTL.bit.FREE_SOFT = 2;
    q->QPOSCNT = 0;
    q->QEPCTL.bit.QPEN = 1;
}
void init_eQEPs(void)
{
    GPIO_SetupPinMux(20, GPIO_MUX_CPU1, 1);
    GPIO_SetupPinMux(21, GPIO_MUX_CPU1, 1);
    GPIO_SetupPinMux(54, GPIO_MUX_CPU1, 5);
    GPIO_SetupPinMux(55, GPIO_MUX_CPU1, 5);
    GPIO_SetupPinMux(6, GPIO_MUX_CPU1, 5);
    GPIO_SetupPinMux(7, GPIO_MUX_CPU1, 5);
    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO20 = 1;
    GpioCtrlRegs.GPAPUD.bit.GPIO21 = 1;
    GpioCtrlRegs.GPBPUD.bit.GPIO54 = 1;
    GpioCtrlRegs.GPBPUD.bit.GPIO55 = 1;
    GpioCtrlRegs.GPAPUD.bit.GPIO6 = 1;
    GpioCtrlRegs.GPAPUD.bit.GPIO7 = 1;
    EDIS;
    __se423_qep(&EQep1Regs);
    __se423_qep(&EQep2Regs);
    __se423_qep(&EQep3Regs);
}
void __se423_pwm(volatile struct EPWM_REGS *p, Uint16 clkdiv, Uint16 period, Uint16 compare)
{
    p->TBCTL.bit.CTRMODE = 0;
    p->TBCTL.bit.FREE_SOFT = 3;
    p->TBCTL.bit.CLKDIV = clkdiv;
    p->TBCTL.bit.PHSEN = 0;
    p->TBCTR = 0;
    p->TBPRD = period;
    p->CMPA.bit.CMPA = compare;
    p->CMPB.bit.CMPB = compare;
    p->AQCTLA.bit.CAU = 1;
    p->AQCTLA.bit.ZRO = 2;
    p->AQCTLB.bit.CBU = 1;
    p->AQCTLB.bit.ZRO = 2;
    p->TBPHS.bit.TBPHS = 0;
}
void init_EPWM1and2(void)
{
    __se423_pwm(&EPwm1Regs, 0, 2500, 1250);
    __se423_pwm(&EPwm2Regs, 0, 2500, 1250);
    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO0 = 1;
    GpioCtrlRegs.GPAPUD.bit.GPIO2 = 1;
    EDIS;
    GPIO_SetupPinMux(0, GPIO_MUX_CPU1, 1);
    GPIO_SetupPinMux(2, GPIO_MUX_CPU1, 1);
}
void init_RCServoPWM_3AB_5AB_6A(void)
{
    __se423_pwm(&EPwm3Regs, 4, 62500, 5000);
    __se423_pwm(&EPwm5Regs, 4, 62500, 5000);
    __se423_pwm(&EPwm6Regs, 4, 62500, 5000);
    EALLOW;
    GpioCtrlRegs.GPAPUD.bit.GPIO4 = 1;
    GpioCtrlRegs.GPAPUD.bit.GPIO5 = 1;
    GpioCtrlRegs.GPAPUD.bit.GPIO8 = 1;
    GpioCtrlRegs.GPAPUD.bit.GPIO9 = 1;
    GpioCtrlRegs.GPAPUD.bit.GPIO10 = 1;
    EDIS;
    GPIO_SetupPinMux(4, GPIO_MUX_CPU1, 1);
    GPIO_SetupPinMux(5, GPIO_MUX_CPU1, 1);
    GPIO_SetupPinMux(8, GPIO_MUX_CPU1, 1);
    GPIO_SetupPinMux(9, GPIO_MUX_CPU1, 1);
    GPIO_SetupPinMux(10, GPIO_MUX_CPU1, 1);
}
void init_ADCsAndDACs(void)
{
    EALLOW;
    AdcaRegs.ADCCTL2.bit.PRESCALE = 6;
    AdcbRegs.ADCCTL2.bit.PRESCALE = 6;
    AdccRegs.ADCCTL2.bit.PRESCALE = 6;
    AdcdRegs.ADCCTL2.bit.PRESCALE = 6;
    AdcSetMode(ADC_ADCA, ADC_RESOLUTION_12BIT, ADC_SIGNALMODE_SINGLE);
    AdcSetMode(ADC_ADCB, ADC_RESOLUTION_12BIT, ADC_SIGNALMODE_SINGLE);
    AdcSetMode(ADC_ADCC, ADC_RESOLUTION_12BIT, ADC_SIGNALMODE_SINGLE);
    AdcSetMode(ADC_ADCD, ADC_RESOLUTION_12BIT, ADC_SIGNALMODE_SINGLE);
    AdcaRegs.ADCCTL1.bit.INTPULSEPOS = 1;
    AdcbRegs.ADCCTL1.bit.INTPULSEPOS = 1;
    AdccRegs.ADCCTL1.bit.INTPULSEPOS = 1;
    AdcdRegs.ADCCTL1.bit.INTPULSEPOS = 1;
    AdcaRegs.ADCCTL1.bit.ADCPWDNZ = 1;
    AdcbRegs.ADCCTL1.bit.ADCPWDNZ = 1;
    AdccRegs.ADCCTL1.bit.ADCPWDNZ = 1;
    AdcdRegs.ADCCTL1.bit.ADCPWDNZ = 1;
    DELAY_US(1000);
    AdccRegs.ADCSOC0CTL.bit.CHSEL = 2;
    AdccRegs.ADCSOC0CTL.bit.ACQPS = 99;
    AdccRegs.ADCSOC0CTL.bit.TRIGSEL = 11;
    AdccRegs.ADCSOC1CTL.bit.CHSEL = 3;
    AdccRegs.ADCSOC1CTL.bit.ACQPS = 99;
    AdccRegs.ADCSOC1CTL.bit.TRIGSEL = 11;
    AdccRegs.ADCSOC2CTL.bit.CHSEL = 4;
    AdccRegs.ADCSOC2CTL.bit.ACQPS = 99;
    AdccRegs.ADCSOC2CTL.bit.TRIGSEL = 11;
    AdccRegs.ADCSOC3CTL.bit.CHSEL = 5;
    AdccRegs.ADCSOC3CTL.bit.ACQPS = 99;
    AdccRegs.ADCSOC3CTL.bit.TRIGSEL = 11;
    AdccRegs.ADCINTSEL1N2.bit.INT1SEL = 3;
    AdccRegs.ADCINTSEL1N2.bit.INT1E = 1;
    AdccRegs.ADCINTFLGCLR.bit.ADCINT1 = 1;
    DacaRegs.DACCTL.bit.DACREFSEL = 1;
    DacaRegs.DACCTL.bit.LOADMODE = 0;
    DacaRegs.DACOUTEN.bit.DACOUTEN = 1;
    DacbRegs.DACCTL.bit.DACREFSEL = 1;
    DacbRegs.DACCTL.bit.LOADMODE = 0;
    DacbRegs.DACOUTEN.bit.DACOUTEN = 1;
    EDIS;
}
`;

/** Functions of this file a student's file may define itself. */
const REPLACEABLE = [
  "xy_control", "Matrix3x3_Invert", "Matrix3x3_Trans", "Matrix3x3_Mult", "Matrix1x3_Mult", "Matrix3x1_Mult",
  "Matrix3x2_Mult", "Matrix3x1_Add", "Matrix3x3_Add", "UpdateOptitrackStates", "readEncLeft", "readEncRight",
  "readEncWheel", "setEPWM3A_RCServo", "setEPWM3B_RCServo", "setEPWM5A_RCServo", "setEPWM5B_RCServo",
  "setEPWM6A_RCServo", "PIcontrol", "InitSE423DefaultGPIO", "readbuttons", "PostSWI1", "PostSWI2", "PostSWI3",
  "init_eQEPs", "init_EPWM1and2", "init_RCServoPWM_3AB_5AB_6A", "init_ADCsAndDACs",
];

const fr = Math.fround;

/** Steering to a point, as xy_control does it. Exported for tests. */
export function xyControl(turnThres: number, x: number, y: number, xd: number, yd: number, thetaAbs: number, radius: number, radiusNear: number): { vref: number; turn: number; near: number } {
  const theta = Math.atan2(Math.sin(thetaAbs), Math.cos(thetaAbs));
  const dx = xd - x;
  const dy = yd - y;
  const dist = Math.hypot(dx, dy);
  let err = theta - Math.atan2(dy, dx);
  if (err > Math.PI) err -= 2 * Math.PI;
  if (err < -Math.PI) err += 2 * Math.PI;
  let dir = 1;
  const near = dist < radiusNear ? 1 : 0;
  if (near) {
    if (dist < radius) dir = 0;
    else if (Math.abs(err) > Math.PI / 2) dir = -1;
    err = 0;
  }
  let vref = dir * Math.min(dist, 1);
  const turn = Math.abs(vref) > 0 ? 2 * vref * err : 2 * err;
  if (Math.abs(turn) > turnThres) vref = 0;
  // + 0 turns a negative zero into zero.
  return { vref: fr(vref) + 0, turn: fr(turn) + 0, near };
}

function install(b: Board): void {
  const c = b.compiler;
  const mem = b.mem;
  const getF = (addr: number) => bitsFloat(mem.read(addr, 2));
  const putF = (addr: number, v: number) => mem.write(addr, 2, floatBits(fr(v)));
  const cost = (line: number, statements: number) => {
    for (let i = 0; i < statements; i++) b.tick(line);
  };
  /** rows x cols floats at addr. */
  const getM = (addr: number, rows: number, cols: number): number[][] =>
    Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, k) => getF(addr + 2 * (r * cols + k))));
  const putM = (addr: number, m: number[][]) => m.forEach((row, r) => row.forEach((v, k) => putF(addr + 2 * (r * row.length + k), v)));
  const mul = (a: number[][], x: number[][]): number[][] =>
    a.map((row) => x[0].map((_, k) => row.reduce((s, v, i) => fr(s + fr(v * x[i][k])), 0)));

  // ----- MatrixMath.h -----
  const product = (name: string, ar: number, ac: number, bc: number) =>
    c.defineNative(name, (a, _t, line) => {
      const m = mul(getM(a[0], ar, ac), getM(a[1], ac, bc));
      cost(line, 2 * ar * bc);
      putM(a[2], m);
      return 0;
    });
  product("Matrix3x3_Mult", 3, 3, 3);
  product("Matrix1x3_Mult", 1, 3, 3);
  product("Matrix3x1_Mult", 3, 3, 1);
  product("Matrix3x2_Mult", 3, 2, 1);
  const sum = (name: string, cols: number) =>
    c.defineNative(name, (a, _t, line) => {
      const x = getM(a[0], 3, cols);
      const y = getM(a[1], 3, cols);
      cost(line, 3 * cols);
      putM(a[2], x.map((row, r) => row.map((v, k) => fr(fr(a[3]) * v) + fr(fr(a[4]) * y[r][k]))));
      return 0;
    });
  sum("Matrix3x1_Add", 1);
  sum("Matrix3x3_Add", 3);
  // The final project's own SPIB set-up also selects the accelerometer's 4 g range, and the project scales
  // for it. The library's setupSpib() sets the port only, so the range is selected here, for programs that
  // use the final project's board set-up.
  c.defineNative("__se423_imu", () => {
    const imu = b.plugins.get("spi_devices") as { mpuRegs?: Uint8Array } | undefined;
    if (imu?.mpuRegs) imu.mpuRegs[0x1c] = 0x08;
    return 0;
  });
  c.defineNative("Matrix3x3_Trans", (a, _t, line) => {
    const m = getM(a[0], 3, 3);
    cost(line, 9);
    putM(a[1], m.map((_, r) => m.map((row) => row[r])));
    return 0;
  });
  c.defineNative("Matrix3x3_Invert", (a, _t, line) => {
    const m = getM(a[0], 3, 3);
    cost(line, 20);
    const co = (r: number, k: number) => m[(r + 1) % 3][(k + 1) % 3] * m[(r + 2) % 3][(k + 2) % 3] - m[(r + 1) % 3][(k + 2) % 3] * m[(r + 2) % 3][(k + 1) % 3];
    const det = m[0][0] * co(0, 0) + m[0][1] * co(0, 1) + m[0][2] * co(0, 2);
    if (det === 0)
      b.warn(b.line, "matrix-singular", "Matrix3x3_Invert was given a matrix that has no inverse (its determinant is 0), so the result is not a number. Check the matrix before the call, for example a covariance that was never set.");
    // The inverse is the transposed cofactor matrix divided by the determinant.
    putM(a[1], m.map((_, r) => m.map((_row, k) => co(k, r) / det)));
    return 0;
  });

  // ----- xy.h -----
  c.defineNative("xy_control", (a, _t, line) => {
    const r = xyControl(a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9]);
    cost(line, 20);
    putF(a[0], r.vref);
    putF(a[1], r.turn);
    return r.near;
  });

  // ----- OptiTrack.h -----
  const opti = c.globals.get("Optitrackdata")!;
  c.defineNative("__optitrack", (a, _t, line) => {
    // The packet: x and y in metres, heading in degrees, the body's number, a frame count.
    const [x, y, deg] = [0, 1, 2].map((i) => getF(opti.addr + 2 * i));
    cost(line, 10);
    if (Number.isNaN(x) || x === 0 || y === 0 || deg === 0) return 0;
    let th = (deg * Math.PI) / 180;
    // The same heading, with the number of whole turns of the pose the program has.
    th += 2 * Math.PI * Math.round((a[1] - th) / (2 * Math.PI));
    // The arena's axes: x is mirrored and the origin lies 4 ft along y.
    putF(a[0], -x * 3.28083989501312);
    putF(a[0] + 2, y * 3.28083989501312 + 4);
    putF(a[0] + 4, th);
    mem.write(a[2], 1, 1);
    return 0;
  });

  // ----- SE423Lib.h -----
  const enc = (name: string, n: number, radPerCount: number) => {
    const cnt = b.dev.reg(`EQep${n}Regs.QPOSCNT`);
    c.defineNative(name, (_a, _t, line) => {
      cost(line, 3);
      return fr((mem.read(cnt.addr, 2) | 0) * radPerCount);
    });
  };
  enc("readEncLeft", 1, (-2 * Math.PI) / 40000);
  enc("readEncRight", 2, (2 * Math.PI) / 40000);
  enc("readEncWheel", 3, (2 * Math.PI) / 4000);

  for (const [name, n, ab] of [["setEPWM3A_RCServo", 3, "A"], ["setEPWM3B_RCServo", 3, "B"], ["setEPWM5A_RCServo", 5, "A"], ["setEPWM5B_RCServo", 5, "B"], ["setEPWM6A_RCServo", 6, "A"]] as const) {
    const cmp = b.dev.reg(`EPwm${n}Regs.CMP${ab}`);
    c.defineNative(name, (a, _t, line) => {
      cost(line, 3);
      const angle = Math.max(-90, Math.min(90, a[0]));
      // 8 % of the 62500-count period is the middle, 4 % either way is 90 degrees.
      const counts = Math.trunc(5000 + (angle * 2500) / 90);
      mem.write(cmp.addr, 2, (((counts & 0xffff) << 16) | (mem.read(cmp.addr, 2) & 0xffff)) >>> 0);
      return 0;
    });
  }

  // PIcontrol keeps its own memory between calls, like the static variables of the C function.
  const pi = { left: 0, right: 0, sumL: 0, sumR: 0 };
  const KP = 3;
  const KI = 15;
  const KP_TURN = 3;
  // Friction compensation: effort per ft/s and the effort that just starts a wheel, forward and backward.
  const friction = (v: number) => (v > 0 ? 1.302 * v + 1.68 : 1.29 * v - 1.56);
  c.defineNative("PIcontrol", (a, _t, line) => {
    const [vref, turn, left, right] = [a[2], a[3], a[4], a[5]];
    cost(line, 20);
    const vL = FT_PER_WHEEL_RAD * (left - pi.left) * 1000;
    const vR = FT_PER_WHEEL_RAD * (right - pi.right) * 1000;
    const steer = vR - vL + turn;
    const eL = vref - vL + KP_TURN * steer;
    const eR = vref - vR - KP_TURN * steer;
    pi.sumL += eL;
    pi.sumR += eR;
    let uL = KP * eL + KI * 0.001 * pi.sumL + friction(vL);
    let uR = KP * eR + KI * 0.001 * pi.sumR + friction(vR);
    if (Math.abs(uL) > 10) pi.sumL *= 0.99;
    if (Math.abs(uR) > 10) pi.sumR *= 0.99;
    uL = Math.max(-10, Math.min(10, uL));
    uR = Math.max(-10, Math.min(10, uR));
    pi.left = left;
    pi.right = right;
    putF(a[0], uL);
    putF(a[1], uR);
    mem.writes++;
    return 0;
  });

  for (const name of REPLACEABLE) c.fns.get(name)!.replaceable = true;
}

export const plugin: SimPlugin = {
  name: "course_final",
  // After course_ladar.ts, which defines pose and the OptiTrack variables.
  order: 2,
  prelude: PRELUDE,
  install,
};
