import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runProgram, type Check } from "../src/sim/runner";
import { LiveSession } from "../src/sim/live";
import { Board } from "../src/sim/board";
import { fftRadix2 } from "../src/sim/plugins/course_fft";
import { xyControl } from "../src/sim/plugins/course_final";
import { starter as fft } from "../src/ui/sandbox-starters/fft";
import { starter as final } from "../src/ui/sandbox-starters/final";

// The course's FFT and final project starters must run unchanged. They live
// outside this repo (TI and course copyright), so those tests are skipped
// when the checkout is not present. The library they need is tested always.
const SUB = "SE423Spring26/C2000Ware_4_01_00_00/device_support/f2837xd/examples/cpu1";
const ROOT = [`./${SUB}`, `../SE-423---Class-Material/${SUB}`].find((p) => existsSync(p));
const read = (project: string) => readFileSync(`${ROOT}/${project}/cpu01/${project}_main.c`, "latin1");

const pass = (r: ReturnType<typeof runProgram>) => {
  expect(r.compileError).toBeUndefined();
  expect(r.runtimeError).toBeUndefined();
  for (const c of r.checks) expect(c.pass, `${c.label}: ${c.detail}`).toBe(true);
};
const clean = (r: ReturnType<typeof runProgram>) => {
  pass(r);
  expect(r.diagnostics).toEqual([]);
};
/** A bare program for one library function: no InitSysCtrl needed. */
const bare = (source: string, checks: Check[], durationMs = 5) => {
  Board.expectInitSysCtrl = false;
  try {
    return runProgram({ kit: "robot", source, durationMs, checks });
  } finally {
    Board.expectInitSysCtrl = true;
  }
};
/** Runs a live session (the Sandbox's way of running) for `ms` of simulated time; returns the wall time in ms. */
const live = (s: LiveSession, ms: number): number => {
  const t0 = performance.now();
  const end = s.timeMs + ms;
  for (let i = 0; i < 100000 && s.timeMs < end - 1e-6 && s.running; i++) s.step(Math.min(20, end - s.timeMs), 1000);
  return performance.now() - t0;
};
const global = (b: Board, name: string, words = 1) => b.mem.peek(b.compiler.globals.get(name)!.addr, words);
const float = (bits: number) => new Float32Array(new Uint32Array([bits]).buffer)[0];

