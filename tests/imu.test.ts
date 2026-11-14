import { describe, expect, it } from "vitest";
import { runProgram, type Stimulus } from "../src/sim/runner";
import type { SpiDevicesState } from "../src/sim/plugins/spi_devices";
import { FT_PER_WHEEL_RAD } from "../src/sim/plugins/robot_world";
import { WHEEL_BASE } from "../src/sim/plugins/plant";
import { codes } from "./helpers";
import { LiveSession } from "../src/sim/live";
import { sandboxWorld } from "../src/ui/sandbox-starters";
import { worldSetup } from "../src/ui/views/robot-arena-model";

// The MPU-9250 model (src/sim/plugins/spi_devices.ts) against the product
// specification (PS), the register map (RM) and the course's addendum (AD):
// what the sensor feels on the robot, offset and noise of a real part, the
// data rate and the filter, sleep and start-up, the offset registers, and
// the diagnostics for a transfer that does not follow the addendum.

/** One-register write, one-register read and a 16-bit read that starts one register early (AD p1, p4). */
const LIB = `
uint16_t junk;
void mpu_write(uint16_t reg, uint16_t value)
{
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = (reg << 8) | value;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    junk = SpibRegs.SPIRXBUF;
    DELAY_US(10);
}
uint16_t mpu_read(uint16_t reg)
{
    uint16_t value;
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0x8000 | (reg << 8);
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    value = SpibRegs.SPIRXBUF & 0x00FF;
    DELAY_US(10);
    return value;
}
// reg is the high byte's address
int16_t mpu_read16(uint16_t reg)
{
    int16_t value;
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0x8000 | ((reg - 1) << 8);
    SpibRegs.SPITXBUF = 0;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 2);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    junk = SpibRegs.SPIRXBUF;
    value = SpibRegs.SPIRXBUF;
    DELAY_US(10);
    return value;
}
`;
const prog = (globals: string, body: string) => `${LIB}
${globals}
void main(void)
{
    InitSysCtrl();
    InitGpio();
    setupSpib();
${body}
    while (1) {}
}
`;

const run = (source: string, durationMs: number, stimuli: Stimulus[] = []) => {
  const r = runProgram({ kit: "robot", source, durationMs, stimuli });
  expect(r.compileError, JSON.stringify(r.compileError)).toBeUndefined();
  expect(r.runtimeError, JSON.stringify(r.runtimeError)).toBeUndefined();
  return r;
};
const v = (r: ReturnType<typeof run>, name: string) => r.board.readVar(name) as number;
const imu = (r: ReturnType<typeof run>) => (r.board.plugins.get("spi_devices") as SpiDevicesState).imu;
const REAL: Stimulus = { at: 0, set: "IMU_REAL", value: 1 };

/** Mean and standard deviation of gyro Z (deg/s) and accel X (g) over n reads a millisecond apart. */
const STATS = (n: number, before = "") =>
  prog(
    `float gsum = 0, gsq = 0, asum = 0, asq = 0, gmean = 0, gsd = 0, amean = 0, asd = 0;
int16_t first = 0, last = 0;
long i = 0;`,
    `${before}
    DELAY_US(50000);
    for (i = 0; i < ${n}; i++) {
        float g = mpu_read16(0x47) * 250.0 / 32768.0;
        float a = mpu_read16(0x3B) * 2.0 / 32768.0;
        if (i == 0) first = mpu_read16(0x47);
        gsum += g; gsq += g * g; asum += a; asq += a * a;
        DELAY_US(1000);
    }
    last = mpu_read16(0x47);
    gmean = gsum / ${n}; amean = asum / ${n};
    gsd = sqrt(fabs(gsq / ${n} - gmean * gmean));
    asd = sqrt(fabs(asq / ${n} - amean * amean));`,
  );

