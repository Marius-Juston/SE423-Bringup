// An interactive run: the UI advances it a little on every animation frame
// and can press buttons or type into the serial terminal while it runs.

import { Board } from "./board";
import { CError } from "./cc/lexer";
import { RuntimeError } from "./cc/compile";
import { KITS, findPart, type Kit } from "./world/kits";
import { setWorldObjects, worldOf } from "./plugins/lidar";
import { ROBOT_RADIUS_FT, type RobotWorld } from "./plugins/robot_world";
import { objectTouches, tidyObject, type Obstacle } from "./world/terrain";
import { tourAt, waypoints, type PathSet, type Waypoint } from "./tour";

/** An input of the signal bus set when the board powers up (the world a level puts the robot in). */
export interface LiveSetup {
  set: string;
  value: number;
}

/** What the student changed in the world by hand, so that the next run can start in the same world. */
export interface WorldState {
  /** Inputs set in the playground (the terrain, the goal) and the pose the robot was last put down at. */
  inputs: [string, number][];
  /** Objects placed by hand. */
  objects: Obstacle[];
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
  /** The poses the level's test puts the LIDAR robot at; the live run drives round them. */
  private path: Waypoint[] = [];
  /** Simulated time at which the tour began (it is restarted when switched on again). */
  private tourFrom = 0;
  private tourAtNs = -Infinity;
  /** The robot is being driven round the test's poses. Moving it by hand switches this off. */
  touring = false;
  /** Changes the level's test makes to the world later in the run (a second maze, a new goal), in order. */
  private events: PathSet[] = [];
  private nextEvent = 0;
  /** The student changed the world by hand: the test's later changes no longer apply. */
  private handsOn = false;

  /**
   * `setup` are inputs set at power-up, in order: the room, the start pose
   * and the goal of the level, so a live run begins in the level's world.
   */
  private kept = new Map<string, number>();
  private keptObjects: Obstacle[] = [];

  /** The student's own changes to the world, to hand to the next run. Empty after "Reset world". */
  get worldState(): WorldState {
    return { inputs: [...this.kept], objects: this.keptObjects };
  }