describe("RFFT_f32 and friends (TI FPU DSP library)", () => {
  it("fftRadix2 finds a sine and a cosine in their bins", () => {
    const n = 64;
    const re = Float64Array.from({ length: n }, (_, i) => 1 + 3 * Math.cos((2 * Math.PI * 5 * i) / n) + 2 * Math.sin((2 * Math.PI * 9 * i) / n));
    const im = new Float64Array(n);
    fftRadix2(re, im);
    expect(re[0]).toBeCloseTo(n, 9); // the mean, times N
    expect(re[5]).toBeCloseTo((3 * n) / 2, 9); // a cosine is real
    expect(im[5]).toBeCloseTo(0, 9);
    expect(re[9]).toBeCloseTo(0, 9); // a sine is minus imaginary
    expect(im[9]).toBeCloseTo(-n, 9);
    expect(Math.hypot(re[7], im[7])).toBeCloseTo(0, 9);
  });

  const PROGRAM = `
#define N 256
float in[N]; float out[N]; float mag[N/2+1]; float phase[N/2+1]; float coef[N];
RFFT_F32_STRUCT rfft;
float dc, m20, m21, m40, re40, im40, im20, ph20, keep;
int16_t peak = 0;
void main(void) {
    int16_t i;
    float best = 0;
    for (i = 0; i < N; i++) in[i] = 0.5 + 2*sin(2*3.14159265358979*20*i/N) + cos(2*3.14159265358979*40*i/N);
    rfft.FFTSize = N; rfft.FFTStages = 8;
    rfft.InBuf = in; rfft.OutBuf = out; rfft.MagBuf = mag; rfft.PhaseBuf = phase; rfft.CosSinBuf = coef;
    TABLE
    RFFT_f32(&rfft);
    RFFT_f32_mag(&rfft);
    RFFT_f32_phase(&rfft);
    for (i = 1; i < N/2; i++) if (mag[i] > best) { best = mag[i]; peak = i; }
    dc = mag[0]; m20 = mag[20]; m21 = mag[21]; m40 = mag[40];
    re40 = out[40]; im40 = out[N-40]; im20 = out[N-20]; ph20 = phase[20]; keep = in[3];
    while (1) {}
}`;
  it("gives the documented layout, magnitudes and phase for a known signal", () => {
    const near = (name: string, v: number, tol = 0.01): Check => ({ kind: "var", name, min: v - tol, max: v + tol, label: name });
    const r = bare(PROGRAM.replace("TABLE", "RFFT_f32_sincostable(&rfft);"), [
      { kind: "var", name: "peak", equals: 20, label: "peak bin" },
      near("dc", 0.5 * 256), // N times the mean
      near("m20", 2 * 128), // amplitude times N / 2
      near("m21", 0),
      near("m40", 128),
      near("re40", 128), // the cosine: real part of bin 40 in OutBuf[40]
      near("im40", 0),
      near("im20", -256), // the sine: imaginary part of bin 20 in OutBuf[N - 20]
      near("ph20", -Math.PI / 2, 0.001),
      near("keep", 0.5 + 2 * Math.sin((2 * Math.PI * 20 * 3) / 256) + Math.cos((2 * Math.PI * 40 * 3) / 256), 0.001), // InBuf is untouched
    ]);
    clean(r);
    // The transform takes simulated time: 128 butterflies in each of 8 stages, 5 cycles each.
    expect(r.endMs).toBeGreaterThan(0);
  });
  it("says so when the table was never made, and stops on a size that is not 2 to the stages", () => {
    const r = bare(PROGRAM.replace("TABLE", ""), []);
    expect(r.runtimeError).toBeUndefined();
    expect(r.diagnostics.map((d) => d.code)).toEqual(["fft-no-table"]);
    const bad = bare(PROGRAM.replace("TABLE", "RFFT_f32_sincostable(&rfft);").replace("rfft.FFTStages = 8;", "rfft.FFTStages = 7;"), []);
    expect(bad.runtimeError?.msg).toMatch(/FFTSize is 256 but FFTStages is 7/);
  });
});

