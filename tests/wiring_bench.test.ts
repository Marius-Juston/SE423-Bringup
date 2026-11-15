import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { Board } from "../src/sim/board";
import { KITS } from "../src/sim/world/kits";
import { pinsFor } from "../src/sim/device/pinmux";
import { HEADER_PINS, HW_BOARD, headerPin, targetWords } from "../src/sim/wiring/board";
import { benchLink } from "../src/sim/wiring/active";
import { attachBench, type BenchEngine } from "../src/sim/plugins/bench_wiring";
import {
  PART_DEFS, addDevice, checkBench, connect, describeBench, emptyBench, faultCount, instances, optionsOf, parseBench, pinChoices, removeDevice, serializeBench, setInput,
  setOption, statusOf, wiringCsv, wiringTable,
} from "../src/sim/wiring/bench";
import { dividerVolts, photoOhms } from "../src/sim/wiring/parts/photoresistor";
import type { BenchState } from "../src/sim/wiring/types";

// These tests run bare programs, without the InitSysCtrl() every real program starts with.
Board.expectInitSysCtrl = false;

const MS = 1e6;

/** Runs a program on the homework board with a bench, for `ms` of simulated time. */
function bench(source: string, ms: number, state: BenchState = emptyBench(), during?: (e: BenchEngine, b: Board) => void) {
  const b = new Board("redboard");
  let st = state;
  const e = attachBench(b, () => st);
  b.load(source);
  const gen = b.run();
  if (during) {
    b.runUntil(gen, (ms * MS) / 2);
    during(e, b);
  }
  // In slices, as a live run does: a loop that was waiting looks again after a slice ends.
  for (let k = 1; k <= 4; k++) b.runUntil(gen, (ms * MS * (4 + k)) / 8);
  const codes = () => [...b.diagnostics.values()].map((d) => d.code);
  const status = (id: string) => statusOf(e.inst(id)!, e);
  return { b, e, get codes() { return codes(); }, status, set: (s: BenchState) => ((st = s), e.sync()), msgs: () => [...b.diagnostics.values()].map((d) => d.msg) };
}

const out = (pin: number, body = "") => `void main(void) {
  GPIO_SetupPinMux(${pin}, GPIO_MUX_CPU1, 0);
  GPIO_SetupPinOptions(${pin}, GPIO_OUTPUT, GPIO_PUSHPULL);
  ${body}
  while (1) {}
}`;
const setPin = (pin: number) => `GpioDataRegs.GP${"ABCDEF"[pin >> 5]}SET.bit.GPIO${pin} = 1;`;

/** A square wave on a pin made by hand: `highUs` high out of every `periodUs`. */
const pulses = (pin: number, highUs: number, periodUs: number) => `void main(void) {
  GPIO_SetupPinMux(${pin}, GPIO_MUX_CPU1, 0);
  GPIO_SetupPinOptions(${pin}, GPIO_OUTPUT, GPIO_PUSHPULL);
  while (1) {
    GpioDataRegs.GP${"ABCDEF"[pin >> 5]}SET.bit.GPIO${pin} = 1;
    DELAY_US(${highUs});
    GpioDataRegs.GP${"ABCDEF"[pin >> 5]}CLEAR.bit.GPIO${pin} = 1;
    DELAY_US(${periodUs - highUs});
  }
}`;

