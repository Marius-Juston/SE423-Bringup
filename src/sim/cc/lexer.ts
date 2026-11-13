// Lexer and preprocessor for the C subset used in SE 423.

export class CError extends Error {
  constructor(
    public line: number,
    msg: string,
    public file: string = "user",
  ) {
    super(msg);
  }
}

export type TokKind = "id" | "num" | "str" | "chr" | "p" | "eof";

export interface Tok {
  k: TokKind;
  v: string;
  line: number;
  file: string;
  /** Logical line (backslash-newline joined); directives end with it. */
  ll: number;
  /** First token on its logical line. */
  bol: boolean;
  /** Preceded by whitespace (tells `#define F(x)` from `#define F (x)`). */
  ws?: boolean;
  /** Macros that must not be expanded again in this token. */
  hide?: Set<string>;
}

const PUNCT = [
  "<<=", ">>=", "...", "->", "++", "--", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||",
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "##",
  "+", "-", "*", "/", "%", "&", "|", "^", "~", "!", "=", "<", ">", "?", ":", ";", ",", ".",
  "(", ")", "[", "]", "{", "}", "#",
];

const isIdStart = (c: string) => /[A-Za-z_]/.test(c);
const isIdChar = (c: string) => /[A-Za-z0-9_]/.test(c);

export function lex(src: string, file = "user"): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  let ll = 1;
  let bol = true;
  let ws = false;
  let lastEnd = 0;
  const n = src.length;
  const push = (k: TokKind, v: string, at: number) => {
    toks.push({ k, v, line: at, file, ll, bol, ws });
    bol = false;
  };
  while (i < n) {
    const c = src[i];
    ws = i !== lastEnd;
    if (c === "\n") {
      line++;
      ll++;
      bol = true;
      i++;
      continue;
    }
    if (c === "\\" && (src[i + 1] === "\n" || (src[i + 1] === "\r" && src[i + 2] === "\n"))) {
      i += src[i + 1] === "\n" ? 2 : 3;
      line++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === " ") {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const start = line;
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      if (i >= n) throw new CError(start, "This /* comment is never closed with */.", file);
      i += 2;
      continue;
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isIdChar(src[j])) j++;
      push("id", src.slice(i, j), line);
      i = j;
      lastEnd = i;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      if (c === "0" && /[xX]/.test(src[i + 1] ?? "")) {
        j = i + 2;
        while (j < n && /[0-9a-fA-F]/.test(src[j])) j++;
      } else if (c === "0" && /[bB]/.test(src[i + 1] ?? "")) {
        j = i + 2;
        while (j < n && /[01]/.test(src[j])) j++;
      } else {
        while (j < n && /[0-9.]/.test(src[j])) j++;
        if (/[eE]/.test(src[j] ?? "") && /[0-9+-]/.test(src[j + 1] ?? "")) {
          j += 2;
          while (j < n && /[0-9]/.test(src[j])) j++;
        }
      }
      while (j < n && /[uUlLfF]/.test(src[j])) j++;
      push("num", src.slice(i, j), line);
      i = j;
      lastEnd = i;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let out = "";
      while (j < n && src[j] !== c) {
        if (src[j] === "\n") break;
        if (src[j] === "\\") {
          const e = src[j + 1];
          j += 2;
          const simple: Record<string, string> = {
            n: "\n", r: "\r", t: "\t", "0": "\0", "\\": "\\", "'": "'", '"': '"', a: "\x07", b: "\b", f: "\f", v: "\v", "?": "?",
          };
          if (e === "x") {
            let h = "";
            while (/[0-9a-fA-F]/.test(src[j] ?? "")) h += src[j++];
            out += String.fromCharCode(parseInt(h || "0", 16) & 0xffff);
          } else if (/[0-7]/.test(e) && /[0-7]/.test(src[j] ?? "")) {
            let o = e;
            while (o.length < 3 && /[0-7]/.test(src[j] ?? "")) o += src[j++];
            out += String.fromCharCode(parseInt(o, 8));
          } else if (e in simple) out += simple[e];
          else throw new CError(line, `Unknown escape sequence \\${e}.`, file);
          continue;
        }
        out += src[j++];
      }
      if (src[j] !== c) {
        throw new CError(line, c === '"' ? 'This string is missing its closing ".' : "This character is missing its closing '.", file);
      }
      if (c === "'" && out.length !== 1) {
        throw new CError(
          line,
          `'${out}' is not a single character. Use single quotes for one character ('a') and double quotes for a string ("abc").`,
          file,
        );
      }
      push(c === '"' ? "str" : "chr", out, line);
      i = j + 1;
      lastEnd = i;
      continue;
    }
    const p = PUNCT.find((q) => src.startsWith(q, i));
    if (!p) {
      const hint = /[‘’“”]/.test(c)
        ? " It is a curly quote, probably pasted from a document: retype it as a plain quote."
        : "";
      throw new CError(line, `Unexpected character '${c}'.${hint}`, file);
    }
    push("p", p, line);
    i += p.length;
    lastEnd = i;
  }
  toks.push({ k: "eof", v: "", line, file, ll: ll + 1, bol: true });
  return toks;
}