describe("the final project's library (xy.h, MatrixMath.h, OptiTrack.h, SE423Lib.h)", () => {
  it("xyControl steers to a point", () => {
    // Straight ahead and far: full speed, no turn.
    expect(xyControl(1, 0, 0, 5, 0, 0, 0.25, 0.5)).toEqual({ vref: 1, turn: 0, near: 0 });
    // The point is to the left (heading error -pi/2): turn left hard, so stop and spin.
    const left = xyControl(1, 0, 0, 0, 5, 0, 0.25, 0.5);
    expect(left.turn).toBeCloseTo(-Math.PI, 5);
    expect(left.vref).toBe(0);
    // Close: slower, and "near" inside the outer radius; stopped inside the inner one.
    expect(xyControl(1, 0, 0, 0.4, 0, 0, 0.25, 0.5)).toEqual({ vref: Math.fround(0.4), turn: 0, near: 1 });
    expect(xyControl(1, 0, 0, 0.1, 0, 0, 0.25, 0.5)).toEqual({ vref: 0, turn: 0, near: 1 });
    // Overshot (the point is behind, inside the outer radius): back up without turning.
    expect(xyControl(1, 0, 0, -0.4, 0, 0, 0.25, 0.5)).toEqual({ vref: Math.fround(-0.4), turn: 0, near: 1 });
    // A heading of many turns is the same heading.
    expect(xyControl(1, 0, 0, 5, 0, 4 * Math.PI, 0.25, 0.5).turn).toBeCloseTo(0, 5);
  });

  it("matrices, xy_control, a struct returned by UpdateOptitrackStates, buttons and encoders in C", () => {
    const r = bare(
      `
float A[3][3] = {{2,0,1},{1,3,0},{0,1,4}};
float Ainv[3][3]; float P[3][3]; float T[3][3]; float S[3][3];
float B[3][2] = {{1,2},{3,4},{5,6}}; float u[2][1] = {{10},{1}}; float Bu[3][1]; float x[3][1] = {{1},{1},{1}};
float p00, p01, p11, p22, t01, s00, bu2, x2, vref, turn, ox, oy, oth, enc;
int16_t near, flag = 0, flag0 = 5;
uint16_t buttons;
pose robot = {1, 2, 6.5};
pose opti;
void main(void) {
    Matrix3x3_Invert(A, Ainv);
    Matrix3x3_Mult(A, Ainv, P);
    Matrix3x3_Trans(A, T);
    Matrix3x3_Add(A, T, S, 1.0, -0.5);
    Matrix3x2_Mult(B, u, Bu);
    Matrix3x1_Add(x, Bu, x, 1.0, 2.0);
    p00 = P[0][0]; p01 = P[0][1]; p11 = P[1][1]; p22 = P[2][2]; t01 = T[0][1]; s00 = S[0][0];
    bu2 = Bu[2][0]; x2 = x[2][0];
    near = xy_control(&vref, &turn, 1.0, 0, 0, 0.4, 0, 0, 0.25, 0.5);
    opti = UpdateOptitrackStates(robot, &flag0);      /* no packet yet: the flag stays */
    Optitrackdata[0] = 1.0; Optitrackdata[1] = 2.0; Optitrackdata[2] = 10.0;
    opti = UpdateOptitrackStates(robot, &flag);
    ox = opti.x; oy = opti.y; oth = opti.theta;
    InitSE423DefaultGPIO();
    buttons = readbuttons();
    init_eQEPs();
    enc = readEncLeft() + readEncRight() + readEncWheel();
    while (1) {}
}`,
      [
        { kind: "var", name: "p00", min: 0.9999, max: 1.0001, label: "A * inverse, 0 0" },
        { kind: "var", name: "p01", min: -0.0001, max: 0.0001, label: "A * inverse, 0 1" },
        { kind: "var", name: "p11", min: 0.9999, max: 1.0001, label: "A * inverse, 1 1" },
        { kind: "var", name: "p22", min: 0.9999, max: 1.0001, label: "A * inverse, 2 2" },
        { kind: "var", name: "t01", equals: 1, label: "transpose" },
        { kind: "var", name: "s00", equals: 1, label: "A - T / 2" },
        { kind: "var", name: "bu2", equals: 56, label: "3 x 2 product" },
        { kind: "var", name: "x2", equals: 113, label: "3 x 1 sum" },
        { kind: "var", name: "near", equals: 1, label: "xy_control near" },
        { kind: "var", name: "vref", min: 0.3999, max: 0.4001, label: "xy_control vref" },
        { kind: "var", name: "flag0", equals: 5, label: "no packet, no flag" },
        { kind: "var", name: "flag", equals: 1, label: "packet flag" },
        { kind: "var", name: "ox", min: -3.2809, max: -3.2807, label: "OptiTrack x in feet, mirrored" },
        { kind: "var", name: "oy", min: 10.561, max: 10.563, label: "OptiTrack y in feet, plus 4" },
        // 10 degrees, brought to the turn the robot's own 6.5 rad is in.
        { kind: "var", name: "oth", min: 6.457, max: 6.459, label: "OptiTrack heading" },
        { kind: "var", name: "buttons", equals: 0, label: "no button held" },
        { kind: "var", name: "enc", equals: 0, label: "encoders at rest" },
      ],
    );
    clean(r);
  });

  it("a student's file may still define these functions itself, and still may not pass whole structs", () => {
    const own = bare(`float readEncLeft(void) { return 7; }\nfloat v;\nvoid main(void) { v = readEncLeft(); while (1) {} }`, [{ kind: "var", name: "v", equals: 7, label: "own readEncLeft" }]);
    clean(own);
    const st = bare(`pose f(void) { pose p; p.x = 0; return p; }\nvoid main(void) { while (1) {} }`, []);
    expect(st.compileError?.msg).toMatch(/returns a whole struct/);
  });
});