describe("MPU-9250: what it feels on the robot", () => {
  const DRIVE = prog(
    `float gz = 0, ay = 0, ax = 0, axmax = 0;
long n = 0;`,
    `    init_EPWM1and2();
    setEPWM1A(2.0);
    setEPWM2A(-4.0);
    while (1) {
        gz = mpu_read16(0x47) * 250.0 / 32768.0;
        ay = mpu_read16(0x3D) * 2.0 / 32768.0;
        ax = mpu_read16(0x3B) * 2.0 / 32768.0;
        if (ax > axmax) axmax = ax;
        n++;
        DELAY_US(2000);
    }`,
  );
  const WORLD: Stimulus[] = [
    { at: 0, set: "ROBOT_START_X_FT", value: 5 },
    { at: 0, set: "ROBOT_START_Y_FT", value: 5 },
    { at: 0, set: "ROBOT_WORLD", value: 1 },
  ];

  it("gyro Z is the robot's turn rate, accel Y its speed times turn rate, accel X its forward acceleration", () => {
    const r = run(DRIVE, 1500, WORLD);
    expect(r.diagnostics.map((d) => d.msg)).toEqual([]);
    const b = r.board;
    const vl = b.inputs.get("LEFT_WHEEL_RADPS")! * FT_PER_WHEEL_RAD;
    const vr = b.inputs.get("RIGHT_WHEEL_RADPS")! * FT_PER_WHEEL_RAD;
    expect(vr).toBeGreaterThan(vl);
    expect(vl).toBeGreaterThan(0);
    const w = (vr - vl) / WHEEL_BASE;
    const speed = (vl + vr) / 2;
    // Turning left (counter-clockwise): positive rate about Z, pushed towards +Y (the left).
    expect(v(r, "gz")).toBeGreaterThan(5);
    expect(v(r, "gz")).toBeCloseTo((w * 180) / Math.PI, 0);
    expect(v(r, "ay")).toBeGreaterThan(0.001);
    expect(v(r, "ay")).toBeCloseTo((speed * w) / 32.174, 3);
    // At a steady speed there is no forward acceleration; while the wheels spun up there was.
    expect(Math.abs(v(r, "ax"))).toBeLessThan(0.002);
    expect(v(r, "axmax")).toBeGreaterThan(0.02);
    expect(imu(r).source).toBe("robot");
    // The three knobs the robot now moves leave the bench (it hides a knob whose signal has an output history).
    for (const name of ["IMU_GZ_DPS", "IMU_AX_G", "IMU_AY_G"]) expect(b.outputs.get(name)!.length).toBeGreaterThan(1);
    expect(b.output("IMU_GZ_DPS")).toBeCloseTo((w * 180) / Math.PI, 2);
  });

  it("feels nothing of the wheels while the robot world is off, and the knobs still work", () => {
    const r = run(DRIVE, 400, [{ at: 200, set: "IMU_GZ_DPS", value: -30 }, { at: 200, set: "IMU_AY_G", value: 0.25 }]);
    expect(r.diagnostics.map((d) => d.msg)).toEqual([]);
    expect(r.board.inputs.get("RIGHT_WHEEL_RADPS")).toBeGreaterThan(1);
    expect(v(r, "gz")).toBeCloseTo(-30, 1);
    expect(v(r, "ay")).toBeCloseTo(0.25, 3);
    expect(v(r, "axmax")).toBe(0);
    expect(imu(r).source).toBe("knobs");
    expect(r.board.outputs.get("IMU_GZ_DPS")).toBeUndefined();
  });

  it("a stimulus on a driven axis adds to the robot's motion", () => {
    const a = run(DRIVE, 600, WORLD);
    const b = run(DRIVE, 600, [...WORLD, { at: 300, set: "IMU_GZ_DPS", value: 20 }]);
    expect(v(b, "gz") - v(a, "gz")).toBeCloseTo(20, 1);
  });

  it("stands still after a crash", () => {
    // Straight at the wall 5 ft ahead.
    const r = run(DRIVE.replace("setEPWM1A(2.0)", "setEPWM1A(8.0)").replace("setEPWM2A(-4.0)", "setEPWM2A(-8.0)"), 6000, WORLD);
    expect(r.board.output("ROBOT_CRASHED")).toBe(1);
    expect(v(r, "gz")).toBe(0);
    expect(v(r, "ay")).toBe(0);
    expect(v(r, "ax")).toBe(0);
  });
});

