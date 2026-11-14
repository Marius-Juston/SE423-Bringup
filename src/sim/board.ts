// The simulated F28379D: memory, time, events, CPU interrupt logic, and the
// compiled program. Peripherals attach themselves in their constructors.

import { Memory } from "./memory";
import { Device } from "./device/device";
import { Compiler, RuntimeError, STACK_BASE, type Fn, type Rt } from "./cc/compile";
import { ParseContext, Parser } from "./cc/parser";
import { CError, Preprocessor } from "./cc/lexer";
import { UINT, sizeOf } from "./cc/types";
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

/** One CPU write to a register, for the change log. */
export interface WriteEntry {
  /** Position in the run (counts every logged write, also ones no longer kept). */
  n: number;
  t: number;
  /** Line of the student's code that caused it (0: before the program ran). */
  line: number;
  name: string;
  /** Stored value before and after the write. */
  before: number;
  after: number;
  /** The value the code wrote (differs from `after` for write-1-to-set style registers). */
  written: number;
  /** Written by course-library code called from that line. */
  lib: boolean;
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
  overrun = 0;
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
  /** Entries removed from the start of isrLog (live runs only): isrLog[i] is interrupt number i + isrDropped. */
  isrDropped = 0;
  /** Function used by InitPieVectTable for every vector. */
  defaultIsr: Fn | null = null;
  /** Vectors whose interrupt function has run at least once. */
  served = new Set<string>();
  /** EINT has run at least once. */
  private everEnabled = false;

  /** Register writes in order (the most recent 4000). */
  writeLog: WriteEntry[] = [];
  private writeCount = 0;
  diagnostics = new Map<string, Diagnostic>();
  mainReturned = false;
  /** InitSysCtrl() has run (or its absence has been reported once). */
  sysInit = false;
  /** Report a program that writes registers without InitSysCtrl(). Tests of one peripheral run bare programs and switch this off. */
  static expectInitSysCtrl = true;
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

  /** Which course board this is ("robot", "launchpad", "redboard"): plugins use it to attach only what that board has. */
  readonly kit: string;

  constructor(kit = "robot") {
    this.kit = kit;
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

    this.mem.onWrite = (reg, written, before) => {
      // The clocks are not modelled, so a program without InitSysCtrl() runs here. On the chip it would not.
      if (Board.expectInitSysCtrl && !this.sysInit && !this.libDepth && this.line > 0) {
        this.sysInit = true;
        this.warn(
          this.line,
          "no-initsysctrl",
          `${reg.name} is written before InitSysCtrl() has run. On the real chip the watchdog would reset the program after a few milliseconds and the peripheral clocks would be off. Make InitSysCtrl(); the first line of main().`,
        );
      }
      const after = this.mem.peek(reg.addr, reg.words);
      // Library code is only interesting when it actually changed something.
      if (this.libDepth && after === before) return;
      this.writeLog.push({ n: this.writeCount++, t: this.now, line: this.line, name: reg.name, before, after, written, lib: this.libDepth > 0 });
      if (this.writeLog.length > 4000) this.writeLog.splice(0, 1000);
    };

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
    this.inputsUsed.add(name);
    return this.inputs.get(name) ?? fallback;
  }
  /** Inputs something has actually read (the bench shows only these knobs). */
  inputsUsed = new Set<string>();

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
    // A live run can go on for minutes: keep the recent history only.
    if (this.historyLimit && tr.length > this.historyLimit) tr.splice(0, tr.length - (this.historyLimit >> 1));
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
    if (this.pendingDelay) {
      const rest = this.pendingDelay;
      this.pendingDelay = 0;
      this.delay(rest);
    }
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

  /**
   * Longest history kept per pin and per output, in entries (0: everything).
   * A test run keeps everything; a live run sets a limit, because a 20 kHz
   * PWM pin alone records 40 000 changes a second.
   */
  historyLimit = 0;

  /** Line of the conditional loop the program is waiting in, and since when (ns). */
  waitLine = 0;
  waitSince = 0;
  /** The idle pass that follows comes from the waiting loop itself. */
  private waitIdle = false;
  waiting(line: number): void {
    this.waitIdle = line !== 0;
    if (line !== this.waitLine) {
      this.waitLine = line;
      this.waitSince = this.now;
    }
  }

