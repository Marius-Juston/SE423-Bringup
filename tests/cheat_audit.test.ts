import { describe, expect, it } from "vitest";
import { CHAPTERS } from "../src/levels/index";
import type { CodeLevel } from "../src/levels/types";
import { runProgram, type Check, type RunResult, type Stimulus } from "../src/sim/runner";
import type { I2cState } from "../src/sim/plugins/i2c";
import { castRay, worldOf } from "../src/sim/plugins/lidar";
import { ROBOT_RADIUS_FT } from "../src/sim/plugins/robot_world";
import { KIND_SLANT, SLANT_C, SLANT_M, TERRAINS, clearance, slantedWall, terrain } from "../src/sim/world/terrain";

// Programs that take a shortcut and used to pass a level, because nothing in
// the simulator or the runner could see the difference. Each block tests the
// capability that was added to see it, then the level: the shortcut fails,
// and fails on the check that names the mistake.

const level = (id: string): CodeLevel => {
  for (const c of CHAPTERS) for (const l of c.levels) if (l.id === id) return l as CodeLevel;
  throw new Error(`no level ${id}`);
};
const play = (l: CodeLevel, source: string): RunResult => runProgram({ kit: l.kit, source, durationMs: l.durationMs, stimuli: l.stimuli, checks: l.checks, bonus: l.bonus });
/** Replaces one piece of a reference solution; throws when the piece is not there (the level changed). */
const swap = (src: string, from: string | RegExp, to: string): string => {
  const out = src.replace(from, to);
  if (out === src) throw new Error(`nothing to replace: ${from}`);
  return out;
};
const failed = (r: RunResult): string[] => r.checks.filter((c) => !c.pass).map((c) => c.label);
const run = (source: string, durationMs: number, checks: Check[] = [], stimuli: Stimulus[] = []): RunResult => {
  const r = runProgram({ kit: "robot", source, durationMs, checks, stimuli });
  expect(r.compileError, JSON.stringify(r.compileError)).toBeUndefined();
  return r;
};

const LED1_OUT = `    InitSysCtrl();
    InitGpio();
    GPIO_SetupPinMux(22, GPIO_MUX_CPU1, 0);
    GPIO_SetupPinOptions(22, GPIO_OUTPUT, GPIO_PUSHPULL);`;

describe("output latch of a port (check kind latch)", () => {
  const prog = (write: string) => `void main(void)\n{\n${LED1_OUT}\n    ${write}\n    while (1) {}\n}\n`;
  const check: Check = { kind: "latch", port: "A", equals: 0x00400000, label: "only bit 22" };

  it("keeps a 1 written to the bit of an input pin, where no pin shows it", () => {
    const r = run(prog("GpioDataRegs.GPASET.all = 0x00400009;"), 1, [check]);
    expect(r.board.gpio.latchOf(0)).toBe(0x00400009);
    // GPIO0 and GPIO3 are inputs: nothing drives them.
    expect(r.board.gpio.level[0]).toBe(-1);
    expect(r.board.gpio.level[22]).toBe(1);
    expect(r.checks[0].pass).toBe(false);
    expect(r.checks[0].detail).toMatch(/holds 0x00400009, expected 0x00400000\. Extra 1 bits: GPIO0, GPIO3\./);
    expect(r.checks[0].detail).toMatch(/drives the pin high the moment it becomes an output/);
  });

  it("follows SET, CLEAR and TOGGLE, and can be read at a time", () => {
    const src = prog("GpioDataRegs.GPASET.all = 0x00400003;\n    DELAY_US(100);\n    GpioDataRegs.GPACLEAR.all = 0x1;\n    GpioDataRegs.GPATOGGLE.all = 0x6;");
    const r = run(src, 1, [check, { kind: "latch", port: "A", at: 0.05, equals: 0x00400003, label: "before the clear" }, { kind: "latch", port: "A", equals: 0x00400004, label: "at the end" }]);
    expect(r.checks.map((c) => c.pass)).toEqual([false, true, true]);
    expect(r.checks[0].detail).toMatch(/Extra 1 bits: GPIO2\./);
    const none = run(prog(""), 1, [check]);
    expect(none.checks[0].detail).toMatch(/Missing 1 bits: GPIO22\./);
  });

  it("reg-all-bit: writing every bit of GPASET no longer passes", () => {
    const l = level("reg-all-bit");
    expect(play(l, l.solution).passed).toBe(true);
    for (const mask of ["0xFFFFFFFF", "0x00C00000"]) {
      const r = play(l, swap(l.solution, "GpioDataRegs.GPASET.all = 1UL << 22;", `GpioDataRegs.GPASET.all = ${mask};`));
      expect(failed(r), mask).toEqual(["The write to GPASET.all has a 1 in bit 22 and in no other bit"]);
    }
    const c = play(l, swap(l.solution, "GpioDataRegs.GPCSET.bit.GPIO94 = 1;", "GpioDataRegs.GPCSET.all = 0x7FFFFFFF;\n    GpioDataRegs.GPCSET.bit.GPIO94 = 1;"));
    expect(failed(c)).toEqual(["In port C only GPIO94's bit is written"]);
    // The two usual ways to write the mask still pass.
    expect(play(l, swap(l.solution, "1UL << 22", "0x00400000")).passed).toBe(true);
  });
});

