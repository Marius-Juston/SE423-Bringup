// An interactive run: the UI advances it a little on every animation frame
// and can press buttons or type into the serial terminal while it runs.

import { Board } from "./board";
import { CError } from "./cc/lexer";
import { RuntimeError } from "./cc/compile";
import { KITS, findPart, type Kit } from "./world/kits";

const MS = 1e6;

export interface LiveError {
  kind: "compile" | "runtime";
  line: number;
  msg: string;
}

export class LiveSession {
  board = new Board();
  kit: Kit;
  error: LiveError | null = null;
  /** Registers the program wrote, most recent last. */
  touched: string[] = [];
  /** Simulated ms per real ms. */
  speed = 1;
  /** Fraction of the requested speed actually reached in the last step. */
  load = 1;
  private gen: Generator<void, void> | null = null;
  private pressed = new Set<string>();

  constructor(kitId: string, source: string) {
    this.kit = KITS[kitId];
    const b = this.board;
    b.mem.onWrite = (reg, _value, before) => {
      // Library code is only interesting when it actually changed something.
      if (b.libDepth && b.mem.peek(reg.addr, reg.words) === before) return;
      const i = this.touched.indexOf(reg.name);
      if (i >= 0) this.touched.splice(i, 1);
      this.touched.push(reg.name);
    };
    try {
      b.load(source);
      this.gen = b.run();
    } catch (e) {
      this.fail(e);
    }
  }

  private fail(e: unknown): void {
    if (e instanceof CError) this.error = { kind: "compile", line: e.file === "user" ? e.line : 0, msg: e.message };
    else if (e instanceof RuntimeError) this.error = { kind: "runtime", line: e.line, msg: e.message };
    else if (e instanceof RangeError) this.error = { kind: "runtime", line: this.board.line, msg: "The program used too much stack. A function is probably calling itself forever." };
    else throw e;
    this.gen = null;
  }

  get running(): boolean {
    return this.gen !== null;
  }

  get timeMs(): number {
    return this.board.now / MS;
  }

  /** Advances by up to realMs of wall time worth of simulation, within a CPU budget. */
  step(realMs: number, budgetMs = 10): void {
    if (!this.gen) return;
    const b = this.board;
    const start = performance.now();
    const target = b.now + realMs * this.speed * MS;
    const from = b.now;
    b.stepLimit = Infinity;
    try {
      // Small slices so the budget is respected even in busy loops.
      while (b.now < target) {
        b.runUntil(this.gen, Math.min(target, b.now + 0.05 * MS));
        if (performance.now() - start > budgetMs) break;
      }
    } catch (e) {
      this.fail(e);
    }
    this.load = target > from ? Math.min(1, (b.now - from) / (target - from)) : 1;
  }

  setButton(id: string, down: boolean): void {
    const part = findPart(this.kit, id);
    if (part.kind !== "button") return;
    if (down) this.pressed.add(id);
    else this.pressed.delete(id);
    this.board.gpio.drive(part.pin, down ? 0 : null);
  }

  isPressed(id: string): boolean {
    return this.pressed.has(id);
  }

  /** Types text into the terminal connected to SCIA. */
  type(text: string): void {
    const charNs = (10 / 115200) * 1e9;
    [...text].forEach((ch, i) => this.board.sci.receive(0, ch.charCodeAt(0), this.board.now + (i + 1) * charNs));
  }

  ledOn(pin: number, activeLow: boolean): boolean {
    const g = this.board.gpio;
    if (g.mux(pin) === 0 && !g.isOutput(pin)) return false;
    const lv = g.level[pin];
    return lv < 0 ? false : activeLow ? lv === 0 : lv === 1;
  }
}
