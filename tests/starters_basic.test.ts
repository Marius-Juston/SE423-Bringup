import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runProgram, type Check } from "../src/sim/runner";
import { LiveSession } from "../src/sim/live";
import { LED_LETTER_PINS, ledMask } from "../src/sim/plugins/course_leds";

// The Sandbox's own starting programs are tested in sandbox_starters.test.ts.
// The course starter projects must run unchanged. They live outside this
// repo (TI and course copyright), so these tests are skipped when the
// checkout is not present.
const SUB = "SE423Spring26/C2000Ware_4_01_00_00/device_support/f2837xd/examples/cpu1";
const ROOT = [`./${SUB}`, `../SE-423---Class-Material/${SUB}`].find((p) => existsSync(p));
const read = (project: string, file: string) => readFileSync(`${ROOT}/${project}/cpu01/${file}`, "latin1");

const clean = (r: ReturnType<typeof runProgram>) => {
  expect(r.compileError).toBeUndefined();
  expect(r.runtimeError).toBeUndefined();
  expect(r.diagnostics).toEqual([]);
  for (const c of r.checks) expect(c.pass, `${c.label}: ${c.detail}`).toBe(true);
};

/** The digit the 15 LEDs of the red board's display show now, or -1. */
const shownDigit = (level: ArrayLike<number>): number => {
  let mask = 0;
  LED_LETTER_PINS.forEach((pin, i) => {
    if (level[pin] === 1) mask |= 1 << i;
  });
  for (let d = 0; d < 16; d++) if (ledMask(d) === mask) return d;
  return -1;
};

/** Runs a live session (the Sandbox's way of running) for `ms` of simulated time. */
const live = (s: LiveSession, ms: number) => {
  const end = s.timeMs + ms;
  for (let i = 0; i < 100000 && s.timeMs < end - 1e-6 && s.running; i++) s.step(Math.min(20, end - s.timeMs), 1000);
};

describe.skipIf(!ROOT)("XINTstarter_main.c, unchanged, on the homework red board", () => {
  it("counts presses of PB1 and PB2 through XINT1 and XINT2", () => {
    const r = runProgram({
      kit: "redboard",
      source: read("XINTstarter", "XINTstarter_main.c"),
      durationMs: 3050,
      // Each press is held across one 100 ms tick of the timer.
      stimuli: [
        { at: 450, press: "PB1" }, { at: 550, release: "PB1" },
        { at: 950, press: "PB1" }, { at: 1050, release: "PB1" },
        { at: 1450, press: "PB2" }, { at: 1550, release: "PB2" },
      ],
      checks: [
        // Timer 0 fires every 10 ms and the red LED toggles every 10th call: 200 ms period.
        { kind: "blink", led: "RED", periodMs: 200, label: "red" },
        // Timer 2 fires every 40 ms and the blue LED toggles every 15th call: 1200 ms period.
        { kind: "blink", led: "BLUE", periodMs: 1200, label: "blue" },
        { kind: "var", name: "Xint1Count", equals: 2, label: "XINT1" },
        { kind: "var", name: "Xint2Count", equals: 1, label: "XINT2" },
        { kind: "serial", includes: "NumXInt1=0,NumXInt2=0\r\n", label: "print before" },
        { kind: "serial", includes: "NumXInt1=2,NumXInt2=1\r\n", label: "print after" },
        { kind: "serial-period", periodMs: 100, label: "print period" },
      ],
    });
    clean(r);
    // 30 calls of displayLEDletter; 3 of them showed the buttons, so the count reached 27 and 26 is shown.
    expect(shownDigit(r.board.gpio.level)).toBe(26 & 0xf);
  });

  it("runs on the robot board too (its buttons are on other pins)", () => {
    clean(runProgram({ kit: "robot", source: read("XINTstarter", "XINTstarter_main.c"), durationMs: 1000, checks: [] }));
  });

  it("runs as a live session with a button press", () => {
    const s = new LiveSession("redboard", read("XINTstarter", "XINTstarter_main.c"));
    live(s, 1000);
    s.setButton("PB1", true);
    live(s, 250);
    // While PB1 is held the display shows the buttons' number, 1.
    expect(shownDigit(s.board.gpio.level)).toBe(1);
    s.setButton("PB1", false);
    live(s, 1000);
    expect(s.error).toBeNull();
    expect([...s.board.diagnostics.values()]).toEqual([]);
    expect(s.board.readVar("Xint1Count")).toBe(1);
  });
});

