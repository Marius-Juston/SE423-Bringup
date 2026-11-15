// The wiring bench while a program runs: the homework board's parts with
// their fault switches, and the devices attached to free pins
// (src/sim/wiring, docs/WIRING.md). It exists only on a homework board made
// while the Sandbox's bench is switched on (wiring/active.ts); on every
// other board this plugin does nothing, so levels and tests are untouched.
//
// What it does to the simulation:
// - Buttons, switches and digital sensors put levels on pins through
//   gpio.drive, so the GPIO model's own messages apply (a floating input, a
//   short against an output). A press of the board panel's PB1 to PB4 goes
//   through the bench, so a button that is not soldered does nothing.
// - Analog parts set the ADC inputs of the signal bus ("ADCINA4" ...), the
//   same names the board panel's sliders use. An ADC pin whose part is
//   missing or has no supply floats: a conversion of it gets a small
//   wandering voltage and a message.
// - Each pin a part hangs on is measured (frequency, duty, pulse width) from
//   its edges, for the parts' rules.
// - The MPU-9250 is taken off the SPI bus (input MPU_ABSENT of
//   plugins/spi_devices.ts) while it is not plugged in or a jumper is off.
// - The board panel's LEDs ask the bench (ledLit) whether the LED on a pin
//   is lit, so a fault shows there too.
// - The servo angles and the buzzer tone that plugins/actuators.ts publishes
//   for GPIO14, GPIO15 and GPIO16 are held back while the bench's part there
//   cannot act (no battery pack, the buzzer's jumper off).
//
// Limits (data sheet SPRS880P 6.1 and 6.6 give the numbers in
// wiring/bench.ts): connections are fixed and every part follows a rule of
// its own. Nothing is solved as a circuit: no currents, no loading of one
// part by another, no analog voltage on a GPIO pin.

import type { Board } from "../board";
import type { SimPlugin } from "../plugin";
import { gpioOf, isAdc } from "../wiring/board";
import { benchLink } from "../wiring/active";
import { benchView, checkBench, fitted, instances } from "../wiring/bench";
import type { BenchRun, BenchState, BenchView, Inst, Severity, Target, Wave } from "../wiring/types";

/** Measures the square wave on a pin from its edges. */
class Meter {
  rise = -1;
  fall = -1;
  period = 0;
  high = 0;
  edge(level: number, t: number): void {
    if (level === 1) {
      if (this.rise >= 0 && this.fall > this.rise) {
        this.period = t - this.rise;
        this.high = this.fall - this.rise;
      }
      this.rise = t;
    } else this.fall = t;
  }
  wave(now: number): Wave | null {
    if (!this.period || now - Math.max(this.rise, this.fall) > 2 * this.period) return null;
    return { hz: 1e9 / this.period, duty: this.high / this.period, pulseMs: this.high / 1e6 };
  }
}

/** Signals of plugins/actuators.ts that belong to a pin of the homework board. */
const GATED: Record<string, number> = { SERVO1_DEG: 14, SERVO2_DEG: 15, BUZZER_HZ: 16 };

export class BenchEngine implements BenchRun {
  private list: Inst[] = [];
  private view: BenchView;
  private meters = new Map<number, Meter>();
  private watchers = new Map<number, Inst[]>();
  /** Per pin: which part puts which level on it. */
  private drives = new Map<number, Map<string, 0 | 1>>();
  private applied = new Map<number, 0 | 1>();
  private analogs = new Map<string, number | ((t: number) => number)>();
  /** ADC inputs whose part gives no voltage: they float. */
  private floating = new Set<string>();
  private owned = new Set<string>();
  private memory = new Map<string, Record<string, number>>();
  private said = new Set<string>();
  private epoch = 0;
  private gpioDrive: Board["gpio"]["drive"];

