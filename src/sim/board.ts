// The simulated F28379D: memory, time, events, CPU interrupt logic, and the
// compiled program. Peripherals attach themselves in their constructors.

import { Memory } from "./memory";
import { Device } from "./device/device";
import { Compiler, RuntimeError, STACK_BASE, type Fn, type Rt } from "./cc/compile";
import { ParseContext, Parser } from "./cc/parser";
import { CError, Preprocessor } from "./cc/lexer";
import { UINT } from "./cc/types";
import { Gpio } from "./periph/gpio";
import { CpuTimers } from "./periph/cputimer";
import { Pie } from "./periph/pie";
import { Sci } from "./periph/sci";
import { installLibrary, PRELUDE } from "./lib/prelude";

import { SYSCLK_NS } from "./consts";
import { PLUGINS } from "./plugin";

export { SYSCLK_NS };
/** Nominal cost of one C statement (10 CPU cycles). */
const STMT_NS = 50;
const IER_ADDR = 0xf000;
const IFR_ADDR = 0xf001;

export interface Diagnostic {
  line: number;
  code: string;
  msg: string;
  count: number;
  /** Simulation time of the first occurrence, ns (-1: compile time). */
  t: number;
  severity: "error" | "warning" | "info";
}

interface Ev {
  t: number;
  seq: number;
  fn: (t: number) => void;
}

export interface IsrLog {
  t: number;
  name: string;
  vector: string;
  /** How long the function ran, ns (-1 while it is still running). */
  dur: number;
}

export class Board implements Rt {
  mem = new Memory();
  dev: Device;
  ctx = new ParseContext();
  pp = new Preprocessor();
  compiler: Compiler;

  // Rt
  sp = STACK_BASE;
  fp = STACK_BASE;
  ret = 0;
  line = 0;
  libDepth = 0;
  pause = false;

  /** Simulation time in ns. */
  now = 0;
  pauseAt = Infinity;
  steps = 0;
  stepLimit = 40_000_000;
  private overrun = 0;
  private events: Ev[] = [];
  private seq = 0;

  // CPU interrupt state
  ier = 0;
  ifr = 0;
  /** INTM = 1 at reset: maskable interrupts are disabled until EINT. */
  intm = true;
  private irq = false;
  isrDepth = 0;
  isrLog: IsrLog[] = [];
  /** Function used by InitPieVectTable for every vector. */
  defaultIsr: Fn | null = null;

  diagnostics = new Map<string, Diagnostic>();
  mainReturned = false;
  /** Text printed with printf (the CCS console). */
  console = "";
  /** The robot's two-line LCD (UART_printfLine). */
  lcd: [string, string] = ["", ""];
  userLines = 0;

  gpio: Gpio;
  timers: CpuTimers;
  pie: Pie;
  sci: Sci;

  // ---- signal bus between the chip and the world around it ----
  /** Values the world feeds in, by name (e.g. "ADCINA4" in volts, "LEFT_WHEEL_RADPS"). */
  inputs = new Map<string, number>();
  /** Values the chip or the world produces, by name (e.g. "DACA" in volts), with history. */
  outputs = new Map<string, { t: number; v: number }[]>();
  private inputWatchers = new Map<string, ((v: number, t: number) => void)[]>();
  private triggerWatchers = new Map<string, ((t: number) => void)[]>();
  /** State owned by plugins, by plugin name. */
  plugins = new Map<string, unknown>();

  constructor() {
    this.dev = new Device(this.mem);
    this.compiler = new Compiler(this, this.ctx);
    this.dev.declare(this.ctx, (n, t, a) => this.compiler.defineGlobal(n, t, a, "device"));
    this.mem.onProtectedWrite = (reg) =>
      this.warn(
        this.line,
        "eallow",
        `${reg.name} is a protected register: this write was ignored because it is not between EALLOW; and EDIS;.`,
        "error",
      );

    // IER and IFR are CPU registers; C code sees them as variables.
    this.compiler.defineGlobal("IER", UINT, IER_ADDR, "device");
    this.compiler.defineGlobal("IFR", UINT, IFR_ADDR, "device");
    this.mem.hook({
      name: "IER", addr: IER_ADDR, words: 1, protect: false,
      read: () => this.ier,
      after: (v) => {
        this.ier = v;
        this.updateIrq();
      },
    });
    this.mem.hook({
      name: "IFR", addr: IFR_ADDR, words: 1, protect: false,
      read: () => this.ifr,
      after: (v) => {
        this.ifr = v;
        this.updateIrq();
      },
    });

    this.pie = new Pie(this);
    this.gpio = new Gpio(this);
    this.timers = new CpuTimers(this);
    this.sci = new Sci(this);

    // Course library: prototypes and TI sources in C, the rest native.
    const source = [PRELUDE, ...PLUGINS.map((p) => p.prelude ?? "")].join("\n");
    const unit = new Parser(this.pp.run(source, "library"), this.ctx).parseUnit();
    this.compiler.compileUnit(unit, "library");
    installLibrary(this);
    for (const p of PLUGINS) p.install?.(this);
  }

