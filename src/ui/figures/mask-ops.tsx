import { useState } from "react";
import type React from "react";

// The four mask moves on a 16-bit variable (course L2, Lab 2): OR sets,
// AND with the inverted mask clears, XOR toggles, AND tests.

type Op = "set" | "clear" | "toggle" | "test";

// One grid. Every cell carries its row (--r), its place in its byte (--c, 0 to 7), its
// nibble in that byte (--n: 1 for the lower four bits, which stand a little apart in a narrow
// figure) and its byte (--h: 0 for bits 15 to 8, 1 for bits 7 to 0). A wide figure shows the 16 bits in one
// line. A narrow one shows the two bytes as two blocks, one under the other, so a mask bit
// stays at least 24 px wide; the labels are then repeated beside the lower block.
const CSS = `
.mo-wrap { container-type: inline-size; margin-top: 0.4rem; }
.mo-grid { display: grid; grid-template-columns: 4.1rem repeat(16, minmax(0, 1fr)); column-gap: 2px; row-gap: 4px; align-items: center; }
.mo-grid > * { grid-row: var(--r); grid-column: calc(var(--c) + var(--h) * 8 + 2); }
.mo-grid > .mo-lab { grid-column: 1; }
.mo-grid > .mo-rule { grid-column: 1 / -1; }
.mo-grid > .mo-low { display: none; }
.mo-grid .mo-nib { margin-left: 5px; }
.mo-lab { font-size: 0.74rem; line-height: 1.15; color: var(--dim); }
.mo-lab b { display: block; font-family: var(--mono); color: var(--text); font-size: 0.74rem; white-space: nowrap; }
.mo-lab i { font-style: normal; font-family: var(--mono); color: var(--harvest); }
.mo-num { text-align: center; font-family: var(--mono); font-size: var(--fig-small, 11px); color: var(--dim); }
.mo-cell { height: 1.7rem; display: grid; place-items: center; padding: 0; min-width: 0; font-family: var(--mono); font-weight: 700; font-size: 0.9rem; border: 1px solid transparent; border-radius: 4px; background: var(--surface); color: var(--dim); }
.mo-cell.one { color: var(--text); background: var(--surface-2); border-color: var(--dim); }
button.mo-cell { border-color: var(--dim); border-style: dashed; }
button.mo-cell[aria-pressed="true"] { background: var(--harvest); border-color: var(--harvest); border-style: solid; color: var(--bg); }
.mo-cell.inv { opacity: 0.8; }
.mo-cell.hit { background: var(--accent-soft); border: 2px solid var(--orange); color: var(--text); }
.mo-rule { border-top: 2px solid var(--dim); height: 0; }
.mo-mark { text-align: center; font-size: var(--fig-small, 11px); line-height: 1; color: var(--accent-text); height: 0.8rem; }
.mo-code { display: block; margin: 0.5rem 0 0; padding: 0.4rem 0.6rem; background: var(--inset); border-radius: 6px; font-size: 0.85rem; white-space: pre-wrap; }
.mo-n { font-family: var(--mono); font-weight: 700; color: var(--harvest); min-width: 1.4em; text-align: center; display: inline-block; }
@container (max-width: 33rem) {
  .mo-grid { grid-template-columns: minmax(0, auto) repeat(4, minmax(24px, 1fr)) 1px repeat(4, minmax(24px, 1fr)); }
  .mo-grid > * { grid-row: calc(var(--r) + var(--h) * 8); grid-column: calc(var(--c) + var(--n) + 2); }
  .mo-grid > .mo-low { display: block; }
  .mo-grid > .mo-gap { height: 0.5rem; }
  .mo-grid .mo-nib { margin-left: 0; }
  .mo-lab { padding-right: 0.3rem; }
  .mo-lab b { white-space: normal; }
}
`;

