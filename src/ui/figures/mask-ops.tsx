import { useState } from "react";

// The four mask moves on a 16-bit variable (course L2, Lab 2): OR sets,
// AND with the inverted mask clears, XOR toggles, AND tests.

type Op = "set" | "clear" | "toggle" | "test";

const CSS = `
.mo-grid { display: grid; grid-template-columns: 4.1rem repeat(16, minmax(0, 1fr)); column-gap: 2px; row-gap: 4px; align-items: center; margin-top: 0.4rem; }
.mo-grid .mo-nib { margin-left: 5px; }
.mo-lab { font-size: 0.74rem; line-height: 1.15; color: var(--dim); }
.mo-lab b { display: block; font-family: var(--mono); color: var(--text); font-size: 0.74rem; white-space: nowrap; }
.mo-lab i { font-style: normal; font-family: var(--mono); color: var(--harvest); }
.mo-num { text-align: center; font-family: var(--mono); font-size: 0.68rem; color: var(--dim); }
.mo-cell { height: 1.7rem; display: grid; place-items: center; padding: 0; min-width: 0; font-family: var(--mono); font-weight: 700; font-size: 0.9rem; border: 1px solid transparent; border-radius: 4px; background: var(--surface); color: var(--dim); }
.mo-cell.one { color: var(--text); background: var(--surface-2); border-color: var(--dim); }
button.mo-cell { border-color: var(--dim); border-style: dashed; }
button.mo-cell[aria-pressed="true"] { background: var(--harvest); border-color: var(--harvest); border-style: solid; color: var(--bg); }
.mo-cell.inv { opacity: 0.8; }
.mo-cell.hit { background: var(--accent-soft, rgba(255, 95, 5, 0.16)); border: 2px solid var(--orange); color: var(--text); }
.mo-rule { grid-column: 1 / -1; border-top: 2px solid var(--dim); height: 0; }
.mo-mark { text-align: center; font-size: 0.7rem; line-height: 1; color: var(--orange); height: 0.8rem; }
.mo-code { display: block; margin: 0.5rem 0 0; padding: 0.4rem 0.6rem; background: var(--inset, var(--bg)); border-radius: 6px; font-size: 0.85rem; white-space: pre-wrap; }
.mo-n { font-family: var(--mono); font-weight: 700; color: var(--harvest); min-width: 1.4em; text-align: center; display: inline-block; }
`;

const BITS = Array.from({ length: 16 }, (_, i) => 15 - i);
const hex4 = (v: number) => "0x" + v.toString(16).toUpperCase().padStart(4, "0");
const nib = (n: number) => (n % 4 === 3 && n !== 15 ? " mo-nib" : "");
const START = 0x00a5;

