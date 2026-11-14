// Recursive-descent parser for the C subset. Declarations are resolved to
// CTypes here; expressions are typed later, in compile.ts.

import { CError, parseNumber, type Tok } from "./lexer";
import {
  CHAR, DOUBLE, FLOAT, INT, LONG, UINT, ULONG, VOID,
  closest, layout, ptrTo, sizeOf,
  type CType, type FuncType, type MemberDecl, type StructType,
} from "./types";

export type Expr =
  | { k: "num"; line: number; value: number; t: CType }
  | { k: "str"; line: number; value: string }
  | { k: "id"; line: number; name: string }
  | { k: "un"; line: number; op: string; e: Expr }
  | { k: "post"; line: number; op: string; e: Expr }
  | { k: "bin"; line: number; op: string; a: Expr; b: Expr }
  | { k: "assign"; line: number; op: string; a: Expr; b: Expr }
  | { k: "cond"; line: number; c: Expr; a: Expr; b: Expr }
  | { k: "call"; line: number; f: Expr; args: Expr[] }
  | { k: "index"; line: number; a: Expr; i: Expr }
  | { k: "member"; line: number; e: Expr; name: string; arrow: boolean }
  | { k: "cast"; line: number; t: CType; e: Expr }
  | { k: "sizeof"; line: number; t?: CType; e?: Expr }
  | { k: "comma"; line: number; a: Expr; b: Expr };

export type Init = { k: "expr"; e: Expr; line: number } | { k: "list"; items: Init[]; line: number };

export interface VarDecl {
  name: string;
  t: CType;
  init?: Init;
  line: number;
  isStatic: boolean;
  isExtern: boolean;
  /** Declared const: the program may not write it after its initialiser. */
  isConst?: boolean;
  file: string;
}

export type Stmt =
  | { k: "expr"; line: number; e: Expr }
  | { k: "decl"; line: number; vars: VarDecl[] }
  | { k: "block"; line: number; body: Stmt[] }
  | { k: "if"; line: number; c: Expr; a: Stmt; b?: Stmt }
  | { k: "while"; line: number; c: Expr; body: Stmt; semiBlock?: boolean }
  | { k: "do"; line: number; c: Expr; body: Stmt }
  | { k: "for"; line: number; init?: Stmt; c?: Expr; step?: Expr; body: Stmt; semiBlock?: boolean }
  | { k: "switch"; line: number; e: Expr; body: Stmt }
  | { k: "case"; line: number; e?: Expr }
  | { k: "break"; line: number }
  | { k: "continue"; line: number }
  | { k: "return"; line: number; e?: Expr }
  | { k: "empty"; line: number };

export interface FuncDef {
  name: string;
  t: FuncType;
  params: { name: string; t: CType }[];
  body: Stmt;
  line: number;
  interrupt: boolean;
  file: string;
}

export interface Unit {
  funcs: FuncDef[];
  globals: VarDecl[];
  protos: { name: string; t: FuncType; line: number; interrupt: boolean }[];
}

/** Names that persist between the prelude and the student's file. */
export class ParseContext {
  typedefs = new Map<string, CType>();
  tags = new Map<string, StructType>();
  enums = new Map<string, number>();
}

const TYPE_WORDS = new Set([
  "void", "char", "short", "int", "long", "float", "double", "signed", "unsigned",
  "struct", "union", "enum", "const", "volatile", "static", "extern", "typedef",
  "register", "auto", "inline", "__inline", "interrupt", "__interrupt", "bool", "_Bool",
]);

const KEYWORDS = new Set([
  ...TYPE_WORDS, "if", "else", "while", "do", "for", "switch", "case", "default",
  "break", "continue", "return", "sizeof", "goto",
]);

interface Specs {
  t: CType;
  typedef: boolean;
  isStatic: boolean;
  isExtern: boolean;
  interrupt: boolean;
  isConst: boolean;
}