describe("SCL pulse widths measured on the pin (I2C_SCL_MIN_LOW_US, I2C_SCL_MIN_HIGH_US)", () => {
  it("measures the I2C module's clock: (ICCL + 5) and (ICCH + 5) module clock periods", () => {
    // The scan level's solution: 10 MHz module clock, I2CCLKL = 10, I2CCLKH = 5.
    const l = level("bus-i2c-scan");
    const r = play(l, l.solution);
    expect(r.board.output("I2C_SCL_MIN_LOW_US")).toBeCloseTo(1.5, 6);
    expect(r.board.output("I2C_SCL_MIN_HIGH_US")).toBeCloseTo(1.0, 6);
    expect(r.board.output("I2C_SCL_HZ")).toBe(400000);
    const bus = (r.board.plugins.get("i2c") as I2cState).bus;
    expect(bus.minLowNs).toBeCloseTo(1500, 3);
  });

  it("measures a bit-banged master, and does not count the idle bus or the STOP", () => {
    const l = level("bus-i2c-bitbang");
    const good = play(l, l.solution);
    expect(good.passed).toBe(true);
    // DELAY_US(5) plus the statements around it; far below the 2 ms the bus idles after the STOP.
    for (const name of ["I2C_SCL_MIN_LOW_US", "I2C_SCL_MIN_HIGH_US"]) {
      expect(good.board.output(name)).toBeGreaterThanOrEqual(5);
      expect(good.board.output(name)).toBeLessThan(6);
    }
    const slow = play(l, l.solution.replace(/DELAY_US\(5\)/g, "DELAY_US(20)"));
    expect(slow.passed).toBe(true);
    expect(slow.board.output("I2C_SCL_MIN_HIGH_US")).toBeGreaterThanOrEqual(20);
  });

  it("bus-i2c-bitbang: a transfer without delays, or with too short ones, no longer passes", () => {
    const l = level("bus-i2c-bitbang");
    const timing = ["Every SCL low time lasts 5 microseconds or more", "Every SCL high time lasts 5 microseconds or more"];
    const none = play(l, l.solution.replace(/^\s*DELAY_US\(\d+\);.*\n/gm, ""));
    // The sensor in the simulator still answers: only the measurement sees it.
    expect(failed(none)).toEqual(timing);
    expect(none.board.output("I2C_SCL_MIN_HIGH_US")).toBeLessThan(1);
    expect(failed(play(l, l.solution.replace(/DELAY_US\(5\)/g, "DELAY_US(4)")))).toEqual(timing);
    // Only the high time is too short.
    const high = play(l, l.solution.replace(/scl\(1\);(\s*\/\/[^\n]*)?\n(\s*)DELAY_US\(5\);/g, "scl(1);\n$2DELAY_US(2);"));
    expect(failed(high)).toEqual([timing[1]]);
  });
});

