// The bench's state and the rules that do not need a running program: what
// is on it, how it is connected, what is wrong with a connection, and the
// same in words and as a table. The parts themselves are in ./parts, one
// file each. The running side is src/sim/plugins/bench_wiring.ts.
//
// The model is deliberately simple: every connection is fixed (a terminal
// goes to one pin or one supply) and every part has a rule of its own (an
// LED is lit when its pin drives it the right way round; a divider is a
// formula). It is not a circuit solver: currents are not shared between
// parts, and two parts on one pin are reported, not computed.
//
// Electrical limits come from the data sheet (TMS320F2837xD, SPRS880P):
// section 6.1 Absolute Maximum Ratings: input voltage -0.3 V to 4.6 V, 20 mA
// per output pin; section 6.6 Electrical Characteristics: outputs are rated
// at 4 mA (IOH, IOL), an input is high from 2.0 V and low to 0.8 V, the
// internal pull-up carries about 150 uA. The ADC converts 0 V to VREFHI,
// 3.0 V on the LaunchPad (TRM chapter 11; the course handouts say the same).

import type { Board } from "../board";
import { pinMuxRow, signalName } from "../device/pinmux";
import { BATTERY_VOLTS, HEADER_PINS, HW_BOARD, RAILS, gpioOf, headerPin, isAdc, isRail, targetWords } from "./board";
import { PART_DEFS, partDef } from "./parts";
import type { BenchState, BenchView, Inst, Issue, OptionDef, PinInfo, Status, Target, Wave } from "./types";

/** Rated output current of a pin, mA (data sheet 6.6: IOH, IOL). */
export const PIN_MA = 4;
/** Above this a pin may be damaged, V (data sheet 6.1: input voltage). */
export const PIN_MAX_V = 4.6;
/** The ADC's full scale on the LaunchPad, V. */
export const ADC_MAX_V = 3.0;
/** At most this many devices can be attached. */
export const MAX_ADDED = 24;

/** Every board part can be left off the board: the first fault switch of each. */
export const FITTED: OptionDef = { id: "fitted", label: "On the board", choices: [{ id: "yes", label: "Soldered" }, { id: "no", label: "Not soldered" }], fault: true, boardOnly: true };

export const emptyBench = (): BenchState => ({ v: 1, opts: {}, inputs: {}, added: [] });

/** The options of a part: the fault switch every board part has, then its own. */
export function optionsOf(i: { def: Inst["def"]; part?: Inst["part"] }): OptionDef[] {
  const own = (i.def.options ?? []).filter((o) => (i.part ? !o.addedOnly : !o.boardOnly));
  return i.part ? [FITTED, ...own] : own;
}

/** Everything on the bench: the board's parts in the board's order, then the attached devices. */
export function instances(state: BenchState): Inst[] {
  const out: Inst[] = [];
  const resolve = (base: Omit<Inst, "opts" | "inputs">): Inst => {
    const opts: Record<string, string> = {};
    for (const o of optionsOf(base)) {
      const v = state.opts[base.id]?.[o.id];
      opts[o.id] = o.choices.some((c) => c.id === v) ? v! : o.choices[0].id;
    }
    const inputs: Record<string, number> = {};
    for (const d of base.def.inputs ?? []) {
      const v = state.inputs[base.id]?.[d.id];
      inputs[d.id] = typeof v === "number" && Number.isFinite(v) && d.kind !== "hold" ? Math.min(d.max ?? 1, Math.max(d.min ?? 0, v)) : d.initial;
    }
    return { ...base, opts, inputs };
  };
  for (const p of HW_BOARD.parts) {
    const def = partDef(p.kind);
    if (def?.onBoard) out.push(resolve({ id: p.id, kind: p.kind, def, label: p.label, conn: def.onBoard(p), part: p }));
  }
  for (const a of state.added) {
    const def = partDef(a.kind);
    if (!def?.addable) continue;
    const conn: Record<string, Target> = {};
    for (const t of def.terminals) conn[t.id] = a.conn[t.id] ?? "";
    out.push(resolve({ id: a.id, kind: a.kind, def, label: a.label, conn }));
  }
  return out;
}