  // ---------- signal bus ----------

  /** The world sets an input value (a knob, a sensor, a shaft speed). */
  setInput(name: string, v: number, t = this.now): void {
    this.inputs.set(name, v);
    this.mem.writes++;
    for (const w of this.inputWatchers.get(name) ?? []) w(v, t);
  }

  input(name: string, fallback = 0): number {
    return this.inputs.get(name) ?? fallback;
  }

  onInput(name: string, fn: (v: number, t: number) => void): void {
    const l = this.inputWatchers.get(name);
    if (l) l.push(fn);
    else this.inputWatchers.set(name, [fn]);
  }

  /** Records an output value (only when it changes). */
  publish(name: string, v: number, t = this.now): void {
    let tr = this.outputs.get(name);
    if (!tr) this.outputs.set(name, (tr = []));
    const last = tr[tr.length - 1];
    if (last && last.v === v) return;
    if (last && last.t === t) last.v = v;
    else tr.push({ t, v });
    this.mem.writes++;
  }

  /** Latest published value, or the value at a past time. */
  output(name: string, t?: number): number | undefined {
    const tr = this.outputs.get(name);
    if (!tr || !tr.length) return undefined;
    if (t === undefined) return tr[tr.length - 1].v;
    let v: number | undefined;
    for (const x of tr) {
      if (x.t > t) break;
      v = x.v;
    }
    return v;
  }

  /**
   * Hardware trigger lines between peripherals, by name: "TINT0".."TINT2"
   * (CPU timers), "EPWM1SOCA".."EPWM12SOCB" (ePWM start-of-conversion),
   * "ADCAINT1".. (ADC interrupts, for the DMA).
   */
  onTrigger(name: string, fn: (t: number) => void): void {
    const l = this.triggerWatchers.get(name);
    if (l) l.push(fn);
    else this.triggerWatchers.set(name, [fn]);
  }

  fireTrigger(name: string, t = this.now): void {
    const l = this.triggerWatchers.get(name);
    if (l) for (const w of l) w(t);
  }

  // ---------- program ----------

  /** Compiles the student's file. Throws CError on the first error. */
  load(source: string): void {
    this.userLines = source.split("\n").length;
    const toks = this.pp.run(source, "user");
    for (const w of this.pp.warnings) this.warn(w.line, "preprocessor", w.msg);
    const unit = new Parser(toks, this.ctx).parseUnit();
    this.compiler.compileUnit(unit, "user");
  }

  /**
   * Starts the program. The returned generator yields each time the
   * simulation reaches `pauseAt`; set a later `pauseAt` and call next().
   */
  *run(entry = "main"): Generator<void, void> {
    for (const init of this.compiler.inits) init();
    const main = this.compiler.fns.get(entry);
    if (!main?.body) throw new CError(1, `The program has no ${entry}() function.`);
    yield* this.compiler.invokeGen(main, [], main.line);
    // After main returns the real chip sits in an endless loop; interrupts keep running.
    this.mainReturned = true;
    for (;;) {
      this.idle();
      if (this.pause) yield;
      else this.tick(this.line);
    }
  }

  /** Runs until the given time (ns). Returns false when the program cannot continue. */
  runUntil(gen: Generator<void, void>, t: number): void {
    this.pauseAt = t;
    this.pause = false;
    this.overrun = 0;
    if (this.now >= t) return;
    gen.next();
  }

  // ---------- time ----------

  tick(line: number): void {
    if (line) this.line = line;
    this.now += STMT_NS;
    if (++this.steps > this.stepLimit)
      throw new RuntimeError(line, "The program ran for too many steps. Look for a loop that never ends and does work on every pass.");
    if (this.events.length && this.events[0].t <= this.now) this.runEvents();
    if (this.irq) this.dispatch();
    if (this.now >= this.pauseAt) {
      this.pause = true;
      if (++this.overrun > 2_000_000)
        throw new RuntimeError(line, "This code never finishes: it is stuck in a loop that nothing can end (inside an interrupt function, or a function called from an expression).");
    }
  }

  idle(): void {
    if (this.irq) {
      this.dispatch();
      return;
    }
    const next = this.events.length ? this.events[0].t : Infinity;
    const target = Math.min(next, this.pauseAt);
    if (target > this.now && target !== Infinity) this.now = target;
    if (this.events.length && this.events[0].t <= this.now) this.runEvents();
    if (this.irq) this.dispatch();
    if (this.now >= this.pauseAt) this.pause = true;
  }