interface Declarator {
  name?: string;
  line: number;
  /** The declared object itself is const: no '*' and a const type, or '* const'. */
  isConst?: boolean;
  wrap: (base: CType) => CType;
  /** Parameter names when the outermost suffix is a parameter list. */
  params?: { name: string; t: CType }[];
}

export class Parser {
  private p = 0;
  constructor(
    private toks: Tok[],
    private ctx: ParseContext,
  ) {}

  private get t(): Tok {
    return this.toks[this.p];
  }
  private err(msg: string, tok: Tok = this.t): CError {
    return new CError(tok.line, msg, tok.file);
  }
  private is(v: string): boolean {
    return this.t.v === v && (this.t.k === "p" || this.t.k === "id");
  }
  private accept(v: string): boolean {
    if (this.is(v)) {
      this.p++;
      return true;
    }
    return false;
  }
  private expect(v: string, context = ""): Tok {
    if (!this.is(v)) {
      const prev = this.toks[this.p - 1];
      if (v === ";" && prev)
        throw new CError(prev.line, `Missing ; at the end of this line${context ? ` (${context})` : ""}.`, prev.file);
      const got = this.t.k === "eof" ? "the end of the file" : `'${this.t.v}'`;
      throw this.err(`Expected '${v}' but found ${got}${context ? ` ${context}` : ""}.`);
    }
    return this.toks[this.p++];
  }

  private isTypeStart(tok: Tok = this.t): boolean {
    return tok.k === "id" && (TYPE_WORDS.has(tok.v) || this.ctx.typedefs.has(tok.v));
  }

  // ---------- translation unit ----------

  parseUnit(): Unit {
    const unit: Unit = { funcs: [], globals: [], protos: [] };
    while (this.t.k !== "eof") {
      if (this.accept(";")) continue;
      this.external(unit);
    }
    return unit;
  }

  private external(unit: Unit): void {
    const start = this.t;
    if (!this.isTypeStart()) {
      if (start.k === "id" && this.toks[this.p + 1]?.k === "id") {
        const hint = closest(start.v, [...this.ctx.typedefs.keys(), ...TYPE_WORDS]);
        throw this.err(`'${start.v}' is not a type.${hint ? ` Did you mean '${hint}'?` : ""}`);
      }
      throw this.err(
        `Statements must be inside a function. '${start.v}' is outside every function: check for a missing or extra { or }.`,
      );
    }
    const specs = this.specifiers();
    if (this.accept(";")) return; // struct/enum definition only
    let first = true;
    for (;;) {
      const d = this.declarator();
      if (!d.name) throw this.err("Expected a name in this declaration.");
      const type = d.wrap(specs.t);
      if (specs.typedef) {
        this.ctx.typedefs.set(d.name, type);
      } else if (type.k === "func") {
        if (first && this.is("{")) {
          const params = d.params ?? [];
          const body = this.block();
          unit.funcs.push({
            name: d.name, t: type, params, body, line: d.line, interrupt: specs.interrupt, file: start.file,
          });
          return;
        }
        unit.protos.push({ name: d.name, t: type, line: d.line, interrupt: specs.interrupt });
      } else {
        const v: VarDecl = {
          name: d.name, t: type, line: d.line, isStatic: specs.isStatic, isExtern: specs.isExtern, file: start.file,
          isConst: d.isConst ?? specs.isConst,
        };
        if (this.accept("=")) v.init = this.initializer();
        unit.globals.push(v);
      }
      first = false;
      if (!this.accept(",")) break;
    }
    this.expect(";", "after the declaration");
  }

  // ---------- declarations ----------