export const fitted = (i: Inst | undefined): boolean => !!i && i.opts.fitted !== "no";
/** How many fault switches are away from "all is well". */
export const faultCount = (state: BenchState): number =>
  instances(state).reduce((n, i) => n + optionsOf(i).filter((o) => o.fault && i.opts[o.id] !== o.choices[0].id).length, 0);

// ---------- reading the chip ----------

const PORTS = "ABCDEF";

/** What a GPIO pin is doing, from the simulated registers. `wave` is filled in by the running bench. */
export function pinInfo(board: Board, n: number, wave: Wave | null = null): PinInfo {
  const g = board.gpio;
  const mux = g.mux(n);
  const mode = mux !== 0 ? "periph" : g.isOutput(n) ? "out" : "in";
  const fn = mux !== 0 ? signalName(pinMuxRow(n)?.fn[mux] ?? "") : "";
  return { n, mode, mux, fn, level: g.level[n], pullUp: g.pullUpEnabled(n), wave };
}

/** "GPIO22 is an input (bit 22 of GPADIR is 0)": why a pin does not drive what hangs on it, with what to write. */
export function whyNotDriven(p: PinInfo, wants = ""): string {
  if (p.mode === "in")
    return `GPIO${p.n} is an input (bit ${p.n & 31} of GP${PORTS[p.n >> 5]}DIR is 0), so nothing drives it. Make it an output: GPIO_SetupPinOptions(${p.n}, GPIO_OUTPUT, GPIO_PUSHPULL);`;
  if (p.mode === "periph" && p.level < 0)
    return `GPIO${p.n}'s mux gives the pin to ${p.fn || `the signal at position ${p.mux}`}, and that peripheral is not driving it yet${wants ? ` (${wants})` : ""}.`;
  return "";
}

/** A view of the bench with no running program, or with one (`waves` then holds each pin's measured square wave). */
export function benchView(state: BenchState, board: Board | null, waves?: (n: number) => Wave | null, memory?: Map<string, Record<string, number>>): BenchView {
  const list = instances(state);
  const byId = new Map(list.map((i) => [i.id, i]));
  const mem = memory ?? new Map<string, Record<string, number>>();
  const view: BenchView = {
    board,
    inst: (id) => byId.get(id),
    all: () => list,
    pin(t) {
      const n = gpioOf(t);
      return n === null || !board ? null : pinInfo(board, n, waves?.(n) ?? null);
    },
    rail(t) {
      if (t === "BAT") return fitted(byId.get("BAT")) ? BATTERY_VOLTS : 0;
      const r = RAILS.find((x) => x.id === t);
      return r ? r.volts : null;
    },
    high(t) {
      const v = view.rail(t);
      if (v !== null) return v > 0 ? 1 : 0;
      const p = view.pin(t);
      if (!p || p.mode === "in" || p.level < 0) return null;
      return p.wave ? p.wave.duty : p.level;
    },
    mem(i) {
      let m = mem.get(i.id);
      if (!m) mem.set(i.id, (m = {}));
      return m;
    },
  };
  return view;
}

export function statusOf(i: Inst, view: BenchView): Status {
  if (i.part && !fitted(i)) return { text: "not soldered", why: `${i.label} is not soldered on the board, so it does nothing. Set "On the board" to Soldered.` };
  return i.def.status(i, view);
}

// ---------- pins ----------

/** Who uses a pin: the parts whose terminals are on it. */
export function usersOf(list: Inst[], t: Target): { inst: Inst; terminal: string }[] {
  const out: { inst: Inst; terminal: string }[] = [];
  for (const i of list) {
    if (i.part && !fitted(i)) continue;
    for (const d of i.def.terminals) if (i.conn[d.id] === t) out.push({ inst: i, terminal: d.id });
  }
  return out;
}

export interface PinChoice {
  target: Target;
  /** What the list shows: "GPIO22 (pin 8, J1.8)". */
  words: string;
  /** The parts already on it, by label; empty for a free pin. */
  usedBy: string[];
}