describe.skipIf(!ROOT)("HWstarter_main.c, unchanged, on the homework red board", () => {
  const checks: Check[] = [
    // Timer 0 fires every 10 ms and toggles the red LED: 20 ms period.
    { kind: "blink", led: "RED", periodMs: 20, label: "red" },
    // Timer 2 fires every 40 ms and toggles the blue LED: 80 ms period.
    { kind: "blink", led: "BLUE", periodMs: 80, label: "blue" },
    // Timer 2 asks for a print every 50th call: at 2 s and 4 s. Two characters were typed.
    { kind: "serial", equals: "Num Timer2:50 Num SerialRX: 0\r\nNum Timer2:100 Num SerialRX: 2\r\n", label: "prints" },
    { kind: "var", name: "numTimer0calls", min: 519, max: 520, label: "timer0 count" },
    { kind: "var", name: "LEDdisplaynum", equals: 2, label: "two digits shown" },
  ];
  it("blinks, prints every 2 s and steps the LED display every 2.5 s", () => {
    const r = runProgram({
      kit: "redboard",
      source: read("HWstarter", "HWstarter_main.c"),
      durationMs: 5200,
      stimuli: [{ at: 3000, type: "ab" }],
      checks,
    });
    clean(r);
    // displayLEDletter(0) at 2.5 s, displayLEDletter(1) at 5 s.
    expect(shownDigit(r.board.gpio.level)).toBe(1);
  });

  it("runs as a live session with a button press", () => {
    const s = new LiveSession("redboard", read("HWstarter", "HWstarter_main.c"));
    live(s, 1500);
    s.setButton("PB1", true);
    live(s, 200);
    s.setButton("PB1", false);
    live(s, 1000);
    expect(s.error).toBeNull();
    expect([...s.board.diagnostics.values()]).toEqual([]);
    expect(shownDigit(s.board.gpio.level)).toBe(0);
    expect(s.board.sci.tx[0].map((x) => String.fromCharCode(x.ch)).join("")).toBe("Num Timer2:50 Num SerialRX: 0\r\n");
  });
});

describe.skipIf(!ROOT)("LADAR_PICOMstarter_main.c, unchanged, on the robot board", () => {
  it("changes the LADAR's baud rate, reads scans and shows real distances", () => {
    const r = runProgram({
      kit: "robot",
      source: read("LADAR_PICOM_starter", "LADAR_PICOMstarter_main.c"),
      durationMs: 3000,
      // The 10 ft box, the robot 3 ft from the wall ahead and 4 ft from the wall on its right.
      stimuli: [
        { at: 0, set: "LIDAR_ROOM", value: 0 },
        { at: 0, set: "LIDAR_X_FT", value: 7 },
        { at: 0, set: "LIDAR_Y_FT", value: 4 },
        { at: 0, set: "LIDAR_THETA_RAD", value: 0 },
      ],
      checks: [
        { kind: "lcd", line: 1, matches: "^LV1:0\\.000 LV2:0\\.000$", label: "lcd 1" },
        { kind: "lcd", line: 2, matches: "^F\\d\\.\\d{4} R\\d\\.\\d{4}$", label: "lcd 2" },
        // Straight ahead (points 111 to 115): 3 ft.
        { kind: "var", name: "LADARfront", min: 2.98, max: 3.02, label: "front" },
        // Points 52 to 56 look 60.5 to 64.7 degrees to the right: nearest 4 / sin(64.7 deg) = 4.42 ft.
        { kind: "var", name: "LADARrightfront", min: 4.4, max: 4.45, label: "right front" },
        // The software interrupt of Timer 2 runs every 1 ms from 1 s on (after the first DELAY_US).
        { kind: "var", name: "timecount", min: 1990, max: 2000, label: "SWI1 count" },
        { kind: "serial", port: 2, includes: "S1152000124000\n", label: "S command" },
        { kind: "signal", name: "LIDAR_SCANS", min: 9, max: 11, label: "scans" },
        // The 34-byte packet for the Raspberry Pi leaves on SCID every 250 ms; nothing listens.
        { kind: "serial", port: 3, includes: "*$", label: "packet to the Pi" },
      ],
    });
    clean(r);
    expect(r.board.readVar("newLinuxCommands")).toBe(0);
  });

  it("runs as a live session with a button press", () => {
    const s = new LiveSession("robot", read("LADAR_PICOM_starter", "LADAR_PICOMstarter_main.c"));
    live(s, 2500);
    s.setButton("PB1", true);
    live(s, 200);
    s.setButton("PB1", false);
    live(s, 300);
    expect(s.error).toBeNull();
    expect([...s.board.diagnostics.values()]).toEqual([]);
    // The empty 10 ft box, the robot in the middle: 5 ft ahead.
    expect(s.board.lcd[1]).toMatch(/^F5\.0\d{3} R5\.\d{4}$/);
  });
});

