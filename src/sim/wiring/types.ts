// The wiring bench: the homework board with its parts, the faults a student
// can switch on to see their symptom, and devices attached to free pins.
// Pure TypeScript: no DOM, no clock of its own. docs/WIRING.md explains it.

import type { Board } from "../board";

/**
 * Where a terminal goes: a chip pin by its name on the board ("GPIO22",
 * "ADCINA4"), a supply ("3V3", "5V", "BAT": the battery pack), "GND", or ""
 * for a terminal that is not connected.
 */
export type Target = string;

/**
 * What a terminal does.
 * - `in`: the chip drives it (an LED, a transistor's base). Needs an output pin.
 * - `pwm`: as `in`, and the part wants pulses (a servo, a buzzer).
 * - `out`: the part drives a digital level into the chip.
 * - `contact`: a passive contact that joins the pin to another terminal's rail while closed (a button).
 * - `analog`: the part puts a voltage on an ADC pin.
 * - `power`, `ground`: its supply.
 */
export type Role = "in" | "pwm" | "out" | "contact" | "analog" | "power" | "ground";

export interface TerminalDef {
  id: string;
  name: string;
  role: Role;
}

/** A setting with a few named choices: a fault switch, a resistor value, a jumper position. The first choice is the default. */
export interface OptionDef {
  id: string;
  label: string;
  choices: { id: string; label: string }[];
  /** A choice other than the first is a fault (shown under "Faults", counted as one). */
  fault?: boolean;
  /** Only for the parts on the board (a device you attach is removed instead of unsoldered). */
  boardOnly?: boolean;
  /** Only for a device the student attaches (the board's own part has the value the board gives it). */
  addedOnly?: boolean;
}

/** Something the student moves while the program runs: a slider, a switch, a button to hold. */
export interface InputDef {
  id: string;
  label: string;
  kind: "range" | "toggle" | "hold";
  min?: number;
  max?: number;
  step?: number;
  initial: number;
  unit?: string;
}

/** A part as the compiled board file lists it (tools/gen-board.mjs). */
export interface BoardPart {
  id: string;
  kind: string;
  label: string;
  /** Its place on the board: x, y, width, height in mm, y down. */
  box: [number, number, number, number];
  pin?: number;
  via?: string;
  res?: string;
  ohm?: number;
  jumper?: string;
  serves?: string[];
  adc?: string;
  adcX?: string;
  adcY?: string;
  rail?: string;
  signal?: string;
  back?: boolean;
  /** Nets (indexes into the board's net list) the part hangs on at the chip's side. */
  nets: number[];
  /** Nets behind an inverter or a resistor: between the chip's net and the part itself. */
  far: number[];
}

/** One part on the bench, with its settings resolved. */
export interface Inst {
  id: string;
  kind: string;
  def: PartDef;
  label: string;
  conn: Record<string, Target>;
  opts: Record<string, string>;
  inputs: Record<string, number>;
  /** The board's own part (its connections are fixed), or undefined for a device the student attached. */
  part?: BoardPart;
}

/** What a part reports about itself at this moment. */
export interface Status {
  /** A few words: "on", "off", "45 degrees", "silent". */
  text: string;
  /** How strongly it is on, 0 to 1 (an LED's brightness, a tone, a pressed button). */
  level?: number;
  /** A servo's horn angle, degrees. */
  angle?: number;
  /** Why it is not doing what the circuit asks, in a sentence with what to check. Empty when all is well. */
  why?: string;
}

export type Severity = "error" | "warning" | "info";

export interface Issue {
  /** The part it is about. */
  inst: string;
  code: string;
  severity: Severity;
  msg: string;
}

/** What a chip pin is doing right now, read from the simulated registers. */
export interface PinInfo {
  n: number;
  /** `out`: GPIO output. `in`: GPIO input. `periph`: the mux gives the pin to a peripheral. */
  mode: "out" | "in" | "periph";
  mux: number;
  /** The peripheral signal at that mux position ("EPWM12A"), when the table has it. */
  fn: string;
  /** 0, 1, or -1 when nothing defines it. */
  level: number;
  pullUp: boolean;
  /** The pin's recent square wave, if it has one. */
  wave: Wave | null;
}

