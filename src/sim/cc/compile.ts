// Turns the AST into JavaScript closures. Expressions become plain
// functions returning a number; statements become functions or generators
// (generators let the simulation pause between statements).

import type { Memory } from "../memory";
import { CError } from "./lexer";
import type { Expr, FuncDef, Init, Stmt, Unit, VarDecl } from "./parser";
import type { ParseContext } from "./parser";
import {
  CHAR, FLOAT, INT, LONG, UINT, ULONG, VOID,
  closest, isArith, isFloat, isInt, isPtr, isScalar, ptrTo, sameType, sizeOf, typeName,
  type CType, type Field, type FuncType, type StructType,
} from "./types";

export class RuntimeError extends Error {
  constructor(
    public line: number,
    msg: string,
  ) {
    super(msg);
  }
}

/** What compiled code needs from the simulated CPU. */
export interface Rt {
  mem: Memory;
  sp: number;
  fp: number;
  ret: number;
  line: number;
  /** Greater than 0 while course-library code is running. */
  libDepth: number;
  /** Set when the simulation should hand control back to the runner. */
  pause: boolean;
  /** Called at the start of every statement. */
  tick(line: number): void;
  /** The loop just ran a full pass without changing anything: skip ahead. */
  idle(): void;
  warn(line: number, code: string, msg: string): void;
}

export type Native = (args: number[], types: CType[], line: number) => number;

export interface Fn {
  name: string;
  id: number;
  t: FuncType;
  interrupt: boolean;
  line: number;
  frame: number;
  paramStore: ((v: number) => void)[];
  body?: () => Generator<void, Sig>;
  native?: Native;
  defined: boolean;
  file: string;
  /** A library function the student's file is allowed to redefine. */
  replaceable?: boolean;
}

export interface GlobalVar {
  name: string;
  addr: number;
  t: CType;
  file: string;
}

type Sig = 0 | 1 | 2 | 3; // normal, break, continue, return

interface St {
  sync?: () => Sig;
  gen?: () => Generator<void, Sig>;
}

interface LV {
  addr: () => number;
  bit?: Field;
}

interface Ex {
  t: CType;
  get: () => number;
  lv?: LV;
  /** Compile-time constant. */
  c?: number;
  /** Name of the function when the expression is a function designator. */
  fn?: Fn;
}

interface Local {
  t: CType;
  /** Frame offset, or absolute address for static locals. */
  off: number;
  isStatic: boolean;
}

export const GLOBAL_BASE = 0xc000;
export const STACK_BASE = 0x18000;
export const STACK_SIZE = 0x2000;
export const STRING_BASE = 0x90000;
export const FN_BASE = 0x82000;

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

export function floatBits(v: number): number {
  f32[0] = v;
  return u32[0];
}
export function bitsFloat(b: number): number {
  u32[0] = b;
  return f32[0];
}

/** Brings a JavaScript number into the value range of a C type. */
export function normalizer(t: CType): (v: number) => number {
  if (t.k === "int") {
    if (t.w === 1) return t.s ? (v) => (v << 16) >> 16 : (v) => v & 0xffff;
    return t.s ? (v) => v | 0 : (v) => v >>> 0;
  }
  if (t.k === "float") return Math.fround;
  if (t.k === "ptr") return (v) => v >>> 0;
  return (v) => v;
}

export class Compiler {
  fns = new Map<string, Fn>();
  fnById: Fn[] = [];
  globals = new Map<string, GlobalVar>();
  /** Run once before main(): global initialisers. */
  inits: (() => void)[] = [];
  private nextGlobal = GLOBAL_BASE;
  private nextString = STRING_BASE;
  private strings = new Map<string, number>();
  private scopes: Map<string, Local>[] = [];
  private frame = 0;
  private curFn: Fn | null = null;
  private file = "user";
  private loopDepth = 0;
  private switchDepth = 0;

  constructor(
    private rt: Rt,
    private ctx: ParseContext,
  ) {}

  private err(line: number, msg: string): CError {
    return new CError(line, msg, this.file);
  }

  // ---------- memory access ----------

  private loader(t: CType): (a: number) => number {
    const mem = this.rt.mem;
    if (t.k === "int") {
      if (t.w === 1) return t.s ? (a) => (mem.read(a, 1) << 16) >> 16 : (a) => mem.read(a, 1);
      return t.s ? (a) => mem.read(a, 2) | 0 : (a) => mem.read(a, 2);
    }
    if (t.k === "float") return (a) => bitsFloat(mem.read(a, 2));
    if (t.k === "ptr") return (a) => mem.read(a, 2);
    return (a) => a; // arrays, structs, functions: the value is the address
  }

  private storer(t: CType): (a: number, v: number) => void {
    const mem = this.rt.mem;
    if (t.k === "int") return t.w === 1 ? (a, v) => mem.write(a, 1, v & 0xffff) : (a, v) => mem.write(a, 2, v >>> 0);
    if (t.k === "float") return (a, v) => mem.write(a, 2, floatBits(v));
    if (t.k === "ptr") return (a, v) => mem.write(a, 2, v >>> 0);
    throw new Error("storer: not a scalar");
  }

  defineGlobal(name: string, t: CType, addr?: number, file = this.file): GlobalVar {
    if (addr === undefined) {
      const size = sizeOf(t);
      if (size >= 2 && this.nextGlobal % 2) this.nextGlobal++;
      addr = this.nextGlobal;
      this.nextGlobal += size;
    }
    const g: GlobalVar = { name, addr, t, file };
    this.globals.set(name, g);
    return g;
  }

  defineNative(name: string, native: Native): void {
    const f = this.fns.get(name);
    if (!f) throw new Error(`native ${name} has no prototype in the prelude`);
    f.native = native;
    f.defined = true;
  }

  private declareFn(name: string, t: FuncType, line: number, interrupt: boolean): Fn {
    let f = this.fns.get(name);
    if (!f) {
      f = { name, id: this.fnById.length, t, interrupt, line, frame: 0, paramStore: [], defined: false, file: this.file };
      this.fns.set(name, f);
      this.fnById.push(f);
    } else {
      if (interrupt) f.interrupt = true;
      if (!f.t.oldStyle || t.params.length) {
        // A later prototype or the definition refines the type.
        if (!f.defined) f.t = t;
      }
    }
    return f;
  }

  fnAddr(f: Fn): number {
    return FN_BASE + f.id * 2;
  }

  fnAt(addr: number): Fn | undefined {
    const id = (addr - FN_BASE) / 2;
    return Number.isInteger(id) ? this.fnById[id] : undefined;
  }

  // ---------- translation unit ----------

