// An interactive run: the UI advances it a little on every animation frame
// and can press buttons or type into the serial terminal while it runs.

import { Board } from "./board";
import { CError } from "./cc/lexer";
import { RuntimeError } from "./cc/compile";
import { KITS, findPart, type Kit } from "./world/kits";
import { setWorldObjects } from "./plugins/lidar";
import type { RobotWorld } from "./plugins/robot_world";
import type { Obstacle } from "./world/terrain";

/** An input of the signal bus set when the board powers up (the world a level puts the robot in). */
export interface LiveSetup {
  set: string;
  value: number;
}

const MS = 1e6;

export interface LiveError {
  kind: "compile" | "runtime";
  line: number;
  msg: string;
}

export class LiveSession {
  board: Board;
  kit: Kit;
  error: LiveError | null = null;
  /** Paused by the student (stepping). */
  paused = false;
  /** Simulated ms per real ms. */
  speed = 1;
  /** Fraction of the requested speed actually reached in the last step. */
  load = 1;
  private gen: Generator<void, void> | null = null;
  private pressed = new Set<string>();

  /**
   * `setup` are inputs set at power-up, in order: the room, the start pose
   * and the goal of the level, so a live run begins in the level's world.
   */
  constructor(kitId: string, source: string, private setup: LiveSetup[] = []) {
    this.board = new Board(kitId);
    // Minutes of running must not fill the memory: about a second of a fast PWM pin, a minute of a 1 kHz signal.
    this.board.historyLimit = 60_000;
    this.kit = KITS[kitId];
    const b = this.board;
    for (const p of this.kit.parts) if (p.kind === "knob") b.setInput(p.input, p.initial, 0);
    for (const s of setup) b.setInput(s.set, s.value, 0);
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

  /** Runs statements until `done` says stop (or a safety limit), then pauses. */
  private stepWhile(more: () => boolean, limit: number): void {
    if (!this.gen) return;
    const b = this.board;
    b.stepLimit = Infinity;
    this.paused = true;
    try {
      for (let i = 0; i < limit; i++) {
        // pauseAt = now makes the program stop again after one statement.
        b.pauseAt = b.now;
        b.pause = false;
        // Each single step is a fresh slice: the "never finishes" guard counts within one slice only.
        b.overrun = 0;
        if (this.gen.next().done) {
          this.gen = null;
          break;
        }
        if (!more()) break;
      }
    } catch (e) {
      this.fail(e);
    }
  }

  /** Executes up to the next line of the student's code. */
  stepLine(): void {
    const b = this.board;
    const line = b.line;
    const isr = b.isrLog.length;
    this.stepWhile(() => b.line === line && b.isrLog.length === isr, 5000);
  }

  /** Runs until the program next writes a register (or 200 000 statements pass). */
  stepToWrite(): void {
    const b = this.board;
    const n = b.writeLog.length ? b.writeLog[b.writeLog.length - 1].n : -1;
    this.stepWhile(() => (b.writeLog.length ? b.writeLog[b.writeLog.length - 1].n : -1) === n, 200_000);
  }

  setButton(id: string, down: boolean): void {
    const part = findPart(this.kit, id);
    if (part.kind !== "button") return;
    if (down) this.pressed.add(id);
    else this.pressed.delete(id);
    this.board.gpio.drive(part.pin, down ? 0 : null);
  }

  /** Turns a knob. */
  setKnob(id: string, value: number): void {
    const part = findPart(this.kit, id);
    if (part.kind === "knob") this.board.setInput(part.input, value);
  }

  // ---- the playground: the student moves things in the world while the program runs ----

  /** Sets a signal-bus input by name (the goal, the room, a maze seed). */
  setInput(name: string, value: number): void {
    if (Number.isFinite(value)) this.board.setInput(name, value);
  }

  /** The robot world of capstone levels, when it is switched on. */
  private get world(): RobotWorld | undefined {
    const w = this.board.plugins.get("robot-world") as RobotWorld | undefined;
    return w?.on ? w : undefined;
  }

  /**
   * Picks the robot up and puts it down at a new pose. In the robot world
   * that also clears a crash; on the test bench it uses the bench's
   * TB_SET inputs; a LIDAR standing alone is moved by its pose inputs. The
   * encoders, the LIDAR and the robot stay consistent in every case, and
   * the program is not told: its own estimate keeps its value.
   */
  placeRobot(x: number, y: number, theta: number, kind: "world" | "bench" | "scan"): void {
    if (![x, y, theta].every(Number.isFinite)) return;
    const b = this.board;
    if (kind === "world") this.world?.place(x, y, theta);
    else if (kind === "bench") {
      b.setInput("TB_SET_X_FT", x);
      b.setInput("TB_SET_Y_FT", y);
      b.setInput("TB_SET_THETA_RAD", theta);
    } else {
      b.setInput("LIDAR_X_FT", x);
      b.setInput("LIDAR_Y_FT", y);
      b.setInput("LIDAR_THETA_RAD", theta);
    }
  }

  /** Replaces the objects placed by hand in the world. */
  setObjects(objects: Obstacle[]): void {
    setWorldObjects(this.board, objects);
  }

  /** Back to the world this run started in: its room, start pose and goal, and no placed objects. */
  resetWorld(kind: "world" | "bench" | "scan"): void {
    const b = this.board;
    setWorldObjects(b, []);
    const given = new Map(this.setup.map((s) => [s.set, s.value]));
    for (const name of ["WORLD_KIND", "WORLD_SEED", "WORLD_SIZE", "WORLD_LOOPS", "LIDAR_ROOM"]) if (b.inputs.has(name) || given.has(name)) b.setInput(name, given.get(name) ?? 0);
    // An input the level never set goes back to "not set" (the world's own goal or start then applies).
    const restore = (name: string) => {
      if (given.has(name)) b.setInput(name, given.get(name)!);
      else b.inputs.delete(name);
    };
    restore("ROBOT_GOAL_X_FT");
    restore("ROBOT_GOAL_Y_FT");
    if (kind === "world") this.world?.reset();
    else if (kind === "bench") this.placeRobot(given.get("TB_SET_X_FT") ?? 0, given.get("TB_SET_Y_FT") ?? 0, given.get("TB_SET_THETA_RAD") ?? 0, "bench");
    else {
      restore("LIDAR_X_FT");
      restore("LIDAR_Y_FT");
      restore("LIDAR_THETA_RAD");
      // Tell the LIDAR its pose changed.
      b.setInput("LIDAR_ROOM", b.inputs.get("LIDAR_ROOM") ?? 0);
    }
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