/** The choices for a terminal: supplies, then free pins, then pins in use (with who uses them). */
export function pinChoices(state: BenchState, self?: string): PinChoice[] {
  const list = instances(state);
  const pins = HEADER_PINS.map((p): PinChoice => ({
    target: p.target,
    words: `${p.target} (pin ${p.number}, ${p.header})`,
    usedBy: [...new Set(usersOf(list, p.target).filter((u) => u.inst.id !== self).map((u) => u.inst.label))],
  }));
  return [
    ...RAILS.map((r): PinChoice => ({ target: r.id, words: r.name, usedBy: [] })),
    ...pins.filter((p) => !p.usedBy.length),
    ...pins.filter((p) => p.usedBy.length),
  ];
}

const pwmPins = (): string => HEADER_PINS.filter((p) => p.pwm.length).map((p) => `${p.target} (${p.pwm.join(", ")})`).join(", ");
const adcPins = (): string => HEADER_PINS.filter((p) => isAdc(p.target)).map((p) => p.target).join(", ");

/** The voltage a part's own supply terminal sits at, or null when it has none or it is not connected. */
function supplyOf(i: Inst, view: BenchView): number | null {
  const t = i.def.terminals.find((d) => d.role === "power");
  return t && i.conn[t.id] ? view.rail(i.conn[t.id]) : null;
}

/**
 * What is wrong with how the attached devices are connected. Each message
 * says what happens and what to choose instead. The board's own parts are
 * connected by the board, so only sharing a pin with them is reported.
 */
export function checkBench(state: BenchState): Issue[] {
  const view = benchView(state, null);
  const list = view.all();
  const out: Issue[] = [];
  for (const i of list) {
    if (i.part) continue;
    const add = (code: string, severity: Issue["severity"], msg: string) => out.push({ inst: i.id, code, severity, msg: `${i.label}: ${msg}` });
    const supply = supplyOf(i, view);
    for (const d of i.def.terminals) {
      const t = i.conn[d.id];
      const name = `its ${d.name}`;
      if (!t) {
        add(`open-${d.id}`, "warning", `${name} is not connected, so the part cannot work. Choose where it goes.`);
        continue;
      }
      const rail = isRail(t);
      if (d.role === "ground") {
        if (t !== "GND") add(`ground-${d.id}`, "error", `${name} goes to ${targetWords(t)}. It must go to GND: without a common ground the part and the chip share no reference.`);
        continue;
      }
      if (d.role === "power") {
        if (t === "GND") add(`power-${d.id}`, "error", `${name} goes to GND, so the part has no supply. Choose 3V3, 5V or the battery pack.`);
        else if (!rail) add(`power-${d.id}`, "error", `${name} goes to ${targetWords(t)}. A pin gives at most ${PIN_MA} mA (data sheet 6.6): it cannot power a part. Choose 3V3, 5V or the battery pack.`);
        else if (t === "BAT" && view.rail("BAT") === 0) add("no-battery", "warning", `${name} goes to the battery pack, and the battery pack is not on the board, so the part has no supply.`);
        continue;
      }
      // From here on the terminal carries a signal.
      if (rail) {
        if (d.role === "analog" || d.role === "out") add(`rail-${d.id}`, "error", `${name} is an output and goes straight to ${targetWords(t)}. Connect it to a pin the program reads.`);
        continue;
      }
      if (d.role === "analog") {
        if (!isAdc(t)) add(`no-adc-${d.id}`, "error", `${name} is a voltage, and ${t} has no ADC channel: a GPIO pin only reads 0 or 1. Choose one of ${adcPins()}.`);
        else if (supply !== null && supply > PIN_MAX_V) add(`over-${d.id}`, "error", `${name} can rise to its supply, ${supply} V, and ${t} is a 3.3 V pin (data sheet 6.1: 4.6 V at most). That can destroy the pin. Power the part from 3V3.`);
        else if (supply !== null && supply > ADC_MAX_V) add(`adc-range-${d.id}`, "info", `${name} can rise to ${supply} V. The ADC converts 0 V to ${ADC_MAX_V.toFixed(1)} V, so everything above ${ADC_MAX_V.toFixed(1)} V reads 4095.`);
      } else if (isAdc(t)) {
        add(`adc-digital-${d.id}`, "error", `${name} is a digital signal, and ${t} is an analog input: the program can only convert its voltage, not ${d.role === "out" || d.role === "contact" ? "read it as 0 or 1" : "drive it"}. Choose a GPIO pin.`);
      } else if (d.role === "out" && supply !== null && supply > PIN_MAX_V) {
        add(`over-${d.id}`, "error", `${name} swings to its supply, ${supply} V, and ${t} is a 3.3 V pin (data sheet 6.1: 4.6 V at most). That can destroy the pin. Power the part from 3V3.`);
      } else if (d.role === "pwm" && !headerPin(t)?.pwm.length) {
        add(`no-pwm-${d.id}`, "warning", `${name} needs pulses, and ${t} has no ePWM output: the program would have to toggle the pin by hand. Pins with an ePWM output: ${pwmPins()}.`);
      }
      // Two parts on one pin.
      const others = usersOf(list, t).filter((u) => u.inst.id !== i.id);
      const drives = (role: string) => role === "out" || role === "analog";
      for (const u of others) {
        const their = u.inst.def.terminals.find((x) => x.id === u.terminal)!;
        if (drives(d.role) && drives(their.role)) add(`clash-${d.id}`, "error", `${name} and ${u.inst.label} both put a level on ${t}. Two outputs on one pin fight each other. Choose a free pin.`);
        else if (drives(d.role) || drives(their.role) || d.role === "contact" || their.role === "contact") add(`shared-${d.id}`, "warning", `${t} is also used by ${u.inst.label}: one of them drives the pin while the other one needs it. Choose a free pin.`);
        else add(`shared-${d.id}`, "info", `${t} also drives ${u.inst.label}: both follow the same pin.`);
      }
    }
    out.push(...(i.def.check?.(i, view) ?? []));
  }
  // The same message once.
  return out.filter((x, n) => out.findIndex((y) => y.inst === x.inst && y.code === x.code) === n);
}

