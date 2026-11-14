// Runs a program on a board kit, applies scripted stimuli, and evaluates
// a level's checks.

import { Board, type Diagnostic, type IsrLog } from "./board";
import { CError } from "./cc/lexer";
import { RuntimeError } from "./cc/compile";
import { KITS, findPart, type Kit } from "./world/kits";
import { PIN_COUNT, PORTS, type PinChange } from "./periph/gpio";

const MS = 1e6;

export type Stimulus =
  | { at: number; press: string }
  | { at: number; release: string }
  /** Sets a named input of the signal bus (a knob, a sensor value, a shaft speed). */
  | { at: number; set: string; value: number }
  /** Characters typed into the serial terminal, one after another. */
  | { at: number; type: string; port?: number };

export type Check = { label: string; hint?: string } & (
  | { kind: "led"; led: string; at: number; on: boolean }
  | { kind: "pin"; pin: number; at: number; level: 0 | 1 }
  /** Full on+off period of a blinking LED or pin, measured between `from` and `to` (ms). */
  | { kind: "blink"; led?: string; pin?: number; periodMs: number; tolPct?: number; from?: number; to?: number }
  | { kind: "steady"; led: string; from: number; to: number; on: boolean }
  /** Exactly one of two LEDs is lit, sampled across [from, to] ms. */
  | { kind: "opposite"; a: string; b: string; from: number; to: number }
  | { kind: "serial"; port?: number; includes?: string; equals?: string; matches?: string }
  /** Text printed with printf (the console, not the serial port). */
  | { kind: "console"; includes?: string; equals?: string; matches?: string }
  /** Time between the starts of consecutive printed lines. */
  | { kind: "serial-period"; port?: number; periodMs: number; tolPct?: number }
  /** A line of the robot board's LCD, at `at` ms (default: at the end of the run). */
  | { kind: "lcd"; line: 1 | 2; matches: string; at?: number }
  | { kind: "reg"; reg: string; field?: string; equals: number; at?: number }
  /**
   * The output latch of a whole port ("A" to "F"): what DAT / SET / CLEAR / TOGGLE writes left in
   * it, also for pins that are inputs, where the pin itself shows nothing. Read at `at` ms (default: end).
   */
  | { kind: "latch"; port: "A" | "B" | "C" | "D" | "E" | "F"; equals: number; at?: number }
  | { kind: "var"; name: string; equals?: number; min?: number; max?: number; at?: number }
  | { kind: "isr"; fn: string; min?: number; max?: number }
  /** A named output of the signal bus (e.g. "DACA" in volts) at time `at` ms (default: end of run). */
  | { kind: "signal"; name: string; at?: number; equals?: number; tol?: number; min?: number; max?: number }
  /** Fraction of time an LED or pin is on/high between `from` and `to`, in percent. */
  | { kind: "duty"; led?: string; pin?: number; pct: number; tolPct?: number; from?: number; to?: number }
  /**
   * Time from one switch-on of an LED (or rising edge of a pin) to the next, between `from` and `to` (ms).
   * Unlike `blink` it does not assume equal on and off times, so it fits a PWM waveform. Every
   * period in the window must be within `tolPct` percent (default 2) of `periodMs`.
   */
  | { kind: "period"; led?: string; pin?: number; periodMs: number; tolPct?: number; from?: number; to?: number }
  /** The pin changes within `withinUs` microseconds after time `after` (ms), e.g. after a button press. */
  | { kind: "latency"; led?: string; pin?: number; after: number; withinUs: number }
  /** Text sent on a pin as a UART waveform (start bit, 8 data bits LSB first, stop bit), decoded at `baud`. */
  | { kind: "uart"; pin: number; baud: number; includes: string }
  /** Longest single run of an interrupt function, microseconds. */
  | { kind: "isr-time"; fn: string; maxUs: number }
  /** Total C statements executed during the run (a measure of CPU work). */
  | { kind: "max-steps"; max: number }
  /** Lines of code, not counting blank lines and comments. */
  | { kind: "max-lines"; max: number }
  | { kind: "no-dat-write" }
  | { kind: "no-diagnostic"; code: string }
  | { kind: "source"; mustMatch?: string; mustNotMatch?: string }
);