  compileUnit(unit: Unit, file: string): void {
    this.file = file;
    for (const p of unit.protos) this.declareFn(p.name, p.t, p.line, p.interrupt);
    for (const f of unit.funcs) {
      const existing = this.fns.get(f.name);
      if (existing?.defined && !(existing.replaceable && existing.file !== file)) {
        throw this.err(
          f.line,
          existing.native || existing.file !== file
            ? `'${f.name}' is already provided by the course library; give your function another name.`
            : `The function '${f.name}' is defined twice.`,
        );
      }
      this.declareFn(f.name, f.t, f.line, f.interrupt).t = f.t;
    }
    for (const g of unit.globals) this.globalDecl(g);
    for (const f of unit.funcs) this.compileFn(f);
  }

  private globalDecl(v: VarDecl): void {
    const existing = this.globals.get(v.name);
    if (v.isExtern && !v.init) {
      if (!existing) this.defineGlobal(v.name, this.completeArray(v.t, v.init, v.line));
      return;
    }
    if (existing && existing.file === this.file && !v.isExtern) {
      // "extern int x;" followed by "int x;" is fine; two definitions with initialisers are not.
      if (v.init) throw this.err(v.line, `The variable '${v.name}' is defined more than once.`);
      return;
    }
    if (existing && existing.file !== this.file)
      throw this.err(v.line, `'${v.name}' already exists in the course library; choose another name.`);
    if (this.fns.has(v.name)) throw this.err(v.line, `'${v.name}' is already the name of a function.`);
    const t = this.completeArray(v.t, v.init, v.line);
    this.checkComplete(t, v.line, v.name);
    const g = this.defineGlobal(v.name, t);
    if (v.init) {
      const run = this.initCode(t, v.init, () => g.addr);
      this.inits.push(run);
    }
  }

  private checkComplete(t: CType, line: number, name: string): void {
    if (t.k === "void") throw this.err(line, `'${name}' cannot have type void.`);
    if (t.k === "struct" && !t.complete)
      throw this.err(line, `The type 'struct ${t.name}' is not defined, so '${name}' cannot be created.`);
    if (t.k === "array") this.checkComplete(t.of, line, name);
  }

  private completeArray(t: CType, init: Init | undefined, line: number): CType {
    if (t.k !== "array" || t.n !== -1) return t;
    if (!init) throw this.err(line, "This array needs a size, for example: float samples[10];");
    if (init.k === "list") return { k: "array", of: t.of, n: init.items.length };
    if (init.e.k === "str") return { k: "array", of: t.of, n: init.e.value.length + 1 };
    throw this.err(line, "This array needs a size or a { ... } list.");
  }

  private compileFn(def: FuncDef): void {
    const f = this.fns.get(def.name)!;
    f.interrupt = f.interrupt || def.interrupt;
    f.line = def.line;
    f.file = this.file;
    this.curFn = f;
    this.frame = 0;
    this.scopes = [new Map()];
    f.paramStore = def.params.map((p) => {
      if (!p.name) throw this.err(def.line, `A parameter of '${def.name}' has a type but no name.`);
      const off = this.allocLocal(p.name, p.t, def.line);
      const st = this.storer(p.t);
      const rt = this.rt;
      return (v: number) => st(rt.fp + off, v);
    });
    const body = this.stmt(def.body);
    f.frame = this.frame + (this.frame % 2);
    f.defined = true;
    f.body = body.gen ?? syncToGen(body.sync!);
    this.scopes = [];
    this.curFn = null;
  }

  private reserveLocal(t: CType): number {
    const size = sizeOf(t);
    if (size >= 2 && this.frame % 2) this.frame++;
    const off = this.frame;
    this.frame += size;
    return off;
  }

  private bindLocal(name: string, t: CType, off: number, line: number): void {
    const scope = this.scopes[this.scopes.length - 1];
    if (scope.has(name)) throw this.err(line, `'${name}' is declared twice in the same block.`);
    scope.set(name, { t, off, isStatic: false });
  }

  private allocLocal(name: string, t: CType, line: number): number {
    const off = this.reserveLocal(t);
    this.bindLocal(name, t, off, line);
    return off;
  }

  // ---------- initialisers ----------

  /** Code that initialises the object of type t at addr(). */
  private initCode(t: CType, init: Init, addr: () => number): () => void {
    const mem = this.rt.mem;
    if (init.k === "expr" && !(t.k === "array" && init.e.k === "str")) {
      if (t.k === "array") throw this.err(init.line, "Initialise an array with a { ... } list.");
      if (t.k === "struct") {
        const src = this.expr(init.e);
        if (src.t !== t) throw this.err(init.line, "Initialise a struct with a { ... } list.");
        const n = t.size;
        return () => {
          const a = addr();
          const s = src.get();
          for (let i = 0; i < n; i++) mem.write(a + i, 1, mem.read(s + i, 1));
        };
      }
      const val = this.convert(this.rvalue(this.expr(init.e)), t, init.line, "initialise");
      const st = this.storer(t);
      return () => st(addr(), val.get());
    }
    const size = sizeOf(t);
    const parts: (() => void)[] = [];
    if (t.k === "array" && init.k === "expr" && init.e.k === "str") {
      const s = init.e.value;
      if (s.length + 1 > t.n)
        throw this.err(
          init.line,
          `"${s}" needs ${s.length + 1} elements (one per character plus the terminating 0), but the array has ${t.n}.`,
        );
      parts.push(() => {
        const a = addr();
        for (let i = 0; i < s.length; i++) mem.write(a + i, 1, s.charCodeAt(i));
      });
    } else if (init.k === "list") {
      if (t.k === "array") {
        if (init.items.length > t.n)
          throw this.err(init.line, `Too many values: the array has ${t.n} elements but ${init.items.length} values are listed.`);
        const es = sizeOf(t.of);
        init.items.forEach((it, i) => parts.push(this.initCode(t.of, it, () => addr() + i * es)));
      } else if (t.k === "struct") {
        const fields = t.fields.filter((f) => f.bitW === undefined);
        if (init.items.length > fields.length) throw this.err(init.line, "Too many values for this struct.");
        init.items.forEach((it, i) => parts.push(this.initCode(fields[i].type, it, () => addr() + fields[i].off)));
      } else {
        if (init.items.length !== 1) throw this.err(init.line, "A single value is expected here, not a list.");
        return this.initCode(t, init.items[0], addr);
      }
    }
    return () => {
      const a = addr();
      for (let i = 0; i < size; i++) mem.write(a + i, 1, 0);
      for (const p of parts) p();
    };
  }

  // ---------- statements ----------