  private specifiers(): Specs {
    const s: Specs = { t: INT, typedef: false, isStatic: false, isExtern: false, interrupt: false, isConst: false };
    let base: CType | undefined;
    let longs = 0;
    let sign: "s" | "u" | undefined;
    let kw: string | undefined;
    const startTok = this.t;
    const startP = this.p;
    for (;;) {
      const t = this.t;
      if (t.k !== "id") break;
      if (t.v === "typedef") s.typedef = true;
      else if (t.v === "static") s.isStatic = true;
      else if (t.v === "extern") s.isExtern = true;
      else if (t.v === "interrupt" || t.v === "__interrupt") s.interrupt = true;
      else if (t.v === "const") s.isConst = true;
      else if (["volatile", "register", "auto", "inline", "__inline"].includes(t.v)) {
        /* accepted, no effect */
      } else if (t.v === "signed") sign = "s";
      else if (t.v === "unsigned") sign = "u";
      else if (t.v === "long") longs++;
      else if (["void", "char", "short", "int", "float", "double", "bool", "_Bool"].includes(t.v)) {
        if (kw && !(kw === "short" && t.v === "int") && !(kw === "int" && t.v === "short"))
          throw this.err(`Two types in one declaration ('${kw}' and '${t.v}').`);
        kw = kw === "short" ? "short" : t.v;
      } else if (t.v === "struct" || t.v === "union") {
        this.p++;
        base = this.structSpec(t.v === "union");
        continue;
      } else if (t.v === "enum") {
        this.p++;
        this.enumSpec();
        base = INT;
        continue;
      } else if (this.ctx.typedefs.has(t.v) && !base && !kw && !longs && !sign) {
        base = this.ctx.typedefs.get(t.v)!;
      } else break;
      this.p++;
    }
    if (base) {
      if (kw || longs || sign)
        throw this.err(`Two types in one declaration ('${kw ?? (longs ? "long" : sign === "u" ? "unsigned" : "signed")}' and another type).`, startTok);
      s.t = base;
      return s;
    }
    if (!kw && !longs && !sign) {
      if (this.p === startP) throw this.err(`Expected a type but found '${this.t.v}'.`);
      return s; // "static x;" style: int
    }
    if (longs >= 2) throw this.err("64-bit integers (long long) are not available in this game.", startTok);
    const unsigned = sign === "u";
    if (kw && (sign || longs) && ["void", "float", "bool", "_Bool"].includes(kw))
      throw this.err(`'${sign ? (unsigned ? "unsigned" : "signed") : "long"}' cannot be combined with '${kw}'.`, startTok);
    if (kw === "double" && sign) throw this.err(`'${unsigned ? "unsigned" : "signed"}' cannot be combined with 'double'.`, startTok);
    switch (kw) {
      case "void":
        s.t = VOID;
        break;
      case "char":
        s.t = unsigned ? { k: "int", w: 1, s: false, ch: true } : CHAR;
        break;
      case "float":
        s.t = FLOAT;
        break;
      case "double":
        s.t = DOUBLE;
        break;
      case "bool":
      case "_Bool":
        s.t = UINT;
        break;
      default:
        s.t = longs ? (unsigned ? ULONG : LONG) : unsigned ? UINT : INT;
    }
    return s;
  }

  private structSpec(union: boolean): CType {
    let name = "";
    if (this.t.k === "id" && !this.is("{")) name = this.toks[this.p++].v;
    let st = name ? this.ctx.tags.get(name) : undefined;
    if (!st) {
      st = { k: "struct", name: name || "(anonymous)", union, fields: [], size: 1, align: 1, complete: false };
      if (name) this.ctx.tags.set(name, st);
    }
    if (!this.accept("{")) return st;
    const members: MemberDecl[] = [];
    while (!this.accept("}")) {
      const specs = this.specifiers();
      for (;;) {
        if (this.is(":")) {
          this.p++;
          members.push({ name: "", type: specs.t, bitW: this.constInt(this.conditional()) });
        } else {
          const d = this.declarator();
          if (!d.name) throw this.err("Expected a member name.");
          const type = d.wrap(specs.t);
          const m: MemberDecl = { name: d.name, type };
          if (this.accept(":")) m.bitW = this.constInt(this.conditional());
          members.push(m);
        }
        if (!this.accept(",")) break;
      }
      this.expect(";", "after the struct member");
    }
    layout(st, members);
    return st;
  }

