import { runProgram, type RunResult } from "../src/sim/runner";

/** Runs a C program and returns what it printed with printf. */
export function run(source: string, durationMs = 1, kit = "robot"): RunResult {
  return runProgram({ kit, source, durationMs });
}

export function out(source: string, durationMs = 1): string {
  const r = run(source, durationMs);
  if (r.compileError) throw new Error(`compile error line ${r.compileError.line}: ${r.compileError.msg}`);
  if (r.runtimeError) throw new Error(`runtime error line ${r.runtimeError.line}: ${r.runtimeError.msg}`);
  return r.console;
}

/** Wraps statements in main(). */
export const main = (body: string, globals = "") => `${globals}\nvoid main(void) {\n${body}\n}\n`;

export function compileError(source: string): string {
  const r = run(source);
  if (!r.compileError) throw new Error("expected a compile error");
  return `${r.compileError.line}: ${r.compileError.msg}`;
}

export const codes = (r: RunResult) => r.diagnostics.map((d) => d.code);