  private stmt(s: Stmt): St {
    const rt = this.rt;
    const line = s.line;
    // Library code reports the line of the student's call, not its own.
    const tl = this.file === "library" ? 0 : line;
    switch (s.k) {
      case "empty":
        return { sync: () => 0 };
      case "expr": {
        // A direct call to a user function runs as a generator so that the
        // simulation can pause inside it.
        if (s.e.k === "call" && s.e.f.k === "id" && !this.lookupLocal(s.e.f.name)) {
          const f = this.fns.get(s.e.f.name);
          if (f && !f.native) {
            const args = this.callArgs(f, f.t, s.e.args, line);
            const types = this.argTypes(f.t, s.e.args);
            const self = this;
            return {
              gen: function* () {
                rt.tick(tl);
                const vals = args.map((a) => a());
                // Library natives are installed after the library is compiled.
                if (f.native) f.native(vals, types, rt.line);
                else yield* self.invokeGen(f, vals, line);
                return 0 as Sig;
              },
            };
          }
        }
        const e = this.expr(s.e);
        if (e.fn && s.e.k === "id")
          throw this.err(line, `'${s.e.name}' is a function: add () to call it, for example ${s.e.name}();`);
        const get = e.get;
        return {
          sync: () => {
            rt.tick(tl);
            get();
            return 0;
          },
        };
      }
      case "decl": {
        const runs: (() => void)[] = [];
        for (const v of s.vars) {
          const t = this.completeArray(v.t, v.init, v.line);
          this.checkComplete(t, v.line, v.name);
          if (v.isStatic) {
            const scope = this.scopes[this.scopes.length - 1];
            if (scope.has(v.name)) throw this.err(v.line, `'${v.name}' is declared twice in the same block.`);
            const size = sizeOf(t);
            if (size >= 2 && this.nextGlobal % 2) this.nextGlobal++;
            const addr = this.nextGlobal;
            this.nextGlobal += size;
            scope.set(v.name, { t, off: addr, isStatic: true });
            if (v.init) this.inits.push(this.initCode(t, v.init, () => addr));
            continue;
          }
          // The initialiser is compiled before the name exists (int x = x; is an error).
          const off = this.reserveLocal(t);
          if (v.init) runs.push(this.initCode(t, v.init, () => rt.fp + off));
          this.bindLocal(v.name, t, off, v.line);
        }
        if (!runs.length) return { sync: () => 0 };
        return {
          sync: () => {
            rt.tick(tl);
            for (const r of runs) r();
            return 0;
          },
        };
      }
      case "block": {
        this.scopes.push(new Map());
        const body = s.body.map((b) => this.stmt(b));
        this.scopes.pop();
        return seq(body, rt);
      }
      case "if": {
        const c = this.cond(s.c);
        const a = this.stmt(s.a);
        const b = s.b ? this.stmt(s.b) : undefined;
        if (a.sync && (!b || b.sync)) {
          const as = a.sync;
          const bs = b?.sync;
          return {
            sync: () => {
              rt.tick(tl);
              return c() ? as() : bs ? bs() : 0;
            },
          };
        }
        return {
          gen: function* () {
            rt.tick(tl);
            if (c()) return a.gen ? yield* a.gen() : a.sync!();
            if (b) return b.gen ? yield* b.gen() : b.sync!();
            return 0 as Sig;
          },
        };
      }
      case "while":
      case "do":
      case "for": {
        this.scopes.push(new Map());
        const init = s.k === "for" && s.init ? this.stmt(s.init) : undefined;
        const c = s.k === "for" ? (s.c ? this.cond(s.c) : undefined) : this.cond(s.c);
        const step = s.k === "for" && s.step ? this.expr(s.step).get : undefined;
        this.loopDepth++;
        const body = this.stmt(s.body);
        this.loopDepth--;
        this.scopes.pop();
        const mem = rt.mem;
        const testFirst = s.k !== "do";
        return {
          gen: function* () {
            if (init) init.gen ? yield* init.gen() : init.sync!();
            let first = true;
            let idleNext = false;
            for (;;) {
              const w0 = mem.writes;
              const l0 = mem.liveReads;
              const a0 = mem.sigA;
              const b0 = mem.sigB;
              rt.tick(tl);
              if ((testFirst || !first) && c && !c()) break;
              // The previous pass changed nothing and the loop goes on:
              // every later pass would be identical until an event happens,
              // so jump to that event. (Tested after the condition, so a
              // loop that is about to end is never held back.)
              if (idleNext) {
                idleNext = false;
                rt.idle();
                if (rt.pause) yield;
              }
              first = false;
              const sig = body.gen ? yield* body.gen() : body.sync!();
              if (sig === 1) break;
              if (sig === 3) return 3 as Sig;
              if (step) step();
              idleNext = mem.writes === w0 && mem.liveReads === l0 && mem.sigA === a0 && mem.sigB === b0;
              if (rt.pause) yield;
            }
            return 0 as Sig;
          },
        };
      }
      case "switch": {
        const e = this.rvalue(this.expr(s.e));
        if (!isInt(e.t)) throw this.err(line, "switch needs an integer value.");
        if (s.body.k !== "block") throw this.err(line, "switch must be followed by { ... }.");
        this.scopes.push(new Map());
        this.switchDepth++;
        const cases = new Map<number, number>();
        let dflt = -1;
        const body: St[] = [];
        for (const b of s.body.body) {
          if (b.k === "case") {
            if (!b.e) dflt = body.length;
            else {
              const ce = this.expr(b.e);
              if (ce.c === undefined) throw this.err(b.line, "A case value must be a constant (a number, #define or enum).");
              if (cases.has(ce.c)) throw this.err(b.line, `case ${ce.c} appears twice in this switch.`);
              cases.set(ce.c, body.length);
            }
          } else body.push(this.stmt(b));
        }
        this.switchDepth--;
        this.scopes.pop();
        const get = e.get;
        return {
          gen: function* () {
            rt.tick(tl);
            const start = cases.get(get()) ?? dflt;
            if (start < 0) return 0 as Sig;
            for (let i = start; i < body.length; i++) {
              const b = body[i];
              const sig = b.gen ? yield* b.gen() : b.sync!();
              if (sig === 1) return 0 as Sig;
              if (sig) return sig;
              if (rt.pause) yield;
            }
            return 0 as Sig;
          },
        };
      }
      case "case":
        throw this.err(line, "'case' and 'default' belong directly inside the { } of a switch.");
      case "break":
        if (!this.loopDepth && !this.switchDepth) throw this.err(line, "'break' only works inside a loop or a switch.");
        return { sync: () => 1 };
      case "continue":
        if (!this.loopDepth) throw this.err(line, "'continue' only works inside a loop.");
        return { sync: () => 2 };
      case "return": {
        const f = this.curFn!;
        if (s.e) {
          if (f.t.ret.k === "void") throw this.err(line, `'${f.name}' is a void function, so it cannot return a value.`);
          const v = this.convert(this.rvalue(this.expr(s.e)), f.t.ret, line, "return");
          const get = v.get;
          return {
            sync: () => {
              rt.tick(tl);
              rt.ret = get();
              return 3;
            },
          };
        }
        if (f.t.ret.k !== "void")
          throw this.err(line, `'${f.name}' must return a ${typeName(f.t.ret)} value: write return <value>;`);
        return { sync: () => 3 };
      }
    }
  }

