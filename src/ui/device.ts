// One shared copy of the register map for the puzzles and the handbook.
import { Device, fieldShift, type RegInfo } from "../sim/device/device";
import { Memory } from "../sim/memory";
import trm from "../levels/trm-index.json";

let dev: Device | null = null;
export function device(): Device {
  return (dev ??= new Device(new Memory()));
}

export interface BitField {
  name: string;
  hi: number;
  lo: number;
  desc?: string;
  reserved?: boolean;
}

/** Fields of a register from bit 0 up, with reserved gaps filled in. */
export function fieldsOf(reg: RegInfo): BitField[] {
  const bits = reg.words * 16;
  const named = reg.fields
    .map((f) => ({ name: f.name, lo: fieldShift(f), hi: fieldShift(f) + (f.bitW ?? 16) - 1, desc: f.desc }))
    .sort((a, b) => a.lo - b.lo);
  return fillGaps(named, bits);
}

export function fillGaps(named: BitField[], bits: number): BitField[] {
  const out: BitField[] = [];
  let next = 0;
  for (const f of [...named].sort((a, b) => a.lo - b.lo)) {
    if (f.lo > next) out.push({ name: "reserved", lo: next, hi: f.lo - 1, reserved: true });
    out.push(f);
    next = f.hi + 1;
  }
  if (next < bits) out.push({ name: named.length ? "reserved" : "", lo: next, hi: bits - 1, reserved: named.length > 0 });
  return out;
}

export const fieldValue = (v: number, f: BitField): number => Math.floor(v / 2 ** f.lo) % 2 ** (f.hi - f.lo + 1);

export const hex = (v: number, bits: number): string => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(bits / 4, "0");

const TRM = trm as Record<string, { title: string; page: number }>;
export const TRM_URL = "https://coecsl.ece.illinois.edu/SE423/tms320f28379D_TechRefi.pdf";
export function trmRef(section: string): { title: string; page: number; url: string } | undefined {
  const r = TRM[section];
  return r ? { ...r, url: `${TRM_URL}#page=${r.page}` } : undefined;
}