export interface RunSpec {
  kit: string;
  source: string;
  /** Simulated time to run, ms. */
  durationMs: number;
  stimuli?: Stimulus[];
  checks?: Check[];
  /** Optional objectives, evaluated like checks but reported separately. */
  bonus?: Check[];
}

export interface CheckResult {
  label: string;
  pass: boolean;
  detail: string;
  hint?: string;
  /** The measured number behind the check, when it has one (for personal bests). */
  value?: number;
}

export interface RunResult {
  /** Compiled and ran without a runtime error. */
  ran: boolean;
  /** Every check passed and nothing was reported as an error. */
  passed: boolean;
  compileError?: { line: number; msg: string };
  runtimeError?: { line: number; msg: string; tMs: number };
  checks: CheckResult[];
  bonus: CheckResult[];
  diagnostics: Diagnostic[];
  serial: string[];
  console: string;
  lcd: [string, string];
  traces: Map<number, PinChange[]>;
  isrLog: IsrLog[];
  endMs: number;
  board: Board;
  kit: Kit;
}

const fmtMs = (ms: number) => `${+ms.toFixed(3)} ms`;

export function runProgram(spec: RunSpec): RunResult {
  const kit = KITS[spec.kit];
  if (!kit) throw new Error(`unknown kit ${spec.kit}`);
  const b = new Board(spec.kit);
  const end = spec.durationMs * MS;
  const res: RunResult = {
    ran: false, passed: false, checks: [], bonus: [], diagnostics: [], serial: [], console: "", lcd: ["", ""],
    traces: b.gpio.trace, isrLog: b.isrLog, endMs: spec.durationMs, board: b, kit,
  };
  const finish = () => {
    // Still waiting in the same loop after most of the test: what it waits for never came.
    if (b.waitLine && b.now - b.waitSince >= 0.6 * end && !res.runtimeError)
      b.warn(
        b.waitLine,
        "wait-forever",
        `The program reached this loop at ${(b.waitSince / MS).toFixed(2)} ms and was still waiting in it when the test ended: its condition never changed. Whatever it waits for (a flag, a status bit) was never set. Check that the thing that sets it is switched on and can happen.`,
      );
    res.diagnostics = [...b.diagnostics.values()].sort((x, y) => x.line - y.line);
    res.serial = [0, 1, 2, 3].map((p) => b.sci.text(p));
    res.console = b.console;
    res.lcd = b.lcd;
    return res;
  };

  try {
    b.load(spec.source);
  } catch (e) {
    if (e instanceof CError) {
      res.compileError = { line: e.file === "user" ? e.line : 0, msg: e.file === "user" ? e.message : `Library error: ${e.message}` };
      return finish();
    }
    throw e;
  }

  // Knobs start at their initial positions.
  for (const p of kit.parts) if (p.kind === "knob" && !b.inputs.has(p.input)) b.setInput(p.input, p.initial, 0);

  // Stimuli.
  for (const s of spec.stimuli ?? []) {
    if ("set" in s) {
      b.at(s.at * MS, (t) => b.setInput(s.set, s.value, t));
    } else if ("press" in s || "release" in s) {
      const id = "press" in s ? s.press : s.release;
      const part = findPart(kit, id);
      if (part.kind !== "button") throw new Error(`${id} is not a button`);
      const pin = part.pin;
      // A pressed button connects the pin to ground; released, it connects to nothing.
      b.at(s.at * MS, (t) => b.gpio.drive(pin, "press" in s ? 0 : null, t));
    } else {
      const port = s.port ?? 0;
      [...s.type].forEach((ch, i) => {
        const charMs = (10 / 115200) * 1000;
        b.sci.receive(port, ch.charCodeAt(0), (s.at + (i + 1) * charMs) * MS);
      });
    }
  }

  // Samples that must be taken while running.
  const samples = new Map<Check, number | undefined>();
  const lcdSamples = new Map<Check, string>();
  for (const c of [...(spec.checks ?? []), ...(spec.bonus ?? [])]) {
    if ((c.kind === "reg" || c.kind === "var") && c.at !== undefined) {
      b.at(c.at * MS, () => samples.set(c, c.kind === "reg" ? b.dev.get(c.reg, c.field) : b.readVar(c.name)));
    }
    if (c.kind === "lcd" && c.at !== undefined) b.at(c.at * MS, () => lcdSamples.set(c, b.lcd[c.line - 1]));
    if (c.kind === "latch" && c.at !== undefined) b.at(c.at * MS, () => samples.set(c, b.gpio.latchOf(PORTS.indexOf(c.port))));
  }

  const gen = b.run();
  try {
    b.runUntil(gen, end);
    res.ran = true;
  } catch (e) {
    if (e instanceof RuntimeError) res.runtimeError = { line: e.line, msg: e.message, tMs: b.now / MS };
    else if (e instanceof CError) res.compileError = { line: e.line, msg: e.message };
    else if (e instanceof RangeError) res.runtimeError = { line: b.line, msg: "The program used too much stack. A function is probably calling itself forever.", tMs: b.now / MS };
    else throw e;
  }
  res.endMs = Math.min(spec.durationMs, b.now / MS);

  const pinOf = (c: { led?: string; pin?: number }): { pin: number; activeLow: boolean; name: string } => {
    if (c.led) {
      const p = findPart(kit, c.led);
      if (p.kind !== "led") throw new Error(`${c.led} is not an LED`);
      return { pin: p.pin, activeLow: p.activeLow, name: p.label };
    }
    return { pin: c.pin!, activeLow: false, name: `GPIO${c.pin}` };
  };
  const lit = (pin: number, activeLow: boolean, tMs: number): boolean => {
    // An LED only lights when its pin is actually driven as an output.
    if (!b.gpio.isOutput(pin) && b.gpio.mux(pin) === 0) return false;
    const lv = b.gpio.levelAt(pin, tMs * MS);
    return lv < 0 ? false : activeLow ? lv === 0 : lv === 1;
  };

  /**
   * The part of the run a check measures over, ms. `empty` is set, as the sentence to show, when
   * that part has no length: a window that ends where it starts, or one that starts after the test.
   */
  const windowOf = (c: { from?: number; to?: number }): { from: number; to: number; empty?: string } => {
    const from = c.from ?? 0;
    const to = Math.min(c.to ?? spec.durationMs, spec.durationMs);
    if (to > from) return { from, to };
    const why = from >= spec.durationMs ? `it starts at ${fmtMs(from)}, and the test ends at ${fmtMs(spec.durationMs)}` : `it runs from ${fmtMs(from)} to ${fmtMs(c.to ?? spec.durationMs)}, which is no time at all`;
    return { from, to, empty: `Not measured: the time window of this check is empty (${why}). This is a mistake in the level, not in your program.` };
  };
  /** Why a pin that never changed in a window is probably not doing what the program wants. */
  const whyStill = (pin: number): string =>
    b.gpio.mux(pin) !== 0
      ? ` GPIO${pin} is handed to a peripheral in the pin mux, and that peripheral's signal did not change.`
      : !b.gpio.isOutput(pin)
        ? ` GPIO${pin} is not set as an output.`
        : "";
  const NAN_NOTE = " NaN means \"not a number\": the result of a calculation such as 0.0 / 0.0 or sqrt() of a negative number.";

  const evaluate = (c: Check, into: CheckResult[]): void => {
    let pass = false;
    let detail = "";
    let value: number | undefined;
    if (!res.ran && c.kind !== "source" && c.kind !== "max-lines") {
      const e = res.runtimeError;
      // A program stuck in an interrupt function is only given up on long after the test's end: no time then.
      const early = e && e.tMs < spec.durationMs;
      const when = e ? `${early ? ` at ${fmtMs(e.tMs)}` : ""}${e.line ? `${early ? "," : ""} on line ${e.line}` : ""}${early ? ", before the test was over" : ""}` : "";
      into.push({ label: c.label, pass: false, detail: `Not checked: the program stopped with an error${when}.`, hint: c.hint });
      return;
    }
    switch (c.kind) {
      case "led": {
        const p = pinOf(c);
        const on = lit(p.pin, p.activeLow, c.at);
        pass = on === c.on;
        detail = `${p.name} was ${on ? "on" : "off"} at ${fmtMs(c.at)}${pass ? "" : `, expected ${c.on ? "on" : "off"}`}.`;
        if (!pass && !b.gpio.isOutput(p.pin)) detail += ` GPIO${p.pin} is still an input, so it cannot drive the LED.`;
        break;
      }
      case "pin": {
        const lv = b.gpio.levelAt(c.pin, c.at * MS);
        pass = lv === c.level;
        detail = `GPIO${c.pin} was ${lv < 0 ? "floating" : lv ? "high" : "low"} at ${fmtMs(c.at)}${pass ? "" : `, expected ${c.level ? "high" : "low"}`}.`;
        break;
      }
      case "steady": {
        const p = pinOf(c);
        const tr = (b.gpio.trace.get(p.pin) ?? []).filter((x) => x.t > c.from * MS && x.t <= c.to * MS);
        const on = lit(p.pin, p.activeLow, c.from);
        pass = tr.length === 0 && on === c.on;
        detail = tr.length
          ? `${p.name} changed ${tr.length} time${tr.length === 1 ? "" : "s"} between ${fmtMs(c.from)} and ${fmtMs(c.to)}; it should stay ${c.on ? "on" : "off"}.`
          : `${p.name} stayed ${on ? "on" : "off"}${pass ? "" : `, expected ${c.on ? "on" : "off"}`}.`;
        break;
      }
      case "opposite": {
        const pa = pinOf({ led: c.a });
        const pb = pinOf({ led: c.b });
        let bad = -1;
        for (let i = 0; i <= 40 && bad < 0; i++) {
          const t = c.from + ((c.to - c.from) * i) / 40 + 0.37;
          if (lit(pa.pin, pa.activeLow, t) === lit(pb.pin, pb.activeLow, t)) bad = t;
        }
        pass = bad < 0;
        detail = pass
          ? `${pa.name} and ${pb.name} were never on or off together.`
          : `At ${fmtMs(bad)} ${pa.name} and ${pb.name} were both ${lit(pa.pin, pa.activeLow, bad) ? "on" : "off"}.`;
        break;
      }
      case "blink": {
        const p = pinOf(c);
        const w = windowOf(c);
        if (w.empty) {
          detail = w.empty;
          break;
        }
        const from = w.from * MS;
        const to = w.to * MS;
        const tr = (b.gpio.trace.get(p.pin) ?? []).filter((x) => x.t >= from && x.t <= to);
        if (tr.length < 3) {
          detail = `${p.name} changed ${tr.length} time${tr.length === 1 ? "" : "s"} in the test window, so it is not blinking.${whyStill(p.pin)}`;
          break;
        }
        // Median gap between changes: start-up transitions do not skew it.
        const gaps = tr.slice(1).map((x, i) => x.t - tr[i].t).sort((x, y) => x - y);
        const half = gaps[gaps.length >> 1] / MS;
        const period = half * 2;
        const tol = (c.tolPct ?? 2) / 100;
        pass = Math.abs(period - c.periodMs) <= c.periodMs * tol;
        detail = `${p.name} blinks with a period of ${fmtMs(period)} (changes every ${fmtMs(half)})${pass ? "" : `, expected ${fmtMs(c.periodMs)}`}.`;
        break;
      }
      case "period": {
        const p = pinOf(c);
        const w = windowOf(c);
        if (w.empty) {
          detail = w.empty;
          break;
        }
        const onLevel = p.activeLow ? 0 : 1;
        const verb = c.led ? "switches on" : "rises";
        // Switch-on edges: the level becomes "on" and was not "on" just before.
        const starts: number[] = [];
        let prev = -1;
        for (const x of b.gpio.trace.get(p.pin) ?? []) {
          if (x.t > w.to * MS) break;
          if (x.level === onLevel && prev !== onLevel && x.t >= w.from * MS) starts.push(x.t);
          prev = x.level;
        }
        if (starts.length < 2) {
          detail = `${p.name} ${c.led ? "switched on" : "rose"} ${starts.length} time${starts.length === 1 ? "" : "s"} between ${fmtMs(w.from)} and ${fmtMs(w.to)}. Two are needed to measure a period.${starts.length ? "" : whyStill(p.pin)}`;
          break;
        }
        const gaps = starts.slice(1).map((t, i) => (t - starts[i]) / MS).sort((x, y) => x - y);
        const lo = gaps[0];
        const hi = gaps[gaps.length - 1];
        const tol = c.periodMs * ((c.tolPct ?? 2) / 100);
        value = gaps[gaps.length >> 1];
        pass = Math.abs(lo - c.periodMs) <= tol && Math.abs(hi - c.periodMs) <= tol;
        const even = hi - lo <= 1e-6 * Math.max(1, hi);
        detail = even
          ? `${p.name} ${verb} every ${fmtMs(value)}${pass ? "" : `, expected every ${fmtMs(c.periodMs)}`}.`
          : `${p.name} ${verb} at uneven intervals, from ${fmtMs(lo)} to ${fmtMs(hi)}${pass ? "" : `; expected every ${fmtMs(c.periodMs)}`}.`;
        break;
      }
      case "serial": {
        const text = b.sci.text(c.port ?? 0);
        if (c.equals !== undefined) pass = text === c.equals;
        else if (c.includes !== undefined) pass = text.includes(c.includes);
        else if (c.matches !== undefined) pass = new RegExp(c.matches).test(text);
        const shown = JSON.stringify(text.length > 80 ? text.slice(0, 80) + "…" : text);
        detail = text.length ? `The terminal received ${shown}.` : "Nothing was received on the serial terminal.";
        break;
      }
      case "console": {
        const text = b.console;
        if (c.equals !== undefined) pass = text === c.equals;
        else if (c.includes !== undefined) pass = text.includes(c.includes);
        else if (c.matches !== undefined) pass = new RegExp(c.matches).test(text);
        const shown = JSON.stringify(text.length > 120 ? text.slice(0, 120) + "..." : text);
        detail = text.length ? `The program printed ${shown}.` : "The program printed nothing.";
        if (!pass && c.equals !== undefined) detail += ` Expected exactly ${JSON.stringify(c.equals)}.`;
        break;
      }
      case "serial-period": {
        const bytes = b.sci.tx[c.port ?? 0];
        const starts: number[] = [];
        let atLineStart = true;
        for (const x of bytes) {
          if (atLineStart) starts.push(x.t);
          atLineStart = x.ch === 10;
        }
        if (starts.length < 3) {
          detail = `Only ${starts.length} line${starts.length === 1 ? " was" : "s were"} printed; at least 3 are needed to measure the period.`;
          break;
        }
        const period = (starts[starts.length - 1] - starts[0]) / (starts.length - 1) / MS;
        pass = Math.abs(period - c.periodMs) <= c.periodMs * ((c.tolPct ?? 2) / 100);
        detail = `A line is printed every ${fmtMs(period)}${pass ? "" : `, expected every ${fmtMs(c.periodMs)}`}.`;
        break;
      }
      case "lcd": {
        const text = lcdSamples.get(c) ?? b.lcd[c.line - 1];
        pass = new RegExp(c.matches).test(text);
        detail = `LCD line ${c.line} ${c.at !== undefined ? `showed ${JSON.stringify(text)} at ${fmtMs(c.at)}` : `shows ${JSON.stringify(text)}`}.`;
        break;
      }
      case "reg": {
        const name = c.field ? `${c.reg}.bit.${c.field}` : c.reg;
        // A reading asked for at the very end of the run is the final value.
        const v = c.at !== undefined && samples.has(c) ? samples.get(c) : b.dev.get(c.reg, c.field);
        pass = v === c.equals >>> 0;
        detail = `${name} is ${fmtVal(v)}${pass ? "" : `, expected ${fmtVal(c.equals >>> 0)}`}.`;
        break;
      }
      case "latch": {
        const port = PORTS.indexOf(c.port);
        const v = (c.at !== undefined && samples.has(c) ? samples.get(c)! : b.gpio.latchOf(port)) >>> 0;
        const want = c.equals >>> 0;
        pass = v === want;
        const hex = (x: number) => `0x${x.toString(16).toUpperCase().padStart(8, "0")}`;
        detail = `The output latch of port ${c.port} holds ${hex(v)}${pass ? "" : `, expected ${hex(want)}`}.`;
        if (!pass) {
          // Name the pins: a latch bit of an input shows on no pin, so say why it still matters.
          const pins = (mask: number) => {
            const list: number[] = [];
            for (let n = 0; n < 32; n++) if ((mask >>> n) & 1 && port * 32 + n < PIN_COUNT) list.push(port * 32 + n);
            return list.length > 4 ? `GPIO${list[0]} to GPIO${list[list.length - 1]} (${list.length} pins)` : list.map((n) => `GPIO${n}`).join(", ");
          };
          const extra = (v & ~want) >>> 0;
          const missing = (want & ~v) >>> 0;
          if (extra) {
            detail += ` Extra 1 bits: ${pins(extra)}.`;
            const hidden: number[] = [];
            for (let n = 0; n < 32; n++) {
              const pin = port * 32 + n;
              if ((extra >>> n) & 1 && pin < PIN_COUNT && !(b.gpio.mux(pin) === 0 && b.gpio.isOutput(pin))) hidden.push(pin);
            }
            if (hidden.length) detail += ` ${hidden.length === 1 ? `GPIO${hidden[0]} is` : "Some of them are"} not an output now, so nothing shows, but the latch remembers the 1 and drives the pin high the moment it becomes an output.`;
          }
          if (missing) detail += ` Missing 1 bits: ${pins(missing)}.`;
        }
        break;
      }
      case "var": {
        // A reading asked for at the very end of the run is the final value.
        const v = c.at !== undefined && samples.has(c) ? samples.get(c) : b.readVar(c.name);
        if (v === undefined) {
          detail = `There is no global variable named ${c.name}.`;
          break;
        }
        if (Number.isNaN(v)) {
          detail = `${c.name} is NaN.${NAN_NOTE}`;
          break;
        }
        const exact = Number.isInteger(v) && (c.equals === undefined || Number.isInteger(c.equals));
        pass = (c.equals === undefined || (exact ? v === c.equals : Math.abs(v - c.equals) < 1e-6 * Math.max(1, Math.abs(c.equals)))) && (c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max);
        const want = c.equals !== undefined ? `${c.equals}` : c.min === undefined ? `at most ${c.max}` : c.max === undefined ? `at least ${c.min}` : `${c.min} to ${c.max}`;
        detail = `${c.name} is ${Number.isInteger(v) ? v : +v.toPrecision(7)}${pass ? "" : `, expected ${want}`}.`;
        break;
      }
      case "isr": {
        const n = b.isrLog.filter((x) => x.name === c.fn).length;
        pass = (c.min === undefined || n >= c.min) && (c.max === undefined || n <= c.max);
        detail = `${c.fn} ran ${n} time${n === 1 ? "" : "s"}${pass ? "" : `, expected ${c.min !== undefined && c.max !== undefined ? `${c.min} to ${c.max}` : c.min !== undefined ? `at least ${c.min}` : `at most ${c.max}`}`}.`;
        break;
      }
      case "signal": {
        const v = b.output(c.name, c.at !== undefined ? c.at * MS : undefined);
        if (v === undefined && c.at !== undefined && b.output(c.name) !== undefined) {
          detail = `${c.name} had not produced a value yet at ${fmtMs(c.at)}. Its first value came later in the test.`;
          break;
        }
        if (v !== undefined && Number.isNaN(v)) {
          detail = `${c.name} was NaN${c.at !== undefined ? ` at ${fmtMs(c.at)}` : ""}.${NAN_NOTE}`;
          break;
        }
        if (v === undefined) {
          detail = `${c.name} never produced a value during the test. Either the program never reached the code that produces it, or the peripheral is not switched on, or its pin is not selected in the pin mux.`;
          break;
        }
        pass = (c.equals === undefined || Math.abs(v - c.equals) <= (c.tol ?? 1e-9)) && (c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max);
        const want = c.equals !== undefined ? `${c.equals}${c.tol ? ` (within ${c.tol})` : ""}` : c.min === undefined ? `at most ${c.max}` : c.max === undefined ? `at least ${c.min}` : `${c.min} to ${c.max}`;
        value = v;
        detail = `${c.name} was ${+v.toPrecision(5)}${c.at !== undefined ? ` at ${fmtMs(c.at)}` : ""}${pass ? "" : `, expected ${want}`}.`;
        break;
      }
      case "duty": {
        const p = pinOf(c);
        const w = windowOf(c);
        if (w.empty) {
          detail = w.empty;
          break;
        }
        const from = w.from * MS;
        const to = w.to * MS;
        let on = 0;
        let defined = 0;
        let lv = b.gpio.levelAt(p.pin, from);
        let last = from;
        for (const x of b.gpio.trace.get(p.pin) ?? []) {
          if (x.t <= from) continue;
          if (x.t >= to) break;
          if (lv >= 0 && (p.activeLow ? lv === 0 : lv === 1)) on += x.t - last;
          if (lv >= 0) defined += x.t - last;
          last = x.t;
          lv = x.level;
        }
        if (lv >= 0 && (p.activeLow ? lv === 0 : lv === 1)) on += to - last;
        if (lv >= 0) defined += to - last;
        const pct = (100 * on) / (to - from);
        pass = Math.abs(pct - c.pct) <= (c.tolPct ?? 2);
        detail = `${p.name} was ${c.led ? "on" : "high"} ${pct.toFixed(1)}% of the time between ${fmtMs(w.from)} and ${fmtMs(w.to)}${pass ? "" : `, expected ${c.pct}%`}.`;
        // No level at all is not the same as a pin held low: say which it was.
        if (!pass && defined === 0) detail = `GPIO${p.pin} had no level between ${fmtMs(w.from)} and ${fmtMs(w.to)}: nothing drove it, so ${c.led ? `${p.name} was never on` : "it was never high"}, expected ${c.pct}% of the time.${whyStill(p.pin)}`;
        else if (!pass && c.led && pct === 0 && whyStill(p.pin)) detail += whyStill(p.pin);
        break;
      }
      case "latency": {
        const p = pinOf(c);
        const first = (b.gpio.trace.get(p.pin) ?? []).find((x) => x.t >= c.after * MS);
        if (!first) {
          detail = `${p.name} never changed after ${fmtMs(c.after)}.`;
          break;
        }
        const us = (first.t - c.after * MS) / 1000;
        pass = us <= c.withinUs;
        detail = `${p.name} changed ${us < 10 ? us.toFixed(2) : us.toFixed(0)} us after the event${pass ? "" : `, the limit is ${c.withinUs} us`}.`;
        break;
      }
      case "uart": {
        const text = decodeUart(b.gpio.trace.get(c.pin) ?? [], c.baud, end);
        pass = text.includes(c.includes);
        const shown = JSON.stringify(text.length > 60 ? text.slice(0, 60) + "..." : text);
        detail = text.length ? `Decoding GPIO${c.pin} at ${c.baud} baud gives ${shown}.` : `No valid UART frame was found on GPIO${c.pin} at ${c.baud} baud.`;
        break;
      }
      case "isr-time": {
        const runs = b.isrLog.filter((x) => x.name === c.fn && x.dur >= 0);
        if (!runs.length) {
          detail = `${c.fn} never ran.`;
          break;
        }
        const worst = Math.max(...runs.map((x) => x.dur)) / 1000;
        value = worst;
        pass = worst <= c.maxUs;
        detail = `The longest run of ${c.fn} took ${worst.toFixed(2)} us${pass ? "" : `, the budget is ${c.maxUs} us`}.`;
        break;
      }
      case "max-steps":
        pass = b.steps <= c.max;
        detail = `The program executed ${b.steps} statements${pass ? "" : `, the limit is ${c.max}`}.`;
        break;
      case "max-lines": {
        const n = stripComments(spec.source).split("\n").filter((l) => l.trim() !== "").length;
        pass = n <= c.max;
        detail = `The code has ${n} lines${pass ? "" : `, the limit is ${c.max}`}.`;
        break;
      }
      case "no-dat-write":
        pass = b.gpio.datWrites.size === 0;
        detail = pass ? "No output was changed through a GPxDAT register." : `The code writes ${[...b.gpio.datWrites].join(", ")}. Use the SET, CLEAR or TOGGLE register instead.`;
        break;
      case "no-diagnostic": {
        const d = [...b.diagnostics.values()].find((x) => x.code === c.code || x.code.startsWith(`${c.code}-`));
        pass = !d;
        detail = d ? `Line ${d.line}: ${d.msg}` : "No problem reported.";
        break;
      }
      case "source": {
        const code = stripComments(spec.source);
        pass = (!c.mustMatch || new RegExp(c.mustMatch).test(code)) && (!c.mustNotMatch || !new RegExp(c.mustNotMatch).test(code));
        const missing = !!c.mustMatch && !new RegExp(c.mustMatch).test(code);
        detail = pass
          ? c.mustMatch
            ? "The code does this."
            : "The code avoids this."
          : missing
            ? "The code does not do this yet."
            : "The code still contains what this asks you to avoid.";
        break;
      }
    }
    into.push({ label: c.label, pass, detail, hint: pass ? undefined : c.hint, value });
  };
  for (const c of spec.checks ?? []) evaluate(c, res.checks);
  for (const c of spec.bonus ?? []) evaluate(c, res.bonus);
  finish();
  res.passed = res.ran && res.checks.every((c) => c.pass) && !res.diagnostics.some((d) => d.severity === "error");
  return res;
}