// ---------- changing the bench ----------

/** A new device of a kind, not connected to anything yet. The id never repeats within a bench. */
export function addDevice(state: BenchState, kind: string): BenchState {
  const def = partDef(kind);
  if (!def?.addable || state.added.length >= MAX_ADDED) return state;
  let n = 1;
  const taken = new Set([...HW_BOARD.parts.map((p) => p.id), ...state.added.map((a) => a.id)]);
  while (taken.has(`X${n}`)) n++;
  const same = state.added.filter((a) => a.kind === kind).length;
  const conn: Record<string, Target> = {};
  for (const t of def.terminals) conn[t.id] = "";
  return { ...state, added: [...state.added, { id: `X${n}`, kind, label: `${def.name} ${same + 1}`, conn }] };
}

export function removeDevice(state: BenchState, id: string): BenchState {
  const { [id]: _o, ...opts } = state.opts;
  const { [id]: _i, ...inputs } = state.inputs;
  return { ...state, opts, inputs, added: state.added.filter((a) => a.id !== id) };
}

export function connect(state: BenchState, id: string, terminal: string, target: Target): BenchState {
  return { ...state, added: state.added.map((a) => (a.id === id ? { ...a, conn: { ...a.conn, [terminal]: target } } : a)) };
}

export function setOption(state: BenchState, id: string, option: string, choice: string): BenchState {
  return { ...state, opts: { ...state.opts, [id]: { ...state.opts[id], [option]: choice } } };
}

export function setInput(state: BenchState, id: string, input: string, value: number): BenchState {
  return { ...state, inputs: { ...state.inputs, [id]: { ...state.inputs[id], [input]: value } } };
}

// ---------- saving ----------

const TARGETS = new Set<string>(["", ...RAILS.map((r) => r.id), ...HEADER_PINS.map((p) => p.target)]);
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * A bench from stored or imported text. Anything that is not understood is
 * dropped and the rest is kept: an unknown part, a pin the board does not
 * have, a value of the wrong type. Text that is not a bench gives the
 * default bench.
 */