describe("the compiled board", () => {
  it("is small and has the board's parts where the kit says they are", () => {
    const bytes = readFileSync("src/sim/world/boards/hw-board.json").length;
    expect(bytes).toBeLessThan(150_000);
    expect(HW_BOARD.w).toBeCloseTo(154.94);
    expect(HW_BOARD.h).toBeCloseTo(198.12);
    const kit = KITS.redboard.parts;
    for (const p of kit) {
      if (p.kind !== "led" && p.kind !== "button") continue;
      if (p.id === "BLUE" || p.id === "RED") continue;
      const own = HW_BOARD.parts.find((x) => x.id === p.id);
      expect(own, p.id).toBeDefined();
      expect(own!.pin, p.id).toBe(p.pin);
    }
  });

  it("keeps every part and pad inside the board, with a net that exists", () => {
    for (const [x, y, net, group] of HW_BOARD.holes) {
      expect(x >= 0 && x <= HW_BOARD.w && y >= 0 && y <= HW_BOARD.h).toBe(true);
      expect(HW_BOARD.nets[net]).toBeDefined();
      expect(HW_BOARD.groups[group]).toBeDefined();
    }
    for (const p of HW_BOARD.parts) {
      const [x, y, w, h] = p.box;
      expect(x >= 0 && y >= 0 && x + w <= HW_BOARD.w + 0.01 && y + h <= HW_BOARD.h + 0.01, p.id).toBe(true);
      expect(w > 0 && h > 0, p.id).toBe(true);
    }
    expect(new Set(HW_BOARD.parts.map((p) => p.id)).size).toBe(HW_BOARD.parts.length);
  });

  it("joins the pads of one strip and keeps different pins apart", () => {
    const byGroup = new Map<number, Set<number>>();
    for (const [, , net, group] of HW_BOARD.holes) byGroup.set(group, (byGroup.get(group) ?? new Set()).add(net));
    HW_BOARD.groups.forEach((g, i) => {
      if (/^STRIP(5|10)$/.test(g.kind)) expect(byGroup.get(i)!.size, g.id).toBe(1);
    });
    // Each chip pin is one net, and the LaunchPad's 80 pins are all there.
    expect(new Set(HW_BOARD.nets).size).toBe(HW_BOARD.nets.length);
    expect(HW_BOARD.launchpad.pins).toHaveLength(80);
  });

  it("names the LaunchPad's headers as the pin mux table does", () => {
    expect(headerPin("GPIO0")).toMatchObject({ number: 40, header: "J4.10" });
    expect(headerPin("ADCINA4")).toMatchObject({ number: 69, header: "J7.9" });
    expect(targetWords("GPIO22")).toBe("GPIO22 (pin 8, J1.8)");
    // The ePWM outputs offered for a pin are the table's.
    for (const p of HEADER_PINS) for (const s of p.pwm) expect(pinsFor(s).some((x) => `GPIO${x.pin}` === p.target), `${p.target} ${s}`).toBe(true);
    expect(headerPin("GPIO14")!.pwm).toContain("EPWM8A");
  });

  it("holds no copy of the board file's internals", () => {
    const text = readFileSync("src/sim/world/boards/hw-board.json", "utf8");
    expect(text).not.toMatch(/<|eagle|N\$\d|\.sch|\.brd/i);
  });
});

describe("the bench with nothing changed", () => {
  it("starts fully built, with no fault, nothing attached and no message", () => {
    const s = emptyBench();
    expect(s.added).toEqual([]);
    expect(faultCount(s)).toBe(0);
    expect(checkBench(s)).toEqual([]);
    for (const i of instances(s)) for (const o of optionsOf(i)) expect(i.opts[o.id], `${i.id} ${o.id}`).toBe(o.choices[0].id);
    expect(instances(s).map((i) => i.id)).toEqual(HW_BOARD.parts.map((p) => p.id));
  });

  it("lights an LED through its inverter when the pin is high", () => {
    const pin = HW_BOARD.parts.find((p) => p.id === "LED7")!.pin!;
    const r = bench(out(pin, setPin(pin)), 1);
    expect(r.status("LED7")).toMatchObject({ text: "on", level: 1 });
    expect(r.status("LED8").level).toBe(0);
    expect(r.status("LED8").why).toMatch(/is an input/);
    expect(r.codes).toEqual([]);
  });

  it("shows a dimmed LED for a square wave", () => {
    const pin = HW_BOARD.parts.find((p) => p.id === "LED3")!.pin!;
    const r = bench(pulses(pin, 30, 120), 5);
    expect(r.status("LED3").level).toBeGreaterThan(0.2);
    expect(r.status("LED3").level).toBeLessThan(0.3);
    expect(r.status("LED3").text).toMatch(/dimmed/);
  });

  it("reads a button through the pull-up, and says so when the pull-up is off", () => {
    const src = (pull: string) => `int seen = 5;
void main(void) {
  GPIO_SetupPinMux(6, GPIO_MUX_CPU1, 0);
  GPIO_SetupPinOptions(6, GPIO_INPUT, ${pull});
  while (1) { seen = GpioDataRegs.GPADAT.bit.GPIO6; }
}`;
    const r = bench(src("GPIO_PULLUP"), 2, emptyBench(), (e) => e.press("PB3", true));
    expect(r.b.readVar("seen")).toBe(0);
    expect(r.status("PB3").text).toMatch(/pressed/);
    r.e.press("PB3", false);
    expect(r.b.gpio.level[6]).toBe(1);
    const bad = bench(src("GPIO_PUSHPULL"), 2);
    expect(bad.status("PB3").why).toMatch(/pull-up is off/);
    expect(bad.codes).toContain("floating-6");
  });

  it("takes a press of the board panel's button as a press of the bench's", () => {
    const r = bench(`void main(void) { GPIO_SetupPinOptions(4, GPIO_INPUT, GPIO_PULLUP); while (1) {} }`, 1);
    r.b.gpio.drive(4, 0);
    expect(r.b.gpio.level[4]).toBe(0);
    expect(r.status("PB1").text).toMatch(/pressed/);
    r.b.gpio.drive(4, null);
    expect(r.b.gpio.level[4]).toBe(1);
  });

  it("puts the joystick and the photoresistor on their ADC inputs", () => {
    let s = setInput(emptyBench(), "JOY", "x", 50);
    s = setInput(s, "LDR", "light", 100);
    const r = bench(`void main(void) { while (1) {} }`, 1, s);
    expect(r.b.inputs.get("ADCINA2")).toBeCloseTo(3.3 * 0.75, 5);
    expect(r.b.inputs.get("ADCINA3")).toBeCloseTo(1.65, 5);
    expect(r.b.inputs.get("ADCINA4")).toBeCloseTo((3.3 * 2200) / (500 + 2200), 5);
  });

  it("follows the divider formula from dark to bright", () => {
    expect(photoOhms(0)).toBeCloseTo(200_000);
    expect(photoOhms(100)).toBeCloseTo(500);
    expect(dividerVolts(0, 1000)).toBeCloseTo(3.3 / 201, 4);
    let last = -1;
    for (let l = 0; l <= 100; l += 5) {
      const v = dividerVolts(l, 4700);
      expect(v).toBeGreaterThan(last);
      expect(v).toBeLessThan(3.3);
      last = v;
    }
  });

  it("turns a servo's horn to the angle of the pulse and makes the buzzer sound", () => {
    const servo = bench(pulses(15, 2000, 20000), 100);
    expect(servo.status("RC2").angle).toBeCloseTo(45, 0);
    expect(servo.b.output("SERVO2_DEG")).toBeCloseTo(45, 0);
    const buzz = bench(pulses(16, 500, 1000), 20);
    expect(buzz.status("B1").text).toMatch(/sounding at 1000 Hz/);
    expect(buzz.b.output("BUZZER_HZ")).toBeCloseTo(1000, 0);
  });
});