  constructor(readonly board: Board, private state: () => BenchState) {
    this.view = benchView(state(), board);
    const g = board.gpio;
    this.gpioDrive = g.drive.bind(g);
    // The board panel's push buttons press the bench's buttons.
    g.drive = (pin, d, t) => {
      const own = this.list.find((i) => i.part && i.kind === "button" && gpioOf(i.conn.a) === pin);
      if (!own) return this.gpioDrive(pin, d, t);
      this.mem(own).held = d === 0 ? 1 : 0;
      this.sync();
    };
    g.listeners.push((pin, level, t) => {
      const who = this.watchers.get(pin);
      if (!who) return;
      this.meters.get(pin)!.edge(level, t);
      for (const i of who) {
        if (i.kind === "led") this.tell(i, t);
        if (!i.part || fitted(i)) i.def.edge?.(i, this, `GPIO${pin}`, level, t);
        // The program drives a part that is not there: say so once.
        else if (board.gpio.mux(pin) !== 0 || board.gpio.isOutput(pin)) {
          const role = i.def.terminals.find((d) => i.conn[d.id] === `GPIO${pin}`)?.role;
          if (role === "in" || role === "pwm") this.warn(i, "not-soldered", `${i.label} is not soldered on the board: GPIO${pin} changes, but nothing there can answer. Solder it (Wiring bench, ${i.label}, On the board).`);
        }
      }
    });
    const input = board.input.bind(board);
    board.input = (name, fallback) => {
      if (!this.floating.has(name)) return input(name, fallback);
      board.inputsUsed.add(name);
      const who = this.list.find((i) => i.def.terminals.some((d) => d.role === "analog" && i.conn[d.id] === name));
      if (who) this.warn(who, `floating-${name}`, `${name} was converted, but nothing puts a voltage on it: ${!who.part || fitted(who) ? `${who.label} has no supply or is the wrong way round` : `${who.label} is not on the board`}. The result is noise. Check the part on the wiring bench.`);
      // What an open ADC input holds is left-over charge: a small voltage that wanders, the same for every run.
      const bucket = Math.floor(board.now / 1e6);
      return 0.05 + ((Math.imul(bucket + 1, 0x9e3779b1) >>> 20) / 4096) * 0.25;
    };
    const publish = board.publish.bind(board);
    board.publish = (name, v, t) => {
      const pin = GATED[name];
      if (pin !== undefined) {
        const own = this.list.find((i) => i.part && (i.kind === "servo" || i.kind === "buzzer") && gpioOf(i.conn.sig) === pin);
        const dead = !own || !fitted(own) || own.def.works?.(own, this) === false;
        // A servo that cannot move keeps its angle; a buzzer that cannot sound is silent.
        if (dead && name !== "BUZZER_HZ") return;
        if (dead) v = 0;
      }
      publish(name, v, t);
    };
    board.plugins.set("bench-wiring", this);
    // After the session has set the board panel's sliders to their start values.
    board.at(0, () => this.sync());
  }

  // ----- BenchView -----
  inst = (id: string) => this.view.inst(id);
  all = () => this.view.all();
  pin = (t: Target) => this.view.pin(t);
  rail = (t: Target) => this.view.rail(t);
  high = (t: Target) => this.view.high(t);
  mem = (i: Inst) => this.view.mem(i);

  /** The bench changed (a fault switch, a slider, a device attached): set everything up again. */
  sync(): void {
    const b = this.board;
    const state = this.state();
    this.list = instances(state);
    this.view = benchView(state, b, (n) => this.meters.get(n)?.wave(b.now) ?? null, this.memory);
    this.epoch++;
    this.watchers.clear();
    for (const i of this.list)
      for (const d of i.def.terminals) {
        const n = gpioOf(i.conn[d.id]);
        if (n === null) continue;
        if (!this.meters.has(n)) this.meters.set(n, new Meter());
        const w = this.watchers.get(n);
        if (w) w.includes(i) || w.push(i);
        else this.watchers.set(n, [i]);
      }
    this.drives.clear();
    this.analogs.clear();
    this.floating.clear();
    for (const i of this.list) i.def.apply?.(i, this);
    this.flush();
    // What a level's checks read: each LED's state, and how many options were changed.
    for (const i of this.list) if (i.part && i.kind === "led") this.tell(i, b.now);
    b.publish("BENCH_CHANGES", benchLink.changes);
    // The IMU is on the SPI bus only while it is plugged in and its four jumpers are fitted.
    const imu = this.list.find((i) => i.part && i.kind === "imu");
    const absent = imu && (!fitted(imu) || imu.def.works?.(imu, this) === false) ? 1 : 0;
    if ((b.inputs.get("MPU_ABSENT") ?? 0) !== absent) b.setInput("MPU_ABSENT", absent);
    for (const x of checkBench(state)) if (x.severity !== "info") this.say(`${x.code}-${x.inst}`, x.msg, x.severity, 0);
    // A loop that found nothing to do sleeps until the next event: this is one, so it looks again.
    b.at(b.now, () => b.mem.writes++);
  }