interface Macro {
  name: string;
  params?: string[];
  body: Tok[];
}

export class Preprocessor {
  macros = new Map<string, Macro>();
  warnings: { line: number; msg: string }[] = [];

  define(name: string, body: string): void {
    this.macros.set(name, { name, body: lex(body, "builtin").slice(0, -1) });
  }

  /** Lex and preprocess a source file; macros persist between calls. */
  run(src: string, file = "user"): Tok[] {
    const toks = lex(src, file);
    const out: Tok[] = [];
    // Conditional stack: each entry says whether the current branch is live
    // and whether any branch of this #if has been taken.
    const cond: { live: boolean; taken: boolean; parentLive: boolean }[] = [];
    const live = () => cond.length === 0 || cond[cond.length - 1].live;
    let i = 0;
    while (toks[i].k !== "eof") {
      const t = toks[i];
      if (t.k === "p" && t.v === "#" && t.bol) {
        let j = i + 1;
        const lineToks: Tok[] = [];
        while (toks[j].k !== "eof" && toks[j].ll === t.ll) lineToks.push(toks[j++]);
        i = j;
        this.directive(lineToks, t, cond, live());
        continue;
      }
      if (!live()) {
        i++;
        continue;
      }
      i = this.expandAt(toks, i, out);
    }
    if (cond.length) throw new CError(toks[i].line, "An #if or #ifdef is missing its #endif.", file);
    out.push(toks[i]);
    return out;
  }

  private directive(
    lt: Tok[],
    hash: Tok,
    cond: { live: boolean; taken: boolean; parentLive: boolean }[],
    isLive: boolean,
  ): void {
    const name = lt[0]?.v ?? "";
    const rest = lt.slice(1);
    const err = (m: string) => new CError(hash.line, m, hash.file);
    switch (name) {
      case "ifdef":
      case "ifndef":
      case "if": {
        let v = false;
        if (isLive) {
          if (name === "if") v = this.evalIf(rest, hash);
          else {
            v = this.macros.has(rest[0]?.v ?? "");
            if (name === "ifndef") v = !v;
          }
        }
        cond.push({ live: isLive && v, taken: v, parentLive: isLive });
        return;
      }
      case "elif":
      case "else": {
        const c = cond[cond.length - 1];
        if (!c) throw err(`#${name} without a matching #if.`);
        const v = name === "else" ? true : c.parentLive && !c.taken && this.evalIf(rest, hash);
        c.live = c.parentLive && !c.taken && v;
        if (c.live) c.taken = true;
        return;
      }
      case "endif":
        if (!cond.pop()) throw err("#endif without a matching #if.");
        return;
    }
    if (!isLive) return;
    switch (name) {
      case "define": {
        const id = rest[0];
        if (!id || id.k !== "id") throw err("#define needs a name, for example: #define PERIOD 2500");
        let body = rest.slice(1);
        let params: string[] | undefined;
        // Function-like only when "(" touches the name.
        if (body[0]?.v === "(" && !body[0].ws && isParamList(body)) {
          params = [];
          let k = 1;
          while (body[k].v !== ")") {
            if (body[k].k === "id") params.push(body[k].v);
            k++;
          }
          body = body.slice(k + 1);
        }
        if (body.some((b) => b.v === "##" || (b.v === "#" && params)))
          throw err("The # and ## macro operators are not available in this game.");
        this.macros.set(id.v, { name: id.v, params, body });
        return;
      }
      case "undef":
        this.macros.delete(rest[0]?.v ?? "");
        return;
      case "include":
      case "pragma":
      case "":
        return;
      case "error":
        throw err(`#error ${rest.map((r) => r.v).join(" ")}`);
      default:
        throw err(`Unknown preprocessor directive #${name}.`);
    }
  }