describe("bus-i2c-scan: the addresses are stored, not only printed", () => {
  it("fails a scan that prints the right lines without filling found[]", () => {
    const l = level("bus-i2c-scan");
    let c = swap(l.solution, "if (count < 8) found[count] = address;", "");
    c = swap(c, 'serial_printf(&SerialA, "0x%02X\\r\\n", found[i]);', 'serial_printf(&SerialA, "0x%02X\\r\\n", i == 0 ? 0x48 : 0x68);');
    const r = play(l, c);
    expect(r.serial[0]).toBe("0x48\r\n0x68\r\n2 devices\r\n");
    expect(failed(r)).toEqual(["found[0] holds 0x48, the first address that answered", "found[1] holds 0x68, the second address that answered"]);
  });
});

describe("a disturbed CAN bus (CAN_ERROR_FRAMES): receive error counter, EWarn and the status interrupt (TRM 22.6.3, 22.15.2.2, 22.15.2.3)", () => {
  const l = level("bus-can-leds");
  const noStatus = (src: string) => swap(src, /if \(status == CAN_INT_INT0ID_STATUS\) \{\s*status = CANgetStatus\(CANB_BASE\);\s*\} else if/, "if");
  const withNoise = (n: number, at = 70): Stimulus[] => [...(l.stimuli ?? []).filter((s) => !("set" in s && s.set === "CAN_ERROR_FRAMES")), { at, set: "CAN_ERROR_FRAMES", value: n }];
  const at = (n: number, durationMs: number, source = l.solution, t = 70) => runProgram({ kit: l.kit, source, durationMs, stimuli: withNoise(n, t) });
  const es = (r: RunResult) => r.board.dev.get("CanbRegs.CAN_ES");
  const errc = (r: RunResult) => r.board.dev.get("CanbRegs.CAN_ERRC");

  it("counts one receive error per damaged frame, and sets EWarn from 96", () => {
    // 95 damaged frames end 95 * 131 us after 70 ms. Stop before the next sensor frame (105 ms).
    const below = at(95, 100);
    expect(below.board.output("CAN_RX_ERRORS")).toBe(95);
    expect((errc(below) >> 8) & 0x7f).toBe(95);
    expect(es(below) & 0x40).toBe(0);
    expect(below.board.output("CAN_STATUS_INTS")).toBeUndefined();

    const warn = at(96, 100);
    expect((errc(warn) >> 8) & 0x7f).toBe(96);
    expect(es(warn) & 0x40).toBe(0x40);
    // The level's set-up has EIE = 1: the change of EWarn is one status interrupt, taken and cleared by the solution.
    expect(warn.board.output("CAN_STATUS_INTS")).toBe(1);
    expect(warn.board.dev.get("CanbRegs.CAN_INT")).toBe(0);
    expect(warn.diagnostics).toEqual([]);
    // Reading CAN_ES in the interrupt function set LEC back to 7 and left EWarn alone.
    expect(es(warn) & 7).toBe(7);
  });

  it("goes error passive at 128 without an interrupt of its own, and comes down by one per good frame", () => {
    const passive = at(140, 100);
    expect(errc(passive) & 0x8000).toBe(0x8000);
    expect((errc(passive) >> 8) & 0x7f).toBe(127);
    expect(es(passive) & 0x20).toBe(0x20);
    expect(passive.board.output("CAN_STATUS_INTS")).toBe(1);

    // 100 errors, then frames at 105 ms (two from sensor 1) and 130 ms (two from sensor 2), and so on.
    const later = at(100, 140);
    expect(later.board.output("CAN_RX_ERRORS")).toBe(96);
    const cleared = at(100, 240);
    expect(cleared.board.output("CAN_RX_ERRORS")).toBe(92);
    expect(es(cleared) & 0x40).toBe(0);
    // EWarn going back to 0 is a second status interrupt.
    expect(cleared.board.output("CAN_STATUS_INTS")).toBe(2);
    expect(cleared.diagnostics).toEqual([]);
  });

  it("damages a sensor frame that falls inside the burst", () => {
    // Sensor 1 sends at 105 ms. A burst from 104 ms covers it.
    const quiet = at(0, 120);
    const noisy = at(20, 120, l.solution, 104);
    expect(noisy.board.output("CAN_RX_FRAMES")).toBe((quiet.board.output("CAN_RX_FRAMES") ?? 0) - 1);
    // 20 damaged frames and the two of sensor 1 (distance and quality).
    expect(noisy.board.output("CAN_RX_ERRORS")).toBe(22);
  });

  it("raises no interrupt with EIE = 0, and counts nothing while the module is in initialization mode", () => {
    const noEie = at(100, 100, swap(l.solution, "CanbRegs.CAN_CTL.bit.EIE = 1;", "CanbRegs.CAN_CTL.bit.EIE = 0;"));
    expect(es(noEie) & 0x40).toBe(0x40);
    expect(es(noEie) & 7).toBe(6); // LEC: CRC error, nobody read the register
    expect(noEie.board.output("CAN_STATUS_INTS")).toBeUndefined();
    const init = at(100, 100, swap(l.solution, "CanbRegs.CAN_CTL.bit.Init = 0;", ""));
    expect(init.board.output("CAN_RX_ERRORS")).toBeUndefined();
  });

  it("with SIE = 1 every damaged frame is a status interrupt (LEC changed)", () => {
    const sie = at(3, 80, swap(l.solution, "CanbRegs.CAN_CTL.bit.EIE = 1;", "CanbRegs.CAN_CTL.bit.EIE = 1;\n    CanbRegs.CAN_CTL.bit.SIE = 1;"));
    // Frames at 5 and 30 ms (two each, RxOk), then three damaged ones.
    expect(sie.board.output("CAN_STATUS_INTS")).toBe(7);
    expect(sie.diagnostics).toEqual([]);
  });

  it("bus-can-leds and bus-checkpoint: an interrupt function without the status branch no longer passes", () => {
    for (const id of ["bus-can-leds", "bus-checkpoint"]) {
      const lv = level(id);
      const good = play(lv, lv.solution);
      expect(good.passed, id).toBe(true);
      expect(good.board.output("CAN_STATUS_INTS"), id).toBe(2);
      const r = play(lv, noStatus(lv.solution));
      expect(r.passed, id).toBe(false);
      expect(r.diagnostics.map((d) => d.code), id).toEqual(["can-int-stuck"]);
      expect(r.diagnostics[0].msg).toMatch(/the status interrupt was never cleared/);
      expect(failed(r).some((label) => /status interrupt/.test(label)), id).toBe(true);
    }
  });
});