describe("fault switches", () => {
  const pinOf = (id: string) => HW_BOARD.parts.find((p) => p.id === id)!.pin!;

  it("an LED that is not soldered stays dark, and the program is told why", () => {
    const r = bench(pulses(pinOf("LED5"), 100, 200), 3, setOption(emptyBench(), "LED5", "fitted", "no"));
    expect(r.status("LED5")).toMatchObject({ text: "not soldered" });
    expect(r.codes).toEqual(["bench-not-soldered-LED5"]);
    expect(r.msgs()[0]).toMatch(/LED5 is not soldered on the board: GPIO111 changes/);
    expect(faultCount(setOption(emptyBench(), "LED5", "fitted", "no"))).toBe(1);
  });

  it("a reversed LED and a missing inverter chip each name themselves", () => {
    const rev = bench(pulses(pinOf("LED2"), 100, 200), 3, setOption(emptyBench(), "LED2", "way", "rev"));
    expect(rev.status("LED2").level).toBe(0);
    expect(rev.codes).toContain("bench-led-reversed-LED2");
    expect(rev.msgs().join(" ")).toMatch(/wrong way round/);
    const chip = bench(pulses(pinOf("LED9"), 100, 200), 3, setOption(emptyBench(), "IC2", "fitted", "no"));
    expect(chip.status("LED9").why).toMatch(/IC2/);
    expect(chip.codes).toContain("bench-led-no-driver-LED9");
    // An LED behind another chip is not affected.
    expect(bench(out(pinOf("LED1"), setPin(pinOf("LED1"))), 1, setOption(emptyBench(), "IC2", "fitted", "no")).status("LED1").level).toBe(1);
  });

  it("a button that is not soldered does nothing", () => {
    const r = bench(`void main(void) { GPIO_SetupPinOptions(5, GPIO_INPUT, GPIO_PULLUP); while (1) {} }`, 1, setOption(emptyBench(), "PB2", "fitted", "no"));
    r.e.press("PB2", true);
    r.b.gpio.drive(5, 0);
    expect(r.b.gpio.level[5]).toBe(1);
  });

  it("the buzzer is silent with its jumper off or on GND", () => {
    for (const pos of ["off", "gnd"]) {
      const r = bench(pulses(16, 500, 1000), 20, setOption(emptyBench(), "JBUZ", "pos", pos));
      expect(r.status("B1").text).toBe("silent");
      expect(r.b.output("BUZZER_HZ")).toBe(0);
      expect(r.codes).toContain("bench-buzzer-silent-B1");
      expect(r.msgs().join(" ")).toMatch(/jumper/);
    }
  });

  it("a servo does not move without the battery pack", () => {
    const r = bench(pulses(14, 2400, 20000), 100, setOption(emptyBench(), "BAT", "fitted", "no"));
    expect(r.status("RC1")).toMatchObject({ text: "not moving", angle: 0 });
    expect(r.b.output("SERVO1_DEG")).toBeUndefined();
    expect(r.codes).toContain("bench-servo-no-power-RC1");
    expect(r.msgs().join(" ")).toMatch(/battery pack/);
  });

  it("a missing or reversed joystick leaves its ADC inputs floating", () => {
    for (const s of [setOption(emptyBench(), "JOY", "fitted", "no"), setOption(emptyBench(), "JOY", "way", "rev")]) {
      const r = bench(`void main(void) { while (1) {} }`, 1, s);
      const v = r.b.input("ADCINA2");
      expect(v).toBeLessThan(0.4);
      expect(r.codes).toContain("bench-floating-ADCINA2-JOY");
    }
  });

  it("an IMU that is not plugged in, or has a jumper off, stops answering: the program reads all 1s", () => {
    // Reads WHO_AM_I (0x75) with the course's SPIB set-up from the library; the chip answers 0x71.
    const src = `int got = 0;
void main(void) {
  setupSpib();
  GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;
  SpibRegs.SPITXBUF = 0xF500;
  while (SpibRegs.SPIFFRX.bit.RXFFST == 0) {}
  got = SpibRegs.SPIRXBUF;
  GpioDataRegs.GPCSET.bit.GPIO66 = 1;
  while (1) {}
}`;
    expect(bench(src, 2).b.readVar("got")! & 0xff).toBe(0x71);
    for (const s of [setOption(emptyBench(), "IMU", "fitted", "no"), setOption(emptyBench(), "JIMU1", "pos", "off"), setOption(emptyBench(), "JIMU4", "fitted", "no")]) {
      const r = bench(src, 2, s);
      expect(r.b.readVar("got")! & 0xffff).toBe(0xffff);
      expect(r.b.inputs.get("MPU_ABSENT")).toBe(1);
      // The cause is named: the jumper, or the breakout that is not there. No message about the chip select.
      expect(r.codes.filter((c) => !/^bench-(imu-unreachable-IMU|not-soldered-(IMU|JIMU\d))$/.test(c))).toEqual([]);
      expect(r.codes.length).toBeGreaterThan(0);
    }
    // Without a bench the input does not exist and the chip is on the bus.
    const plain = new Board("redboard");
    expect(plain.inputs.has("MPU_ABSENT")).toBe(false);
  });

  it("the board panel's LED of a faulted part is dark", () => {
    const pin = pinOf("LED6");
    const r = bench(out(pin, setPin(pin)), 1, setOption(emptyBench(), "LED6", "fitted", "no"));
    expect(r.b.gpio.level[pin]).toBe(1);
    expect(r.e.ledLit(pin)).toBe(false);
    expect(r.e.ledLit(31)).toBeUndefined();
    expect(bench(out(pin, setPin(pin)), 1).e.ledLit(pin)).toBe(true);
  });

  it("a missing IMU jumper is an error when the program selects the chip", () => {
    const src = out(66, `GpioDataRegs.GPCSET.bit.GPIO66 = 1; DELAY_US(10); GpioDataRegs.GPCCLEAR.bit.GPIO66 = 1;`);
    const r = bench(src, 1, setOption(emptyBench(), "JIMU3", "pos", "off"));
    expect(r.codes).toContain("bench-imu-unreachable-IMU");
    expect(r.status("IMU").why).toMatch(/MISO/);
    expect(bench(src, 1).codes).toEqual([]);
  });

  it("takes a fault switched on while the program runs", () => {
    const r = bench(out(pinOf("LED4"), setPin(pinOf("LED4"))), 1);
    expect(r.status("LED4").level).toBe(1);
    r.set(setOption(emptyBench(), "LED4", "fitted", "no"));
    expect(r.status("LED4").text).toBe("not soldered");
  });
});