export interface Wave {
  hz: number;
  /** Fraction of the period the pin is high. */
  duty: number;
  /** Length of the high pulse, ms. */
  pulseMs: number;
}

/** What a part's rules may ask of the bench. With no program running, `board` is null and pins are unknown. */
export interface BenchView {
  board: Board | null;
  inst(id: string): Inst | undefined;
  all(): Inst[];
  /** The pin behind a target, or null for a supply, an ADC pin or no running program. */
  pin(t: Target): PinInfo | null;
  /** Volts of a supply target (0 for GND, 6 for the battery pack when it is fitted), or null for a pin. */
  rail(t: Target): number | null;
  /** How much of the time the target is high, 0 to 1; null when nothing drives it. */
  high(t: Target): number | null;
  /** A value a part keeps while the program runs (a held button, a servo's last angle). */
  mem(inst: Inst): Record<string, number>;
}

/** What a part may do to the running simulation. */
export interface BenchRun extends BenchView {
  board: Board;
  /** Puts a level on a pin from outside (a pressed button, a sensor's output), or lets go with null. */
  drive(inst: Inst, t: Target, level: 0 | 1 | null): void;
  /** Puts a voltage on an ADC pin: a number, or a function of time (ns) for a signal that never rests. */
  analog(inst: Inst, t: Target, volts: number | ((tNs: number) => number) | null): void;
  /** A message on the line the program is at. The same code is reported once. */
  warn(inst: Inst, code: string, msg: string, severity?: Severity): void;
  /** Calls `fn` at a later simulated time (ns), unless the bench has been set up again since. */
  later(tNs: number, fn: () => void): void;
}

/** A drawing instruction in board millimetres. `tone` picks a colour token in the interface. */
export type Shape =
  | { s: "rect"; x: number; y: number; w: number; h: number; r?: number; tone: Tone; fill?: boolean; dash?: boolean }
  | { s: "circle"; x: number; y: number; r: number; tone: Tone; fill?: boolean; dash?: boolean }
  | { s: "line"; x1: number; y1: number; x2: number; y2: number; tone: Tone; w?: number }
  | { s: "text"; x: number; y: number; text: string; tone: Tone; size?: number; anchor?: "start" | "middle" | "end" };

/** `part`: a body. `metal`: pads and legs. `lit`: on. `dark`: off. `gone`: not fitted. `bad`: a fault. */
export type Tone = "part" | "metal" | "lit" | "dark" | "gone" | "bad" | "ink";

export interface PartDef {
  kind: string;
  name: string;
  /** One plain sentence: what it is and what it does on the bench. */
  description: string;
  terminals: TerminalDef[];
  options?: OptionDef[];
  inputs?: InputDef[];
  /** Offered in the device bin (attach it to free pins). */
  addable?: boolean;
  /** The connections of the board's own part of this kind. */
  onBoard?(p: BoardPart): Record<string, Target>;
  /** Checks of how it is connected, beyond the ones every part gets. */
  check?(i: Inst, b: BenchView): Issue[];
  /** Sets up what the part does to the simulation. Called again whenever the bench changes. */
  apply?(i: Inst, r: BenchRun): void;
  /** A pin one of its terminals is on changed level. */
  edge?(i: Inst, r: BenchRun, t: Target, level: 0 | 1, tNs: number): void;
  /** False while the part cannot act at all (no supply, a jumper missing): the simulator's own model of it is then silenced too. */
  works?(i: Inst, b: BenchView): boolean;
  status(i: Inst, b: BenchView): Status;
  /** The picture of the board's own part, inside its box. */
  draw?(i: Inst, s: Status, box: [number, number, number, number]): Shape[];
}

export interface AddedDevice {
  id: string;
  kind: string;
  label: string;
  conn: Record<string, Target>;
}

/** Everything the student changed on the bench. The default is the fully built board with nothing attached. */
export interface BenchState {
  v: 1;
  opts: Record<string, Record<string, string>>;
  inputs: Record<string, Record<string, number>>;
  added: AddedDevice[];
}