describe("the slanted wall (WORLD_KIND 6)", () => {
  it("is the line y = 0.5 x - 2 and nothing else, the same every time", () => {
    const w = slantedWall();
    expect(terrain({ kind: KIND_SLANT })).toEqual(w);
    expect(slantedWall()).toEqual(w);
    expect(w.walls).toHaveLength(1);
    expect(w.goal).toBeUndefined();
    expect(clearance(w, w.start[0], w.start[1])).toBeGreaterThan(ROBOT_RADIUS_FT);
    expect(TERRAINS.some((t) => t.spec.kind === KIND_SLANT)).toBe(true);
    // Straight down from (4, 3): the wall is at y = 0.5 * 4 - 2 = 0.
    expect(castRay(w, 4, 3, -Math.PI / 2)).toBeCloseTo(3, 9);
    // Perpendicular distance from (2, 1.5).
    const d = Math.abs(SLANT_M * 2 - 1.5 + SLANT_C) / Math.hypot(SLANT_M, 1);
    expect(clearance(w, 2, 1.5)).toBeCloseTo(d, 9);
    expect(castRay(w, 2, 1.5, Math.atan(SLANT_M) - Math.PI / 2)).toBeCloseTo(d, 9);
    // Looking away from the wall there is nothing.
    expect(castRay(w, 2, 1.5, Math.PI / 2)).toBe(Infinity);
  });

  it("is the world of a run whose stimuli set WORLD_KIND to 6, from that moment", () => {
    const idle = "void main(void) { InitSysCtrl(); while (1) {} }";
    const r = run(idle, 20, [], [{ at: 10, set: "WORLD_KIND", value: KIND_SLANT }]);
    expect(worldOf(r.board).name).toBe("open space with one slanted wall");
    const before = run(idle, 5, [], [{ at: 10, set: "WORLD_KIND", value: KIND_SLANT }]);
    expect(worldOf(before.board).name).toBe("empty box");
  });

  it("sens-world: an angle without atan(), or a distance that ignores the slope, no longer passes", () => {
    const l = level("sens-world");
    const good = play(l, l.solution);
    expect(good.passed).toBe(true);
    expect(good.board.readVar("wall_m")).toBeCloseTo(0.5, 3);
    const angle = "wall_angle = atan(wall_m) - robot_theta;";
    const noAtan = play(l, swap(l.solution, angle, "wall_angle = wall_m - robot_theta;"));
    expect(failed(noAtan)).toHaveLength(1);
    expect(failed(noAtan)[0]).toMatch(/^Slanted wall: the wall is at 0\.264 rad/);
    const flat = play(l, swap(swap(l.solution, angle, "wall_angle = -robot_theta;"), "wall_dist = fabs(wall_m*robot_x - robot_y + wall_c) / sqrt(wall_m*wall_m + 1.0);", "wall_dist = fabs(wall_c - robot_y);"));
    expect(failed(flat)).toHaveLength(2);
    expect(failed(flat).every((label) => label.startsWith("Slanted wall:"))).toBe(true);
  });
});

