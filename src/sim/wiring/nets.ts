// Who is connected to what: from a part to its nets and pins, and from a
// LaunchPad pin (or any pad) to every part and attached device on it. The
// picture's highlight, the sentence under it and the pin table all come
// from here, so they always agree. Pure: no DOM.

import { HEADER_PINS, HW_BOARD, gpioOf, headerPin, isAdc } from "./board";
import { fitted, instances } from "./bench";
import type { BenchState, Inst } from "./types";

const B = HW_BOARD;

/** What the picture can point at: a part, a LaunchPad pin (1 to 80), or a net by its index. */
export type Pick = { t: "part"; id: string } | { t: "pin"; n: number } | { t: "net"; net: number };

/** How a net is used, for the line style of "all connections". */
export type NetKind = "out" | "in" | "analog" | "pwm" | "spi" | "supply" | "ground";
export const NET_KINDS: { id: NetKind; name: string }[] = [
  { id: "out", name: "Digital output (the chip drives a part)" },
  { id: "in", name: "Digital input (a part drives the chip)" },
  { id: "pwm", name: "PWM (pulses for a servo or the buzzer)" },
  { id: "analog", name: "Analog (a voltage for the ADC)" },
  { id: "spi", name: "SPI (the IMU)" },
  { id: "supply", name: "Supply" },
  { id: "ground", name: "Ground" },
];

/** The nets a part is on. For a device the student attached: the nets of the pins and supplies it goes to. */
export function partNets(i: Inst): { near: number[]; far: number[] } {
  if (i.part) return { near: i.part.nets, far: i.part.far };
  const near = [...new Set(i.def.terminals.map((d) => B.nets.indexOf(i.conn[d.id] === "BAT" ? "VIN" : i.conn[d.id])).filter((n) => n >= 0))];
  return { near, far: [] };
}

export interface NetUser {
  inst: Inst;
  /** "LED1 (through IC1)", "Joystick", "RC servo 1: signal wire". */
  words: string;
  kind: NetKind | null;
}

const KIND_OF_PART: Record<string, NetKind> = { led: "out", button: "in", buzzer: "pwm", "buzzer-jumper": "pwm", servo: "pwm", photoresistor: "analog", imu: "spi", "imu-jumper": "spi", battery: "supply", "power-led": "supply" };
const KIND_OF_ROLE: Record<string, NetKind> = { in: "out", pwm: "pwm", out: "in", contact: "in", analog: "analog", power: "supply", ground: "ground" };

/** Every fitted part and attached device on a net. */
export function netUsers(list: Inst[], net: number): NetUser[] {
  const name = B.nets[net];
  const out: NetUser[] = [];
  for (const i of list) {
    if (i.part) {
      if (!fitted(i) || i.kind === "inverter") continue;
      const near = i.part.nets.includes(net);
      if (!near && !i.part.far.includes(net)) continue;
      let kind: NetKind | null = KIND_OF_PART[i.kind] ?? null;
      if (i.kind === "joystick") kind = isAdc(name) ? "analog" : "in";
      out.push({ inst: i, words: `${i.label}${near && i.part.via && gpioOf(name) !== null ? ` (through ${i.part.via})` : near ? "" : " (behind its inverter or resistor)"}`, kind });
    } else {
      for (const d of i.def.terminals) {
        const to = i.conn[d.id] === "BAT" ? "VIN" : i.conn[d.id];
        if (to === name) out.push({ inst: i, words: `${i.label}: ${d.name.replace(/ \(.*\)$/, "")}`, kind: KIND_OF_ROLE[d.role] ?? null });
      }
    }
  }
  return out;
}

const ORDER: NetKind[] = ["spi", "pwm", "analog", "in", "out", "supply", "ground"];
/** How a net is used, or null for a net nothing uses. Supplies and ground are what they are. */
export function netKind(list: Inst[], net: number): NetKind | null {
  const name = B.nets[net];
  if (name === "GND") return "ground";
  if (name === "3V3" || name === "5V" || name === "VIN") return "supply";
  const kinds = netUsers(list, net).map((u) => u.kind);
  return ORDER.find((k) => kinds.includes(k)) ?? null;
}