describe("MPU-9250: a real part (IMU_REAL = 1)", () => {
  it("is exact and silent without IMU_REAL", () => {
    const r = run(STATS(300), 500, [{ at: 0, set: "IMU_GZ_DPS", value: 10 }]);
    // (Single-precision sums: the spread is zero to within their rounding.)
    expect(v(r, "gsd")).toBeLessThan(0.05);
    expect(v(r, "first")).toBe(v(r, "last"));
    expect(v(r, "first")).toBe(Math.round((10 * 32768) / 250));
    expect(v(r, "gmean")).toBeCloseTo(10, 2);
    expect(v(r, "amean")).toBe(0);
    expect(v(r, "asd")).toBe(0);
  });

  it("has an offset inside the specification's tolerance and noise of density times root bandwidth", () => {
    // Reset settings: gyro 250 Hz, accelerometer 460 Hz.
    const r = run(STATS(3000), 3400, [REAL]);
    expect(r.diagnostics).toEqual([]);
    // PS Table 1: 0.01 deg/s per root hertz. PS Table 2: 300 ug per root hertz.
    expect(v(r, "gsd")).toBeGreaterThan(0.01 * Math.sqrt(250) * 0.9);
    expect(v(r, "gsd")).toBeLessThan(0.01 * Math.sqrt(250) * 1.1);
    expect(v(r, "asd")).toBeGreaterThan(300e-6 * Math.sqrt(460) * 0.9);
    expect(v(r, "asd")).toBeLessThan(300e-6 * Math.sqrt(460) * 1.1);
    // Zero-rate offset within +-5 deg/s, zero-g offset within +-60 mg, and neither is zero.
    expect(v(r, "gmean")).toBeCloseTo(0.9, 1);
    expect(Math.abs(v(r, "gmean"))).toBeLessThan(5);
    expect(v(r, "amean")).toBeCloseTo(0.025, 2);
    expect(Math.abs(v(r, "amean"))).toBeLessThan(0.06);
  });

  it("gives the data sheet's 0.1 deg/s rms with the 92 Hz filter", () => {
    const r = run(STATS(3000, "    mpu_write(0x1A, 0x02);"), 3400, [REAL]);
    expect(v(r, "gsd")).toBeGreaterThan(0.085);
    expect(v(r, "gsd")).toBeLessThan(0.11);
  });

  it("repeats exactly from run to run", () => {
    const a = run(STATS(500), 700, [REAL]);
    const b = run(STATS(500), 700, [REAL]);
    for (const name of ["gmean", "gsd", "amean", "asd", "first", "last"]) expect(v(a, name)).toBe(v(b, name));
    expect(v(a, "first")).not.toBe(v(a, "last"));
  });

  it("takes another offset from the IMU_BIAS inputs", () => {
    const r = run(STATS(500), 700, [REAL, { at: 0, set: "IMU_BIAS_GZ_DPS", value: -3 }, { at: 0, set: "IMU_BIAS_AX_G", value: 0.05 }]);
    expect(v(r, "gmean")).toBeCloseTo(-3, 1);
    expect(v(r, "amean")).toBeCloseTo(0.05, 2);
  });
});