  idle(): void {
    // Another loop is idling now: the waiting loop was left with break or return.
    if (!this.waitIdle) this.waitLine = 0;
    this.waitIdle = false;
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

  /**
   * Busy-waits for `ns` (DELAY_US). Time passes, so events happen and
   * interrupts are taken during the wait, as on the chip.
   */
  delay(ns: number): void {
    const target = this.now + ns;
    // Stop at the end of the current run slice; the rest of the wait is
    // served when the program resumes (see tick).
    const limit = this.pauseAt > this.now ? Math.min(target, this.pauseAt) : target;
    while (this.now < limit) {
      const next = this.events.length ? Math.min(this.events[0].t, limit) : limit;
      if (next > this.now) this.now = next;
      if (this.events.length && this.events[0].t <= this.now) this.runEvents();
      if (this.irq) this.dispatch();
    }
    if (this.now < target) {
      this.pendingDelay = target - this.now;
      this.pause = true;
    }
  }
  private pendingDelay = 0;
  waitLeft(): boolean {
    return this.pendingDelay > 0;
  }
  waitOn(): void {
    const rest = this.pendingDelay;
    this.pendingDelay = 0;
    if (rest) this.delay(rest);
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
    if (!v) this.everEnabled = true;
    this.updateIrq();
  }

  /** Sets a CPU interrupt flag (bit 0 = INT1 ... bit 13 = INT14). */
  raiseCpu(bit: number): void {
    this.mem.writes++;
    // Timers 1 and 2 have no PIE channel: a second request with the first still waiting was lost.
    if (bit >= 12 && this.ifr & (1 << bit)) this.blocked(bit === 12 ? "TIMER1_INT" : "TIMER2_INT", bit + 1, null);
    this.ifr |= 1 << bit;
    this.updateIrq();
  }

  /** The student's function a vector points to (null: not set, or still the default handler). */
  isrFor(vector: string): Fn | null {
    const reg = this.dev.regs.get(`PieVectTable.${vector}`);
    if (!reg) return null;
    const fn = this.compiler.fnAt(this.mem.peek(reg.addr, 2));
    return fn && fn !== this.defaultIsr ? fn : null;
  }

  /**
   * An interrupt was requested again while its last request was still
   * waiting. When the cause is a missing enable, say so on the interrupt
   * function. `pieReason` is what the PIE found (null: its side is fine).
   * The message is taken back if the function runs after all (a slow set-up
   * before EINT is not a mistake).
   */
  blocked(vector: string, cpuInt: number, pieReason: string | null): void {
    // Inside an interrupt function INTM and IER are changed by the CPU itself.
    if (this.isrDepth) return;
    const fn = this.isrFor(vector);
    if (!fn) return;
    let reason = pieReason;
    if (!reason && !(this.ier & (1 << (cpuInt - 1)))) reason = `IER does not have M_INT${cpuInt} set. Add IER |= M_INT${cpuInt};`;
    if (!reason && this.intm && !this.everEnabled) reason = "interrupts are still disabled globally. Add EINT; after the set-up.";
    if (!reason) return;
    this.warn(
      fn.line,
      `irq-blocked-${vector}`,
      `'${fn.name}' has not run: the ${vector} interrupt was requested more than once, but it cannot reach the CPU: ${reason}`,
    );
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
      this.served.add(vector);
      this.diagnostics.delete(`irq-blocked-${vector}:${fn.line}`);
      if (n < 12) this.pie.acked &= ~(1 << n);
      const saved = { ier: this.ier, eallow: this.mem.eallow, line: this.line };
      this.ier &= ~(1 << n);
      this.intm = true;
      this.mem.eallow = false;
      this.irq = false;
      this.isrDepth++;
      this.mem.writes++;
      const entry: IsrLog = { t: this.now, name: fn.name, vector, dur: -1 };
      this.isrLog.push(entry);
      // A live run keeps the recent ones only (a 10 kHz interrupt adds 36 million entries an hour).
      if (this.historyLimit && this.isrLog.length > this.historyLimit) {
        const cut = this.isrLog.length - (this.historyLimit >> 1);
        this.isrLog.splice(0, cut);
        this.isrDropped += cut;
      }
      this.now += 14 * SYSCLK_NS;
      const began = this.now;
      try {
        this.compiler.invoke(fn, [], fn.line);
      } finally {
        this.isrDepth--;
        entry.dur = this.now - began;
      }
      this.now += 8 * SYSCLK_NS;
      // TRM 3.4.5 step 9: the group stays blocked until the function writes its PIEACK bit.
      if (n < 12 && !(this.pie.acked & (1 << n)))
        this.warn(
          fn.line,
          "pie-no-ack",
          `'${fn.name}' returned without acknowledging PIE group ${n + 1}, so no interrupt of group ${n + 1} can reach the CPU again, this one included. ` +
            `End the function with PieCtrlRegs.PIEACK.all = PIEACK_GROUP${n + 1};`,
        );
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

  /**
   * Elements of a global array by name, flattened (for bench views that
   * draw images, maps or buffers). Returns undefined if there is no such
   * array of numbers.
   */
  readArray(name: string): { data: number[]; dims: number[] } | undefined {
    const g = this.compiler.globals.get(name);
    if (!g || g.t.k !== "array") return undefined;
    const dims: number[] = [];
    let t = g.t as import("./cc/types").CType;
    while (t.k === "array") {
      dims.push(t.n);
      t = t.of;
    }
    if (t.k !== "int" && t.k !== "float") return undefined;
    const n = dims.reduce((a, b) => a * b, 1);
    const data = new Array<number>(n);
    const buf = new Float32Array(1);
    const bits = new Uint32Array(buf.buffer);
    for (let i = 0; i < n; i++) {
      const raw = this.mem.peek(g.addr + i * t.w, t.w);
      if (t.k === "float") {
        bits[0] = raw;
        data[i] = buf[0];
      } else data[i] = !t.s ? raw : t.w === 1 ? (raw << 16) >> 16 : raw | 0;
    }
    return { data, dims };
  }

  /** Value of a global variable by name (for checks and the watch view). */
  /** The value of a global variable, or of an array element named as in C: "reply[3]", "map[2][5]". */
  readVar(name: string): number | undefined {
    const m = /^(\w+)((?:\[\d+\])*)$/.exec(name.trim());
    const g0 = m ? this.compiler.globals.get(m[1]) : undefined;
    if (!g0 || !m) return undefined;
    let t = g0.t;
    let at = g0.addr;
    for (const ix of m[2].match(/\d+/g) ?? []) {
      if (t.k !== "array" || +ix >= t.n) return undefined;
      t = t.of;
      at += +ix * sizeOf(t);
    }
    const g = { addr: at };
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