  constructor(kitId: string, source: string, private setup: LiveSetup[] = [], script: readonly PathSet[] = [], restore?: WorldState) {
    this.board = new Board(kitId);
    // Minutes of running must not fill the memory: about a second of a fast PWM pin, a minute of a 1 kHz signal.
    this.board.historyLimit = 60_000;
    this.kit = KITS[kitId];
    const b = this.board;
    for (const p of this.kit.parts) if (p.kind === "knob") b.setInput(p.input, p.initial, 0);
    // The world is described before it is switched on: the level's, then what the student changed last time.
    const restored = !!restore && (restore.inputs.length > 0 || restore.objects.length > 0);
    for (const s of setup) if (s.set !== "ROBOT_WORLD") b.setInput(s.set, s.value, 0);
    if (restored) {
      for (const [name, v] of restore.inputs) {
        b.setInput(name, v, 0);
        this.kept.set(name, v);
      }
      this.keptObjects = restore.objects;
      this.handsOn = true;
    }
    for (const s of setup) if (s.set === "ROBOT_WORLD") b.setInput(s.set, s.value, 0);
    if (this.keptObjects.length) {
      // An object left where this run's robot starts would end the run at once: it is not carried over.
      const start = worldOf(b).start;
      const on = this.world !== undefined;
      const x = on ? (b.output("ROBOT_X_FT") ?? start[0]) : (b.inputs.get("LIDAR_X_FT") ?? start[0]);
      const y = on ? (b.output("ROBOT_Y_FT") ?? start[1]) : (b.inputs.get("LIDAR_Y_FT") ?? start[1]);
      this.keptObjects = this.keptObjects.filter((o) => !objectTouches(tidyObject(o), x, y, ROBOT_RADIUS_FT));
      // Placed before the program is compiled, so the world is whole even when the program is not.
      setWorldObjects(b, this.keptObjects);
    }
    this.path = waypoints(script);
    this.touring = this.path.length > 1 && !restored;
    this.events = script.filter((e) => e.at > 0.02 && /^(WORLD_|ROBOT_GOAL_)/.test(e.set)).sort((a, b) => a.at - b.at);
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

  /** When the test next changes the world by itself (ms), if it still will. */
  get worldChangeMs(): number | undefined {
    return this.handsOn ? undefined : this.events[this.nextEvent]?.at;
  }

  /** True when the level's test moves the robot, so there is a path to drive round. */
  get hasTour(): boolean {
    return this.path.length > 1;
  }

  /** Starts (from the first pose) or stops the drive round the test's poses. */
  setTour(on: boolean): void {
    this.touring = on && this.hasTour;
    if (this.touring) {
      this.tourFrom = this.board.now / MS;
      this.tour(true);
    }
  }

  /** Puts the robot where the tour has it now. Only inputs that changed are set. */
  private tour(force = false): void {
    const b = this.board;
    // Every 10 ms of simulated time is smooth to the eye and costs little.
    if (!this.touring || (!force && b.now - this.tourAtNs < 10 * MS)) return;
    this.tourAtNs = b.now;
    for (const [name, v] of tourAt(this.path, b.now / MS - this.tourFrom)) if (b.inputs.get(name) !== v) b.setInput(name, v);
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
        this.tour();
        // The world changes when it does in the test, so Run and Run tests show the same thing.
        while (this.nextEvent < this.events.length && this.events[this.nextEvent].at * MS <= b.now) {
          const e = this.events[this.nextEvent++];
          if (!this.handsOn) b.setInput(e.set, e.value);
        }
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
    const isr = b.isrLog.length + b.isrDropped;
    this.stepWhile(() => b.line === line && b.isrLog.length + b.isrDropped === isr, 5000);
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
    if (!Number.isFinite(value)) return;
    this.handsOn = true;
    this.kept.set(name, value);
    this.board.setInput(name, value);
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
    this.touring = false;
    // The robot is where the student wants it: the test's later changes would pull the world from under it.
    this.handsOn = true;
    // The next run starts where the robot was last put down.
    const names = kind === "world" ? ["ROBOT_START_X_FT", "ROBOT_START_Y_FT", "ROBOT_START_THETA_RAD"] : kind === "bench" ? ["TB_SET_X_FT", "TB_SET_Y_FT", "TB_SET_THETA_RAD"] : ["LIDAR_X_FT", "LIDAR_Y_FT", "LIDAR_THETA_RAD"];
    [x, y, theta].forEach((v, i) => this.kept.set(names[i], v));
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
    this.handsOn = true;
    this.keptObjects = objects;
    setWorldObjects(this.board, objects);
  }

  /** Back to the world this run started in: its room, start pose and goal, and no placed objects. */
  resetWorld(kind: "world" | "bench" | "scan"): void {
    const b = this.board;
    this.touring = false;
    this.handsOn = true;
    setWorldObjects(b, []);
    // The level's own start pose again (a restored run began at the student's).
    for (const name of ["ROBOT_START_X_FT", "ROBOT_START_Y_FT", "ROBOT_START_THETA_RAD"]) {
      const own = this.setup.find((s) => s.set === name);
      if (own) b.inputs.set(name, own.value);
      else b.inputs.delete(name);
    }
    const given = new Map(this.setup.map((s) => [s.set, s.value]));
    // The level's own terrain: an input it never set is "not set" again (0 is not the default seed or size of a maze).
    for (const name of ["WORLD_KIND", "WORLD_SEED", "WORLD_SIZE", "WORLD_LOOPS"]) if (!given.has(name)) b.inputs.delete(name);
    for (const name of ["WORLD_KIND", "WORLD_SEED", "WORLD_SIZE", "WORLD_LOOPS"]) if (given.has(name)) b.setInput(name, given.get(name)!);
    // Setting the room also tells everything that watches the world that it has changed.
    b.setInput("LIDAR_ROOM", given.get("LIDAR_ROOM") ?? 0);
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
    // Nothing of the student's is carried to the next run.
    this.kept.clear();
    this.keptObjects = [];
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