const BITS = Array.from({ length: 16 }, (_, i) => 15 - i);
const hex4 = (v: number) => "0x" + v.toString(16).toUpperCase().padStart(4, "0");
const nib = (n: number) => (n % 4 === 3 && n !== 15 ? " mo-nib" : "");
/** Where a cell goes in the grid: its row, and for a bit its byte and its place in it. */
const at = (r: number, bit?: number, low = false) =>
  ({ "--r": r, "--c": bit === undefined ? 0 : 7 - (bit % 8), "--n": bit === undefined || bit % 8 > 3 ? 0 : 1, "--h": bit === undefined ? (low ? 1 : 0) : bit < 8 ? 1 : 0 }) as React.CSSProperties;
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
  const labX = <><b>x</b><i>{hex4(x)}</i></>;
  const labMask = <><b>mask</b><i>{m}</i></>;
  const labInv = <><b>~mask</b><i>{hex4(inv)}</i></>;
  const labResult = <><b>{op === "test" ? "x & mask" : `x ${opSign} ${op === "clear" ? "~mask" : "mask"}`}</b><i>{hex4(result)}</i></>;
  const labHits = op === "test" ? "survived" : "changed";
  return (
    <figure className="figure" aria-label="Interactive bit masks: set, clear, toggle and test bits of a 16-bit value">
      <style>{CSS}</style>
      <div className="mo-wrap">
        <div className="mo-grid" role="group" aria-label={`x is ${hex4(x)}, mask is ${m}, result is ${hex4(result)}`}>
          <span className="mo-lab" style={at(1)}>bit</span>
          {BITS.map((b) => <span key={b} className={`mo-num${nib(b)}`} style={at(1, b)}>{b}</span>)}
          <span className="mo-lab" style={at(2)}>{labX}</span>
          {BITS.map((b) => <span key={b} className={`mo-cell${nib(b)}${(x >> b) & 1 ? " one" : ""}`} style={at(2, b)}>{(x >> b) & 1}</span>)}
          <span className="mo-lab" style={at(3)}>{labMask}</span>
          {BITS.map((b) => (
            <button key={b} className={`mo-cell${nib(b)}`} style={at(3, b)} aria-pressed={((mask >> b) & 1) === 1} aria-label={`mask bit ${b}, value ${(mask >> b) & 1}`} onClick={() => setMask(mask ^ (1 << b))}>
              {(mask >> b) & 1}
            </button>
          ))}
          {op === "clear" && (
            <>
              <span className="mo-lab" style={at(4)}>{labInv}</span>
              {BITS.map((b) => <span key={b} className={`mo-cell inv${nib(b)}${(inv >> b) & 1 ? " one" : ""}`} style={at(4, b)}>{(inv >> b) & 1}</span>)}
            </>
          )}
          <span className="mo-rule" style={at(5)} />
          <span className="mo-lab" style={at(6)}>{labResult}</span>
          {BITS.map((b) => (
            <span key={b} className={`mo-cell${nib(b)}${(hits >> b) & 1 ? " hit" : (result >> b) & 1 ? " one" : ""}`} style={at(6, b)}>{(result >> b) & 1}</span>
          ))}
          <span className="mo-lab" style={at(7)}>{labHits}</span>
          {BITS.map((b) => <span key={b} className={`mo-mark${nib(b)}`} style={at(7, b)} aria-hidden="true">{(hits >> b) & 1 ? "▲" : ""}</span>)}
          {/* a narrow figure shows the lower byte as a second block: the same labels again, not read out twice */}
          <span className="mo-low mo-gap" style={at(8)} />
          <span className="mo-lab mo-low" aria-hidden="true" style={at(1, undefined, true)}>bit</span>
          <span className="mo-lab mo-low" aria-hidden="true" style={at(2, undefined, true)}>{labX}</span>
          <span className="mo-lab mo-low" aria-hidden="true" style={at(3, undefined, true)}>{labMask}</span>
          {op === "clear" && <span className="mo-lab mo-low" aria-hidden="true" style={at(4, undefined, true)}>{labInv}</span>}
          <span className="mo-rule mo-low" style={at(5, undefined, true)} />
          <span className="mo-lab mo-low" aria-hidden="true" style={at(6, undefined, true)}>{labResult}</span>
          <span className="mo-lab mo-low" aria-hidden="true" style={at(7, undefined, true)}>{labHits}</span>
        </div>
      </div>
      <code className="mo-code">
        {stmt}
        {"\n"}
        {single ? `${alt}   // the same\n` : ""}
        {op === "test" ? `// x & mask = ${hex4(result)}: the test is ${result ? "true" : "false"}` : `// x: ${hex4(x)} -> ${hex4(result)}   (${opName} with ${hex4(operand)})`}
      </code>
      <p className="fig-why" role="status">{why}</p>
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
          <button className="fig-opt" aria-label="shift the 1 one place right, to a lower bit" aria-disabled={single && pos === 0} onClick={() => shift(-1)}>-</button>
          <span className="mo-n" aria-hidden="true">{single ? pos : "?"}</span>
          <button className="fig-opt" aria-label="shift the 1 one place left, to a higher bit" aria-disabled={single && pos === 15} onClick={() => shift(1)}>+</button>
          <code>{single ? `(1 << ${pos}) = ${m}` : mask === 0 ? `${m}: no bit chosen` : `${m}: more than one bit`}</code>
        </div>
        <div>
          <span>Then</span>
          <button className="fig-opt" aria-disabled={op === "test" || result === x} onClick={() => op !== "test" && setX(result)}>run it: x = result</button>
          <button className="fig-opt" aria-disabled={x === START} onClick={() => setX(START)}>Reset x to {hex4(START)}</button>
        </div>
      </div>
      <figcaption>The mask's 1 bits choose which bits of x are worked on; every other bit of x comes through unchanged. Click bits of the mask (the dashed row), or build a one-bit mask with the shift.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "mask-ops",
  title: "Bit masks: set, clear, toggle, test",
  description: "Click the bits of a mask and choose an operation to see which bits of x change and the C statement that does it.",
  Component: MaskOps,
};