describe("devices attached to free pins", () => {
  const dev = (kind: string, conn: Record<string, string>, s = emptyBench()): BenchState => {
    let st = addDevice(s, kind);
    const id = st.added[st.added.length - 1].id;
    for (const [t, to] of Object.entries(conn)) st = connect(st, id, t, to);
    return st;
  };
  const codesOf = (s: BenchState) => checkBench(s).map((x) => x.code);

  it("offers supplies, then free pins, then pins in use with who uses them", () => {
    const c = pinChoices(emptyBench());
    expect(c.slice(0, 4).map((x) => x.target)).toEqual(["GND", "3V3", "5V", "BAT"]);
    expect(c.find((x) => x.target === "GPIO52")!.usedBy).toEqual([]);
    expect(c.find((x) => x.target === "GPIO22")!.usedBy).toEqual(["LED1"]);
    expect(c.findIndex((x) => x.target === "GPIO52")).toBeLessThan(c.findIndex((x) => x.target === "GPIO22"));
    // A part that is not soldered frees its pin.
    expect(pinChoices(setOption(emptyBench(), "LED1", "fitted", "no")).find((x) => x.target === "GPIO22")!.usedBy).toEqual([]);
  });

  it("reports a terminal left open, and a ground or supply in the wrong place", () => {
    expect(codesOf(dev("potentiometer", {}))).toEqual(["open-w", "open-vcc", "open-gnd"]);
    expect(codesOf(dev("potentiometer", { w: "ADCINA5", vcc: "GPIO52", gnd: "3V3" }))).toEqual(["power-vcc", "ground-gnd"]);
  });

  it("reports an analog output on a pin without an ADC channel, naming pins that have one", () => {
    const x = checkBench(dev("analog-sensor", { out: "GPIO52", vcc: "3V3", gnd: "GND" }));
    expect(x.map((i) => i.code)).toEqual(["no-adc-out"]);
    expect(x[0].msg).toMatch(/ADCINA5/);
    expect(x[0].severity).toBe("error");
  });

  it("reports 5 V into a 3.3 V pin and an ADC input above 3.0 V", () => {
    expect(checkBench(dev("analog-sensor", { out: "ADCINB3", vcc: "5V", gnd: "GND" }))[0]).toMatchObject({ code: "over-out", severity: "error" });
    expect(checkBench(dev("digital-sensor", { out: "GPIO52", vcc: "5V", gnd: "GND" }))[0]).toMatchObject({ code: "over-out", severity: "error" });
    expect(checkBench(dev("potentiometer", { w: "ADCINB3", vcc: "3V3", gnd: "GND" }))[0]).toMatchObject({ code: "adc-range-w", severity: "info" });
  });

  it("reports a servo or buzzer on a pin without an ePWM output, and a servo not on the battery pack", () => {
    const noPwm = checkBench(dev("servo", { sig: "GPIO52", pwr: "BAT", gnd: "GND" }));
    expect(noPwm[0].code).toBe("no-pwm-sig");
    expect(noPwm[0].msg).toMatch(/GPIO10 \(EPWM6A\)/);
    expect(codesOf(dev("servo", { sig: "GPIO10", pwr: "BAT", gnd: "GND" }))).toEqual([]);
    expect(codesOf(dev("servo", { sig: "GPIO10", pwr: "5V", gnd: "GND" }))).toEqual(["servo-usb"]);
    expect(codesOf(dev("servo", { sig: "GPIO10", pwr: "3V3", gnd: "GND" }))).toEqual(["servo-3v3"]);
    expect(codesOf(dev("servo", { sig: "GPIO10", pwr: "BAT", gnd: "GND" }, setOption(emptyBench(), "BAT", "fitted", "no")))).toEqual(["no-battery"]);
    expect(codesOf(dev("buzzer", { sig: "GPIO67", gnd: "GND" }))).toEqual(["no-pwm-sig"]);
  });

  it("reports a pin an on-board part or another device already uses", () => {
    expect(checkBench(dev("digital-sensor", { out: "GPIO4", vcc: "3V3", gnd: "GND" }))[0]).toMatchObject({ code: "shared-out", severity: "warning" });
    expect(checkBench(dev("led", { a: "GPIO22", k: "GND" }))[0]).toMatchObject({ code: "shared-a", severity: "info" });
    const two = dev("digital-sensor", { out: "GPIO52", vcc: "3V3", gnd: "GND" }, dev("switch", { c: "GPIO52" }));
    expect(checkBench(two).some((x) => x.code === "clash-out" && x.severity === "error")).toBe(true);
    expect(codesOf(dev("digital-sensor", { out: "ADCINA5", vcc: "3V3", gnd: "GND" }))).toEqual(["adc-digital-out"]);
  });

  it("checks an extra LED's resistor against the pin's 4 mA", () => {
    const led = dev("led", { a: "GPIO52", k: "GND" });
    expect(codesOf(led)).toEqual([]);
    expect(codesOf(setOption(led, "X1", "ohm", "330"))).toEqual(["led-current"]);
    expect(codesOf(setOption(led, "X1", "ohm", "100"))).toEqual(["led-current"]);
    expect(checkBench(setOption(led, "X1", "ohm", "0"))[0]).toMatchObject({ code: "led-no-resistor", severity: "error" });
    expect(codesOf(dev("transistor", { base: "GPIO52", load: "5V", gnd: "GND" }))).toEqual(["load-usb"]);
  });

  it("runs an extra LED, a switch, a potentiometer and a transistor from a program", () => {
    let s = dev("led", { a: "3V3", k: "GPIO52" });
    s = dev("switch", { c: "GPIO67" }, s);
    s = dev("potentiometer", { w: "ADCINB3", vcc: "3V3", gnd: "GND" }, s);
    s = dev("transistor", { base: "GPIO56", load: "BAT", gnd: "GND" }, s);
    s = setInput(setInput(s, "X2", "up", 1), "X3", "pos", 25);
    const r = bench(`int sw = 7;
void main(void) {
  GPIO_SetupPinOptions(52, GPIO_OUTPUT, GPIO_PUSHPULL);
  GPIO_SetupPinOptions(56, GPIO_OUTPUT, GPIO_PUSHPULL);
  GPIO_SetupPinOptions(67, GPIO_INPUT, GPIO_PUSHPULL);
  GpioDataRegs.GPBSET.bit.GPIO56 = 1;
  while (1) { sw = GpioDataRegs.GPCDAT.bit.GPIO67; }
}`, 1, s);
    // The LED hangs between 3V3 and the pin: lit while the pin is low.
    expect(r.status("X1")).toMatchObject({ text: "on", level: 1 });
    expect(r.b.readVar("sw")).toBe(1);
    expect(r.b.inputs.get("ADCINB3")).toBeCloseTo(3.3 * 0.25, 5);
    expect(r.status("X4").text).toBe("LED on");
    expect(r.codes).toEqual([]);
  });

  it("turns an extra servo on any pin, and gives a digital sensor's pulses to the program", () => {
    const s = dev("servo", { sig: "GPIO10", pwr: "BAT", gnd: "GND" });
    const r = bench(pulses(10, 800, 20000), 100, s);
    expect(r.status("X1").angle).toBeCloseTo(-90, 0);
    const d = setInput(dev("digital-sensor", { out: "GPIO52", vcc: "3V3", gnd: "GND" }), "X1", "hz", 500);
    const p = bench(`int edges = 0; int last = 0;
void main(void) {
  GPIO_SetupPinOptions(52, GPIO_INPUT, GPIO_PUSHPULL);
  while (1) { int v = GpioDataRegs.GPBDAT.bit.GPIO52; if (v != last) { edges++; last = v; } }
}`, 20, d);
    expect(p.b.readVar("edges")).toBeGreaterThanOrEqual(18);
    expect(p.b.readVar("edges")).toBeLessThanOrEqual(21);
  });

  it("gives a microphone's tone to a conversion as a voltage around 1.5 V", () => {
    const r = bench(`void main(void) { while (1) {} }`, 1, dev("microphone", { out: "ADCINB4", vcc: "3V3", gnd: "GND" }));
    const quarter = 1e9 / 440 / 4;
    r.b.now = Math.round(quarter);
    expect(r.b.input("ADCINB4")).toBeCloseTo(2.0, 2);
  });

  it("puts wiring mistakes in the program's messages when it runs", () => {
    const r = bench(`void main(void) { while (1) {} }`, 1, dev("analog-sensor", { out: "ADCINB3", vcc: "5V", gnd: "GND" }));
    expect(r.codes).toContain("bench-over-out-X1");
  });

  it("lists what was attached as a table and as CSV, and removes it again", () => {
    const s = dev("servo", { sig: "GPIO10", pwr: "BAT" });
    expect(wiringTable(emptyBench())).toEqual([]);
    expect(wiringTable(s)).toEqual([
      { device: "RC servo 1", kind: "RC servo", terminal: "signal wire", goesTo: "GPIO10", header: "pin 76, J8.6" },
      { device: "RC servo 1", kind: "RC servo", terminal: "supply wire", goesTo: "Battery pack", header: "" },
      { device: "RC servo 1", kind: "RC servo", terminal: "ground wire", goesTo: "not connected", header: "" },
    ]);
    expect(wiringCsv(s).split("\n")[1]).toBe('RC servo 1,RC servo,signal wire,GPIO10,"pin 76, J8.6"');
    expect(removeDevice(s, "X1")).toEqual(emptyBench());
    expect(describeBench(s).join("\n")).toMatch(/RC servo 1: signal wire to GPIO10 \(pin 76, J8\.6\); supply wire to battery pack; ground wire to not connected/);
  });
});