function MaskOps() {
  const [x, setX] = useState(START);
  const [mask, setMask] = useState(0x0200);
  const [op, setOp] = useState<Op>("set");
  const [n, setN] = useState(9);
  const inv = ~mask & 0xffff;
  const result = op === "set" ? x | mask : op === "clear" ? x & inv : op === "toggle" ? x ^ mask : x & mask;
  // Bits to point at: the ones the statement changes, or for a test the ones that survive the AND.
  const hits = op === "test" ? result : x ^ result;
  const single = mask !== 0 && (mask & (mask - 1)) === 0;
  const pos = single ? Math.log2(mask) : -1;
  const shift = (d: number) => {
    const k = Math.min(15, Math.max(0, (single ? pos : n) + d));
    setN(k);
    setMask(1 << k);
  };
  const m = hex4(mask);
  const sh = `(1 << ${pos})`;
  const stmt = { set: `x |= ${m};`, clear: `x &= ~${m};`, toggle: `x ^= ${m};`, test: `if (x & ${m}) { ... }` }[op];
  const alt = { set: `x |= ${sh};`, clear: `x &= ~${sh};`, toggle: `x ^= ${sh};`, test: `if (x & ${sh}) { ... }` }[op];
  const count = BITS.filter((b) => (hits >> b) & 1).length;
  const why =
    mask === 0
      ? "The mask has no 1 bits, so it selects nothing. Click bits in the mask row."
      : op === "set"
        ? `OR: where the mask is 1 the result is 1, where it is 0 the bit of x passes through. ${count ? `${count} bit${count > 1 ? "s" : ""} of x changed to 1.` : "Those bits were already 1, so nothing changed."}`
        : op === "clear"
          ? `AND with the inverted mask: ~mask is 0 exactly where the mask is 1, and AND with 0 gives 0. Everywhere else ~mask is 1 and the bit of x passes through. ${count ? `${count} bit${count > 1 ? "s" : ""} of x changed to 0.` : "Those bits were already 0, so nothing changed."}`
          : op === "toggle"
            ? `XOR: where the mask is 1 the bit of x is flipped, where it is 0 it passes through. ${count} bit${count > 1 ? "s" : ""} flipped.`
            : `AND without assignment: x is not changed. Only the masked bits can survive, so the result is ${result === 0 ? "0, which C treats as false: no masked bit of x is 1" : `${hex4(result)}, not zero, which C treats as true: a masked bit of x is 1`}.`;
  const operand = op === "clear" ? inv : mask;
  const opSign = { set: "|", clear: "&", toggle: "^", test: "&" }[op];
  const opName = { set: "OR", clear: "AND", toggle: "XOR", test: "AND" }[op];
  return (
    <figure className="figure" aria-label="Interactive bit masks: set, clear, toggle and test bits of a 16-bit value">
      <style>{CSS}</style>
      <div className="fig-controls">
        <div>
          <span>Operation</span>
          <button className="fig-opt" aria-pressed={op === "set"} onClick={() => setOp("set")}>set (OR)</button>
          <button className="fig-opt" aria-pressed={op === "clear"} onClick={() => setOp("clear")}>clear (AND NOT)</button>
          <button className="fig-opt" aria-pressed={op === "toggle"} onClick={() => setOp("toggle")}>toggle (XOR)</button>
          <button className="fig-opt" aria-pressed={op === "test"} onClick={() => setOp("test")}>test (AND)</button>
        </div>
        <div>
          <span>Mask</span>
          <code style={{ marginLeft: 0 }}>1 &lt;&lt;</code>
          <button className="fig-opt" aria-label="shift one place less" onClick={() => shift(-1)}>-</button>
          <span className="mo-n">{single ? pos : "?"}</span>
          <button className="fig-opt" aria-label="shift one place more" onClick={() => shift(1)}>+</button>
          <code>{single ? `= ${m}: a single 1 in bit ${pos}` : `mask = ${m}: not a single bit`}</code>
        </div>
      </div>
      <div className="mo-grid" role="group" aria-label={`x is ${hex4(x)}, mask is ${m}, result is ${hex4(result)}`}>
        <span className="mo-lab">bit</span>
        {BITS.map((b) => <span key={b} className={`mo-num${nib(b)}`}>{b}</span>)}
        <span className="mo-lab"><b>x</b><i>{hex4(x)}</i></span>
        {BITS.map((b) => <span key={b} className={`mo-cell${nib(b)}${(x >> b) & 1 ? " one" : ""}`}>{(x >> b) & 1}</span>)}
        <span className="mo-lab"><b>mask</b><i>{m}</i></span>
        {BITS.map((b) => (
          <button key={b} className={`mo-cell${nib(b)}`} aria-pressed={((mask >> b) & 1) === 1} aria-label={`mask bit ${b}`} onClick={() => setMask(mask ^ (1 << b))}>
            {(mask >> b) & 1}
          </button>
        ))}
        {op === "clear" && (
          <>
            <span className="mo-lab"><b>~mask</b><i>{hex4(inv)}</i></span>
            {BITS.map((b) => <span key={b} className={`mo-cell inv${nib(b)}${(inv >> b) & 1 ? " one" : ""}`}>{(inv >> b) & 1}</span>)}
          </>
        )}
        <span className="mo-rule" />
        <span className="mo-lab"><b>{op === "test" ? "x & mask" : `x ${opSign} ${op === "clear" ? "~mask" : "mask"}`}</b><i>{hex4(result)}</i></span>
        {BITS.map((b) => (
          <span key={b} className={`mo-cell${nib(b)}${(hits >> b) & 1 ? " hit" : (result >> b) & 1 ? " one" : ""}`}>{(result >> b) & 1}</span>
        ))}
        <span className="mo-lab">{op === "test" ? "survived" : "changed"}</span>
        {BITS.map((b) => <span key={b} className={`mo-mark${nib(b)}`} aria-hidden="true">{(hits >> b) & 1 ? "▲" : ""}</span>)}
      </div>
      <code className="mo-code">
        {stmt}
        {single ? `      // the same: ${alt}` : ""}
        {"\n"}
        {op === "test" ? `// x & mask = ${hex4(result)}: the test is ${result ? "true" : "false"}` : `// x: ${hex4(x)} -> ${hex4(result)}   (${opName} with ${hex4(operand)})`}
      </code>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Then</span>
          <button className="fig-opt" disabled={op === "test" || result === x} onClick={() => setX(result)}>run it: x = result</button>
          <button className="fig-opt" disabled={x === START} onClick={() => setX(START)}>x back to {hex4(START)}</button>
        </div>
      </div>
      <figcaption>Click bits of the mask (the dashed row), or build a one-bit mask with the shift. The mask's 1 bits choose which bits of x are worked on; every other bit of x always comes through unchanged.</figcaption>
    </figure>
  );
}

export const figure = { id: "mask-ops", Component: MaskOps };