describe("wheel slip on the test bench (TB_SLIP_LEFT, TB_SLIP_RIGHT)", () => {
  // Both wheels at the same effort: straight ahead at 0.5 ft/s once up to speed.
  const drive = `float vL = 0;
float vR = 0;
float gyro = 0;
void main(void)
{
    InitSysCtrl();
    while (1) {
        tb_set_effort(2.8, 2.8);
        vL = tb_left_speed();
        vR = tb_right_speed();
        gyro = tb_gyro_z();
        DELAY_US(1000);
    }
}
`;
  const theta = (r: RunResult, ms?: number) => r.board.output("TB_THETA_RAD", ms === undefined ? undefined : ms * 1e6)!;

  it("turns the robot about the slipping wheel while both encoders read the same speed", () => {
    const r = run(drive, 1500, [], [{ at: 1000, set: "TB_SLIP_LEFT", value: 1 }]);
    expect(theta(r, 999)).toBeCloseTo(0, 9);
    // The right wheel alone moves the robot: omega = 0.5 / 0.6 rad/s for 0.5 s.
    expect(theta(r)).toBeCloseTo((0.5 / 0.6) * 0.5, 3);
    expect(r.board.readVar("vL")).toBeCloseTo(0.5, 4);
    expect(r.board.readVar("vR")).toBeCloseTo(0.5, 4);
    // The gyro turns with the robot.
    expect(r.board.readVar("gyro")).toBeCloseTo(0.5 / 0.6, 3);
    // The robot's centre moves at half the speed.
    const x0 = r.board.output("TB_X_FT", 1000e6)!;
    const path = Math.hypot(r.board.output("TB_X_FT")! - x0, r.board.output("TB_Y_FT")!);
    expect(path).toBeGreaterThan(0.11);
    expect(path).toBeLessThan(0.125);
  });

  it("scales with the share, works for the right wheel with the other sign, and ends when set back to 0", () => {
    const half = run(drive, 1500, [], [{ at: 1000, set: "TB_SLIP_RIGHT", value: 0.5 }]);
    expect(theta(half)).toBeCloseTo((-0.25 / 0.6) * 0.5, 3);
    const stretch = run(drive, 2000, [], [{ at: 1000, set: "TB_SLIP_LEFT", value: 1 }, { at: 1200, set: "TB_SLIP_LEFT", value: 0 }]);
    expect(theta(stretch, 1200)).toBeCloseTo((0.5 / 0.6) * 0.2, 3);
    expect(theta(stretch)).toBeCloseTo(theta(stretch, 1200), 6);
    expect(stretch.board.readVar("gyro")).toBeCloseTo(0, 6);
    // Values outside 0 to 1 are held to that range; no slip leaves the run as it was.
    const over = run(drive, 1500, [], [{ at: 1000, set: "TB_SLIP_LEFT", value: 7 }]);
    expect(theta(over)).toBeCloseTo(theta(run(drive, 1500, [], [{ at: 1000, set: "TB_SLIP_LEFT", value: 1 }])), 9);
    expect(theta(run(drive, 1500))).toBeCloseTo(0, 9);
    // The same script gives the same run.
    expect(theta(run(drive, 1500, [], [{ at: 1000, set: "TB_SLIP_RIGHT", value: 0.5 }]))).toBe(theta(half));
  });

  it("loc-comp: a heading from the encoders alone no longer passes", () => {
    const l = level("loc-comp");
    const line = "theta = ALPHA * (theta + gyro * 0.001) + (1.0 - ALPHA) * theta_enc;";
    const slip = "At the end of the wheel slip (7.9 s) the heading is still within 0.06 rad";
    expect(play(l, l.solution).passed).toBe(true);
    expect(failed(play(l, swap(l.solution, line, "theta = theta_enc + 0.0 * gyro;")))).toEqual([slip]);
    expect(failed(play(l, swap(l.solution, line, "theta = 0.5 * (theta + gyro * 0.001) + 0.5 * theta_enc;")))).toEqual([slip]);
    // The gyro alone (the starter) fails on the bias, as before.
    expect(failed(play(l, l.starter))).toContain("2 s after the bias changed, the error is bounded (below 0.06 rad)");
  });
});