describe("saving the bench", () => {
  it("round-trips", () => {
    let s = addDevice(emptyBench(), "joystick");
    s = connect(s, "X1", "x", "ADCINA5");
    s = setOption(setInput(s, "LDR", "light", 20), "JBUZ", "pos", "off");
    expect(parseBench(serializeBench(s))).toEqual(s);
  });

  it("gives the default bench for text that is not a bench", () => {
    for (const t of [null, "", "{", "[]", "7", '{"v":2}', '{"v":1,"added":"x","opts":5,"inputs":[]}']) expect(parseBench(t)).toEqual(emptyBench());
  });

  it("drops what it does not understand and keeps the rest", () => {
    const got = parseBench(
      JSON.stringify({
        v: 1,
        opts: { LED1: { way: "rev", fitted: "maybe" }, NOPE: { fitted: "no" }, LED2: 5 },
        inputs: { LDR: { light: 1e9 }, JOY: { x: "left", held: 1 } },
        added: [
          { id: "X1", kind: "servo", label: "  Arm\u0007  ", conn: { sig: "GPIO10", pwr: "GPIO999", gnd: 3 } },
          { id: "X1", kind: "servo", conn: {} },
          { id: "LED1", kind: "led" },
          { id: "X2", kind: "imu" },
          { id: "X3", kind: "nothing" },
          "junk",
        ],
      }),
    );
    expect(got.opts).toEqual({ LED1: { way: "rev" } });
    expect(got.inputs).toEqual({ LDR: { light: 100 } });
    expect(got.added).toEqual([{ id: "X1", kind: "servo", label: "Arm", conn: { sig: "GPIO10", pwr: "", gnd: "" } }]);
  });
});