  private flush(): void {
    const b = this.board;
    for (const pin of new Set([...this.applied.keys(), ...this.drives.keys()])) {
      const by = this.drives.get(pin);
      const levels = by ? [...new Set(by.values())] : [];
      if (levels.length > 1) this.say(`fight-${pin}`, `Two parts on the wiring bench drive GPIO${pin} to different levels at once (${[...by!.keys()].map((id) => this.inst(id)?.label).join(", ")}). That is a short circuit between them. Give each its own pin.`, "error");
      const level = levels.length ? (levels.includes(0) ? 0 : 1) : null;
      if (level === null) this.applied.delete(pin);
      else this.applied.set(pin, level);
      this.gpioDrive(pin, level, b.now);
    }
    for (const name of this.owned) if (!this.analogs.has(name)) b.sources.delete(name);
    for (const [name, v] of this.analogs) {
      this.owned.add(name);
      if (typeof v === "number") {
        b.sources.delete(name);
        if (b.inputs.get(name) !== v) b.setInput(name, v);
      } else {
        b.inputs.delete(name);
        b.sources.set(name, v);
      }
    }
  }

  // ----- BenchRun -----
  drive(i: Inst, t: Target, level: 0 | 1 | null): void {
    const pin = gpioOf(t);
    if (pin === null) return;
    let by = this.drives.get(pin);
    if (level === null) {
      by?.delete(i.id);
      if (by && !by.size) this.drives.delete(pin);
    } else {
      if (!by) this.drives.set(pin, (by = new Map()));
      by.set(i.id, level);
    }
    // A change made from an event (a sensor's square wave) takes effect at once.
    if (this.flushing) this.flushOne(pin);
  }
  private flushing = false;
  private flushOne(pin: number): void {
    const by = this.drives.get(pin);
    const levels = by ? [...new Set(by.values())] : [];
    const level = levels.length ? (levels.includes(0) ? 0 : 1) : null;
    if (level === null) this.applied.delete(pin);
    else this.applied.set(pin, level);
    this.gpioDrive(pin, level, this.board.now);
  }

  analog(i: Inst, t: Target, volts: number | ((tNs: number) => number) | null): void {
    if (!isAdc(t)) return;
    if (volts === null) {
      if (!this.analogs.has(t)) this.floating.add(t);
      return;
    }
    if (this.analogs.has(t)) this.say(`two-analog-${t}`, `Two parts on the wiring bench put a voltage on ${t} (${i.label} is one of them). The ADC can only read one. Give each its own ADC pin.`, "error");
    this.floating.delete(t);
    this.analogs.set(t, volts);
  }

  warn(i: Inst, code: string, msg: string, severity: Severity = "warning"): void {
    this.say(`${code}-${i.id}`, msg, severity);
  }

  private say(key: string, msg: string, severity: Severity, line = this.board.line): void {
    if (this.said.has(key)) return;
    this.said.add(key);
    this.board.warn(line, `bench-${key}`, msg, severity);
  }

  later(tNs: number, fn: () => void): void {
    const epoch = this.epoch;
    this.board.at(tNs, () => {
      if (epoch !== this.epoch) return;
      this.flushing = true;
      try {
        fn();
      } finally {
        this.flushing = false;
      }
    });
  }

  /**
   * For the board panel's LED of a pin: whether the bench's LED there is lit, or undefined when the bench has
   * no LED on that pin (the LaunchPad's own two LEDs).
   */
  ledLit(pin: number): boolean | undefined {
    const led = this.list.find((i) => i.part && i.kind === "led" && gpioOf(i.conn.a) === pin);
    if (!led) return undefined;
    return fitted(led) && (led.def.status(led, this).level ?? 0) > 0;
  }

  /** Publishes "BENCH_<id>": 1 while the board's LED is lit. */
  private tell(i: Inst, t: number): void {
    const lit = (!i.part || fitted(i)) && (i.def.status(i, this).level ?? 0) > 0;
    this.board.publish(`BENCH_${i.id}`, lit ? 1 : 0, t);
  }

  /** Holds or lets go of a button on the bench (a push button, the joystick's switch). */
  press(id: string, down: boolean): void {
    const i = this.inst(id);
    if (!i) return;
    this.mem(i).held = down ? 1 : 0;
    this.sync();
  }
}

/** Puts a running bench on a board. The Sandbox does this through wiring/active.ts; tests call it directly. */
export function attachBench(board: Board, state: () => BenchState): BenchEngine {
  return new BenchEngine(board, state);
}

export const plugin: SimPlugin = {
  name: "bench-wiring",
  // After every model whose signals the bench holds back or feeds.
  order: 90,
  install(b) {
    if (b.kit !== "redboard" || !benchLink.state) return;
    benchLink.engine = attachBench(b, () => benchLink.state!);
  },
};
