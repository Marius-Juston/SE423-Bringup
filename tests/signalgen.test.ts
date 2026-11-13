import { describe, expect, it } from "vitest";
import { runProgram, type Stimulus } from "../src/sim/runner";
import { tbNoise, tbSampleAt } from "../src/sim/plugins/signalgen";

const set = (name: string, value: number): Stimulus => ({ at: 0, set: name, value });

function run(source: string, stimuli: Stimulus[] = [], durationMs = 2) {
  const r = runProgram({ kit: "robot", source, durationMs, stimuli });
  expect(r.compileError, JSON.stringify(r.compileError)).toBeUndefined();
  expect(r.runtimeError, JSON.stringify(r.runtimeError)).toBeUndefined();
  expect(r.diagnostics).toEqual([]);
  return r;
}

describe("test bench signal source", () => {
  it("defaults to a 100 Hz sine of amplitude 1 sampled at 10 kHz", () => {
    const r = run(`float x0, x1, x25, x50;
void main(void) {
  int i;
  InitSysCtrl();
  x0 = tb_sample();
  x1 = tb_sample();
  for (i = 2; i < 25; i++) tb_sample();
  x25 = tb_sample();
  for (i = 26; i < 50; i++) tb_sample();
  x50 = tb_sample();
  while (1) {}
}`);
    const v = (n: string) => r.board.readVar(n)!;
    expect(v("x0")).toBe(0);
    expect(v("x1")).toBeCloseTo(Math.sin((2 * Math.PI * 100) / 10000), 6);
    expect(v("x25")).toBeCloseTo(1, 6); // a quarter period
    expect(v("x50")).toBeCloseTo(0, 6);
    expect(r.board.output("TB_IN")).toBe(v("x50"));
  });

  it("sums two sines, an offset and repeatable noise as the inputs describe", () => {
    const shape = { f1: 50, a1: 0.5, f2: 400, a2: 0.25, noise: 0.1, dc: 1.5, fs: 1000 };
    const stim = [set("TB_F1_HZ", 50), set("TB_A1", 0.5), set("TB_F2_HZ", 400), set("TB_A2", 0.25), set("TB_NOISE", 0.1), set("TB_DC", 1.5), set("TB_FS_HZ", 1000)];
    const src = `float x3, x7, sum = 0;
void main(void) {
  int i;
  InitSysCtrl();
  for (i = 0; i < 8; i++) {
    float x = tb_sample();
    if (i == 3) x3 = x;
    if (i == 7) x7 = x;
    sum += x;
  }
  tb_output(sum);
  while (1) {}
}`;
    const r = run(src, stim);
    expect(r.board.readVar("x3")).toBe(tbSampleAt(shape, 3));
    expect(r.board.readVar("x7")).toBe(tbSampleAt(shape, 7));
    const want = 1.5 + 0.5 * Math.sin((2 * Math.PI * 50 * 3) / 1000) + 0.25 * Math.sin((2 * Math.PI * 400 * 3) / 1000) + 0.1 * tbNoise(3);
    expect(r.board.readVar("x3")).toBeCloseTo(want, 6);
    // Same program, same numbers.
    expect(run(src, stim).board.readVar("sum")).toBe(r.board.readVar("sum"));
    expect(r.board.output("TB_OUT")).toBe(r.board.readVar("sum"));
  });

  it("keeps the noise inside [-1, 1) with a mean near zero", () => {
    let sum = 0;
    for (let n = 0; n < 4000; n++) {
      const u = tbNoise(n);
      expect(u).toBeGreaterThanOrEqual(-1);
      expect(u).toBeLessThan(1);
      sum += u;
    }
    expect(Math.abs(sum / 4000)).toBeLessThan(0.05);
  });

  it("shows aliasing: 900 Hz sampled at 1 kHz gives the samples of an inverted 100 Hz sine", () => {
    for (let n = 0; n < 20; n++) expect(tbSampleAt({ f1: 900, fs: 1000 }, n)).toBeCloseTo(-tbSampleAt({ f1: 100, fs: 1000 }, n), 5);
  });

  it("publishes tb_output for signal checks", () => {
    const r = runProgram({
      kit: "robot",
      durationMs: 3,
      source: `void main(void) { InitSysCtrl(); tb_output(0.25); DELAY_US(1000); tb_output(-2.5); while (1) {} }`,
      checks: [
        { kind: "signal", name: "TB_OUT", at: 0.5, equals: 0.25, label: "first value" },
        { kind: "signal", name: "TB_OUT", equals: -2.5, label: "last value" },
      ],
    });
    for (const c of r.checks) expect(c.pass, c.detail).toBe(true);
  });

  it("tb_stream stores 12-bit readings of 1.5 V + x[n] every sample period", () => {
    const r = run(
      `uint16_t reading = 0;
uint16_t first = 0, fourth = 0;
void main(void) {
  InitSysCtrl();
  tb_stream(&reading);
  DELAY_US(150);
  first = reading;
  DELAY_US(300);
  fourth = reading;
  tb_stream(0);
  DELAY_US(1000);
  while (1) {}
}`,
      [set("TB_F1_HZ", 2500), set("TB_A1", 1)],
      3,
    );
    // fs = 10 kHz, f = 2.5 kHz: x = 0, 1, 0, -1, ...
    expect(r.board.readVar("first")).toBe(2048); // x[0] = 0 -> 1.5 V
    expect(r.board.readVar("fourth")).toBe(Math.floor((0.5 * 4096) / 3)); // x[3] = -1 -> 0.5 V
    expect(r.board.readVar("reading")).toBe(r.board.readVar("fourth")); // stopped
  });

  it("can drive an ADC input with the waveform in continuous time", () => {
    const r = run(`void main(void) { InitSysCtrl(); while (1) {} }`, [set("TB_F1_HZ", 250), set("TB_A1", 1), { at: 0, set: "TB_FEED_ADCIND13", value: 1 }], 1);
    // At 1 ms a 250 Hz sine is at its peak: 1.5 V + 1 V.
    expect(r.board.input("ADCIND13")).toBeCloseTo(2.5, 3);
    const off = run(`void main(void) { InitSysCtrl(); while (1) {} }`, [set("TB_F1_HZ", 250)], 1);
    expect(off.board.inputs.has("ADCIND13")).toBe(false); // not fed unless asked
    // Clipped to the ADC range.
    const clip = run(`void main(void) { InitSysCtrl(); while (1) {} }`, [set("TB_F1_HZ", 250), set("TB_A1", 5), { at: 0, set: "TB_FEED_ADCINB2", value: 1 }], 1);
    expect(clip.board.input("ADCINB2")).toBe(3);
  });
});
