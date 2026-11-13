// Runs a program on a board kit, applies scripted stimuli, and evaluates
// a level's checks.

import { Board, type Diagnostic, type IsrLog } from "./board";
import { CError } from "./cc/lexer";
import { RuntimeError } from "./cc/compile";
import { KITS, findPart, type Kit } from "./world/kits";
import type { PinChange } from "./periph/gpio";

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
  | { kind: "lcd"; line: 1 | 2; matches: string }
  | { kind: "reg"; reg: string; field?: string; equals: number; at?: number }
  | { kind: "var"; name: string; equals?: number; min?: number; max?: number; at?: number }
  | { kind: "isr"; fn: string; min?: number; max?: number }
  /** A named output of the signal bus (e.g. "DACA" in volts) at time `at` ms (default: end of run). */
  | { kind: "signal"; name: string; at?: number; equals?: number; tol?: number; min?: number; max?: number }
  /** Fraction of time an LED or pin is on/high between `from` and `to`, in percent. */
  | { kind: "duty"; led?: string; pin?: number; pct: number; tolPct?: number; from?: number; to?: number }
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
  const b = new Board();
  const end = spec.durationMs * MS;
  const res: RunResult = {
    ran: false, passed: false, checks: [], bonus: [], diagnostics: [], serial: [], console: "", lcd: ["", ""],
    traces: b.gpio.trace, isrLog: b.isrLog, endMs: spec.durationMs, board: b, kit,
  };
  const finish = () => {
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
  for (const c of [...(spec.checks ?? []), ...(spec.bonus ?? [])]) {
    if ((c.kind === "reg" || c.kind === "var") && c.at !== undefined) {
      b.at(c.at * MS, () => samples.set(c, c.kind === "reg" ? b.dev.get(c.reg, c.field) : b.readVar(c.name)));
    }
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

  const evaluate = (c: Check, into: CheckResult[]): void => {
    let pass = false;
    let detail = "";
    if (!res.ran && c.kind !== "source" && c.kind !== "max-lines") {
      into.push({ label: c.label, pass: false, detail: "Not checked: the program stopped with an error.", hint: c.hint });
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
        const from = (c.from ?? 0) * MS;
        const to = (c.to ?? spec.durationMs) * MS;
        const tr = (b.gpio.trace.get(p.pin) ?? []).filter((x) => x.t >= from && x.t <= to);
        if (tr.length < 3) {
          detail = `${p.name} changed ${tr.length} time${tr.length === 1 ? "" : "s"} in the test window, so it is not blinking.`;
          if (!b.gpio.isOutput(p.pin)) detail += ` GPIO${p.pin} is not set as an output.`;
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
        const text = b.lcd[c.line - 1];
        pass = new RegExp(c.matches).test(text);
        detail = `LCD line ${c.line} shows ${JSON.stringify(text)}.`;
        break;
      }
      case "reg": {
        const v = c.at !== undefined ? samples.get(c) : b.dev.get(c.reg, c.field);
        pass = v === c.equals >>> 0;
        const name = c.field ? `${c.reg}.bit.${c.field}` : c.reg;
        detail = `${name} is ${fmtVal(v)}${pass ? "" : `, expected ${fmtVal(c.equals >>> 0)}`}.`;
        break;
      }
      case "var": {
        const v = c.at !== undefined ? samples.get(c) : b.readVar(c.name);
        if (v === undefined) {
          detail = `There is no global variable named ${c.name}.`;
          break;
        }
        const exact = Number.isInteger(v) && (c.equals === undefined || Number.isInteger(c.equals));
        pass = (c.equals === undefined || (exact ? v === c.equals : Math.abs(v - c.equals) < 1e-6 * Math.max(1, Math.abs(c.equals)))) && (c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max);
        const want = c.equals !== undefined ? `${c.equals}` : `${c.min ?? "-∞"} to ${c.max ?? "∞"}`;
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
        if (v === undefined) {
          detail = `${c.name} never produced a value.`;
          break;
        }
        pass = (c.equals === undefined || Math.abs(v - c.equals) <= (c.tol ?? 1e-9)) && (c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max);
        const want = c.equals !== undefined ? `${c.equals}${c.tol ? ` (within ${c.tol})` : ""}` : `${c.min ?? "-inf"} to ${c.max ?? "inf"}`;
        detail = `${c.name} was ${+v.toPrecision(5)}${c.at !== undefined ? ` at ${fmtMs(c.at)}` : ""}${pass ? "" : `, expected ${want}`}.`;
        break;
      }
      case "duty": {
        const p = pinOf(c);
        const from = (c.from ?? 0) * MS;
        const to = (c.to ?? spec.durationMs) * MS;
        let on = 0;
        let lv = b.gpio.levelAt(p.pin, from);
        let last = from;
        for (const x of b.gpio.trace.get(p.pin) ?? []) {
          if (x.t <= from) continue;
          if (x.t >= to) break;
          if (lv >= 0 && (p.activeLow ? lv === 0 : lv === 1)) on += x.t - last;
          last = x.t;
          lv = x.level;
        }
        if (lv >= 0 && (p.activeLow ? lv === 0 : lv === 1)) on += to - last;
        const pct = (100 * on) / (to - from);
        pass = Math.abs(pct - c.pct) <= (c.tolPct ?? 2);
        detail = `${p.name} was ${c.led ? "on" : "high"} ${pct.toFixed(1)}% of the time${pass ? "" : `, expected ${c.pct}%`}.`;
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
    into.push({ label: c.label, pass, detail, hint: pass ? undefined : c.hint });
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