describe("the library pieces the starters need", () => {
  it("a student's file may define the LADAR variables itself", () => {
    const r = runProgram({
      kit: "robot",
      durationMs: 10,
      source: `
typedef struct { float x; float y; float theta; } pose;
float LADARfront = 2.5;
char G_command[] = "G04472503\\n";
uint16_t G_len = 11;
pose ROBOTps = {1, 2, 3};
float seen = 0;
void main(void) { InitSysCtrl(); seen = LADARfront + ROBOTps.y + G_len; while (1) {} }
`,
      checks: [{ kind: "var", name: "seen", equals: 15.5, label: "own variables" }],
    });
    clean(r);
  });

  it("MINTn and MG12_n leave only higher priorities enabled", () => {
    const r = runProgram({
      kit: "robot",
      durationMs: 10,
      source: `
uint16_t m[6];
void main(void) {
    InitSysCtrl();
    m[0] = MINT1; m[1] = MINT12; m[2] = MINT13; m[3] = MG12_9; m[4] = MG12_11; m[5] = MINT5;
    while (1) {}
}
`,
      checks: [],
    });
    clean(r);
    const at = r.board.compiler.globals.get("m")!.addr;
    // Group n has level n; INT13 to INT16 have level 4 (above groups 5 to 12, below 1 to 3).
    expect([0, 1, 2, 3, 4, 5].map((i) => r.board.mem.peek(at + i, 1))).toEqual([0x0000, 0xf7ff, 0x0007, 0x00ff, 0x03ff, 0xf00f]);
  });

  it("displayLEDletter and setLEDLetter light the red board's display", () => {
    const r = runProgram({
      kit: "redboard",
      durationMs: 10,
      source: `
uint16_t pins[15] = {22, 94, 95, 97, 111, 130, 131, 25, 26, 27, 60, 61, 157, 158, 159};
uint16_t corners[15] = {1,0,0,0,1, 0,0,0,0,0, 1,0,0,0,7};
uint16_t i = 0;
void main(void) {
    InitSysCtrl();
    for (i = 0; i < 15; i++) {
        GPIO_SetupPinMux(pins[i], GPIO_MUX_CPU1, 0);
        GPIO_SetupPinOptions(pins[i], GPIO_OUTPUT, GPIO_PUSHPULL);
    }
    displayLEDletter(0x27);
    DELAY_US(1000);
    setLEDLetter(corners);
    while (1) {}
}
`,
      checks: [
        // 7: the top row (LED1, LED6, LED11) and the right column (LED11 to LED15).
        { kind: "led", led: "LED1", at: 0.5, on: true, label: "7 top left" },
        { kind: "led", led: "LED6", at: 0.5, on: true, label: "7 top middle" },
        { kind: "led", led: "LED2", at: 0.5, on: false, label: "7 left" },
        { kind: "led", led: "LED15", at: 0.5, on: true, label: "7 bottom right" },
        { kind: "led", led: "LED6", at: 5, on: false, label: "corners middle" },
        { kind: "led", led: "LED5", at: 5, on: true, label: "corners bottom left" },
        { kind: "led", led: "LED15", at: 5, on: true, label: "corners bottom right" },
      ],
    });
    clean(r);
    expect(ledMask(7)).toBe(0b11111_00001_00001);
    expect(ledMask(8)).toBe(0b11111_10101_11111);
  });
});
