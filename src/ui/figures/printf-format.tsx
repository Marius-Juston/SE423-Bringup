import { useState } from "react";
import { tracePrintf, type PrintfArg } from "../../sim/lib/printf";

// One printf conversion on the C28x, formatted by the simulator's own printf
// (src/sim/lib/printf.ts), so the figure and a running program cannot disagree.
// TMS320C28x Optimizing C/C++ Compiler User's Guide (SPRU514X): Table 6-1
// (char and int 16 bits, long and float 32 bits, pointers 32 bits) and 7.3.1
// (a 32-bit argument lies with its upper half at the higher address, which the
// library meets first). Course: lecture 4, slides 13 to 15,
// %[flags][width][.precision][length]specifier.

type TypeId = "int16_t" | "uint16_t" | "int32_t" | "uint32_t" | "float" | "char" | "string";

interface TypeDef {
  id: TypeId;
  label: string;
  start: string;
  examples: string[];
  rule: string;
  /** The value as a number or text, or undefined when the text is not a value of this type. */
  parse: (s: string) => number | string | undefined;
}

const whole = (lo: number, hi: number) => (s: string) => {
  if (!/^\s*-?\d{1,10}\s*$/.test(s)) return undefined;
  const v = Number(s);
  return v >= lo && v <= hi ? v : undefined;
};
const TYPES: TypeDef[] = [
  { id: "int16_t", label: "int16_t", start: "-1234", examples: ["-1", "1234", "-32768"], rule: "a whole number from -32768 to 32767", parse: whole(-32768, 32767) },
  { id: "uint16_t", label: "uint16_t", start: "40000", examples: ["40000", "255", "65535"], rule: "a whole number from 0 to 65535", parse: whole(0, 65535) },
  { id: "int32_t", label: "int32_t", start: "70000", examples: ["70000", "-70000", "5"], rule: "a whole number from -2147483648 to 2147483647", parse: whole(-2147483648, 2147483647) },
  { id: "uint32_t", label: "uint32_t", start: "70000", examples: ["70000", "3000000000", "4096"], rule: "a whole number from 0 to 4294967295", parse: whole(0, 4294967295) },
  {
    id: "float",
    label: "float",
    start: "3.14159",
    examples: ["3.14159", "-0.5", "123456.7", "0.00012"],
    rule: "a number between -1000000000000 and 1000000000000",
    parse: (s) => {
      if (!/^\s*-?(\d+\.?\d*|\.\d+)(e[-+]?\d{1,2})?\s*$/i.test(s)) return undefined;
      const v = Math.fround(Number(s));
      return Number.isFinite(v) && Math.abs(v) <= 1e12 ? v : undefined;
    },
  },
  { id: "char", label: "char", start: "A", examples: ["A", "z", "7"], rule: "one letter, digit or sign", parse: (s) => (/^[\x20-\x7e]$/.test(s) ? s : undefined) },
  { id: "string", label: "string", start: "Hello", examples: ["Hello", "robot", "ok"], rule: "up to 16 letters, digits or signs", parse: (s) => (/^[\x20-\x7e]{0,16}$/.test(s) && !/["\\]/.test(s) ? s : undefined) },
];
const START: Record<TypeId, string> = Object.fromEntries(TYPES.map((t) => [t.id, t.start])) as Record<TypeId, string>;

const CONVS = ["d", "u", "x", "X", "o", "f", "e", "g", "c", "s"] as const;
type Conv = (typeof CONVS)[number];
const FLAGS: [string, string][] = [
  ["-", "- left"],
  ["+", "+ sign"],
  [" ", "space"],
  ["#", "# prefix"],
  ["0", "0 zeros"],
];

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const TEXT_ADDR = 0xa000;

function toArg(type: TypeId, v: number | string): PrintfArg {
  if (type === "string") return { kind: "ptr", words: 2, bits: TEXT_ADDR, value: TEXT_ADDR };
  if (type === "float") {
    f32[0] = v as number;
    return { kind: "float", words: 2, bits: u32[0], value: f32[0] };
  }
  const n = type === "char" ? (v as string).charCodeAt(0) : (v as number);
  const words = type === "int32_t" || type === "uint32_t" ? 2 : 1;
  return { kind: "int", words, bits: words === 2 ? n >>> 0 : n & 0xffff, value: n, signed: !type.startsWith("u"), type };
}

const hex4 = (w: number) => "0x" + w.toString(16).toUpperCase().padStart(4, "0");

const CSS = `
.pf-piece { fill: var(--surface); stroke: var(--dim); stroke-width: 1; }
.pf-piece.none { stroke-dasharray: 3 3; opacity: 0.6; }
.pf-mono { font-family: var(--mono); font-weight: 700; fill: var(--value); font-size: max(12px, calc(10px / var(--fig-k, 1))); }
.pf-cell { fill: var(--surface); stroke: var(--border-strong); stroke-width: 1; }
.pf-cell.space { fill: none; stroke-dasharray: 2 2; }
.pf-char { font-family: var(--mono); font-weight: 700; fill: var(--text); }
.pf-char.space { fill: var(--dim); font-weight: 400; }
.pf-word.unread { opacity: 0.5; }
.pf-word.beyond { stroke-dasharray: 4 3; }
.pf-ok { fill: var(--ok); font-weight: 700; }
.pf-bad { fill: var(--bad); font-weight: 700; }
.pf-in { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; }
.pf-in input { font-family: var(--mono); font-size: 0.85rem; background: var(--inset); color: var(--value); border: 1px solid var(--dim); border-radius: 4px; padding: 0.1em 0.3em; }
.pf-in input[aria-invalid="true"] { border-color: var(--bad); }
.pf-in input.val { width: 10.6rem; }
.pf-in input.num { width: 3.6rem; }
.pf-rule { color: var(--dim); font-size: 0.78rem; flex-basis: 100%; margin-left: 4.9rem; }
.pf-rule.bad { color: var(--bad); }
.pf-code { display: block; margin: 0.5rem 0 0; padding: 0.4rem 0.6rem; background: var(--inset); border-radius: 6px; font-size: 0.85rem; white-space: pre; overflow-x: auto; }
`;

function PrintfFormat() {
  const [type, setType] = useState<TypeId>("int32_t");
  const [raw, setRaw] = useState<Record<TypeId, string>>(START);
  const [conv, setConv] = useState<Conv>("d");
  const [long, setLong] = useState(true);
  const [flags, setFlags] = useState("");
  const [width, setWidth] = useState(0);
  const [prec, setPrec] = useState<number | null>(null);

  const def = TYPES.find((t) => t.id === type)!;
  const parsed = def.parse(raw[type]);
  const valid = parsed !== undefined;
  const value = parsed ?? def.parse(def.start)!;
  const arg = toArg(type, value);
  const text = type === "string" ? (value as string) : "";

  const build = (fl: string, w: number, p: number | null) => `%${fl}${w || ""}${p === null ? "" : "." + p}${long ? "l" : ""}${conv}`;
  const spec = build(flags, width, prec);
  const run = (s: string) => tracePrintf(s, [arg], () => text);
  const trace = run(spec);
  const c = trace.convs[0];
  const out = trace.text;
  const problem = c.problem;
  const readN = c.read.length;
  // Words to draw: the value's own, then any the conversion read beyond them.
  const words = [
    ...trace.cells.map((cell) => ({ offset: cell.offset, word: cell.word, own: true })),
    ...c.read.filter((o) => !trace.cells.some((cell) => cell.offset === o)).map((o) => ({ offset: o, word: 0, own: false })),
  ];

  // What each setting did, found by formatting again without it.
  const notes: string[] = [];
  const plain = run(build(flags, 0, prec)).text;
  if (width > 0) {
    if (plain.length < width) {
      const pad = width - plain.length;
      const zeros = !flags.includes("-") && out !== plain.padStart(width, " ");
      notes.push(`The width ${width} is a least number of characters: ${pad} ${zeros ? (pad === 1 ? "zero fills" : "zeros fill") : pad === 1 ? "space fills" : "spaces fill"} it on the ${flags.includes("-") ? "right" : "left"}.`);
    } else notes.push(`The text is already ${plain.length} characters, so the width ${width} adds nothing. A width never cuts.`);
  }
  if (prec !== null) {
    if ("feE".includes(conv)) notes.push(`The precision .${prec} is the number of digits after the point, rounded.`);
    else if (conv === "g") notes.push(`With g the precision .${prec} is the number of significant digits.`);
    else if (conv === "s") notes.push(`With s the precision .${prec} is the most characters printed.`);
    else if (conv === "c") notes.push("The precision does nothing with c.");
    else notes.push(`With an integer the precision .${prec} is the least number of digits, filled with zeros.`);
  }
  if (long && "fegcs".includes(conv)) notes.push(`The l changes nothing with ${conv}.`);
  for (const [f] of FLAGS) {
    if (!flags.includes(f)) continue;
    if (run(build(flags.replace(f, ""), width, prec)).text === out) notes.push(`The ${f === " " ? "space" : f} flag changes nothing here.`);
  }

  const takes = readN === 2 ? "two 16-bit words" : "one 16-bit word";
  const has = arg.words === 2 ? "two" : "one";
  let why: string;
  if (problem?.code === "printf-sign") why = `The size fits, the sign does not. ${problem.msg}`;
  else if (problem) why = `On the board: ${problem.msg}`;
  else if (type === "string") why = `%s is given the address of the text (32 bits) and prints characters until the 0 that ends the string.`;
  else if (conv === "c") why = `%c takes one 16-bit word and prints the character with that ASCII number: ${arg.value} is '${String.fromCharCode(arg.value & 0xff)}'.`;
  else if (type === "float") why = `%${conv} takes ${takes}, and a float has two: the value is printed as it is.`;
  else {
    why = `${spec} takes ${takes} and ${type.startsWith("int") ? "an" : "a"} ${type} has ${has}: the number is right.`;
    if ("xXo".includes(conv) && arg.signed && arg.value < 0) why += ` ${conv === "o" ? "Octal" : "Hexadecimal"} shows the bits themselves, so a negative number looks large.`;
    if (type === "char") why += " A char is a 16-bit number here: this is its ASCII number.";
  }
  if (notes.length) why += " " + notes.join(" ");

  // Geometry.
  const pieces: [string, string, number][] = [
    ["%", "", 26],
    [flags.replace(" ", "\u2423"), "flags", 62],
    [width ? String(width) : "", "width", 62],
    [prec === null ? "" : "." + prec, "precision", 74],
    [long ? "l" : "", "length", 62],
    [conv, "specifier", 74],
  ];
  let px = 6;
  const pieceBoxes = pieces.map(([t, label, w]) => {
    const x = px;
    px += w + 4.4;
    return { t, label, w, x };
  });
  const chars = [...out];
  const cw = Math.min(17, 388 / Math.max(1, chars.length));
  const decl =
    type === "string" ? `char v[] = "${text}";` : type === "char" ? `char v = '${value}';` : type === "float" ? `float v = ${raw[type].trim() && valid ? raw[type].trim() : def.start};` : `${type} v = ${value};`;
  const spaces = chars.filter((ch) => ch === " ").length;
  const aria = `The conversion ${spec} with ${type.startsWith("int") ? "an" : "a"} ${type} ${type === "string" ? `"${text}"` : type === "char" ? `'${value}'` : value}: it reads ${takes}, the value has ${has}. Printed: "${out}", ${chars.length} characters${problem ? ". This is not the value" : ""}.`;

  const toggleFlag = (f: string) => setFlags((cur) => (cur.includes(f) ? cur.replace(f, "") : FLAGS.map(([x]) => x).filter((x) => cur.includes(x) || x === f).join("")));
  const clampInt = (s: string, hi: number) => Math.max(0, Math.min(hi, Math.round(Number(s)) || 0));

  return (
    <figure className="figure" aria-label="Interactive printf conversion">
      <style>{CSS}</style>
      <svg viewBox="0 0 400 204" role="img" aria-label={aria}>
        <text x="6" y="10" className="fig-label dim">the conversion, piece by piece</text>
        {pieceBoxes.map((p) => (
          <g key={p.label || "pct"}>
            <rect x={p.x} y="16" width={p.w} height="24" rx="4" className={`pf-piece ${p.t ? "" : "none"}`} />
            <text x={p.x + p.w / 2} y="33" textAnchor="middle" className={p.t ? "pf-mono" : "fig-label dim"}>{p.t || "none"}</text>
            <text x={p.x + p.w / 2} y="52" textAnchor="middle" className="fig-label dim">{p.label}</text>
          </g>
        ))}

        <text x="6" y="74" className="fig-label dim">
          {type === "string" ? "the value passed: the address of the text, 32 bits" : `the value passed: ${arg.words === 2 ? "two 16-bit words" : "one 16-bit word"}`}
        </text>
        {words.map((w, i) => {
          const read = c.read.includes(w.offset);
          const x = 6 + i * 104;
          const part = !w.own ? "next in memory" : arg.words === 1 ? "all 16 bits" : i === 0 ? "upper 16 bits" : "lower 16 bits";
          return (
            <g key={w.offset}>
              <rect x={x} y="80" width="98" height="26" rx="4" className={`fig-box pf-word ${read ? "hot" : "unread"} ${w.own ? "" : "beyond"}`} />
              <text x={x + 49} y="98" textAnchor="middle" className="fig-value">{w.own ? hex4(w.word) : "?"}</text>
              <text x={x + 49} y="118" textAnchor="middle" className="fig-label dim">{part}</text>
              <text x={x + 49} y="130" textAnchor="middle" className="fig-label">{read ? "read" : "not read"}</text>
            </g>
          );
        })}
        <text x="222" y="92" className="fig-label">{`${spec} reads ${readN === 2 ? "2 words" : "1 word"}`}</text>
        <text x="222" y="105" className="fig-label">{`the value has ${arg.words === 2 ? "2 words" : "1 word"}`}</text>
        <text x="222" y="120" className={`fig-label ${problem ? "pf-bad" : "pf-ok"}`}>
          {!problem ? "fits" : problem.code === "printf-sign" ? "size fits, sign does not" : "does not fit"}
        </text>

        <text x="6" y="152" className="fig-label dim">
          {`printed: ${chars.length} character${chars.length === 1 ? "" : "s"}${spaces ? ` (the dot marks a space)` : ""}`}
        </text>
        {chars.map((ch, i) => (
          <g key={i}>
            <rect x={6 + i * cw} y="158" width={cw - 1.5} height="24" rx="2.5" className={`pf-cell ${ch === " " ? "space" : ""}`} />
            <text x={6 + i * cw + (cw - 1.5) / 2} y="175" textAnchor="middle" className={`pf-char ${ch === " " ? "space" : ""}`} style={{ fontSize: Math.min(14, cw * 1.05) }}>
              {ch === " " ? "\u00b7" : ch}
            </text>
          </g>
        ))}
        {chars.length === 0 && <text x="6" y="175" className="fig-label">nothing</text>}
        <text x="6" y="198" className={`fig-label ${problem ? "pf-bad" : "dim"}`}>
          {problem ? "not the value in the variable" : "the value, as asked"}
        </text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Type</span>
          {TYPES.map((t) => (
            <button key={t.id} className="fig-opt" aria-pressed={type === t.id} onClick={() => setType(t.id)}>{t.label}</button>
          ))}
        </div>
        <div className="pf-in">
          <span><label htmlFor="pf-value">Value</label></span>
          <input
            id="pf-value"
            className="val"
            type="text"
            inputMode={type === "char" || type === "string" ? "text" : "decimal"}
            spellCheck={false}
            autoComplete="off"
            value={raw[type]}
            aria-invalid={!valid}
            aria-describedby="pf-rule"
            onChange={(e) => setRaw({ ...raw, [type]: e.target.value })}
          />
          {def.examples.map((ex) => (
            <button key={ex} className="fig-opt" aria-pressed={raw[type] === ex} onClick={() => setRaw({ ...raw, [type]: ex })}>{ex}</button>
          ))}
          <small id="pf-rule" className={`pf-rule ${valid ? "" : "bad"}`}>{valid ? `Type ${def.rule}.` : `Not ${def.rule}: showing ${def.start}.`}</small>
        </div>
        <div>
          <span>Specifier</span>
          {CONVS.map((cv) => (
            <button key={cv} className="fig-opt" aria-pressed={conv === cv} aria-label={`specifier ${cv === "X" ? "capital X" : cv}`} onClick={() => setConv(cv)}>{cv}</button>
          ))}
        </div>
        <div>
          <span>Length</span>
          <button className="fig-opt" aria-pressed={!long} onClick={() => setLong(false)}>none: 16 bits</button>
          <button className="fig-opt" aria-pressed={long} onClick={() => setLong(true)}>l: 32 bits</button>
        </div>
      </div>
      <details className="fig-more">
        <summary>More controls: flags, width, precision</summary>
        <div className="fig-controls">
          <div>
            <span>Flags</span>
            {FLAGS.map(([f, label]) => (
              <button key={f} className="fig-opt" aria-pressed={flags.includes(f)} onClick={() => toggleFlag(f)}>{label}</button>
            ))}
          </div>
          <div className="pf-in">
            <span><label htmlFor="pf-width">Width</label></span>
            <input id="pf-width" className="num" type="number" min={0} max={20} value={width} onChange={(e) => setWidth(clampInt(e.target.value, 20))} />
            <button className="fig-opt" aria-pressed={width === 0} onClick={() => setWidth(0)}>none</button>
            <button className="fig-opt" aria-pressed={width === 8} onClick={() => setWidth(8)}>8</button>
          </div>
          <div className="pf-in">
            <span><label htmlFor="pf-prec">Precision</label></span>
            <input id="pf-prec" className="num" type="number" min={0} max={9} value={prec ?? ""} placeholder="none" onChange={(e) => setPrec(e.target.value === "" ? null : clampInt(e.target.value, 9))} />
            <button className="fig-opt" aria-pressed={prec === null} onClick={() => setPrec(null)}>none</button>
            <button className="fig-opt" aria-pressed={prec === 2} onClick={() => setPrec(2)}>.2</button>
          </div>
        </div>
      </details>
      <code className="pf-code">{`${decl}\nserial_printf(&SerialA, "${spec}\\r\\n", v);`}</code>
      <figcaption>
        On this chip int is 16 bits, so d, u, x, o and c take one 16-bit word; with l they take two. f, e and g take the two words of a float, and s the address of a text. A conversion that
        takes the wrong number of words prints a wrong value without any error. Width 0 means no width.
      </figcaption>
    </figure>
  );
}

export const figure = {
  id: "printf-format",
  title: "printf conversion",
  description: "Pick a value, its type and the letters after the percent sign to see exactly what is printed, which parts of the value are read, and what comes out when the two do not match.",
  Component: PrintfFormat,
};