  private cond(e: Expr): () => number {
    const x = this.rvalue(this.expr(e));
    if (!isScalar(x.t)) throw this.err(e.line, "A condition must be a number or a pointer.");
    if (e.k === "assign" && e.op === "=")
      this.rt.warn(e.line, "assign-in-condition", "This condition uses = (assignment). To compare two values use ==.");
    return x.get;
  }

  // ---------- calls ----------

  private callArgs(f: Fn | null, ft: FuncType, args: Expr[], line: number): (() => number)[] {
    const name = f ? `'${f.name}'` : "This function";
    if (!ft.oldStyle || ft.params.length) {
      if (args.length < ft.params.length || (!ft.variadic && args.length > ft.params.length)) {
        throw this.err(
          line,
          `${name} takes ${ft.params.length} argument${ft.params.length === 1 ? "" : "s"}, but ${args.length} ${args.length === 1 ? "was" : "were"} given.`,
        );
      }
    }
    return args.map((a, i) => {
      const x = this.rvalue(this.expr(a));
      const pt = ft.params[i];
      if (!pt) return this.promoteVar(x).get;
      return this.convert(x, pt, a.line, `pass as argument ${i + 1} of ${name}`).get;
    });
  }

  private argTypes(ft: FuncType, args: Expr[]): CType[] {
    return args.map((a, i) => ft.params[i] ?? this.promoteVar(this.rvalue(this.expr(a))).t);
  }

  /** Default argument promotions for "..." arguments. */
  private promoteVar(x: Ex): Ex {
    if (isInt(x.t) && x.t.ch) return { t: INT, get: x.get, c: x.c };
    return x;
  }

  /** Runs a function to completion (used from expressions and for interrupts). */
  invoke(f: Fn, args: number[], line: number): number {
    if (f.native) return f.native(args, f.t.params, this.rt.line);
    const rt = this.rt;
    const body = this.enter(f, args, line);
    const savedFp = rt.fp;
    const base = rt.sp;
    rt.fp = base;
    rt.sp = base + f.frame;
    for (let i = 0; i < f.paramStore.length; i++) f.paramStore[i](args[i] ?? 0);
    const lib = f.file === "library" ? 1 : 0;
    rt.libDepth += lib;
    try {
      const g = body();
      while (!g.next().done) {
        /* pauses are ignored here; the caller is not resumable */
      }
    } finally {
      rt.libDepth -= lib;
      rt.sp = base;
      rt.fp = savedFp;
    }
    return rt.ret;
  }

  *invokeGen(f: Fn, args: number[], line: number): Generator<void, number> {
    const rt = this.rt;
    const body = this.enter(f, args, line);
    const savedFp = rt.fp;
    const base = rt.sp;
    rt.fp = base;
    rt.sp = base + f.frame;
    for (let i = 0; i < f.paramStore.length; i++) f.paramStore[i](args[i] ?? 0);
    const lib = f.file === "library" ? 1 : 0;
    rt.libDepth += lib;
    try {
      yield* body();
    } finally {
      rt.libDepth -= lib;
      rt.sp = base;
      rt.fp = savedFp;
    }
    return rt.ret;
  }

  private enter(f: Fn, _args: number[], line: number): () => Generator<void, Sig> {
    if (!f.body)
      throw new RuntimeError(line, `'${f.name}' is declared but has no body. Write the function, or check the spelling of its name.`);
    if (this.rt.sp + f.frame > STACK_BASE + STACK_SIZE)
      throw new RuntimeError(line, `Stack overflow while calling '${f.name}'. A function is probably calling itself forever.`);
    return f.body;
  }

  // ---------- expressions ----------