describe("MPU-9250: data rate and filter (RM 4.4, 4.5, 4.8)", () => {
  it("holds a sample until the next one is due: 1 kHz / (1 + SMPLRT_DIV)", () => {
    // 100 samples a second, read 1000 times a second for 200 ms: the reading changes about 20 times.
    const r = run(
      prog(
        `int16_t now = 0, before = 0;
int changes = 0, i = 0, ready = 0;`,
        `    mpu_write(0x1A, 0x01);
    mpu_write(0x19, 9);
    DELAY_US(50000);
    before = mpu_read16(0x47);
    for (i = 0; i < 200; i++) {
        DELAY_US(1000);
        now = mpu_read16(0x47);
        if (now != before) changes++;
        before = now;
        ready += mpu_read(0x3A) & 1;
    }`,
      ),
      400,
      [REAL],
    );
    expect(r.diagnostics).toEqual([]);
    expect(v(r, "changes")).toBeGreaterThanOrEqual(18);
    expect(v(r, "changes")).toBeLessThanOrEqual(23);
    // INT_STATUS says "new data" once per sample, not once per read.
    expect(v(r, "ready")).toBeGreaterThanOrEqual(19);
    expect(v(r, "ready")).toBeLessThanOrEqual(23);
    expect(imu(r).rateHz).toBe(100);
    expect(r.board.output("IMU_RATE_HZ")).toBe(100);
    expect(r.board.output("IMU_GYRO_BW_HZ")).toBe(184);
  });

  it("ignores the divider where the register map says it has no effect", () => {
    // DLPF_CFG = 0: 8 kHz internal rate, divider not used.
    const r = run(prog("", "    mpu_write(0x19, 9);"), 2);
    expect(imu(r).rateHz).toBe(8000);
    // Fchoice_b = 1: 32 kHz, 8800 Hz.
    const f = run(prog("", "    mpu_write(0x1B, 0x01);\n    mpu_write(0x1D, 0x08);"), 2);
    expect(imu(f).rateHz).toBe(32000);
    expect(imu(f).gyroBwHz).toBe(8800);
    expect(imu(f).accelBwHz).toBe(1130);
  });

  it("smooths a step with the time constant of the selected bandwidth", () => {
    // 20 Hz: 1 / (2 pi 20) = 7.96 ms. Step of 100 deg/s at 20 ms.
    const r = run(
      prog(
        "float at8 = 0, at40 = 0, before = 0, az8 = 0;",
        `    mpu_write(0x1A, 0x04);
    mpu_write(0x1D, 0x04);
    DELAY_US(19000);
    before = mpu_read16(0x47) * 250.0 / 32768.0;
    DELAY_US(8900);
    at8 = mpu_read16(0x47) * 250.0 / 32768.0;
    az8 = mpu_read16(0x3F) * 2.0 / 32768.0;
    DELAY_US(32000);
    at40 = mpu_read16(0x47) * 250.0 / 32768.0;`,
      ),
      80,
      [{ at: 20, set: "IMU_GZ_DPS", value: 100 }, { at: 20, set: "IMU_AZ_G", value: 0 }],
    );
    expect(v(r, "before")).toBe(0);
    // About 8 ms after the step: 1 - 1/e = 63 %.
    expect(v(r, "at8")).toBeGreaterThan(60);
    expect(v(r, "at8")).toBeLessThan(67);
    expect(v(r, "az8")).toBeGreaterThan(0.33);
    expect(v(r, "az8")).toBeLessThan(0.4);
    expect(v(r, "at40")).toBeGreaterThan(99);
  });

  it("passes the value unchanged at the reset settings", () => {
    const r = run(prog("float g = 0;", "    DELAY_US(5200);\n    g = mpu_read16(0x47) * 250.0 / 32768.0;"), 8, [{ at: 5, set: "IMU_GZ_DPS", value: 100 }]);
    expect(v(r, "g")).toBeCloseTo(100, 2);
  });

  it("gives all fourteen bytes of one burst from the same sample", () => {
    // A stimulus in the middle of the burst does not tear it.
    const r = run(
      prog("int16_t d[8];\nint i;", `    DELAY_US(900);
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0x8000 | 0x3A00;
    for (i = 0; i < 7; i++) SpibRegs.SPITXBUF = 0;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 8);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    for (i = 0; i < 8; i++) d[i] = SpibRegs.SPIRXBUF;`),
      3,
      [{ at: 1.06, set: "IMU_GZ_DPS", value: 100 }, { at: 1.06, set: "IMU_GX_DPS", value: 100 }],
    );
    const d = (i: number) => (r.board.mem.peek(r.board.compiler.globals.get("d")!.addr + i, 1) << 16) >> 16;
    expect(d(5)).toBe(d(7));
  });
});

