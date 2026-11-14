import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runProgram } from "../src/sim/runner";
import { LiveSession } from "../src/sim/live";
import { LED_LETTER_PINS, ledMask } from "../src/sim/plugins/course_leds";
import { CODE_LEVELS, OWN_FILE, PROGRAMS, expectSolvesNoLevel, type Program } from "./sandbox_guard";

// The Sandbox's starting programs show what a board can do. They must never
// be the answer to a level, a lab or a homework. This file is the guard:
//   (a) each program runs on its board with no error and no diagnostics,
//   (b) it is short, plain ASCII, with lines of at most 100 characters,
//   (c) pasted into every code level of its board, it passes none of them,
//   (d) it contains none of the marks of graded work listed below.
// (c) for the programs in OWN_FILE is in sandbox_starters_<id>.test.ts.

/**
 * Marks of graded work. Each was found in an earlier starting program, or is
 * what a handout or a level has the student write. A starting program uses
 * the board's library instead, or leaves the part out.
 */
const GRADED: { what: string; pattern: RegExp }[] = [
  // Lab 6 exercise 6, levels loc-dead, cap-goto: the robot's pose from wheel speeds and a heading.
  { what: "dead reckoning (trigonometry, a pose)", pattern: /\b(cos|sin|atan2?)f?\s*\(|\bROBOTps\b|\btheta\b|\bpose\b/ },
  // Lab 5 exercises 3 and 4, levels ctl-pi, cap-speed: the PI speed controller and its steering coupling.
  { what: "a speed controller", pattern: /\bK[pid]\w*|\bPIcontrol\b|\bvref\b|\bturn\s*=|integral|\bI[Kk]_?\w*|\berr(or)?\w*\s*=/ },
  // Lab 7 exercise 1, levels loc-checkpoint, cap-goto: steering to a point, way points.
  { what: "way point following", pattern: /\bxy_control\b|robotdest|waypoint|WAYPOINT|statePos/ },
  // Lab 6 exercise 5, levels sens-steer, sens-follow, cap-wall, cap-final: wall following and stopping at an obstacle.
  { what: "wall following or an obstacle stop", pattern: /LADARrightfront|LADARfront|right_wall|front_wall|ref_right|left_turn|_ft\s*<|ahead\s*[<>]|distance_p[io]ng\s*[<>]/ },
  // Lab 3 exercise 3, levels enc-speed, cap-dist: wheel speed and distance in feet from the encoder angles.
  { what: "wheel speed or distance in feet", pattern: /1\.235|FT_PER_RAD|Wheel\w*\s*-\s*\w*Wheel|Wheel_1|_old\b|_prev\b|\bvLeft\b|\bvRight\b|LeftVel|RightVel/ },
  // Lab 3 exercises 1 and 2, HW2, HW4 exercise 3, levels of chapters 9 to 11: PWM, servo and eQEP registers.
  { what: "PWM, servo or eQEP registers written by hand", pattern: /EPwm\d+Regs|EQep\dRegs|RCServo/ },
  // HW3 exercises 3 to 5, levels of chapters 12 and 13: the SPI port and the MPU-9250.
  { what: "the SPI port or the IMU", pattern: /Spi[a-c]Regs|SPI[TR]XBUF|setupSpib|SPIB_isr|gyro|accel/i },
  // Levels bus-can-setup, bus-can-receive, bus-can-leds (the earlier program passed two of them).
  { what: "CAN set-up or its interrupt function", pattern: /Can[ab]Regs|CAN[a-z]\w*\(|InitCAN|can_isr|CANB/ },
  // Lab 4 exercises 1 and 4, HW2, levels adc-epwm, adc-isr, adc-trigger-own: a triggered ADC with its interrupt, the DAC echo.
  { what: "an ADC trigger, an ADC interrupt or the DAC", pattern: /TRIGSEL|ADCINTSEL|ADCINTFLG|ADC[A-D]1?_?(ISR|INT)|SOC[AB]EN|Dac[a-c]Regs|DACVAL/ },
  // Levels dmaf-dma, dmaf-setup-own: the DMA channel and its buffer swap.
  { what: "DMA set-up", pattern: /DmaRegs|DmaClaSrcSelRegs|DMA_/ },
  // Lab 4 exercise 2, levels dmaf-avg5, dmaf-fir: discrete filters.
  { what: "a filter", pattern: /\bfir\b|\bxk\w*|\byk\w*|\bb\[\w+\]\s*\*/i },
  // HW4 exercise 4 (move the two interrupts to PB3 and PB4), level int-xint-button (PB3 of the robot board).
  { what: "the external interrupts of HW4 or of int-xint-button", pattern: /XINT2|xint2|SetupXINT\dGpio\((6|7|159|160)\)/ },
  // Lab 2 exercises 2 and 3, HW1 exercise 8, levels in-readswitches, in-checkpoint: buttons packed by hand, buttons on LEDs.
  { what: "push buttons read or shown by hand", pattern: /returnvalue|SetLEDsOnOff|ReadSwitches|GP[A-F]DAT\.bit\.GPIO\d+\s*==/ },
  // Lab 6 exercise 3, levels int-swi, int-priorities: software interrupts.
  { what: "software interrupts", pattern: /PIEIFR|PostSWI|SWI\d|MINT\d|MG12_/ },
];

const clean = (r: ReturnType<typeof runProgram>) => {
  expect(r.compileError).toBeUndefined();
  expect(r.runtimeError).toBeUndefined();
  expect(r.diagnostics.map((d) => `${d.line}: ${d.msg}`)).toEqual([]);
  for (const c of r.checks) expect(c.pass, `${c.label}: ${c.detail}`).toBe(true);
};
const program = (id: string): Program => PROGRAMS.find((p) => p.id === id)!;
const sets = (p: Program) => (p.stimuli ?? []).flatMap((x) => ("set" in x ? [{ set: x.set, value: x.value }] : []));
/** Runs a live session (the Sandbox's way of running) for `ms` of simulated time. */
const live = (s: LiveSession, ms: number) => {
  const end = s.timeMs + ms;
  for (let i = 0; i < 100000 && s.timeMs < end - 1e-6 && s.running; i++) s.step(Math.min(20, end - s.timeMs), 1000);
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

describe("the Sandbox's starting programs", () => {
  it("are the seven of the menu, each with a file of its own for the slow level run where needed", () => {
    expect(PROGRAMS.map((p) => p.id).sort()).toEqual(["arena", "blink", "fft", "final", "homework", "ladar", "xint"]);
    for (const id of OWN_FILE) {
      expect(PROGRAMS.some((p) => p.id === id), id).toBe(true);
      expect(existsSync(`tests/sandbox_starters_${id}.test.ts`), id).toBe(true);
    }
  });

  it("never take their text from a level", () => {
    const files = ["src/ui/Sandbox.tsx", ...readdirSync("src/ui/sandbox-starters").map((f) => `src/ui/sandbox-starters/${f}`)];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(/from\s+"[^"]*levels\/(index|chapters)[^"]*"|findLevel|\.solution\b/.test(text), f).toBe(false);
    }
  });

  for (const p of PROGRAMS) {
    describe(p.id, () => {
      const lines = p.source.split("\n");

      it("is short, plain ASCII, with lines of at most 100 characters", () => {
        expect(lines.length).toBeLessThanOrEqual(160);
        for (const line of lines) {
          expect(line.length, line).toBeLessThanOrEqual(100);
          expect(/^[\x20-\x7e]*$/.test(line), line).toBe(true);
        }
      });

      for (const kit of p.kits)
        it(`runs 2 s on the ${kit} board with no error and no diagnostics, also as a live session`, () => {
          const r = runProgram({ kit, source: p.source, durationMs: 2000, stimuli: p.stimuli, checks: [] });
          clean(r);
          for (const name of p.watch) expect(r.board.compiler.globals.has(name), name).toBe(true);
          const s = new LiveSession(kit, p.source, sets(p));
          live(s, 2000);
          expect(s.error).toBeNull();
          expect(s.board.diagnostics.size).toBe(0);
        });

      it("contains no mark of graded work", () => {
        for (const g of GRADED) {
          const hit = lines.find((line) => g.pattern.test(line));
          expect(hit, `${g.what}: ${hit}`).toBeUndefined();
        }
      });

      if (!OWN_FILE.includes(p.id))
        it("passes no level when pasted into it", () => {
          const n = expectSolvesNoLevel(p);
          console.info(`${p.id}: pasted into ${n} code levels, none passes.`);
          expect(n).toBeGreaterThan(0);
        });
    });
  }

  it("the guard itself works: a level's solution is caught, and so is each mark of graded work", () => {
    const l = CODE_LEVELS.find((x) => x.id === "cap-wall")!;
    const old: Program = { id: "old arena", kits: ["robot"], source: l.solution, watch: [] };
    const only = CODE_LEVELS.filter((x) => x.id !== "cap-wall");
    // Against cap-wall alone, to keep this quick.
    CODE_LEVELS.splice(0, CODE_LEVELS.length, l);
    try {
      expect(() => expectSolvesNoLevel(old)).toThrow(/cap-wall/);
    } finally {
      CODE_LEVELS.splice(0, CODE_LEVELS.length, ...only, l);
    }
    const marks = [
      "x = x + v*cosf(heading)*0.001;", "uLeft = Kp*eLeft + Ki*IKLeft;", "xy_control(&v, &t, 1.0, 0, 0, 1, 1, 0, 0.25, 0.5);",
      "if (LADARfront < 1.0) {", "v = (LeftWheel - LeftWheel_1)*1000;", "EPwm1Regs.CMPA.bit.CMPA = 1250;", "SpibRegs.SPITXBUF = 0;",
      "CANreadMessage(CANB_BASE, 1, rxMsgData);", "AdcbRegs.ADCSOC0CTL.bit.TRIGSEL = 0x11;", "DmaRegs.CH1.CONTROL.bit.RUN = 1;",
      "yk = b[0]*xk + b[1]*xk_1;", "GPIO_SetupXINT1Gpio(6);", "if (GpioDataRegs.GPADAT.bit.GPIO4 == 0) {", "PostSWI1();",
    ];
    marks.forEach((line, i) => expect(GRADED[i].pattern.test(line), line).toBe(true));
    expect(marks.length).toBe(GRADED.length);
  });
});

describe("what the starting programs show", () => {
  it("xint: each press of PB1 is counted, shown and printed", () => {
    const p = program("xint");
    const r = runProgram({
      kit: "redboard",
      source: p.source,
      durationMs: 1500,
      stimuli: [{ at: 300, press: "PB1" }, { at: 400, release: "PB1" }, { at: 700, press: "PB1" }, { at: 800, release: "PB1" }, { at: 1000, press: "PB1" }],
      checks: [
        { kind: "var", name: "presses", equals: 3, label: "presses" },
        { kind: "isr", fn: "xint1_isr", min: 3, max: 3, label: "one interrupt per press" },
        { kind: "led", led: "BLUE", at: 350, on: true, label: "blue LED after the first press" },
        { kind: "serial", includes: "PB1 pressed 3 times\r\n", label: "print" },
      ],
    });
    clean(r);
    expect(shownDigit(r.board.gpio.level)).toBe(3);
  });

  // The homework program stays close to the course's HW starter (the owner's choice): three timers,
  // a count on the LED display every 2.5 s and a print every 2 s.
  it("homework: blinks, steps the LED display and prints two counts", () => {
    const p = program("homework");
    const r = runProgram({
      kit: "redboard",
      source: p.source,
      durationMs: 5200,
      stimuli: [{ at: 1200, type: "ab" }],
      checks: [
        { kind: "blink", led: "RED", periodMs: 20, label: "red" },
        { kind: "blink", led: "BLUE", periodMs: 80, label: "blue" },
        { kind: "serial", matches: "Num Timer2:\\d+ Num SerialRX: 2\\r\\n", label: "print" },
      ],
    });
    clean(r);
    expect(r.board.readVar("LEDdisplaynum")).toBe(2);
  });

  it("ladar: the LCD shows the distance ahead, to the right and to the left", () => {
    const p = program("ladar");
    // Room 3 is 10 ft by 10 ft and the robot stands at (4, 3) looking along +x.
    const r = runProgram({
      kit: "robot",
      source: p.source,
      durationMs: 1000,
      stimuli: p.stimuli,
      checks: [
        { kind: "lcd", line: 1, matches: "^Ahead 6\\.0\\d ft$", label: "lcd 1" },
        { kind: "lcd", line: 2, matches: "^R 3\\.0\\d L 7\\.0\\d$", label: "lcd 2" },
      ],
    });
    clean(r);
  });

  it("fft: the LCD shows the tone at the microphone", () => {
    const p = program("fft");
    const tone = (hz: number, lcd: string) =>
      clean(runProgram({ kit: "robot", source: p.source, durationMs: 600, stimuli: [{ at: 0, set: "MIC_TONE_HZ", value: hz }], checks: [{ kind: "lcd", line: 2, matches: lcd, label: `${hz} Hz` }] }));
    tone(1000, "^Freq 996 Hz$"); // bin 51 of 512 at 10 kHz
    tone(2400, "^Freq 2402 Hz$"); // bin 123
    tone(7000, "^Freq (29|30)\\d\\d Hz$"); // above half the sampling rate: it shows near 3000 Hz
  });

  it("arena: the robot drives a circle without touching anything", () => {
    const p = program("arena");
    const r = runProgram({
      kit: "robot",
      source: p.source,
      durationMs: 12000,
      stimuli: p.stimuli,
      checks: [
        { kind: "signal", name: "ROBOT_CRASHED", equals: 0, label: "no crash" },
        { kind: "signal", name: "ROBOT_ODOMETER_FT", min: 6, label: "it drives" },
        { kind: "signal", name: "ROBOT_THETA_RAD", at: 3000, min: 0.5, label: "to the left" },
        { kind: "lcd", line: 1, matches: "^Left  \\d+\\.\\d rad$", label: "lcd" },
      ],
    });
    clean(r);
  });

  it("final: the buttons drive the robot, and it stands still without one", () => {
    const p = program("final");
    const r = runProgram({
      kit: "robot",
      source: p.source,
      durationMs: 4000,
      stimuli: [...(p.stimuli ?? []), { at: 500, press: "PB1" }, { at: 2000, release: "PB1" }, { at: 2500, press: "PB2" }, { at: 3200, release: "PB2" }],
      checks: [
        { kind: "signal", name: "ROBOT_ODOMETER_FT", at: 450, equals: 0, label: "still at first" },
        { kind: "signal", name: "ROBOT_X_FT", at: 2400, min: 3.5, label: "PB1 drove it forward" },
        { kind: "signal", name: "ROBOT_THETA_RAD", min: 0.3, label: "PB2 turned it left" },
        { kind: "var", name: "leftPower", equals: 0, label: "stopped at the end" },
        { kind: "lcd", line: 2, matches: "^Ahead \\d\\.\\d\\d ft$", label: "lcd" },
        { kind: "signal", name: "ROBOT_CRASHED", equals: 0, label: "no crash" },
      ],
    });
    clean(r);
  });
});
