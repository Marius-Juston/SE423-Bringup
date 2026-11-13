// The F28379D register map: C types for the compiler and one hook per
// register for the peripherals. Built from registers.json (TI headers).

import data from "./registers.json";
import type { Memory, RegHook } from "../memory";
import type { ParseContext } from "../cc/parser";
import { INT, UINT, ULONG, VOID, layout, ptrTo, sizeOf, type CType, type Field, type MemberDecl, type StructType } from "../cc/types";

type RawMember = [name: string, type: string, arrayLen: number, bitWidth: number, desc: string];
interface RawType {
  k: string;
  m: RawMember[];
}
const RAW = data as unknown as { types: Record<string, RawType>; instances: [string, string, number][] };

/** Peripherals whose registers only accept writes between EALLOW and EDIS (TRM register tables). */
const PROTECTED = [
  /^GpioCtrlRegs$/, /^PieVectTable$/, /^DevCfgRegs$/, /^ClkCfgRegs$/, /^CpuSysRegs$/, /^WdRegs$/,
  /^InputXbarRegs$/, /^DmaClaSrcSelRegs$/, /^SyncSocRegs$/, /^Adc[a-d]Regs$/, /^Dac[a-c]Regs$/, /^DmaRegs$/,
];

export interface RegInfo {
  name: string;
  addr: number;
  words: 1 | 2;
  desc: string;
  fields: Field[];
  hook: RegHook;
}

const PINT: CType = ptrTo({ k: "func", ret: VOID, params: [], variadic: false });

export class Device {
  types = new Map<string, StructType>();
  instances: { name: string; type: StructType; addr: number }[] = [];
  regs = new Map<string, RegInfo>();
  regsByAddr = new Map<number, RegInfo>();

  constructor(public mem: Memory) {
    for (const [name, struct, addr] of RAW.instances) {
      const type = this.type(struct);
      this.instances.push({ name, type, addr });
      this.walk(name, type, addr, PROTECTED.some((re) => re.test(name)));
    }
  }

  private scalar(name: string): CType | undefined {
    switch (name) {
      case "Uint16":
      case "bp_16":
        return UINT;
      case "int16":
        return INT;
      case "Uint32":
      case "uint32_t":
      case "bp_32":
        return ULONG;
      case "PINT":
        return PINT;
    }
    return undefined;
  }

  private type(name: string): StructType {
    let st = this.types.get(name);
    if (st) return st;
    const raw = RAW.types[name];
    if (!raw) throw new Error(`registers.json: unknown type ${name}`);
    st = { k: "struct", name, union: raw.k === "union", fields: [], size: 1, align: 1, complete: false };
    this.types.set(name, st);
    const members: MemberDecl[] = raw.m.map(([mname, mtype, arr, bits, desc]) => {
      let t = this.scalar(mtype) ?? this.type(mtype.replace(/^(struct|union) /, ""));
      if (arr) t = { k: "array", of: t, n: arr };
      return { name: mname, type: t, bitW: bits || undefined, desc: desc || undefined };
    });
    layout(st, members);
    return st;
  }

  private walk(prefix: string, st: StructType, base: number, protect: boolean): void {
    for (const f of st.fields) {
      if (/^rsvd/i.test(f.name)) continue;
      const name = `${prefix}.${f.name}`;
      const addr = base + f.off;
      const t = f.type;
      if (t.k === "struct" && !t.union) this.walk(name, t, addr, protect);
      else if (t.k === "array") {
        const es = sizeOf(t.of);
        for (let i = 0; i < t.n; i++) {
          if (t.of.k === "struct" && !t.of.union) this.walk(`${name}[${i}]`, t.of, addr + i * es, protect);
          else this.add(`${name}[${i}]`, t.of, addr + i * es, f.desc ?? "", protect);
        }
      } else this.add(name, t, addr, f.desc ?? "", protect);
    }
  }

  private add(name: string, t: CType, addr: number, desc: string, protect: boolean): void {
    const words = sizeOf(t) as 1 | 2;
    let fields: Field[] = [];
    if (t.k === "struct") {
      const bit = t.fields.find((f) => f.name === "bit");
      if (bit && bit.type.k === "struct") fields = bit.type.fields.filter((f) => !/^rsvd/i.test(f.name));
    }
    const hook: RegHook = { name, addr, words, protect };
    this.mem.hook(hook);
    const info: RegInfo = { name, addr, words, desc, fields, hook };
    this.regs.set(name, info);
    this.regsByAddr.set(addr, info);
  }

  reg(name: string): RegInfo {
    const r = this.regs.get(name);
    if (!r) throw new Error(`unknown register ${name}`);
    return r;
  }

  /** Stored value of a register or of one of its fields ("Reg.FIELD"). */
  get(name: string, field?: string): number {
    const r = this.reg(name);
    const v = this.mem.peek(r.addr, r.words);
    if (!field) return v;
    const f = r.fields.find((x) => x.name === field);
    if (!f) throw new Error(`register ${name} has no field ${field}`);
    return fieldGet(v, f, r.words);
  }

  /** Peripheral-side store (no hooks, no protection). */
  set(name: string, value: number, field?: string): void {
    const r = this.reg(name);
    if (!field) {
      this.mem.poke(r.addr, r.words, value);
      return;
    }
    const f = r.fields.find((x) => x.name === field);
    if (!f) throw new Error(`register ${name} has no field ${field}`);
    this.mem.poke(r.addr, r.words, fieldSet(this.mem.peek(r.addr, r.words), f, value, r.words));
  }

  /** Makes the register types and instances visible to C code. */
  declare(ctx: ParseContext, defineGlobal: (name: string, t: CType, addr: number) => void): void {
    for (const [name, t] of this.types) ctx.tags.set(name, t);
    ctx.typedefs.set("PINT", PINT);
    for (const i of this.instances) defineGlobal(i.name, i.type, i.addr);
  }
}

/** Bit position of a field inside its register (fields are laid out in 16-bit units). */
export function fieldShift(f: Field): number {
  return f.off * 16 + (f.bitOff ?? 0);
}

export function fieldGet(regValue: number, f: Field, _words: number): number {
  const w = f.bitW ?? 16;
  const mask = w === 32 ? 0xffffffff : 2 ** w - 1;
  return Math.floor(regValue / 2 ** fieldShift(f)) & mask;
}

export function fieldSet(regValue: number, f: Field, v: number, _words: number): number {
  const w = f.bitW ?? 16;
  const max = w === 32 ? 0xffffffff : 2 ** w - 1;
  const sh = fieldShift(f);
  const mask = (max * 2 ** sh) >>> 0;
  return ((regValue & ~mask) | (((v & max) * 2 ** sh) & mask)) >>> 0;
}