describe("MPU-9250: power (RM 4.34, 4.35; PS Tables 1, 2 and 4)", () => {
  const SLEEP = prog(
    "int16_t held = 0, early = 0, late = 0;\nuint16_t pwr = 0;",
    `    DELAY_US(2000);
    mpu_write(0x6B, 0x40);
    pwr = mpu_read(0x6B);
    DELAY_US(10000);
    held = mpu_read16(0x47);
    mpu_write(0x6B, 0x01);
    DELAY_US(5000);
    early = mpu_read16(0x47);
    DELAY_US(40000);
    late = mpu_read16(0x47);`,
  );

  it("holds the last sample while asleep and needs 35 ms to start the gyro again", () => {
    const r = run(SLEEP, 80, [{ at: 1, set: "IMU_GZ_DPS", value: 50 }, { at: 5, set: "IMU_GZ_DPS", value: -50 }]);
    expect(v(r, "pwr")).toBe(0x40);
    expect(v(r, "held")).toBe(Math.round((50 * 32768) / 250));
    expect(v(r, "early")).toBe(v(r, "held"));
    expect(v(r, "late")).toBe(Math.round((-50 * 32768) / 250));
    expect(codes(r)).toEqual(["mpu-asleep", "mpu-waking"]);
    const [asleep, waking] = r.diagnostics;
    expect(asleep.msg).toMatch(/asleep.*0x6B.*SLEEP.*write 0x01/);
    expect(waking.msg).toMatch(/35 ms/);
    expect(asleep.line).toBeGreaterThan(0);
  });

  it("starts asleep when the part's PU_SLEEP_MODE bit is set (input IMU_PU_SLEEP)", () => {
    const r = run(prog("uint16_t pwr = 0, who = 0;", "    pwr = mpu_read(0x6B);\n    who = mpu_read(0x75);"), 2, [{ at: 0, set: "IMU_PU_SLEEP", value: 1 }]);
    expect(v(r, "pwr")).toBe(0x40);
    expect(v(r, "who")).toBe(0x71);
    expect(r.diagnostics).toEqual([]);
  });

  it("H_RESET restores the registers and the chip needs its start-up time", () => {
    const r = run(
      prog(
        "uint16_t lost = 0, range = 0, kept = 0;\nint16_t early = 0, late = 0;",
        `    mpu_write(0x1B, 0x18);
    mpu_write(0x6B, 0x80);
    mpu_write(0x1C, 0x10);
    DELAY_US(15000);
    lost = mpu_read(0x1C);
    range = mpu_read(0x1B);
    mpu_write(0x1C, 0x08);
    kept = mpu_read(0x1C);
    early = mpu_read16(0x3F);
    DELAY_US(40000);
    late = mpu_read16(0x3F);`,
      ),
      80,
    );
    expect(v(r, "lost")).toBe(0);
    expect(v(r, "range")).toBe(0);
    expect(v(r, "kept")).toBe(0x08);
    expect(v(r, "early")).toBe(0);
    expect(v(r, "late")).toBe(8192);
    expect(codes(r)).toEqual(["mpu-starting", "mpu-waking"]);
    expect(r.diagnostics[0].msg).toMatch(/0x1C.*reset.*11 ms.*lost.*DELAY_US\(100000\)/);
  });

  it("an axis disabled in PWR_MGMT_2 reads 0", () => {
    const r = run(prog("int16_t gz = 0, gx = 0, az = 0;", `    mpu_write(0x6C, 0x09);
    DELAY_US(1000);
    gz = mpu_read16(0x47);
    gx = mpu_read16(0x43);
    az = mpu_read16(0x3F);`), 4, [{ at: 0, set: "IMU_GZ_DPS", value: 50 }, { at: 0, set: "IMU_GX_DPS", value: 50 }]);
    expect(v(r, "gz")).toBe(0);
    expect(v(r, "az")).toBe(0);
    expect(v(r, "gx")).toBe(Math.round((50 * 32768) / 250));
    expect(codes(r)).toEqual(["mpu-axis-off"]);
  });
});

describe("MPU-9250: offset registers (RM 4.3, 4.39)", () => {
  it("subtracts the gyro offset in steps of 4 / 131 deg/s and adds the accelerometer offset in steps of 0.98 mg", () => {
    const r = run(
      prog(
        "float gz250 = 0, gz1000 = 0, ax2 = 0, ax8 = 0, ay = 0;",
        `    mpu_write(0x17, 328 >> 8);          // ZG_OFFS_USR = 328: 328 * 4 / 131 = 10.02 deg/s
    mpu_write(0x18, 328 & 0xFF);
    mpu_write(0x77, (100 << 1) >> 8);    // XA_OFFS = 100 in bits 15..1: 98 mg
    mpu_write(0x78, (100 << 1) & 0xFF);
    mpu_write(0x7A, 0xFF);               // YA_OFFS = -50: -49 mg
    mpu_write(0x7B, 0x9C);
    DELAY_US(2000);
    gz250 = mpu_read16(0x47) * 250.0 / 32768.0;
    ax2 = mpu_read16(0x3B) * 2.0 / 32768.0;
    ay = mpu_read16(0x3D) * 2.0 / 32768.0;
    mpu_write(0x1B, 0x10);
    mpu_write(0x1C, 0x10);
    DELAY_US(2000);
    gz1000 = mpu_read16(0x47) * 1000.0 / 32768.0;
    ax8 = mpu_read16(0x3B) * 8.0 / 32768.0;`,
      ),
      8,
      [{ at: 0, set: "IMU_GZ_DPS", value: 10 }],
    );
    expect(r.diagnostics).toEqual([]);
    expect(v(r, "gz250")).toBeCloseTo(10 - (328 * 4) / 131, 2);
    // The same offset in every range.
    expect(v(r, "gz1000")).toBeCloseTo(10 - (328 * 4) / 131, 1);
    expect(v(r, "ax2")).toBeCloseTo(0.098, 3);
    expect(v(r, "ax8")).toBeCloseTo(0.098, 2);
    expect(v(r, "ay")).toBeCloseTo(-0.049, 3);
  });
});