  /** Schedules fn at absolute time t (ns). */
  at(t: number, fn: (t: number) => void): Ev {
    const ev: Ev = { t: Math.max(t, 0), seq: this.seq++, fn };
    const evs = this.events;
    let i = evs.length;
    while (i > 0 && (evs[i - 1].t > ev.t || (evs[i - 1].t === ev.t && evs[i - 1].seq > ev.seq))) i--;
    evs.splice(i, 0, ev);
    return ev;
  }

  cancel(ev: Ev | null | undefined): void {
    if (!ev) return;
    const i = this.events.indexOf(ev);
    if (i >= 0) this.events.splice(i, 1);
  }

  private runEvents(): void {
    const evs = this.events;
    while (evs.length && evs[0].t <= this.now) {
      const ev = evs.shift()!;
      ev.fn(ev.t);
    }
  }

  // ---------- interrupts ----------

  setIntm(v: boolean): void {
    this.mem.writes++;
    this.intm = v;
    this.updateIrq();
  }

  /** Sets a CPU interrupt flag (bit 0 = INT1 ... bit 13 = INT14). */
  raiseCpu(bit: number): void {
    this.mem.writes++;
    this.ifr |= 1 << bit;
    this.updateIrq();
  }

  updateIrq(): void {
    this.irq = !this.intm && (this.ifr & this.ier) !== 0;
  }

  private dispatch(): void {
    while (!this.intm && (this.ifr & this.ier) !== 0) {
      const pending = this.ifr & this.ier;
      let n = 0;
      while (!(pending & (1 << n))) n++;
      this.ifr &= ~(1 << n);
      const vector = n < 12 ? this.pie.take(n + 1) : n === 12 ? "TIMER1_INT" : n === 13 ? "TIMER2_INT" : null;
      if (!vector) {
        this.updateIrq();
        continue;
      }
      const reg = this.dev.reg(`PieVectTable.${vector}`);
      const addr = this.mem.peek(reg.addr, 2);
      const fn = this.compiler.fnAt(addr);
      if (!fn || fn === this.defaultIsr) {
        throw new RuntimeError(
          this.line,
          `The ${vector} interrupt fired, but PieVectTable.${vector} does not point to your function, so the CPU jumped to the default handler and stopped. ` +
            `Set it between EALLOW; and EDIS;, for example: PieVectTable.${vector} = &my_isr;`,
        );
      }
      if (!fn.interrupt)
        this.warn(fn.line, "isr-keyword", `'${fn.name}' is used as an interrupt function, so it must be declared with __interrupt: __interrupt void ${fn.name}(void)`);
      const saved = { ier: this.ier, eallow: this.mem.eallow, line: this.line };
      this.ier &= ~(1 << n);
      this.intm = true;
      this.mem.eallow = false;
      this.irq = false;
      this.isrDepth++;
      this.mem.writes++;
      const entry: IsrLog = { t: this.now, name: fn.name, vector, dur: -1 };
      this.isrLog.push(entry);
      this.now += 14 * SYSCLK_NS;
      const began = this.now;
      try {
        this.compiler.invoke(fn, [], fn.line);
      } finally {
        this.isrDepth--;
        entry.dur = this.now - began;
      }
      this.now += 8 * SYSCLK_NS;
      this.ier = saved.ier;
      this.mem.eallow = saved.eallow;
      this.line = saved.line;
      this.intm = false;
      this.pie.evaluate();
    }
    this.updateIrq();
  }

  // ---------- diagnostics ----------

  warn(line: number, code: string, msg: string, severity: Diagnostic["severity"] = "warning"): void {
    const key = `${code}:${line}`;
    const d = this.diagnostics.get(key);
    if (d) d.count++;
    else this.diagnostics.set(key, { line, code, msg, count: 1, t: this.steps ? this.now : -1, severity });
  }

  /** Value of a global variable by name (for checks and the watch view). */
  readVar(name: string): number | undefined {
    const g = this.compiler.globals.get(name);
    if (!g) return undefined;
    const t = g.t;
    if (t.k === "int") {
      const v = this.mem.peek(g.addr, t.w);
      if (!t.s) return v;
      return t.w === 1 ? (v << 16) >> 16 : v | 0;
    }
    if (t.k === "float") {
      const buf = new Float32Array(1);
      new Uint32Array(buf.buffer)[0] = this.mem.peek(g.addr, 2);
      return buf[0];
    }
    if (t.k === "ptr") return this.mem.peek(g.addr, 2);
    return undefined;
  }
}