describe("period of an uneven waveform (check kind period)", () => {
  // LED1 on for `on` ms, off for `off` ms.
  const wave = (on: number, off: number) => `void main(void)\n{\n${LED1_OUT}\n    while (1) {\n        GpioDataRegs.GPASET.bit.GPIO22 = 1;\n        DELAY_US(${on * 1000});\n        GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;\n        DELAY_US(${off * 1000});\n    }\n}\n`;
  const period = (periodMs: number, extra: Partial<Extract<Check, { kind: "period" }>> = {}): Check => ({ kind: "period", led: "LED1", periodMs, label: "period", ...extra });

  it("measures from one switch-on to the next, whatever the duty", () => {
    const r = run(wave(3, 7), 100, [period(10), period(20), { kind: "blink", led: "LED1", periodMs: 10, label: "blink" }, { kind: "duty", led: "LED1", pct: 30, label: "duty" }, period(10, { pin: 22, led: undefined })]);
    expect(r.checks.map((c) => c.pass)).toEqual([true, false, false, true, true]);
    expect(r.checks[0].value).toBeCloseTo(10, 2);
    expect(r.checks[0].detail).toMatch(/^LED1 switches on every 10(\.\d+)? ms\.$/);
    expect(r.checks[1].detail).toMatch(/, expected every 20 ms\.$/);
    expect(r.checks[4].detail).toMatch(/^GPIO22 rises every /);
    // Twice the period with the same duty: the duty check alone cannot tell.
    const slow = run(wave(6, 14), 100, [period(10), { kind: "duty", led: "LED1", pct: 30, label: "duty" }]);
    expect(slow.checks.map((c) => c.pass)).toEqual([false, true]);
  });

  it("requires every period in the window, and says when there is nothing to measure", () => {
    const uneven = `void main(void)\n{\n${LED1_OUT}\n    while (1) {\n        GpioDataRegs.GPASET.bit.GPIO22 = 1;\n        DELAY_US(1000);\n        GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;\n        DELAY_US(4000);\n        GpioDataRegs.GPASET.bit.GPIO22 = 1;\n        DELAY_US(1000);\n        GpioDataRegs.GPACLEAR.bit.GPIO22 = 1;\n        DELAY_US(14000);\n    }\n}\n`;
    const r = run(uneven, 100, [period(10, { tolPct: 5 })]);
    expect(r.checks[0].pass).toBe(false);
    expect(r.checks[0].detail).toMatch(/^LED1 switches on at uneven intervals, from 5(\.\d+)? ms to 15(\.\d+)? ms; expected every 10 ms\.$/);

    const once = run(`void main(void)\n{\n${LED1_OUT}\n    GpioDataRegs.GPASET.bit.GPIO22 = 1;\n    while (1) {}\n}\n`, 20, [period(10)]);
    expect(once.checks[0].detail).toBe("LED1 switched on 1 time between 0 ms and 20 ms. Two are needed to measure a period.");
    const input = run("void main(void)\n{\n    InitSysCtrl();\n    InitGpio();\n    while (1) {}\n}\n", 20, [period(10)]);
    expect(input.checks[0].detail).toBe("LED1 switched on 0 times between 0 ms and 20 ms. Two are needed to measure a period. GPIO22 is not set as an output.");
  });

  it("int-soft-pwm: twice the period with the same brightness no longer passes", () => {
    const l = level("int-soft-pwm");
    expect(play(l, l.solution).passed).toBe(true);
    let c = swap(l.solution, "if (slot >= 10)", "if (slot >= 20)");
    c = swap(swap(c, "onSlots = 8;", "onSlots = 16;"), "onSlots = 3;\n    }", "onSlots = 6;\n    }");
    const r = play(l, c);
    expect(failed(r)).toEqual(["LED1 switches on once every 10 ms: one period is 10 interrupts"]);
    expect(r.checks.find((x) => !x.pass)!.detail).toBe("LED1 switches on every 20 ms, expected every 10 ms.");
  });
});