  private lookupLocal(name: string): Local | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const l = this.scopes[i].get(name);
      if (l) return l;
    }
    return undefined;
  }

  /** Array and function values decay to pointers. */
  private rvalue(x: Ex): Ex {
    if (x.t.k === "array") return { t: ptrTo(x.t.of), get: x.lv ? x.lv.addr : x.get };
    if (x.t.k === "func") return { t: ptrTo(x.t), get: x.get, fn: x.fn };
    return x;
  }

  private convert(x: Ex, to: CType, line: number, what: string): Ex {
    const from = x.t;
    if (sameType(from, to) && from.k !== "struct") return x;
    const fold = (get: () => number): Ex => (x.c !== undefined ? { t: to, get, c: get() } : { t: to, get });
    const g = x.get;
    if (isArith(from) && isArith(to)) {
      if (isInt(to)) {
        const n = normalizer(to);
        if (isFloat(from)) {
          return fold(() => {
            const v = g();
            return n(Number.isFinite(v) ? Math.trunc(v) : 0);
          });
        }
        // Widening conversions that keep the value need no work.
        if (to.w > (from as typeof to).w && ((from as typeof to).s === to.s || !(from as typeof to).s)) return { ...x, t: to, lv: undefined };
        return fold(() => n(g()));
      }
      return isFloat(from) ? { ...x, t: to, lv: undefined } : fold(() => Math.fround(g()));
    }
    if (isPtr(to)) {
      if (isPtr(from)) return { t: to, get: g, c: x.c, fn: x.fn };
      if (isInt(from)) {
        if (x.c === 0 || what === "cast") return fold(() => g() >>> 0);
        throw this.err(line, `Cannot ${what}: a ${typeName(from)} value is not a pointer. Did you forget & ?`);
      }
    }
    if (isInt(to) && isPtr(from)) {
      if (what === "cast") {
        const n = normalizer(to);
        return { t: to, get: () => n(g()) };
      }
      throw this.err(line, `Cannot ${what}: this is a pointer (an address), but a ${typeName(to)} number is expected. Did you forget * or use & by mistake?`);
    }
    if (to.k === "void" && what === "cast") return { t: VOID, get: g };
    if (from.k === "struct" && to.k === "struct" && from === to) return x;
    if (from.k === "struct" && isScalar(to) && regView(from))
      throw this.err(line, `This is a whole register (${typeName(from)}). Add .all for its full value or .bit.NAME for one field.`);
    throw this.err(line, `Cannot ${what}: the value is ${describe(from)} but ${describe(to)} is expected.`);
  }

  /** Usual arithmetic conversions with a 16-bit int. */
  private common(a: CType, b: CType): CType {
    if (isFloat(a) || isFloat(b)) return FLOAT;
    const ia = a as Extract<CType, { k: "int" }>;
    const ib = b as Extract<CType, { k: "int" }>;
    if (ia.w === 2 || ib.w === 2) {
      if ((ia.w === 2 && !ia.s) || (ib.w === 2 && !ib.s)) return ULONG;
      return LONG;
    }
    return !ia.s || !ib.s ? UINT : INT;
  }

  private promote(t: CType): CType {
    if (isInt(t) && t.w === 1) return t.s ? INT : UINT;
    return t;
  }

  expr(e: Expr): Ex {
    const rt = this.rt;
    const mem = rt.mem;
    const line = e.line;
    switch (e.k) {
      case "num": {
        const v = e.t.k === "float" ? Math.fround(e.value) : e.value;
        return { t: e.t, get: () => v, c: v };
      }
      case "str": {
        let addr = this.strings.get(e.value);
        if (addr === undefined) {
          addr = this.nextString;
          this.nextString += e.value.length + 1;
          this.strings.set(e.value, addr);
          for (let i = 0; i < e.value.length; i++) mem.poke(addr + i, 1, e.value.charCodeAt(i));
          mem.poke(addr + e.value.length, 1, 0);
        }
        const a = addr;
        return { t: { k: "array", of: CHAR, n: e.value.length + 1 }, get: () => a, lv: { addr: () => a } };
      }
      case "id": {
        const l = this.lookupLocal(e.name);
        if (l) {
          const off = l.off;
          const addr = l.isStatic ? () => off : () => rt.fp + off;
          const ld = this.loader(l.t);
          return { t: l.t, get: l.isStatic ? () => ld(off) : () => ld(rt.fp + off), lv: { addr } };
        }
        const g = this.globals.get(e.name);
        if (g) {
          const a = g.addr;
          const ld = this.loader(g.t);
          return { t: g.t, get: () => ld(a), lv: { addr: () => a } };
        }
        const f = this.fns.get(e.name);
        if (f) {
          const a = this.fnAddr(f);
          return { t: f.t, get: () => a, fn: f };
        }
        const en = this.ctx.enums.get(e.name);
        if (en !== undefined) return { t: INT, get: () => en, c: en };
        const names = [
          ...this.scopes.flatMap((s) => [...s.keys()]),
          ...this.globals.keys(),
          ...this.fns.keys(),
          ...this.ctx.enums.keys(),
        ];
        const hint = closest(e.name, names);
        throw this.err(
          line,
          `'${e.name}' is not declared.${hint ? ` Did you mean '${hint}'?` : " Declare it before using it, and check the spelling and capital letters."}`,
        );
      }
      case "cast": {
        const x = this.rvalue(this.expr(e.e));
        return this.convert(x, e.t, line, "cast");
      }
      case "sizeof": {
        const t = e.t ?? this.expr(e.e!).t;
        const n = sizeOf(t);
        return { t: ULONG, get: () => n, c: n };
      }
      case "comma": {
        const a = this.expr(e.a).get;
        const b = this.rvalue(this.expr(e.b));
        const bg = b.get;
        return { t: b.t, get: () => (a(), bg()) };
      }
      case "cond": {
        const c = this.cond(e.c);
        let a = this.rvalue(this.expr(e.a));
        let b = this.rvalue(this.expr(e.b));
        let t = a.t;
        if (isArith(a.t) && isArith(b.t)) {
          t = this.common(this.promote(a.t), this.promote(b.t));
          a = this.convert(a, t, line, "use in ?:");
          b = this.convert(b, t, line, "use in ?:");
        } else if (isPtr(a.t) && isInt(b.t)) b = this.convert(b, a.t, line, "use in ?:");
        else if (isPtr(b.t) && isInt(a.t)) {
          a = this.convert(a, b.t, line, "use in ?:");
          t = b.t;
        }
        const ag = a.get;
        const bg = b.get;
        return { t, get: () => (c() ? ag() : bg()) };
      }
      case "member":
        return this.member(e);
      case "index":
        return this.deref(this.binary("+", this.expr(e.a), this.expr(e.i), line), line, true);
      case "call":
        return this.call(e);
      case "un":
        return this.unary(e);
      case "post": {
        const x = this.expr(e.e);
        return this.incdec(x, e.op === "++" ? 1 : -1, false, line);
      }
      case "bin": {
        if (e.op === "&&" || e.op === "||") {
          const a = this.cond(e.a);
          const b = this.cond(e.b);
          return e.op === "&&" ? { t: INT, get: () => (a() && b() ? 1 : 0) } : { t: INT, get: () => (a() || b() ? 1 : 0) };
        }
        return this.binary(e.op, this.expr(e.a), this.expr(e.b), line);
      }
      case "assign":
        return this.assign(e);
    }
  }

  private member(e: Extract<Expr, { k: "member" }>): Ex {
    const base = this.expr(e.e);
    const line = e.line;
    let st: CType;
    let addr: () => number;
    if (e.arrow) {
      const p = this.rvalue(base);
      if (!isPtr(p.t) || p.t.to.k !== "struct") {
        throw this.err(
          line,
          base.t.k === "struct"
            ? `Use '.' here, not '->': '.${e.name}' ('->' is only for pointers).`
            : `'->' needs a pointer to a struct on its left.`,
        );
      }
      st = p.t.to;
      addr = p.get;
    } else {
      if (base.t.k !== "struct" || !base.lv) {
        throw this.err(
          line,
          isPtr(base.t) && base.t.to.k === "struct"
            ? `This is a pointer: use '->${e.name}' instead of '.${e.name}'.`
            : `'.${e.name}' needs a struct or a register on its left, but this is ${describe(base.t)}.`,
        );
      }
      st = base.t;
      addr = base.lv.addr;
    }
    const s = st as StructType;
    if (!s.complete) throw this.err(line, `The type 'struct ${s.name}' is not defined.`);
    const f = s.fields.find((x) => x.name === e.name);
    if (!f) {
      const bit = s.fields.find((x) => x.name === "bit");
      if (bit && bit.type.k === "struct" && bit.type.fields.some((x) => x.name === e.name))
        throw this.err(line, `'${e.name}' is a bit field: write .bit.${e.name}`);
      const gp = /^GPIO(\d+)$/.exec(e.name);
      if (gp && s.fields.some((x) => /^GPIO\d+$/.test(x.name))) {
        const n = +gp[1];
        if (n > 168) throw this.err(line, `There is no GPIO${n}: the chip has GPIO0 to GPIO168.`);
        const port = "ABCDEF"[n >> 5];
        throw this.err(
          line,
          `GPIO${n} is not in this register. GPIO${n} belongs to port ${port} (GPIO${(n >> 5) * 32} to GPIO${Math.min(168, (n >> 5) * 32 + 31)}), so use the GP${port}... register, for example GP${port}SET.`,
        );
      }
      const names = s.fields.map((x) => x.name).filter((n) => n && !/^rsvd/i.test(n));
      const hint = closest(e.name, names);
      const list = names.length <= 12 ? ` It has: ${names.join(", ")}.` : "";
      throw this.err(line, `There is no '${e.name}' here.${hint ? ` Did you mean '${hint}'?` : list}`);
    }
    const off = f.off;
    const a = off ? () => addr() + off : addr;
    if (f.bitW !== undefined) {
      const mem = this.rt.mem;
      const unit = f.unit!;
      const sh = f.bitOff!;
      const mask = f.bitW === 32 ? 0xffffffff : 2 ** f.bitW - 1;
      const signed = isInt(f.type) && f.type.s;
      const w = f.bitW;
      // Tell the register which bits this read is about (a floating pin
      // only matters when its own bit is read).
      const unitMask = (mask * 2 ** sh) >>> 0;
      const readBits = (addr: number): number => {
        mem.readMask = unitMask;
        const v = mem.read(addr, unit);
        mem.readMask = 0;
        return v;
      };
      return {
        t: this.promote(f.type),
        get: signed
          ? () => (((readBits(a()) >>> sh) & mask) << (32 - w)) >> (32 - w)
          : () => ((readBits(a()) >>> sh) & mask) >>> 0,
        lv: { addr: a, bit: f },
      };
    }
    const ld = this.loader(f.type);
    return { t: f.type, get: () => ld(a()), lv: { addr: a } };
  }

  private deref(p: Ex, line: number, index = false): Ex {
    const x = this.rvalue(p);
    if (!isPtr(x.t)) {
      throw this.err(line, index ? "Only arrays and pointers can be indexed with [ ]." : `'*' needs a pointer, but this is ${describe(x.t)}.`);
    }
    const to = x.t.to;
    if (to.k === "void") throw this.err(line, "A void pointer must be cast to a real type before it is used.");
    if (to.k === "func") return { t: to, get: x.get };
    const ld = this.loader(to);
    const g = x.get;
    return { t: to, get: () => ld(g()), lv: { addr: g } };
  }

  private call(e: Extract<Expr, { k: "call" }>): Ex {
    const line = e.line;
    const self = this;
    const rt = this.rt;
    if (e.f.k === "id" && !this.lookupLocal(e.f.name) && !this.globals.has(e.f.name)) {
      const f = this.fns.get(e.f.name);
      if (!f) {
        const hint = closest(e.f.name, this.fns.keys());
        throw this.err(line, `There is no function called '${e.f.name}'.${hint ? ` Did you mean '${hint}'?` : ""}`);
      }
      const args = this.callArgs(f, f.t, e.args, line);
      const n = args.length;
      const types = this.argTypes(f.t, e.args);
      return {
        t: f.t.ret,
        get: () => {
          const vals = new Array<number>(n);
          for (let i = 0; i < n; i++) vals[i] = args[i]();
          return f.native ? f.native(vals, types, rt.line) : self.invoke(f, vals, line);
        },
      };
    }
    let callee = this.rvalue(this.expr(e.f));
    if (isPtr(callee.t) && callee.t.to.k !== "func") callee = this.rvalue(this.deref(callee, line));
    if (!isPtr(callee.t) || callee.t.to.k !== "func") throw this.err(line, "This is not a function, so it cannot be called with ( ).");
    const ft = callee.t.to;
    const args = this.callArgs(null, ft, e.args, line);
    const types = this.argTypes(ft, e.args);
    const cg = callee.get;
    return {
      t: ft.ret,
      get: () => {
        const addr = cg();
        const f = self.fnAt(addr);
        if (!f) throw new RuntimeError(line, `Call through a function pointer that does not point to a function (value 0x${addr.toString(16)}).`);
        const vals = args.map((a) => a());
        return f.native ? f.native(vals, types, rt.line) : self.invoke(f, vals, line);
      },
    };
  }

  private unary(e: Extract<Expr, { k: "un" }>): Ex {
    const line = e.line;
    if (e.op === "&") {
      const x = this.expr(e.e);
      if (x.fn) return { t: ptrTo(x.t), get: x.get, fn: x.fn };
      if (!x.lv) throw this.err(line, "'&' needs a variable (something with an address), not a value.");
      if (x.lv.bit) throw this.err(line, "A bit field has no address of its own; '&' cannot be used on it.");
      return { t: ptrTo(x.t), get: x.lv.addr };
    }
    if (e.op === "*") return this.deref(this.expr(e.e), line);
    if (e.op === "++" || e.op === "--") return this.incdec(this.expr(e.e), e.op === "++" ? 1 : -1, true, line);
    const x = this.rvalue(this.expr(e.e));
    const g = x.get;
    if (e.op === "!") {
      if (!isScalar(x.t)) throw this.err(line, "'!' needs a number or a pointer.");
      return fold({ t: INT, get: () => (g() ? 0 : 1) }, x);
    }
    if (!isArith(x.t)) throw this.err(line, `'${e.op}' needs a number, but this is ${describe(x.t)}.`);
    const t = this.promote(x.t);
    const n = normalizer(t);
    if (e.op === "+") return fold({ t, get: g }, x);
    if (e.op === "-") return fold({ t, get: () => n(-g()) }, x);
    if (isFloat(t)) throw this.err(line, "'~' only works on integers.");
    return fold({ t, get: () => n(~g()) }, x);
  }

  private incdec(x: Ex, d: number, pre: boolean, line: number): Ex {
    if (!x.lv) throw this.err(line, `'${d > 0 ? "++" : "--"}' needs a variable.`);
    if (!isScalar(x.t)) throw this.err(line, `'${d > 0 ? "++" : "--"}' needs a number or pointer variable.`);
    const step = isPtr(x.t) ? d * sizeOf(x.t.to) : d;
    const n = normalizer(x.t);
    const w = this.writer(x, line);
    const g = x.get;
    // Evaluate the address once.
    if (x.lv.bit) {
      return {
        t: x.t,
        get: () => {
          const old = g();
          const nv = n(old + step);
          w(nv);
          return pre ? nv : old;
        },
      };
    }
    const ld = this.loader(x.t);
    const st = this.storer(x.t);
    const addr = x.lv.addr;
    return {
      t: x.t,
      get: () => {
        const a = addr();
        const old = ld(a);
        const nv = n(old + step);
        st(a, nv);
        return pre ? nv : old;
      },
    };
  }

  /** A function that stores a (already converted) value into the lvalue. */
  private writer(x: Ex, line: number): (v: number) => void {
    const lv = x.lv;
    if (!lv) throw this.err(line, "The left side of = must be a variable or a register field, not a value.");
    if (x.t.k === "array") throw this.err(line, "An array cannot be assigned as a whole; assign its elements one by one.");
    const rt = this.rt;
    const mem = rt.mem;
    if (lv.bit) {
      const f = lv.bit;
      const unit = f.unit!;
      const sh = f.bitOff!;
      const max = f.bitW === 32 ? 0xffffffff : 2 ** f.bitW! - 1;
      const mask = (max * 2 ** sh) >>> 0;
      const addr = lv.addr;
      const w = f.bitW!;
      const name = f.name;
      return (v: number) => {
        if (v > max || v < -(max + 1) / 2 - (w === 1 ? 1 : 0)) {
          rt.warn(
            rt.line,
            "field-overflow",
            `${v} does not fit in ${name}, which is ${w} bit${w === 1 ? "" : "s"} wide (0 to ${max}). Only the low ${w === 1 ? "bit" : `${w} bits`} were stored: ${(v & max) >>> 0}.`,
          );
        }
        const a = addr();
        const old = mem.read(a, unit);
        mem.write(a, unit, ((old & ~mask) | ((v * 2 ** sh) & mask)) >>> 0);
      };
    }
    const st = this.storer(x.t);
    const addr = lv.addr;
    return (v: number) => st(addr(), v);
  }

  private assign(e: Extract<Expr, { k: "assign" }>): Ex {
    const line = e.line;
    const a = this.expr(e.a);
    if (!a.lv) {
      throw this.err(
        line,
        a.fn
          ? `'${a.fn.name}' is a function and cannot be assigned to.`
          : "The left side of = must be a variable or a register field, not a value.",
      );
    }
    if (a.t.k === "struct") {
      if (e.op !== "=") throw this.err(line, `'${e.op}' does not work on a whole struct.`);
      const b = this.expr(e.b);
      if (b.t !== a.t) {
        throw this.err(
          line,
          regView(a.t)
            ? "This is a whole register with two views. Assign to .all (the full value) or to .bit.NAME (one field)."
            : `Cannot assign ${describe(b.t)} to ${describe(a.t)}.`,
        );
      }
      const mem = this.rt.mem;
      const n = a.t.size;
      const da = a.lv.addr;
      const sa = b.lv!.addr;
      return {
        t: a.t,
        get: () => {
          const d = da();
          const s = sa();
          for (let i = 0; i < n; i++) mem.write(d + i, 1, mem.read(s + i, 1));
          return d;
        },
        lv: a.lv,
      };
    }
    if (e.op === "=") {
      const b = this.convert(this.rvalue(this.expr(e.b)), a.t, line, "assign");
      const bg = b.get;
      if (!a.lv.bit) {
        const st = this.storer(a.t);
        const addr = a.lv.addr;
        return {
          t: a.t,
          get: () => {
            const ad = addr();
            const v = bg();
            st(ad, v);
            return v;
          },
        };
      }
      const w = this.writer(a, line);
      return {
        t: a.t,
        get: () => {
          const v = bg();
          w(v);
          return v;
        },
      };
    }
    // Compound assignment: read, combine, write back (address evaluated once).
    const op = e.op.slice(0, -1);
    const b = this.expr(e.b);
    if (a.lv.bit) {
      const cur: Ex = { t: a.t, get: a.get };
      const res = this.convert(this.binary(op, cur, b, line), a.t, line, "assign");
      const w = this.writer(a, line);
      const rg = res.get;
      return {
        t: a.t,
        get: () => {
          const v = rg();
          w(v);
          return v;
        },
      };
    }
    let slot = 0;
    const ld = this.loader(a.t);
    const st = this.storer(a.t);
    const cur: Ex = { t: a.t, get: () => ld(slot) };
    const res = this.convert(this.binary(op, cur, b, line), a.t, line, "assign");
    const rg = res.get;
    const addr = a.lv.addr;
    return {
      t: a.t,
      get: () => {
        const saved = slot;
        const ad = addr();
        slot = ad;
        const v = rg();
        slot = saved;
        st(ad, v);
        return v;
      },
    };
  }

  private binary(op: string, a0: Ex, b0: Ex, line: number): Ex {
    const rt = this.rt;
    let a = this.rvalue(a0);
    let b = this.rvalue(b0);
    const bad = () =>
      this.err(line, `'${op}' cannot combine ${describe(a.t)} and ${describe(b.t)}.${regView(a.t) || regView(b.t) ? " For a register add .all or .bit.NAME." : ""}`);
    // Pointer arithmetic and comparison.
    if (isPtr(a.t) || isPtr(b.t)) {
      const ag = a.get;
      const bg = b.get;
      if (op === "+" || op === "-") {
        if (isPtr(a.t) && isInt(b.t)) {
          const size = pointeeSize(a.t, line);
          return { t: a.t, get: op === "+" ? () => ag() + bg() * size : () => ag() - bg() * size };
        }
        if (op === "+" && isInt(a.t) && isPtr(b.t)) {
          const size = pointeeSize(b.t, line);
          return { t: b.t, get: () => bg() + ag() * size };
        }
        if (op === "-" && isPtr(a.t) && isPtr(b.t)) {
          const size = pointeeSize(a.t, line);
          return { t: LONG, get: () => Math.trunc((ag() - bg()) / size) };
        }
      }
      const cmp = compareOp(op);
      if (cmp && (isScalar(a.t) && isScalar(b.t))) return { t: INT, get: () => (cmp(ag(), bg()) ? 1 : 0) };
      throw bad();
    }
    if (!isArith(a.t) || !isArith(b.t)) throw bad();

    if (op === "<<" || op === ">>") {
      if (isFloat(a.t) || isFloat(b.t)) throw this.err(line, `'${op}' only works on integers.`);
      const t = this.promote(a.t) as Extract<CType, { k: "int" }>;
      const n = normalizer(t);
      const ag = a.get;
      const bg = b.get;
      const bits = t.w * 16;
      let get: () => number;
      if (op === "<<") {
        get = () => {
          const s = bg();
          if (s >= bits || s < 0) {
            rt.warn(line, "shift-width", `Shifting a ${bits}-bit value by ${s} is undefined in C (the count must be 0 to ${bits - 1}). The result here is 0; on the chip it can be anything.`);
            return 0;
          }
          return n(ag() * 2 ** s);
        };
        if (a.c === 1 && t.w === 1 && t.s) {
          const inner = get;
          get = () => {
            const s = bg();
            if (s >= 15)
              rt.warn(line, "shift-16", `1 << ${s} does not fit in a 16-bit int (int is 16 bits on this chip). Write 1UL << ${s} for a 32-bit value.`);
            return inner();
          };
        }
      } else get = t.s ? () => ag() >> Math.min(bg(), 31) : () => (bg() >= bits ? 0 : ag() >>> bg());
      return fold2({ t, get }, a, b);
    }

    const t = this.common(this.promote(a.t), this.promote(b.t));
    a = this.convert(a, t, line, "combine");
    b = this.convert(b, t, line, "combine");
    const ag = a.get;
    const bg = b.get;
    const cmp = compareOp(op);
    if (cmp) return fold2({ t: INT, get: () => (cmp(ag(), bg()) ? 1 : 0) }, a, b);

    if (isFloat(t)) {
      const fr = Math.fround;
      switch (op) {
        case "+": return fold2({ t, get: () => fr(ag() + bg()) }, a, b);
        case "-": return fold2({ t, get: () => fr(ag() - bg()) }, a, b);
        case "*": return fold2({ t, get: () => fr(ag() * bg()) }, a, b);
        case "/": return fold2({ t, get: () => fr(ag() / bg()) }, a, b);
      }
      throw this.err(line, `'${op}' only works on integers, but one side is a float.${op === "%" ? " Use fmod() or cast to an integer first." : ""}`);
    }

    const it = t as Extract<CType, { k: "int" }>;
    const n = normalizer(t);
    const is16s = it.w === 1 && it.s;
    const overflow = (v: number, sym: string, x: number, y: number) => {
      rt.warn(
        rt.line,
        "int16-overflow",
        `${x} ${sym} ${y} = ${v} does not fit in a 16-bit int (-32768 to 32767), so the result wrapped around to ${n(v)}. Make one operand 32-bit (for example ${x}L) or use int32_t.`,
      );
    };
    switch (op) {
      case "+":
        return fold2(
          {
            t,
            get: is16s
              ? () => {
                  const x = ag();
                  const y = bg();
                  const v = x + y;
                  if (v > 32767 || v < -32768) overflow(v, "+", x, y);
                  return n(v);
                }
              : () => n(ag() + bg()),
          },
          a,
          b,
        );
      case "-":
        return fold2(
          {
            t,
            get: is16s
              ? () => {
                  const x = ag();
                  const y = bg();
                  const v = x - y;
                  if (v > 32767 || v < -32768) overflow(v, "-", x, y);
                  return n(v);
                }
              : () => n(ag() - bg()),
          },
          a,
          b,
        );
      case "*":
        if (it.w === 2) return fold2({ t, get: () => n(Math.imul(ag(), bg())) }, a, b);
        return fold2(
          {
            t,
            get: is16s
              ? () => {
                  const x = ag();
                  const y = bg();
                  const v = x * y;
                  if (v > 32767 || v < -32768) overflow(v, "*", x, y);
                  return n(v);
                }
              : () => n(ag() * bg()),
          },
          a,
          b,
        );
      case "/":
      case "%": {
        const div = op === "/";
        return {
          t,
          get: () => {
            const y = bg();
            if (y === 0) throw new RuntimeError(rt.line, `Division by zero${div ? "" : " in %"}.`);
            const x = ag();
            return n(div ? Math.trunc(x / y) : x % y);
          },
        };
      }
      case "&": return fold2({ t, get: () => n(ag() & bg()) }, a, b);
      case "|": return fold2({ t, get: () => n(ag() | bg()) }, a, b);
      case "^": return fold2({ t, get: () => n(ag() ^ bg()) }, a, b);
    }
    throw this.err(line, `Unknown operator '${op}'.`);
  }
}