describe("MPU-9250: transfers that do not follow the addendum", () => {
  const raw = (body: string, globals = "int16_t a = 0, b2 = 0;") => prog(globals, body);

  it("a read without the read bit writes the measurement registers: mpu-read-only", () => {
    const r = run(raw(`    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0x4600;
    SpibRegs.SPITXBUF = 0x0000;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 2);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    a = SpibRegs.SPIRXBUF;
    b2 = SpibRegs.SPIRXBUF;`), 2, [{ at: 0, set: "IMU_GZ_DPS", value: 50 }]);
    expect(codes(r)).toEqual(["mpu-read-only"]);
    expect(r.diagnostics[0].msg).toMatch(/0x46.*GYRO_YOUT_L.*0x8000 \| 0x4600/);
    expect(v(r, "b2")).toBe(0);
  });

  it("the course's writes to INT_STATUS and WHO_AM_I are ignored without a word", () => {
    const r = run(raw("    mpu_write(0x3A, 0x01);\n    mpu_write(0x75, 0x71);\n    a = mpu_read(0x75);"), 2);
    expect(r.diagnostics).toEqual([]);
    expect(v(r, "a")).toBe(0x71);
  });

  it("eight clocks are no transfer: mpu-short-frame", () => {
    const r = run(raw(`    SpibRegs.SPICCR.bit.SPISWRESET = 0;
    SpibRegs.SPICCR.bit.SPICHAR = 7;
    SpibRegs.SPICCR.bit.SPISWRESET = 1;
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0xF500;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    a = SpibRegs.SPIRXBUF;`), 2);
    expect(codes(r)).toEqual(["mpu-short-frame"]);
    expect(r.diagnostics[0].msg).toMatch(/8 clock cycles.*16 or more/);
  });

  it("a chip select that never goes high turns the next command into data: mpu-cs-held", () => {
    const r = run(raw(`    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0x1B08;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    a = SpibRegs.SPIRXBUF;
    DELAY_US(1000);
    SpibRegs.SPITXBUF = 0x1C10;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    a = SpibRegs.SPIRXBUF;
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;`), 3);
    expect(codes(r)).toEqual(["mpu-cs-held"]);
    expect(r.diagnostics[0].msg).toMatch(/0x1C10 was written as data to register 0x1C and the next one/);
    const regs = (r.board.plugins.get("spi_devices") as SpiDevicesState).mpuRegs;
    // What the real chip does with it: 0x1C to register 0x1C, 0x10 to 0x1D.
    expect([regs[0x1b], regs[0x1c], regs[0x1d]]).toEqual([0x08, 0x1c, 0x10]);
  });

  it("pulling the chip select low when it is low already is reported too", () => {
    const r = run(raw(`    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0x1B08;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    a = SpibRegs.SPIRXBUF;
    DELAY_US(10);
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0x1C10;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    a = SpibRegs.SPIRXBUF;`), 3);
    expect(codes(r)).toEqual(["mpu-cs-held"]);
    expect(r.diagnostics[0].msg).toMatch(/still low from the transfer before.*register 0x1C/);
  });

  it("no pause between two transfers: mpu-cs-gap", () => {
    const r = run(raw(`    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0x1B08;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    a = SpibRegs.SPIRXBUF;
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0x1C10;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 1);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    a = SpibRegs.SPIRXBUF;`), 2);
    expect(codes(r)).toEqual(["mpu-cs-gap"]);
    expect(r.diagnostics[0].msg).toMatch(/DELAY_US\(10\)/);
  });

  it("a 16-bit read that starts on a high byte splits every value: mpu-split-value", () => {
    const r = run(raw(`    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0x8000 | 0x4700;
    SpibRegs.SPITXBUF = 0x0000;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 2);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    a = SpibRegs.SPIRXBUF;
    b2 = SpibRegs.SPIRXBUF;`), 2, [{ at: 0, set: "IMU_GZ_DPS", value: 50 }]);
    // 0x47, then 0x48 and 0x49: ends on EXT_SENS_DATA, which is no measurement of this chip.
    expect(codes(r)).toEqual([]);
    const s = run(raw(`    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0x8000 | 0x4300;
    SpibRegs.SPITXBUF = 0x0000;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 2);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    a = SpibRegs.SPIRXBUF;
    b2 = SpibRegs.SPIRXBUF;`), 2);
    expect(codes(s)).toEqual(["mpu-split-value"]);
    expect(s.diagnostics[0].msg).toMatch(/GYRO_YOUT_H.*one register earlier/);
  });

  it("a set-up that follows the addendum, then reads at the configured rate, has nothing to report", () => {
    const r = run(
      raw(
        `    // One burst for 0x19 to 0x1D (AD p2, p3), then the power register, as the course's set-up does
    GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
    SpibRegs.SPITXBUF = 0x1900 | 0x0004;
    SpibRegs.SPITXBUF = 0x0300 | 0x0008;
    SpibRegs.SPITXBUF = 0x1000 | 0x0003;
    while (SpibRegs.SPIFFRX.bit.RXFFST != 3);
    GpioDataRegs.GPCSET.bit.GPIO66 = 1;
    a = SpibRegs.SPIRXBUF;
    a = SpibRegs.SPIRXBUF;
    a = SpibRegs.SPIRXBUF;
    DELAY_US(10);
    mpu_write(0x6B, 0x01);
    DELAY_US(50000);
    a = mpu_read16(0x47);
    b2 = mpu_read16(0x3F);`,
      ),
      60,
      [{ at: 0, set: "IMU_GZ_DPS", value: 125 }],
    );
    expect(r.diagnostics).toEqual([]);
    expect(v(r, "a")).toBe(8192);
    expect(v(r, "b2")).toBe(4096);
    expect(imu(r).rateHz).toBe(200);
    expect([imu(r).gyroBwHz, imu(r).accelBwHz]).toEqual([41, 41]);
  });
});