describe("no graded answer on the bench", () => {
  it("ships no preset, no project and no code", () => {
    // The bench starts with nothing attached, and no file of it holds a ready-made set of devices or a program.
    expect(emptyBench().added).toEqual([]);
    const dirs = ["src/sim/wiring", "src/sim/wiring/parts", "src/ui/wiring"];
    for (const dir of dirs) {
      for (const f of readdirSync(dir).filter((x) => /\.(ts|tsx|json)$/.test(x))) {
        const text = readFileSync(`${dir}/${f}`, "utf8");
        expect(text, `${dir}/${f}`).not.toMatch(/preset|example project|EPwm\d+Regs\.|void main\(/i);
        // No device list written out in advance: `added` is only ever built from what the student does.
        expect(text, `${dir}/${f}`).not.toMatch(/added:\s*\[\s*\{/);
      }
    }
  });

  it("offers single devices only: every bin entry is one part with nothing connected", () => {
    for (const d of PART_DEFS.filter((x) => x.addable)) {
      const s = addDevice(emptyBench(), d.kind);
      expect(s.added).toHaveLength(1);
      expect(Object.values(s.added[0].conn).every((c) => c === ""), d.kind).toBe(true);
    }
    expect(PART_DEFS.filter((x) => x.addable).map((x) => x.kind).sort()).toEqual(
      ["analog-sensor", "button", "buzzer", "digital-sensor", "joystick", "led", "microphone", "potentiometer", "servo", "switch", "transistor"],
    );
  });

  it("is off for every board that is not the Sandbox's homework board with the bench on", () => {
    expect(benchLink.state).toBeNull();
    const b = new Board("redboard");
    expect(benchLink.engine).toBeNull();
    // Nothing of the bench is on the board: its GPIO model is the class's own.
    expect(Object.prototype.hasOwnProperty.call(b.gpio, "drive")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(b, "input")).toBe(false);
  });
});

describe("who is connected to what", () => {
  it("goes from a part to its pin, through the inverter chip where there is one", async () => {
    const { highlightOf } = await import("../src/sim/wiring/nets");
    const h = highlightOf(emptyBench(), { t: "part", id: "LED1" })!;
    expect(h.words).toContain("LED1: GPIO22, pin 8, J1.8 through IC1.");
    expect(h.near.map((n) => HW_BOARD.nets[n])).toEqual(["GPIO22"]);
    // Behind the inverter: the LED's two own nets, distinct from the pin's.
    expect(h.far).toHaveLength(2);
    expect(h.far.every((n) => !h.near.includes(n))).toBe(true);
    expect(highlightOf(emptyBench(), { t: "part", id: "JOY" })!.words).toContain("Joystick: ADCINA2, pin 29, J3.9; ADCINA3, pin 26, J3.6; GPIO8, pin 78, J8.8; supply 3V3; ground GND.");
  });

  it("goes from a pin to every part and device on it, and says when a pin is free", async () => {
    const { highlightOf, pinRows } = await import("../src/sim/wiring/nets");
    expect(highlightOf(emptyBench(), { t: "pin", n: 8 })!.words).toBe("Pin 8, J1.8: GPIO22. Connected: LED1 (through IC1). Can carry EPWM12A.");
    expect(highlightOf(emptyBench(), { t: "pin", n: 48 })!.words).toBe("Pin 48, J5.8: GPIO52. Nothing connected. Free for a device of yours.");
    let s = addDevice(emptyBench(), "servo");
    s = connect(s, "X1", "sig", "GPIO52");
    expect(highlightOf(s, { t: "pin", n: 48 })!.words).toBe("Pin 48, J5.8: GPIO52. Connected: RC servo 1: signal wire.");
    // A part that is not soldered is no longer on its pin.
    expect(highlightOf(setOption(emptyBench(), "LED1", "fitted", "no"), { t: "pin", n: 8 })!.words).toMatch(/Nothing connected/);
    const rows = pinRows(emptyBench());
    expect(rows).toHaveLength(80);
    expect(rows.find((r) => r.name === "GPIO4")).toMatchObject({ number: 36, header: "J4.6", type: "GPIO", users: ["PB1"] });
    expect(rows.find((r) => r.name === "ADCINA4")!.users).toEqual(["Photoresistor"]);
    expect(rows.filter((r) => r.type === "Ground").length).toBeGreaterThan(2);
  });

  it("has copper for every pin a part is on, inside the board", () => {
    const withCopper = new Set(HW_BOARD.traces.map((t) => t[0]));
    for (const p of HW_BOARD.parts) {
      if (p.kind === "battery" || p.kind === "power-led" || p.kind === "photoresistor") continue;
      for (const n of p.nets) if (/^(GPIO|ADCIN)/.test(HW_BOARD.nets[n])) expect(withCopper.has(n), `${p.id} ${HW_BOARD.nets[n]}`).toBe(true);
    }
    for (const t of HW_BOARD.traces) {
      expect(t[1] === 0 || t[1] === 1).toBe(true);
      expect((t.length - 2) % 2).toBe(0);
      for (let k = 2; k < t.length; k += 2) expect(t[k] >= 0 && t[k] <= HW_BOARD.w && t[k + 1] >= 0 && t[k + 1] <= HW_BOARD.h).toBe(true);
    }
    expect(JSON.stringify(HW_BOARD.texts)).not.toMatch(/ESP|MSP|Orange/);
  });
});

describe("nothing is connected by rule alone", () => {
  it("shows every terminal of every part of the board: copper, a plane, or a connection made by hand", async () => {
    const { highlightOf } = await import("../src/sim/wiring/nets");
    const copper = new Set(HW_BOARD.traces.map((t) => t[0]));
    const bat = HW_BOARD.parts.find((p) => p.id === "BAT")!;
    expect(bat.links!.length).toBeGreaterThanOrEqual(2);
    for (const i of instances(emptyBench())) {
      const p = i.part!;
      for (const d of i.def.terminals) {
        const t = i.conn[d.id];
        const net = HW_BOARD.nets.indexOf(t);
        const plane = t === "GND" || t === "3V3" || t === "5V";
        const byHand = (t === "BAT" && bat.links!.length > 0) || (p.links ?? []).length > 0;
        // A pin's net has copper to follow, unless the part itself declares the wire that takes it there.
        expect(plane || byHand || (net >= 0 && copper.has(net)), `${i.id}.${d.id} -> ${t}`).toBe(true);
      }
      // And the sentence names what has no copper to light: supply, ground, plugs and hand-made wires.
      const words = highlightOf(emptyBench(), { t: "part", id: i.id })!.words;
      for (const d of i.def.terminals) if (d.role === "ground") expect(words, i.id).toMatch(/GND/);
      expect(words.split(". ").length, `${i.id}: ${words}`).toBeGreaterThanOrEqual(2);
    }
    for (const p of HW_BOARD.parts) for (const [x1, y1, x2, y2, what] of p.links ?? []) {
      expect([x1, x2].every((x) => x >= 0 && x <= HW_BOARD.w) && [y1, y2].every((y) => y >= 0 && y <= HW_BOARD.h), `${p.id}: ${what}`).toBe(true);
      expect(what.length).toBeGreaterThan(5);
    }
  });

  it("names a servo's signal, supply and ground, with and without the battery pack", async () => {
    const { highlightOf } = await import("../src/sim/wiring/nets");
    expect(highlightOf(emptyBench(), { t: "part", id: "RC1" })!.words).toBe(
      "RC servo 1: signal GPIO14, pin 74, J8.4; supply battery pack (about 6 V) through its soldered lead; ground GND. It plugs onto its 3-pin connector. The supply row gets the battery pack through wires soldered by hand.",
    );
    const none = highlightOf(setOption(emptyBench(), "BAT", "fitted", "no"), { t: "part", id: "RC1" })!;
    expect(none.words).toMatch(/supply battery pack, which is not on the board: no supply; ground GND/);
    // Signal row, supply row and ground are all lit.
    const lit = highlightOf(emptyBench(), { t: "part", id: "RC2" })!.near.map((n) => HW_BOARD.nets[n]);
    expect(lit).toContain("GPIO15");
    expect(lit).toContain("GND");
    expect(lit.length).toBe(4);
  });
});