  private enumSpec(): void {
    if (this.t.k === "id" && !this.is("{")) this.p++;
    if (!this.accept("{")) return;
    let next = 0;
    while (!this.accept("}")) {
      const id = this.toks[this.p++];
      if (id.k !== "id") throw this.err("Expected an enum constant name.", id);
      if (this.accept("=")) next = this.constInt(this.conditional());
      this.ctx.enums.set(id.v, next++);
      if (!this.accept(",")) {
        this.expect("}");
        break;
      }
    }
  }

  private declarator(): Declarator {
    let ptrs = 0;
    let constPtr = false;
    while (this.accept("*")) {
      ptrs++;
      constPtr = false;
      while (this.is("const") || this.is("volatile")) {
        if (this.is("const")) constPtr = true;
        this.p++;
      }
    }
    const line = this.t.line;
    let name: string | undefined;
    let inner: Declarator | undefined;
    if (this.is("(") && !this.isTypeStart(this.toks[this.p + 1]) && this.toks[this.p + 1].v !== ")") {
      this.p++;
      inner = this.declarator();
      this.expect(")");
    } else if (this.t.k === "id" && !KEYWORDS.has(this.t.v)) {
      name = this.toks[this.p++].v;
    } else if (this.t.k === "id" && KEYWORDS.has(this.t.v) && !this.isTypeStart()) {
      throw this.err(`'${this.t.v}' is a C keyword and cannot be used as a name.`);
    }
    type Suffix = { arr: number } | { fn: { name: string; t: CType }[]; variadic: boolean; old: boolean };
    const suffixes: Suffix[] = [];
    for (;;) {
      if (this.accept("[")) {
        if (this.accept("]")) suffixes.push({ arr: -1 });
        else {
          const n = this.constInt(this.conditional());
          if (n <= 0) throw this.err("An array needs a size of at least 1.");
          this.expect("]");
          suffixes.push({ arr: n });
        }
      } else if (this.accept("(")) {
        const params: { name: string; t: CType }[] = [];
        let variadic = false;
        let old = false;
        if (this.accept(")")) old = true;
        else if (this.is("void") && this.toks[this.p + 1].v === ")") this.p += 2;
        else {
          for (;;) {
            if (this.accept("...")) {
              variadic = true;
              break;
            }
            if (!this.isTypeStart()) throw this.err(`Expected a parameter type but found '${this.t.v}'.`);
            const ps = this.specifiers();
            const pd = this.declarator();
            let pt = pd.wrap(ps.t);
            if (pt.k === "array") pt = ptrTo(pt.of);
            else if (pt.k === "func") pt = ptrTo(pt);
            params.push({ name: pd.name ?? "", t: pt });
            if (!this.accept(",")) break;
          }
          this.expect(")");
        }
        suffixes.push({ fn: params, variadic, old });
      } else break;
    }
    const first = suffixes[0];
    const wrap = (base: CType): CType => {
      let t = base;
      for (let i = 0; i < ptrs; i++) t = ptrTo(t);
      for (let i = suffixes.length - 1; i >= 0; i--) {
        const s = suffixes[i];
        if ("arr" in s) t = { k: "array", of: t, n: s.arr };
        else t = { k: "func", ret: t, params: s.fn.map((q) => q.t), variadic: s.variadic, oldStyle: s.old };
      }
      return inner ? inner.wrap(t) : t;
    };
    if (inner) return { name: inner.name, line: inner.line, wrap, params: inner.params, isConst: inner.isConst ?? false };
    return { name, line, wrap, params: first && "fn" in first ? first.fn : undefined, isConst: ptrs ? constPtr : undefined };
  }

  private typeName(): CType {
    const s = this.specifiers();
    return this.declarator().wrap(s.t);
  }

  private initializer(): Init {
    const line = this.t.line;
    if (this.accept("{")) {
      const items: Init[] = [];
      while (!this.accept("}")) {
        if (this.is(".") || this.is("["))
          throw this.err("Naming the member or index inside { } (as in .x = 1 or [2] = 5) is not available in this game. List the values in order.");
        items.push(this.initializer());
        if (!this.accept(",")) {
          this.expect("}");
          break;
        }
      }
      return { k: "list", items, line };
    }
    return { k: "expr", e: this.assignment(), line };
  }