/** The LaunchPad pins of a net: number, x, y. */
export const pinsOfNet = (net: number): [number, number, number][] => B.launchpad.pins.filter((p) => p[2] === net).map((p) => [p[3], p[0], p[1]]);

/** "GPIO22, pin 8, J1.8" for a net that reaches the LaunchPad, the supply's name, or the net's own name. */
export function netWords(net: number): string {
  const name = B.nets[net];
  const h = headerPin(name);
  if (h) return `${name}, pin ${h.number}, ${h.header}`;
  if (/^(GND|3V3|5V)$/.test(name)) return name;
  if (name === "VIN") return "battery supply";
  return /^n\d+$/.test(name) ? "a net of its own, not on the LaunchPad" : /^[A-D]\d+$/.test(name) ? `pad row ${name}, not on the LaunchPad` : name;
}

export interface PinRow {
  number: number;
  /** "J1.8" */
  header: string;
  /** "GPIO22", "ADCINA4", "3V3", "GND", or "" for a pin the board does not connect. */
  name: string;
  /** What kind of pin: for sorting and filtering. */
  type: "GPIO" | "ADC" | "Supply" | "Ground" | "Other";
  users: string[];
  /** The ePWM outputs the pin can carry. */
  pwm: string[];
}

/** All 80 LaunchPad pins with what is on each. */
export function pinRows(state: BenchState): PinRow[] {
  const list = instances(state);
  return B.launchpad.pins.map(([, , net, number]): PinRow => {
    const name = net < 0 ? "" : B.nets[net];
    const type = gpioOf(name) !== null ? "GPIO" : isAdc(name) ? "ADC" : name === "GND" ? "Ground" : /^(3V3|5V|VIN)$/.test(name) ? "Supply" : "Other";
    return {
      number,
      header: `J${Math.ceil(number / 10)}.${((number - 1) % 10) + 1}`,
      name,
      type,
      users: net < 0 || type === "Supply" || type === "Ground" ? [] : netUsers(list, net).map((u) => u.words),
      pwm: HEADER_PINS.find((h) => h.number === number)?.pwm ?? [],
    };
  });
}

export interface Highlight {
  /** Nets drawn strongly, and nets drawn lightly (behind an inverter or resistor). */
  near: number[];
  far: number[];
  /** One sentence: what it is, where it goes, who else is there. */
  words: string;
}

/** What to light up for a pick, and the sentence that goes with it. */
export function highlightOf(state: BenchState, pick: Pick): Highlight | null {
  const list = instances(state);
  if (pick.t === "part") {
    const i = list.find((x) => x.id === pick.id);
    if (!i) return null;
    const { near, far } = partNets(i);
    const via = i.part?.via ? ` through ${i.part.via}` : "";
    const where = near.map((n) => netWords(n)).filter((w, k, a) => a.indexOf(w) === k);
    return { near, far, words: `${i.label}${i.part && !fitted(i) ? " (not soldered)" : ""}: ${where.length ? `${where.join("; ")}${via}` : "not connected to a pin"}.` };
  }
  const net = pick.t === "net" ? pick.net : (B.launchpad.pins.find((p) => p[3] === pick.n)?.[2] ?? -1);
  const row = pick.t === "pin" ? pinRows(state).find((r) => r.number === pick.n) : undefined;
  const lead = row ? `Pin ${row.number}, ${row.header}` : "Pad";
  if (net < 0) return { near: [], far: [], words: `${lead}: not connected on this board.` };
  const name = B.nets[net];
  const users = netUsers(list, net).map((u) => u.words);
  const what = row ? `${lead}: ${name}` : `${lead} of ${netWords(net)}`;
  if (name === "GND" || name === "3V3" || name === "5V" || name === "VIN") return { near: [net], far: [], words: `${what}. ${name === "GND" ? "Ground" : "A supply"}: every pad of it is marked.` };
  const free = gpioOf(name) !== null || isAdc(name) ? " Free for a device of yours." : "";
  const pwm = row?.pwm.length ? ` Can carry ${row.pwm.join(", ")}.` : "";
  return { near: [net], far: [], words: `${what}. ${users.length ? `Connected: ${users.join(", ")}.` : `Nothing connected.${free}`}${pwm}` };
}