function syncToGen(f: () => Sig): () => Generator<void, Sig> {
  return function* () {
    return f();
  };
}

/** Runs statements one after another; a generator only when one of them is. */
function seq(body: St[], rt: Rt): St {
  if (body.every((b) => b.sync)) {
    const fs = body.map((b) => b.sync!);
    const n = fs.length;
    if (n === 1) return { sync: fs[0] };
    return {
      sync: () => {
        for (let i = 0; i < n; i++) {
          const sig = fs[i]();
          if (sig) return sig;
        }
        return 0;
      },
    };
  }
  return {
    gen: function* () {
      for (const b of body) {
        const sig = b.gen ? yield* b.gen() : b.sync!();
        if (sig) return sig;
        if (rt.pause) yield;
      }
      return 0 as Sig;
    },
  };
}

function compareOp(op: string): ((a: number, b: number) => boolean) | undefined {
  switch (op) {
    case "==": return (a, b) => a === b;
    case "!=": return (a, b) => a !== b;
    case "<": return (a, b) => a < b;
    case ">": return (a, b) => a > b;
    case "<=": return (a, b) => a <= b;
    case ">=": return (a, b) => a >= b;
  }
  return undefined;
}

/** Marks an expression constant when its operand is. */
function fold(x: Ex, a: Ex): Ex {
  if (a.c !== undefined) x.c = x.get();
  return x;
}
function fold2(x: Ex, a: Ex, b: Ex): Ex {
  if (a.c !== undefined && b.c !== undefined) {
    const v = x.get();
    x.c = v;
    x.get = () => v;
  }
  return x;
}

function pointeeSize(t: Extract<CType, { k: "ptr" }>, line: number): number {
  if (t.to.k === "void") throw new CError(line, "Arithmetic on a void pointer is not possible; cast it to a real type first.");
  return sizeOf(t.to);
}

/** True for the union types TI uses for registers (members "all" and "bit"). */
function regView(t: CType): boolean {
  return t.k === "struct" && t.union && t.fields.some((f) => f.name === "all");
}

function describe(t: CType): string {
  if (regView(t)) return "a whole register";
  switch (t.k) {
    case "struct":
      return `a ${t.union ? "union" : "struct"} (${t.name})`;
    case "array":
      return "an array";
    case "ptr":
      return t.to.k === "func" ? "a function pointer" : `a pointer (${typeName(t)})`;
    case "func":
      return "a function";
    case "void":
      return "nothing (void)";
    default:
      return `a ${typeName(t)}`;
  }
}