  private localDecl(): Stmt {
    const line = this.t.line;
    const file = this.t.file;
    const specs = this.specifiers();
    const vars: VarDecl[] = [];
    if (this.accept(";")) return { k: "empty", line };
    for (;;) {
      const d = this.declarator();
      if (!d.name) throw this.err("Expected a variable name.");
      const type = d.wrap(specs.t);
      if (specs.typedef) this.ctx.typedefs.set(d.name, type);
      else if (type.k === "func") throw this.err("Declare functions outside of other functions.");
      else {
        const v: VarDecl = {
          name: d.name, t: type, line: d.line, isStatic: specs.isStatic, isExtern: specs.isExtern, file,
          isConst: d.isConst ?? specs.isConst,
        };
        if (this.accept("=")) v.init = this.initializer();
        vars.push(v);
      }
      if (!this.accept(",")) break;
    }
    this.expect(";", "after the declaration");
    return { k: "decl", line, vars };
  }

  // ---------- statements ----------

  private block(): Stmt {
    const open = this.expect("{");
    const body: Stmt[] = [];
    while (!this.is("}")) {
      if (this.t.k === "eof")
        throw new CError(open.line, "This { is never closed. Add the matching }.", open.file);
      body.push(this.statement());
    }
    this.p++;
    return { k: "block", line: open.line, body };
  }

  private statement(): Stmt {
    const t = this.t;
    const line = t.line;
    if (t.k === "p") {
      if (t.v === "{") return this.block();
      if (t.v === ";") {
        this.p++;
        return { k: "empty", line };
      }
    }
    if (t.k === "id") {
      switch (t.v) {
        case "if": {
          this.p++;
          this.expect("(", "after 'if'");
          const c = this.expression();
          this.expect(")", "to close the 'if' condition");
          const a = this.statement();
          const b = this.accept("else") ? this.statement() : undefined;
          return { k: "if", line, c, a, b };
        }
        case "while": {
          this.p++;
          this.expect("(", "after 'while'");
          const c = this.expression();
          this.expect(")", "to close the 'while' condition");
          const body = this.statement();
          return { k: "while", line, c, body, semiBlock: body.k === "empty" && this.is("{") };
        }
        case "do": {
          this.p++;
          const body = this.statement();
          if (!this.accept("while")) throw this.err("A 'do' loop must end with 'while (condition);'.");
          this.expect("(");
          const c = this.expression();
          this.expect(")");
          this.expect(";", "after do ... while");
          return { k: "do", line, c, body };
        }
        case "for": {
          this.p++;
          this.expect("(", "after 'for'");
          let init: Stmt | undefined;
          if (this.isTypeStart()) init = this.localDecl();
          else if (!this.accept(";")) {
            init = { k: "expr", line, e: this.expression() };
            this.expect(";", "inside for ( ; ; )");
          }
          const c = this.is(";") ? undefined : this.expression();
          this.expect(";", "inside for ( ; ; )");
          const step = this.is(")") ? undefined : this.expression();
          this.expect(")", "to close the 'for' header");
          const body = this.statement();
          return { k: "for", line, init, c, step, body, semiBlock: body.k === "empty" && this.is("{") };
        }
        case "switch": {
          this.p++;
          this.expect("(", "after 'switch'");
          const e = this.expression();
          this.expect(")");
          return { k: "switch", line, e, body: this.block() };
        }
        case "case": {
          this.p++;
          const e = this.conditional();
          this.expect(":", "after the case value");
          return { k: "case", line, e };
        }
        case "default":
          this.p++;
          this.expect(":", "after 'default'");
          return { k: "case", line };
        case "break":
          this.p++;
          this.expect(";", "after 'break'");
          return { k: "break", line };
        case "continue":
          this.p++;
          this.expect(";", "after 'continue'");
          return { k: "continue", line };
        case "return": {
          this.p++;
          const e = this.is(";") ? undefined : this.expression();
          this.expect(";", "after 'return'");
          return { k: "return", line, e };
        }
        case "goto":
          throw this.err("'goto' is not available in this game. Use loops and if statements.");
        case "else":
          throw this.err("This 'else' has no matching 'if'. Check the braces just above it.");
      }
      if (this.isTypeStart()) return this.localDecl();
      if (this.toks[this.p + 1].k === "id" && !KEYWORDS.has(t.v)) {
        const hint = closest(t.v, [...this.ctx.typedefs.keys(), ...TYPE_WORDS]);
        throw this.err(`'${t.v}' is not a type.${hint ? ` Did you mean '${hint}'?` : ""}`);
      }
    }
    const e = this.expression();
    this.expect(";", "after the statement");
    return { k: "expr", line, e };
  }

