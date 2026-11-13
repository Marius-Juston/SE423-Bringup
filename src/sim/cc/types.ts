// C types as the TI C2000 compiler sees them. Sizes are in 16-bit words:
// char and int are one word, long and float two, pointers two.

export interface Field {
  name: string;
  type: CType;
  /** Offset of the storage unit from the start of the struct, in words. */
  off: number;
  /** Bit-fields only: position inside the storage unit and width. */
  bitOff?: number;
  bitW?: number;
  /** Bit-fields only: storage unit size in words (1 or 2). */
  unit?: 1 | 2;
  desc?: string;
}

export type CType =
  | { k: "void" }
  | { k: "int"; w: 1 | 2; s: boolean; ch?: boolean }
  | { k: "float"; w: 2 | 4 }
  | { k: "ptr"; to: CType }
  | { k: "array"; of: CType; n: number }
  | { k: "struct"; name: string; union: boolean; fields: Field[]; size: number; align: number; complete: boolean }
  | { k: "func"; ret: CType; params: CType[]; variadic: boolean; oldStyle?: boolean };

export type StructType = Extract<CType, { k: "struct" }>;
export type FuncType = Extract<CType, { k: "func" }>;

export const VOID: CType = { k: "void" };
export const CHAR: CType = { k: "int", w: 1, s: true, ch: true };
export const INT: CType = { k: "int", w: 1, s: true };
export const UINT: CType = { k: "int", w: 1, s: false };
export const LONG: CType = { k: "int", w: 2, s: true };
export const ULONG: CType = { k: "int", w: 2, s: false };
export const FLOAT: CType = { k: "float", w: 2 };
// Classic C28x (COFF) ABI: double is the same 32-bit type as float.
export const DOUBLE: CType = FLOAT;

export const ptrTo = (to: CType): CType => ({ k: "ptr", to });

export function sizeOf(t: CType): number {
  switch (t.k) {
    case "void":
      return 1;
    case "int":
    case "float":
      return t.w;
    case "ptr":
      return 2;
    case "array":
      return t.n * sizeOf(t.of);
    case "struct":
      return t.size;
    case "func":
      return 2;
  }
}

export function alignOf(t: CType): number {
  switch (t.k) {
    case "int":
    case "float":
      return t.w >= 2 ? 2 : 1;
    case "ptr":
    case "func":
      return 2;
    case "array":
      return alignOf(t.of);
    case "struct":
      return t.align;
    default:
      return 1;
  }
}

export const isInt = (t: CType): t is Extract<CType, { k: "int" }> => t.k === "int";
export const isFloat = (t: CType): t is Extract<CType, { k: "float" }> => t.k === "float";
export const isArith = (t: CType) => t.k === "int" || t.k === "float";
export const isPtr = (t: CType): t is Extract<CType, { k: "ptr" }> => t.k === "ptr";
export const isScalar = (t: CType) => isArith(t) || isPtr(t);

export function typeName(t: CType): string {
  switch (t.k) {
    case "void":
      return "void";
    case "int":
      if (t.ch) return "char";
      return t.w === 1 ? (t.s ? "int16_t" : "uint16_t") : t.s ? "int32_t" : "uint32_t";
    case "float":
      return t.w === 2 ? "float" : "double";
    case "ptr":
      return t.to.k === "func" ? "function pointer" : `${typeName(t.to)} *`;
    case "array":
      return `${typeName(t.of)}[${t.n}]`;
    case "struct":
      return `${t.union ? "union" : "struct"} ${t.name}`;
    case "func":
      return "function";
  }
}

export interface MemberDecl {
  name: string;
  type: CType;
  bitW?: number;
  desc?: string;
}

/** Lays out a struct or union the way the TI compiler does. */
export function layout(st: StructType, members: MemberDecl[]): void {
  const fields: Field[] = [];
  let bp = 0; // position in bits from the start
  let size = 0;
  let align = 1;
  for (const m of members) {
    if (st.union) bp = 0;
    if (m.bitW !== undefined) {
      const unitBits = sizeOf(m.type) * 16;
      if (m.bitW === 0) {
        bp = Math.ceil(bp / unitBits) * unitBits;
        continue;
      }
      if (Math.floor(bp / unitBits) !== Math.floor((bp + m.bitW - 1) / unitBits)) bp = Math.ceil(bp / unitBits) * unitBits;
      const unitStart = Math.floor(bp / unitBits) * unitBits;
      fields.push({
        name: m.name,
        type: m.type,
        off: unitStart / 16,
        bitOff: bp - unitStart,
        bitW: m.bitW,
        unit: (unitBits / 16) as 1 | 2,
        desc: m.desc,
      });
      bp += m.bitW;
      align = Math.max(align, alignOf(m.type));
      size = Math.max(size, Math.ceil(bp / 16));
      continue;
    }
    const a = alignOf(m.type);
    let off = Math.ceil(bp / 16);
    off = Math.ceil(off / a) * a;
    fields.push({ name: m.name, type: m.type, off, desc: m.desc });
    bp = (off + sizeOf(m.type)) * 16;
    align = Math.max(align, a);
    size = Math.max(size, off + sizeOf(m.type));
  }
  st.fields = fields;
  st.align = align;
  st.size = Math.max(1, Math.ceil(size / align) * align);
  st.complete = true;
}

export function sameType(a: CType, b: CType): boolean {
  if (a.k !== b.k) return false;
  switch (a.k) {
    case "void":
      return true;
    case "int":
      return a.w === (b as typeof a).w && a.s === (b as typeof a).s;
    case "float":
      return a.w === (b as typeof a).w;
    case "ptr":
      return sameType(a.to, (b as typeof a).to);
    case "array":
      return a.n === (b as typeof a).n && sameType(a.of, (b as typeof a).of);
    case "struct":
      return a === b;
    case "func":
      return true;
  }
}

/** Closest name by edit distance, for "did you mean" messages. */
export function closest(name: string, candidates: Iterable<string>): string | undefined {
  // A one- or two-letter name is close to everything: a suggestion would only mislead.
  if (name.length < 3) return undefined;
  let best: string | undefined;
  let bestD = Math.min(3, Math.max(1, Math.floor(name.length / 3))) + 1;
  const a = name.toLowerCase();
  for (const c of candidates) {
    const b = c.toLowerCase();
    if (Math.abs(a.length - b.length) >= bestD) continue;
    const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let diag = prev[0];
      prev[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = prev[j];
        prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
        diag = tmp;
      }
    }
    if (prev[b.length] < bestD) {
      bestD = prev[b.length];
      best = c;
    }
  }
  return best;
}
