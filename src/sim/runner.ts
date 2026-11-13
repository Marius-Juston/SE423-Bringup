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
  /** Time between the starts of consecutive printed lines. */
  | { kind: "serial-period"; port?: number; periodMs: number; tolPct?: number }
  | { kind: "lcd"; line: 1 | 2; matches: string }
  | { kind: "reg"; reg: string; field?: string; equals: number; at?: number }
  | { kind: "var"; name: string; equals?: number; min?: number; max?: number; at?: number }
  | { kind: "isr"; fn: string; min?: number; max?: number }
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
  diagnostics: Diagnostic[];
  serial: string[];
  console: string;
  lcd: [string, string];
  traces: Map<number, PinChange[]>;
  isrLog: IsrLog[];
  /** Registers the program wrote, in order of last write. */
  touched: string[];
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
    ran: false, passed: false, checks: [], diagnostics: [], serial: [], console: "", lcd: ["", ""],
    traces: b.gpio.trace, isrLog: b.isrLog, touched: [], endMs: spec.durationMs, board: b, kit,
  };
  b.mem.onWrite = (reg) => {
    if (b.libDepth && !reg.name.startsWith("Gpio")) return;
    const i = res.touched.indexOf(reg.name);
    if (i >= 0) res.touched.splice(i, 1);
    res.touched.push(reg.name);
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

  // Stimuli.
  for (const s of spec.stimuli ?? []) {
    if ("press" in s || "release" in s) {
      const id = "press" in s ? s.press : s.release;
      const part = findPart(kit, id);
      if (part.kind !== "button") throw new Error(`${id} is not a button`);
      // A pressed button connects the pin to ground; released, it connects to nothing.
      b.at(s.at * MS, (t) => b.gpio.drive(part.pin, "press" in s ? 0 : null, t));
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
  for (const c of spec.checks ?? []) {
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

  for (const c of spec.checks ?? []) {
    let pass = false;
    let detail = "";
    if (!res.ran && c.kind !== "source") {
      res.checks.push({ label: c.label, pass: false, detail: "Not checked: the program stopped with an error.", hint: c.hint });
      continue;
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
        pass = (c.equals === undefined || Math.abs(v - c.equals) < 1e-6 * Math.max(1, Math.abs(c.equals))) && (c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max);
        const want = c.equals !== undefined ? `${c.equals}` : `${c.min ?? "-∞"} to ${c.max ?? "∞"}`;
        detail = `${c.name} is ${+v.toPrecision(7)}${pass ? "" : `, expected ${want}`}.`;
        break;
      }
      case "isr": {
        const n = b.isrLog.filter((x) => x.name === c.fn).length;
        pass = (c.min === undefined || n >= c.min) && (c.max === undefined || n <= c.max);
        detail = `${c.fn} ran ${n} time${n === 1 ? "" : "s"}${pass ? "" : `, expected ${c.min !== undefined && c.max !== undefined ? `${c.min} to ${c.max}` : c.min !== undefined ? `at least ${c.min}` : `at most ${c.max}`}`}.`;
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
        detail = pass ? "Found in the code." : "Not as required in the code.";
        break;
      }
    }
    res.checks.push({ label: c.label, pass, detail, hint: pass ? undefined : c.hint });
  }
  finish();
  res.passed = res.ran && res.checks.every((c) => c.pass) && !res.diagnostics.some((d) => d.severity === "error");
  return res;
}

function fmtVal(v: number | undefined): string {
  if (v === undefined) return "unknown";
  return v > 9 ? `${v} (0x${v.toString(16).toUpperCase()})` : `${v}`;
}

export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}
