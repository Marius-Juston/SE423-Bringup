// What the editor offers while typing: the members of a register structure
// after "." or "->" (GpioDataRegs. then GPASET. then bit. then GPIO31), and
// the names the course library gives a program (registers, helper functions,
// constants, types). Pure: no editor, so it can be tested on its own.
import { Board } from "../../sim/board";
import { typeName, type CType } from "../../sim/cc/types";

export interface Option {
  label: string;
  kind: "property" | "variable" | "function" | "constant" | "type" | "keyword";
  /** Shown beside the name: a type, a bit width. */
  detail?: string;
  /** Shown when the option is selected: what the register or field is for. */
  info?: string;
}

export interface Offer {
  /** How many characters before the cursor the options replace. */
  typed: number;
  options: Option[];
}

const KEYWORDS = [
  "if", "else", "while", "for", "do", "switch", "case", "default", "break", "continue", "return", "sizeof",
  "void", "char", "int", "long", "float", "double", "unsigned", "signed", "struct", "union", "enum", "typedef",
  "const", "volatile", "static", "extern", "__interrupt",
];

interface Names {
  /** Variables the library declares, by name: the register structures and the course's own globals. */
  vars: Map<string, CType>;
  top: Option[];
}

const cache = new Map<string, Names>();

/** The names a program on this board starts with. Built once per board from the simulator's own tables. */
function names(kit: string): Names {
  let n = cache.get(kit);
  if (n) return n;
  const vars = new Map<string, CType>();
  const top: Option[] = [];
  try {
    const b = new Board(kit);
    const hidden = (name: string) => name.startsWith("__");
    for (const [name, g] of b.compiler.globals) {
      if (hidden(name)) continue;
      vars.set(name, g.t);
      top.push({ label: name, kind: "variable", detail: typeName(g.t) });
    }
    for (const [name, f] of b.compiler.fns) {
      if (hidden(name)) continue;
      const params = f.t.params.map(typeName).join(", ") + (f.t.variadic ? ", ..." : "");
      top.push({ label: name, kind: "function", detail: `${typeName(f.t.ret)} (${params || "void"})` });
    }
    for (const name of b.pp.macros.keys()) if (!hidden(name)) top.push({ label: name, kind: "constant" });
    for (const name of b.ctx.enums.keys()) if (!hidden(name)) top.push({ label: name, kind: "constant" });
    for (const [name, t] of b.ctx.typedefs) if (!hidden(name)) top.push({ label: name, kind: "type", detail: typeName(t) });
  } catch {
    // Without the library's names the editor still completes words of the program.
  }
  const seen = new Set(top.map((o) => o.label));
  for (const k of KEYWORDS) if (!seen.has(k)) top.push({ label: k, kind: "keyword" });
  n = { vars, top };
  cache.set(kit, n);
  return n;
}

/** The structure whose members follow a "." or "->" after a value of this type. */
function structOf(t: CType | undefined): Extract<CType, { k: "struct" }> | undefined {
  while (t && (t.k === "ptr" || t.k === "array")) t = t.k === "ptr" ? t.to : t.of;
  return t?.k === "struct" ? t : undefined;
}

const CHAIN = /([A-Za-z_]\w*)((?:\s*(?:\.|->)\s*[A-Za-z_]\w*|\s*\[[^\][]*\])*)\s*(?:\.|->)\s*([A-Za-z_]\w*)?$/;

/**
 * What to offer at the end of `before` (the text of the line up to the
 * cursor). Null when there is nothing to offer: after a "." whose left side
 * is not a known structure, in a number, or with no word begun (unless
 * `explicit`: the student asked with Ctrl+Space).
 */
export function offerAt(before: string, kit: string, explicit = false): Offer | null {
  const { vars, top } = names(kit);
  const m = CHAIN.exec(before);
  if (m) {
    let st = structOf(vars.get(m[1]));
    for (const seg of m[2].match(/(?:\.|->)\s*[A-Za-z_]\w*/g) ?? []) {
      const name = seg.replace(/^(\.|->)\s*/, "");
      st = structOf(st?.fields.find((f) => f.name === name)?.type);
    }
    if (!st) return null;
    const options: Option[] = st.fields
      .filter((f) => !/^rsvd/i.test(f.name))
      .map((f) => ({ label: f.name, kind: "property" as const, detail: f.bitW ? `${f.bitW} bit${f.bitW === 1 ? "" : "s"}` : typeName(f.type), info: f.desc }));
    return options.length ? { typed: (m[3] ?? "").length, options } : null;
  }
  // A member of something unknown (the student's own struct): the words of the program are the better guess.
  if (/(\.|->)\s*\w*$/.test(before)) return null;
  const word = /[A-Za-z_]\w*$/.exec(before)?.[0] ?? "";
  if (!word) return explicit ? { typed: 0, options: top } : null;
  // Not inside a number (0x1F, 10UL, 1.5f).
  if (/[\d.]$/.test(before.slice(0, before.length - word.length))) return null;
  // A finished word ("else", "EALLOW") gets no list: Enter after it must start a new line, not pick from a list.
  if (!explicit && top.some((o) => o.label === word)) return null;
  return { typed: word.length, options: top };
}