describe.skipIf(!ROOT)("fftDMAstarter_main.c, unchanged, on the robot board", () => {
  const run = (hz: number) =>
    runProgram({
      kit: "robot",
      source: read("fftDMAstarter"),
      durationMs: 1000,
      stimuli: [{ at: 0, set: "MIC_TONE_HZ", value: hz }],
      checks: [
        // 1024 samples at 10 kHz: a DMA interrupt every 102.4 ms.
        { kind: "var", name: "DMAcount", equals: 10, label: "DMA interrupts" },
        // Timer 0 every 10 ms toggles the red LED every 5th call, timer 2 every 40 ms the blue one.
        { kind: "blink", led: "RED", periodMs: 100, label: "red" },
        { kind: "blink", led: "BLUE", periodMs: 80, label: "blue" },
      ],
    });
  // The starter toggles GPIO52 in DMA_ISR without ever making it an output: that warning is deserved.
  const deserved = (r: ReturnType<typeof runProgram>) => expect(r.diagnostics.map((d) => d.code)).toEqual(["gpio-not-output-52"]);

  it("shows the bin of a 2400 Hz tone at the microphone", () => {
    const r = run(2400);
    pass(r);
    deserved(r);
    // 2400 Hz * 1024 / 10000 = bin 245.8; the nearest bin, 246, is 2402 Hz.
    expect(r.lcd[1]).toBe("Freq 2402");
    expect(r.lcd[0]).toMatch(/^Max Pwr 4\d\d\.\d{3}$/); // 1 V amplitude: close to 1024 / 2
    expect(global(r.board, "maxpwrindex")).toBe(246);
  });
  it("aliases a 7000 Hz tone to 3000 Hz, as sampling at 10 kHz does", () => {
    const r = run(7000);
    pass(r);
    expect(r.lcd[1]).toBe("Freq 2998");
  });
  it("runs in a live session with the knob's 1000 Hz tone", () => {
    const s = new LiveSession("robot", read("fftDMAstarter"));
    live(s, 1500);
    expect(s.error).toBeNull();
    expect(s.board.lcd[1]).toBe("Freq 996");
  });
});

describe.skipIf(!ROOT)("FinalProjectwithCANAprilStarter_main.c, unchanged, on the robot board", () => {
  it("calibrates, reads its sensors and drives the robot", () => {
    const r = runProgram({
      kit: "robot",
      source: read("FinalProjectwithCANAprilStarter"),
      durationMs: 12000,
      stimuli: [
        { at: 0, set: "ROBOT_WORLD", value: 1 },
        { at: 0, set: "CAN_DIST1_MM", value: 800 },
        { at: 0, set: "CAN_DIST2_MM", value: 1200 },
      ],
      checks: [
        // Two 1 s delays, then EPWM4 -> ADCC -> SPIB -> SWI1 every millisecond.
        { kind: "var", name: "numADCCcalls", min: 10900, max: 11000, label: "ADCC interrupts" },
        { kind: "var", name: "timecount", min: 10900, max: 11000, label: "SWI1 calls" },
        // Three calibration phases of 2000 calls each are over after 8 s.
        { kind: "var", name: "calibration_state", equals: 3, label: "calibration" },
        { kind: "var", name: "doneCal", equals: 1, label: "doneCal" },
        { kind: "var", name: "dis_1", equals: 800, label: "CAN sensor 1" },
        { kind: "var", name: "dis_2", equals: 1200, label: "CAN sensor 2" },
        { kind: "var", name: "rxMsgCount_1", min: 100, max: 120, label: "CAN messages" },
        // The IMU lies flat and still; the library's setupSpib leaves it at 2 g (see course_final.ts).
        { kind: "var", name: "accelz", min: -0.01, max: 0.01, label: "accelz after its offset" },
        { kind: "lcd", line: 1, matches: "^Vrf:\\d\\.\\d\\d trn:-?\\d\\.\\d\\d$", label: "lcd 1" },
        { kind: "lcd", line: 2, matches: "^F\\d+\\.\\d{4} R\\d+\\.\\d{4}$", label: "lcd 2" },
        // A scan every 100 ms once SCIC is at the LADAR's rate.
        { kind: "signal", name: "LIDAR_SCANS", min: 95, max: 101, label: "LADAR scans" },
        // The blue LED blinks during calibration only; the red one every 200 calls, all the time.
        { kind: "blink", led: "RED", periodMs: 400, from: 3000, to: 12000, label: "red" },
        { kind: "blink", led: "BLUE", periodMs: 400, from: 3000, to: 7900, label: "blue while calibrating" },
      ],
    });
    clean(r);
    const b = r.board;
    // The LADAR saw the room: 5 ft to the wall ahead at the start, less after driving towards it.
    expect(float(global(b, "LADARfront", 2))).toBeLessThan(4);
    // After calibration it drives to its first waypoint (-4, 10): it turns left and moves.
    const [x, y] = [b.output("ROBOT_X_FT")!, b.output("ROBOT_Y_FT")!];
    expect(Math.hypot(x - 5, y - 5)).toBeGreaterThan(2);
    expect(b.output("ROBOT_CRASHED")).toBe(0);
    // Its own pose estimate (encoders and the gyro, which turns with the robot) agrees with the world.
    const pose = [0, 1, 2].map((i) => float(b.mem.peek(b.compiler.globals.get("ROBOTps")!.addr + 2 * i, 2)));
    expect(Math.hypot(pose[0] - (x - 5), pose[1] - (y - 5))).toBeLessThan(0.5);
    expect(Math.abs(pose[2] - b.output("ROBOT_THETA_RAD")!)).toBeLessThan(0.15);
  });

  it("keeps up with real time in a live session", () => {
    const s = new LiveSession("robot", read("FinalProjectwithCANAprilStarter"), [{ set: "ROBOT_WORLD", value: 1 }]);
    const wall = live(s, 4000);
    expect(s.error).toBeNull();
    expect(s.board.diagnostics.size).toBe(0);
    expect(s.board.lcd[0]).toMatch(/^Vrf:/);
    // 4 s of simulated time must take clearly less than 4 s (it takes about 1 s).
    expect(wall).toBeLessThan(3000);
    expect(s.load).toBe(1);
  });
});