  private evalIf(toks: Tok[], hash: Tok): boolean {
    // Handles: integers, defined(X), defined X, !, &&, ||, ==, !=, <, >, <=, >=, parentheses.
    const src: Tok[] = [];
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].v === "defined") {
        const paren = toks[i + 1]?.v === "(";
        const id = toks[i + (paren ? 2 : 1)];
        src.push({ ...toks[i], k: "num", v: this.macros.has(id?.v ?? "") ? "1" : "0" });
        i += paren ? 3 : 1;
      } else src.push(toks[i]);
    }
    const ex: Tok[] = [];
    const eof: Tok = { k: "eof", v: "", line: hash.line, file: hash.file, ll: -1, bol: false };
    const all = [...src, eof];
    let i = 0;
    while (all[i].k !== "eof") i = this.expandAt(all, i, ex);
    let p = 0;
    const peek = () => ex[p]?.v;
    const prim = (): number => {
      const t = ex[p++];
      if (!t) throw new CError(hash.line, "Incomplete #if expression.", hash.file);
      if (t.v === "(") {
        const v = or();
        p++;
        return v;
      }
      if (t.v === "!") return prim() ? 0 : 1;
      if (t.v === "-") return -prim();
      if (t.k === "num") return Number(parseNumber(t.v).value);
      if (t.k === "id") return 0;
      throw new CError(hash.line, "This #if expression is too complex for this game.", hash.file);
    };
    const cmp = (): number => {
      let a = prim();
      for (;;) {
        const o = peek();
        if (o === "==") (p++, (a = +(a === prim())));
        else if (o === "!=") (p++, (a = +(a !== prim())));
        else if (o === "<") (p++, (a = +(a < prim())));
        else if (o === ">") (p++, (a = +(a > prim())));
        else if (o === "<=") (p++, (a = +(a <= prim())));
        else if (o === ">=") (p++, (a = +(a >= prim())));
        else return a;
      }
    };
    const and = (): number => {
      let a = cmp();
      while (peek() === "&&") {
        p++;
        const b = cmp();
        a = +(a !== 0 && b !== 0);
      }
      return a;
    };
    const or = (): number => {
      let a = and();
      while (peek() === "||") {
        p++;
        const b = and();
        a = +(a !== 0 || b !== 0);
      }
      return a;
    };
    return or() !== 0;
  }

  /** Expands the token at toks[i] into out; returns the next input index. */
  private expandAt(toks: Tok[], i: number, out: Tok[]): number {
    const t = toks[i];
    const m = t.k === "id" ? this.macros.get(t.v) : undefined;
    if (!m || t.hide?.has(t.v)) {
      out.push(t);
      return i + 1;
    }
    const hide = new Set(t.hide);
    hide.add(m.name);
    let next = i + 1;
    let body: Tok[];
    if (m.params) {
      if (toks[next]?.v !== "(") {
        out.push(t);
        return i + 1;
      }
      const args: Tok[][] = [[]];
      let depth = 0;
      next++;
      for (;;) {
        const a = toks[next];
        if (a.k === "eof") throw new CError(t.line, `The macro ${m.name}( is missing its closing ).`, t.file);
        if (a.v === "(") depth++;
        if (a.v === ")") {
          if (depth === 0) break;
          depth--;
        }
        if (a.v === "," && depth === 0) args.push([]);
        else args[args.length - 1].push(a);
        next++;
      }
      next++;
      if (m.params.length === 0 && args.length === 1 && args[0].length === 0) args.length = 0;
      if (args.length !== m.params.length)
        throw new CError(t.line, `The macro ${m.name} takes ${m.params.length} argument(s), but ${args.length} were given.`, t.file);
      // Arguments are fully expanded before substitution.
      const exArgs = args.map((a) => {
        const o: Tok[] = [];
        const src = [...a, { k: "eof", v: "", line: t.line, file: t.file, ll: -1, bol: false } as Tok];
        let k = 0;
        while (src[k].k !== "eof") k = this.expandAt(src, k, o);
        return o;
      });
      body = [];
      for (const b of m.body) {
        const pi = b.k === "id" ? m.params.indexOf(b.v) : -1;
        if (pi >= 0) body.push(...exArgs[pi]);
        else body.push(b);
      }
    } else body = m.body;
    // Rescan the replacement with this macro hidden.
    const scan: Tok[] = body.map((b) => ({
      ...b,
      line: t.line,
      file: t.file,
      ll: t.ll,
      bol: false,
      hide: new Set([...(b.hide ?? []), ...hide]),
    }));
    scan.push({ k: "eof", v: "", line: t.line, file: t.file, ll: -1, bol: false });
    let k = 0;
    while (scan[k].k !== "eof") k = this.expandAt(scan, k, out);
    return next;
  }
}

function isParamList(body: Tok[]): boolean {
  // "(" [id {"," id}] ")"
  let k = 1;
  if (body[k]?.v === ")") return true;
  for (;;) {
    if (body[k]?.k !== "id") return false;
    k++;
    if (body[k]?.v === ")") return true;
    if (body[k]?.v !== ",") return false;
    k++;
  }
}

export interface NumLit {
  value: number;
  float: boolean;
  /** Suffixes present. */
  u: boolean;
  l: boolean;
  f: boolean;
  /** Written in hex, octal or binary (affects the literal's type). */
  nonDecimal: boolean;
}

export function parseNumber(text: string): NumLit {
  let s = text;
  let u = false;
  let l = false;
  let f = false;
  const hex = /^0[xX]/.test(s);
  const bin = /^0[bB]/.test(s);
  for (;;) {
    const c = s[s.length - 1];
    if (/[uU]/.test(c)) u = true;
    else if (/[lL]/.test(c)) l = true;
    else if (/[fF]/.test(c) && !hex) f = true;
    else break;
    s = s.slice(0, -1);
  }
  if (hex) return { value: parseInt(s.slice(2), 16), float: false, u, l, f: false, nonDecimal: true };
  if (bin) return { value: parseInt(s.slice(2), 2), float: false, u, l, f: false, nonDecimal: true };
  if (/[.eE]/.test(s) || f) return { value: parseFloat(s), float: true, u, l, f, nonDecimal: false };
  if (/^0[0-7]+$/.test(s)) return { value: parseInt(s, 8), float: false, u, l, f: false, nonDecimal: true };
  return { value: parseInt(s, 10), float: false, u, l, f: false, nonDecimal: false };
}