  // ---------- expressions ----------

  expression(): Expr {
    let e = this.assignment();
    while (this.is(",")) {
      const line = this.toks[this.p++].line;
      e = { k: "comma", line, a: e, b: this.assignment() };
    }
    return e;
  }

  private assignment(): Expr {
    const lhs = this.conditional();
    const t = this.t;
    if (t.k === "p" && ["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="].includes(t.v)) {
      this.p++;
      return { k: "assign", line: t.line, op: t.v, a: lhs, b: this.assignment() };
    }
    return lhs;
  }

  private conditional(): Expr {
    const c = this.binary(0);
    if (this.is("?")) {
      const line = this.toks[this.p++].line;
      const a = this.expression();
      this.expect(":", "in the ?: expression");
      return { k: "cond", line, c, a, b: this.conditional() };
    }
    return c;
  }

  private static LEVELS: string[][] = [
    ["||"], ["&&"], ["|"], ["^"], ["&"], ["==", "!="], ["<", ">", "<=", ">="], ["<<", ">>"], ["+", "-"], ["*", "/", "%"],
  ];

  private binary(level: number): Expr {
    if (level >= Parser.LEVELS.length) return this.unary();
    let a = this.binary(level + 1);
    while (this.t.k === "p" && Parser.LEVELS[level].includes(this.t.v)) {
      const op = this.toks[this.p++];
      a = { k: "bin", line: op.line, op: op.v, a, b: this.binary(level + 1) };
    }
    return a;
  }

  private unary(): Expr {
    const t = this.t;
    const line = t.line;
    if (t.k === "p") {
      if (["-", "+", "!", "~", "*", "&"].includes(t.v)) {
        this.p++;
        return { k: "un", line, op: t.v, e: this.unary() };
      }
      if (t.v === "++" || t.v === "--") {
        this.p++;
        return { k: "un", line, op: t.v, e: this.unary() };
      }
      if (t.v === "(" && this.isTypeStart(this.toks[this.p + 1])) {
        this.p++;
        const type = this.typeName();
        this.expect(")", "to close the cast");
        return { k: "cast", line, t: type, e: this.unary() };
      }
    }
    if (t.k === "id" && t.v === "sizeof") {
      this.p++;
      if (this.is("(") && this.isTypeStart(this.toks[this.p + 1])) {
        this.p++;
        const type = this.typeName();
        this.expect(")");
        return { k: "sizeof", line, t: type };
      }
      return { k: "sizeof", line, e: this.unary() };
    }
    return this.postfix();
  }

  private postfix(): Expr {
    let e = this.primary();
    for (;;) {
      const t = this.t;
      if (t.k !== "p") break;
      if (t.v === "[") {
        this.p++;
        const i = this.expression();
        this.expect("]", "to close the array index");
        e = { k: "index", line: t.line, a: e, i };
      } else if (t.v === "(") {
        this.p++;
        const args: Expr[] = [];
        if (!this.accept(")")) {
          for (;;) {
            args.push(this.assignment());
            if (!this.accept(",")) break;
          }
          this.expect(")", "to close the function call");
        }
        e = { k: "call", line: t.line, f: e, args };
      } else if (t.v === "." || t.v === "->") {
        this.p++;
        const id = this.toks[this.p++];
        if (id.k !== "id") throw this.err(`Expected a member name after '${t.v}'.`, id);
        e = { k: "member", line: t.line, e, name: id.v, arrow: t.v === "->" };
      } else if (t.v === "++" || t.v === "--") {
        this.p++;
        e = { k: "post", line: t.line, op: t.v, e };
      } else break;
    }
    return e;
  }