export function parseBench(text: string | null | undefined): BenchState {
  const out = emptyBench();
  let v: unknown;
  try {
    v = JSON.parse(text ?? "");
  } catch {
    return out;
  }
  if (!plain(v) || v.v !== 1) return out;
  if (Array.isArray(v.added)) {
    const seen = new Set(HW_BOARD.parts.map((p) => p.id));
    for (const a of v.added.slice(0, MAX_ADDED)) {
      if (!plain(a) || typeof a.id !== "string" || !/^X\d{1,3}$/.test(a.id) || seen.has(a.id) || typeof a.kind !== "string") continue;
      const def = partDef(a.kind);
      if (!def?.addable) continue;
      seen.add(a.id);
      const conn: Record<string, Target> = {};
      for (const t of def.terminals) {
        const c = plain(a.conn) ? a.conn[t.id] : "";
        conn[t.id] = typeof c === "string" && TARGETS.has(c) ? c : "";
      }
      const label = typeof a.label === "string" && a.label.trim() ? a.label.trim().replace(/[^\x20-\x7e]/g, "").slice(0, 40) : def.name;
      out.added.push({ id: a.id, kind: a.kind, label: label || def.name, conn });
    }
  }
  const known = new Map(instances(out).map((i) => [i.id, i]));
  if (plain(v.opts))
    for (const [id, o] of Object.entries(v.opts)) {
      const i = known.get(id);
      if (!i || !plain(o)) continue;
      for (const d of optionsOf(i)) if (typeof o[d.id] === "string" && d.choices.some((c) => c.id === o[d.id]) && o[d.id] !== d.choices[0].id) (out.opts[id] ??= {})[d.id] = o[d.id] as string;
    }
  if (plain(v.inputs))
    for (const [id, o] of Object.entries(v.inputs)) {
      const i = known.get(id);
      if (!i || !plain(o)) continue;
      for (const d of i.def.inputs ?? []) {
        const x = o[d.id];
        if (d.kind !== "hold" && typeof x === "number" && Number.isFinite(x)) (out.inputs[id] ??= {})[d.id] = Math.min(d.max ?? 1, Math.max(d.min ?? 0, x));
      }
    }
  return out;
}

export const serializeBench = (state: BenchState): string => JSON.stringify({ v: 1, opts: state.opts, inputs: state.inputs, added: state.added });

// ---------- in words ----------

/** How one part is connected: "LED1: pin side to GPIO22 (pin 8, J1.8); ground side to GND." */
export function connectionWords(i: Inst): string {
  const via = i.part?.via ? ` through inverter chip ${i.part.via}` : "";
  return i.def.terminals.map((d) => `${d.name} to ${targetWords(i.conn[d.id])}${d.role !== "power" && d.role !== "ground" && gpioOf(i.conn[d.id]) !== null ? via : ""}`).join("; ");
}

/** The whole bench for someone who cannot see the picture: every part, where it goes, what it is doing. */
export function describeBench(state: BenchState, view: BenchView = benchView(state, null)): string[] {
  return view.all().map((i) => {
    const s = statusOf(i, view);
    return `${i.label}: ${connectionWords(i)}. ${view.board ? `Now: ${s.text}.` : ""}${s.why ? ` ${s.why}` : ""}`.trim();
  });
}

export interface WiringRow {
  device: string;
  kind: string;
  terminal: string;
  goesTo: string;
  /** "pin 8, J1.8" for a chip pin, empty for a supply. */
  header: string;
}

/** The wiring table of what the student attached: one row per terminal. */
export function wiringTable(state: BenchState): WiringRow[] {
  return instances(state)
    .filter((i) => !i.part)
    .flatMap((i) =>
      i.def.terminals.map((d): WiringRow => {
        const t = i.conn[d.id];
        const h = headerPin(t);
        return { device: i.label, kind: i.def.name, terminal: d.name, goesTo: !t ? "not connected" : t === "BAT" ? "Battery pack" : t, header: h ? `pin ${h.number}, ${h.header}` : "" };
      }),
    );
}

/** The wiring table as CSV text (a comma or a quote in a cell is quoted). */
export function wiringCsv(state: BenchState): string {
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = wiringTable(state).map((r) => [r.device, r.kind, r.terminal, r.goesTo, r.header]);
  return [["Device", "Kind", "Terminal", "Goes to", "LaunchPad header"], ...rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

export { PART_DEFS };