/**
 * Reads a pin trace as 8N1 serial data: waits for a falling edge (start
 * bit), samples the middle of each of the 8 data bits (LSB first) and
 * requires a high stop bit.
 */
export function decodeUart(trace: PinChange[], baud: number, endNs: number): string {
  const bit = 1e9 / baud;
  const levelAt = (t: number): number => {
    let lv = 1;
    for (const c of trace) {
      if (c.t > t) break;
      lv = c.level;
    }
    return lv;
  };
  let out = "";
  let t = 0;
  for (let i = 1; i < trace.length; i++) {
    const c = trace[i];
    if (c.t < t || c.level !== 0 || trace[i - 1].level !== 1) continue;
    if (c.t + 9.5 * bit > endNs) break;
    let v = 0;
    for (let k = 0; k < 8; k++) v |= levelAt(c.t + (1.5 + k) * bit) << k;
    if (levelAt(c.t + 9.5 * bit) !== 1) continue; // framing error: not a stop bit
    out += String.fromCharCode(v);
    t = c.t + 9.5 * bit;
  }
  return out;
}

function fmtVal(v: number | undefined): string {
  if (v === undefined) return "unknown";
  return v > 9 ? `${v} (0x${v.toString(16).toUpperCase()})` : `${v}`;
}

export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}