  private primary(): Expr {
    const t = this.toks[this.p++];
    const line = t.line;
    switch (t.k) {
      case "num": {
        const n = parseNumber(t.v);
        if (Number.isNaN(n.value)) throw this.err(`'${t.v}' is not a valid number.`, t);
        if (n.float) return { k: "num", line, value: n.value, t: n.f ? FLOAT : DOUBLE };
        // C rules with a 16-bit int: the literal takes the first type that holds it.
        let type: CType;
        const v = n.value;
        if (v > 0xffffffff) throw this.err(`${t.v} does not fit in 32 bits.`, t);
        if (!n.l && !n.u && v <= 0x7fff) type = INT;
        else if (!n.l && (n.u || n.nonDecimal) && v <= 0xffff) type = UINT;
        else if (!n.u && v <= 0x7fffffff) type = LONG;
        else type = ULONG;
        return { k: "num", line, value: v, t: type };
      }
      case "chr":
        return { k: "num", line, value: t.v.charCodeAt(0), t: INT };
      case "str": {
        let s = t.v;
        while (this.t.k === "str") s += this.toks[this.p++].v;
        return { k: "str", line, value: s };
      }
      case "id":
        if (KEYWORDS.has(t.v)) throw this.err(`Unexpected keyword '${t.v}' in an expression.`, t);
        return { k: "id", line, name: t.v };
      case "p":
        if (t.v === "(") {
          const e = this.expression();
          this.expect(")", "to close the parenthesis");
          return e;
        }
    }
    if (t.k === "eof") throw this.err("The file ends in the middle of a statement.", t);
    throw this.err(`Unexpected '${t.v}'.`, t);
  }

  // ---------- constant expressions ----------

  constInt(e: Expr): number {
    const v = this.constVal(e);
    if (v === undefined) throw new CError(e.line, "A constant value is needed here (a number, #define or enum).");
    return v;
  }

  private constVal(e: Expr): number | undefined {
    switch (e.k) {
      case "num":
        return e.t.k === "int" ? e.value : undefined;
      case "id":
        return this.ctx.enums.get(e.name);
      case "sizeof":
        return e.t ? sizeOf(e.t) : undefined;
      case "cast":
        return this.constVal(e.e);
      case "un": {
        const v = this.constVal(e.e);
        if (v === undefined) return undefined;
        if (e.op === "-") return -v;
        if (e.op === "+") return v;
        if (e.op === "~") return ~v;
        if (e.op === "!") return v ? 0 : 1;
        return undefined;
      }
      case "bin": {
        const a = this.constVal(e.a);
        const b = this.constVal(e.b);
        if (a === undefined || b === undefined) return undefined;
        switch (e.op) {
          case "+": return a + b;
          case "-": return a - b;
          case "*": return a * b;
          case "/": return b ? Math.trunc(a / b) : undefined;
          case "%": return b ? a % b : undefined;
          case "<<": return a << b;
          case ">>": return a >> b;
          case "&": return a & b;
          case "|": return a | b;
          case "^": return a ^ b;
          case "==": return +(a === b);
          case "!=": return +(a !== b);
          case "<": return +(a < b);
          case ">": return +(a > b);
          case "<=": return +(a <= b);
          case ">=": return +(a >= b);
          case "&&": return +(a !== 0 && b !== 0);
          case "||": return +(a !== 0 || b !== 0);
        }
        return undefined;
      }
      case "cond": {
        const c = this.constVal(e.c);
        if (c === undefined) return undefined;
        return this.constVal(c ? e.a : e.b);
      }
    }
    return undefined;
  }
}