describe("the Sandbox's own FFT and final project starting programs", () => {
  for (const st of [fft, final])
    it(`${st.id}: plain ASCII, short lines, runs a second with no error and no diagnostics`, () => {
      expect(st.kit).toBe("robot");
      for (const line of st.source.split("\n")) {
        expect(line.length, line).toBeLessThanOrEqual(100);
        expect(/^[\x20-\x7e]*$/.test(line), line).toBe(true);
      }
      clean(runProgram({ kit: "robot", source: st.source, durationMs: 1000, checks: st.watch.map((name): Check => ({ kind: "var", name, min: -1e9, max: 1e9, label: name })) }));
    });

  it("fft: the LCD shows the tone at the microphone", () => {
    const r = runProgram({ kit: "robot", source: fft.source, durationMs: 600, stimuli: [{ at: 0, set: "MIC_TONE_HZ", value: 440 }], checks: [{ kind: "lcd", line: 2, matches: "^Freq 439 Hz$", label: "lcd" }] });
    clean(r);
    const s = new LiveSession("robot", fft.source);
    live(s, 600);
    expect(s.error).toBeNull();
    expect(s.board.lcd[1]).toBe("Freq 996 Hz"); // the knob starts at 1000 Hz: bin 102
  });

  it("final: drives the square of waypoints and waits while something is in its way", () => {
    const r = runProgram({
      kit: "robot",
      source: final.source,
      durationMs: 22000,
      stimuli: [...final.stimuli, { at: 21000, set: "CAN_DIST1_MM", value: 100 }],
      checks: [
        { kind: "var", name: "doneCal", equals: 1, at: 1100, label: "calibrated after a second" },
        { kind: "var", name: "statePos", equals: 1, at: 9000, label: "first corner reached" },
        { kind: "var", name: "statePos", equals: 0, at: 20900, label: "once around" },
        { kind: "var", name: "dis_1", equals: 100, label: "CAN distance" },
        { kind: "var", name: "vref", equals: 0, label: "waits" },
        { kind: "signal", name: "ROBOT_CRASHED", equals: 0, label: "no crash" },
        { kind: "lcd", line: 1, matches: "^Vrf:0.00 trn:0.00$", label: "lcd" },
      ],
    });
    clean(r);
    const s = new LiveSession("robot", final.source, (final.stimuli ?? []).flatMap((x) => ("set" in x ? [{ set: x.set, value: x.value }] : [])));
    const wall = live(s, 3000);
    expect(s.error).toBeNull();
    expect(s.board.diagnostics.size).toBe(0);
    expect(wall).toBeLessThan(2500);
  });
});