describe("what a check says when it has nothing to measure", () => {
  const blinker = `void main(void)\n{\n${LED1_OUT}\n    while (1) {\n        GpioDataRegs.GPATOGGLE.bit.GPIO22 = 1;\n        DELAY_US(1000);\n    }\n}\n`;

  it("an empty window is named as such, by duty, blink and period", () => {
    const r = run(blinker, 20, [
      { kind: "duty", led: "LED1", pct: 0, from: 5, to: 5, label: "duty, from = to" },
      { kind: "duty", led: "LED1", pct: 50, from: 30, to: 40, label: "duty, after the end" },
      { kind: "blink", led: "LED1", periodMs: 2, from: 12, to: 8, label: "blink, backwards" },
      { kind: "period", led: "LED1", periodMs: 2, from: 25, label: "period, after the end" },
      { kind: "duty", led: "LED1", pct: 50, from: 10, to: 40, label: "duty, cut off at the end of the test" },
    ]);
    expect(r.checks.map((c) => c.pass)).toEqual([false, false, false, false, true]);
    expect(r.checks[0].detail).toBe("Not measured: the time window of this check is empty (it runs from 5 ms to 5 ms, which is no time at all). This is a mistake in the level, not in your program.");
    expect(r.checks[1].detail).toMatch(/it starts at 30 ms, and the test ends at 20 ms/);
    expect(r.checks[2].detail).toMatch(/it runs from 12 ms to 8 ms/);
    expect(r.checks[3].detail).toMatch(/it starts at 25 ms, and the test ends at 20 ms/);
    expect(r.checks[4].detail).toMatch(/^LED1 was on 50\.0% of the time between 10 ms and 20 ms\.$/);
    for (const c of r.checks) expect(c.detail).not.toMatch(/NaN|undefined/);
  });

  it("duty tells a pin nothing drives from a pin held low", () => {
    const r = run("void main(void)\n{\n    InitSysCtrl();\n    InitGpio();\n    while (1) {}\n}\n", 10, [
      { kind: "duty", pin: 22, pct: 50, label: "floating" },
      { kind: "duty", led: "LED1", pct: 0, label: "an LED on an input is off" },
    ]);
    expect(r.checks[0].detail).toBe("GPIO22 had no level between 0 ms and 10 ms: nothing drove it, so it was never high, expected 50% of the time. GPIO22 is not set as an output.");
    expect(r.checks[1].pass).toBe(true);
  });

  it("signal and var: a value that came later, and NaN", () => {
    const src = `float ratio = 1.0;\nfloat zero = 0.0;\nvoid main(void)\n{\n    InitSysCtrl();\n    DELAY_US(5000);\n    ratio = zero / zero;\n    tb_report_pose(0.0, 0.0, 0.0);\n    while (1) {}\n}\n`;
    const r = run(src, 10, [
      { kind: "signal", name: "TB_EST_ERR_FT", at: 2, max: 1, label: "before the first value" },
      { kind: "signal", name: "TB_EST_ERR_FT", max: 1, label: "at the end" },
      { kind: "signal", name: "NO_SUCH_SIGNAL", max: 1, label: "never" },
      { kind: "var", name: "ratio", min: 0, max: 2, label: "NaN" },
      { kind: "var", name: "ratio", at: 2, min: 0, max: 2, label: "before it went wrong" },
    ]);
    expect(r.checks.map((c) => c.pass)).toEqual([false, true, false, false, true]);
    expect(r.checks[0].detail).toBe("TB_EST_ERR_FT had not produced a value yet at 2 ms. Its first value came later in the test.");
    expect(r.checks[2].detail).toMatch(/never produced a value during the test/);
    expect(r.checks[3].detail).toMatch(/^ratio is NaN\. NaN means "not a number"/);
  });

  it("a program that stopped with an error says when and where", () => {
    const src = `int zero = 0;\nint n = 0;\nvoid main(void)\n{\n    InitSysCtrl();\n    DELAY_US(3000);\n    n = 7;\n    n = n / zero;\n    while (1) {}\n}\n`;
    const r = runProgram({ kit: "robot", source: src, durationMs: 10, checks: [{ kind: "var", name: "n", equals: 1, label: "n" }] });
    expect(r.runtimeError).toBeDefined();
    expect(r.checks[0].detail).toMatch(/^Not checked: the program stopped with an error at 3(\.\d+)? ms, on line 8, before the test was over\.$/);

    // An interrupt function that takes longer than its period never lets main() run again. The run still
    // ends with the test, and the function is told why.
    const l = level("int-soft-pwm");
    const starved = runProgram({ kit: l.kit, source: swap(l.solution, "    slot++;", "    DELAY_US(3000);\n    slot++;"), durationMs: 40, checks: [{ kind: "isr", fn: "cpu_timer0_isr", min: 1, label: "isr" }] });
    expect(starved.runtimeError).toBeUndefined();
    expect(starved.board!.now / 1e6).toBeLessThan(44);
    expect(starved.diagnostics.map((d) => d.code)).toContain("isr-starves-main-TIMER0_INT");
  });
});