describe("MPU-9250 in the Sandbox", () => {
  const READ = prog("int16_t gz = 0, lo = 32767, hi = -32768;", `    while (1) {
        gz = mpu_read16(0x47);
        if (gz < lo) lo = gz;
        if (gz > hi) hi = gz;
        DELAY_US(1000);
    }`);
  const live = (kit: string, source: string, ms: number) => {
    // Exactly what the Sandbox does with its level's stimuli (CodeLevelView).
    const s = new LiveSession(kit, source, worldSetup(sandboxWorld(kit as "robot")));
    const end = s.timeMs + ms;
    for (let i = 0; i < 100000 && s.timeMs < end - 1e-6 && s.running; i++) s.step(Math.min(20, end - s.timeMs), 1000);
    expect(s.error).toBeNull();
    return s;
  };

  it("is a real part on the robot board for any program: offset and noise", () => {
    const s = live("robot", READ, 500);
    expect(s.board.diagnostics.size).toBe(0);
    const [lo, hi] = [s.board.readVar("lo") as number, s.board.readVar("hi") as number];
    // 0.9 deg/s of offset is 118 counts; the noise spreads the readings around it.
    expect(lo).toBeGreaterThan(0);
    expect(hi - lo).toBeGreaterThan(40);
    expect((lo + hi) / 2 / 131).toBeGreaterThan(0.6);
    expect((lo + hi) / 2 / 131).toBeLessThan(1.2);
    // The knobs of the axes the program read are on the bench.
    expect(s.board.inputsUsed.has("IMU_GZ_DPS")).toBe(true);
    expect(s.board.outputs.get("IMU_GZ_DPS")).toBeUndefined();
  });

  it("the other boards have no such input", () => {
    expect(sandboxWorld("redboard")).toEqual([]);
    expect(sandboxWorld("launchpad")).toEqual([]);
  });
});
