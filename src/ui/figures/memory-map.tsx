import { useState } from "react";

// Where registers live: address = base + offset in 16-bit words, and the two
// ways C reaches one register (.all and .bit.NAME). Addresses and field
// positions: TRM sections 8.9 (GpioDataRegs at 0x7F00) and 3.8 (CPU timers,
// CpuTimer0Regs at 0x0C00), the same data as src/sim/device/registers.json.

interface Field { name: string; lo: number; width: number }
interface Reg { name: string; offset: number; words: 1 | 2; what: string; value: number; fields: Field[] | "gpio" | null }
interface Block { name: string; base: number; what: string; regs: Reg[] }

const BLOCKS: Block[] = [
  {
    name: "GpioDataRegs", base: 0x7f00, what: "pin levels",
    regs: [
      { name: "GPADAT", offset: 0, words: 2, what: "port A pin levels", value: 0x00400000, fields: "gpio" },
      { name: "GPASET", offset: 2, words: 2, what: "write 1 to drive a pin high", value: 0x00400000, fields: "gpio" },
      { name: "GPACLEAR", offset: 4, words: 2, what: "write 1 to drive a pin low", value: 0x00000800, fields: "gpio" },
      { name: "GPATOGGLE", offset: 6, words: 2, what: "write 1 to flip a pin", value: 0x80000000, fields: "gpio" },
    ],
  },
  {
    name: "CpuTimer0Regs", base: 0x0c00, what: "CPU timer 0",
    regs: [
      { name: "TIM", offset: 0, words: 2, what: "the counter", value: 199999, fields: null },
      { name: "PRD", offset: 2, words: 2, what: "the period", value: 199999, fields: null },
      {
        name: "TCR", offset: 4, words: 1, what: "control", value: 0x4000,
        fields: [{ name: "TIF", lo: 15, width: 1 }, { name: "TIE", lo: 14, width: 1 }, { name: "FREE", lo: 11, width: 1 }, { name: "SOFT", lo: 10, width: 1 }, { name: "TRB", lo: 5, width: 1 }, { name: "TSS", lo: 4, width: 1 }],
      },
      { name: "TPR", offset: 6, words: 1, what: "prescale, low half", value: 0x0000, fields: [{ name: "PSC", lo: 8, width: 8 }, { name: "TDDR", lo: 0, width: 8 }] },
      { name: "TPRH", offset: 7, words: 1, what: "prescale, high half", value: 0x0000, fields: [{ name: "PSCH", lo: 8, width: 8 }, { name: "TDDRH", lo: 0, width: 8 }] },
    ],
  },
];

const CSS = `
.mm-reg { fill: var(--surface); stroke: var(--dim); stroke-width: 1; }
.mm-reg.sel { fill: var(--accent-soft); stroke: var(--orange); stroke-width: 2; }
.mm-word { fill: none; stroke: var(--dim); stroke-width: 1; }
.mm-word.sel { stroke: var(--orange); stroke-width: 2; }
.mm-none { fill: none; stroke: var(--dim); stroke-dasharray: 3 2; }
.mm-sum { display: block; margin: 0.4rem 0; padding: 0.4rem 0.6rem; background: var(--inset); border-radius: 6px; font-size: 0.74rem; white-space: pre-wrap; overflow-wrap: anywhere; }
.mm-h { margin: 0.7rem 0 0.2rem; font-size: 0.85rem; font-weight: 700; }
.mm-grid { display: grid; grid-template-columns: 3.4rem repeat(16, minmax(0, 1fr)); column-gap: 2px; row-gap: 2px; align-items: center; }
.mm-grid .mm-nib { margin-left: 4px; }
.mm-lab { font-size: 0.7rem; line-height: 1.1; color: var(--dim); }
.mm-bit { height: 1.55rem; padding: 0; min-width: 0; font-family: var(--mono); font-weight: 700; font-size: 0.82rem; border: 1px solid var(--dim); border-radius: 4px; background: var(--surface); color: var(--dim); }
.mm-bit[aria-pressed="true"] { background: var(--harvest); border-color: var(--harvest); color: var(--bg); }
.mm-bit.none { border-style: dashed; opacity: 0.6; cursor: default; }
.mm-num { text-align: center; font-family: var(--mono); font-size: 0.66rem; color: var(--dim); }
.mm-f { text-align: center; font-family: var(--mono); font-size: 0.66rem; font-weight: 700; color: var(--text); border: 1px solid var(--dim); border-bottom: none; border-radius: 4px 4px 0 0; min-width: 0; padding: 2px 0; }
.mm-f.v { writing-mode: vertical-rl; height: 2.6rem; justify-self: stretch; display: grid; place-items: center; }
.mm-f.none { border: none; color: var(--dim); font-weight: 400; }
.mm-f.cur { border-color: var(--orange); color: var(--orange); }
`;

const hex = (v: number, digits: number) => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(digits, "0");
const X0 = 16;
const WW = 46;

function MemoryMap() {
  const [bi, setBi] = useState(0);
  const [ri, setRi] = useState(1);
  const [values, setValues] = useState<Record<string, number>>({});
  const [last, setLast] = useState(22);
  const block = BLOCKS[bi];
  const reg = block.regs[ri];
  const key = `${block.name}.${reg.name}`;
  const value = (values[key] ?? reg.value) >>> 0;
  const nbits = reg.words * 16;
  const addr = block.base + reg.offset;
  const fieldAt = (b: number): Field | null =>
    reg.fields === "gpio" ? { name: `GPIO${b}`, lo: b, width: 1 } : reg.fields ? (reg.fields.find((f) => b >= f.lo && b < f.lo + f.width) ?? null) : null;
  const cur = fieldAt(last < nbits ? last : 0);
  const curVal = cur ? (value >>> cur.lo) & (2 ** cur.width - 1) : 0;
  const flip = (b: number) => {
    setValues({ ...values, [key]: (value ^ (2 ** b)) >>> 0 });
    setLast(b);
  };
  const pick = (b: number, r: number) => {
    setBi(b);
    setRi(r);
    const f = BLOCKS[b].regs[r].fields;
    setLast(f === "gpio" ? 22 : f ? f[1].lo : 0);
  };
  const rows = reg.words === 2 ? [1, 0] : [0];
  const nib = (b: number) => (b % 4 === 3 && b % 16 !== 15 ? " mm-nib" : "");
  const why = `${block.name}.${reg.name} (${reg.what}) is ${nbits} bits, so it takes ${reg.words === 2 ? `two words: ${hex(addr, 4)} holds bits 15 to 0 and ${hex(addr + 1, 4)} holds bits 31 to 16` : `one word, at ${hex(addr, 4)}`}. ${
    reg.fields === null
      ? "It is one plain number with no named fields, so code uses .all."
      : cur
        ? `.all and .bit are two names for the same ${nbits} bits: ${cur.name} is ${cur.width === 1 ? `bit ${cur.lo}` : `bits ${cur.lo + cur.width - 1} to ${cur.lo}`}, so changing it changes the hex value of .all, and the other way round.`
        : `Bit ${last} belongs to no field: it is reserved. .bit has no name for it, and code should leave it 0.`
  }`;
  return (
    <figure className="figure" aria-label="Interactive memory map: register addresses and the .all and .bit views">
      <style>{CSS}</style>
      <div className="fig-controls">
        <div>
          <span>Peripheral</span>
          {BLOCKS.map((b, i) => (
            <button key={b.name} className="fig-opt" aria-pressed={bi === i} onClick={() => pick(i, i === 0 ? 1 : 2)}>{b.name}</button>
          ))}
        </div>
        <div>
          <span>Register</span>
          {block.regs.map((r, i) => (
            <button key={r.name} className="fig-opt" aria-pressed={ri === i} onClick={() => pick(bi, i)}>{r.name}</button>
          ))}
        </div>
      </div>
      <svg viewBox="0 0 400 118" role="img" aria-label={`${block.name} starts at ${hex(block.base, 4)}. ${reg.name} is at offset ${reg.offset}, address ${hex(addr, 4)}, and is ${reg.words} word${reg.words > 1 ? "s" : ""} long.`}>
        <text x={X0} y="10" className="fig-label dim">{block.name}: {block.what}. Each box below is one 16-bit word of memory.</text>
        {/* registers, drawn to scale over the words they occupy */}
        {block.regs.map((r, i) => (
          <g key={r.name}>
            <rect x={X0 + r.offset * WW + 1.5} y="18" width={r.words * WW - 3} height="26" rx="4" className={`mm-reg ${i === ri ? "sel" : ""}`} />
            <text x={X0 + (r.offset + r.words / 2) * WW} y="30" textAnchor="middle" className="fig-label">{r.name}</text>
            <text x={X0 + (r.offset + r.words / 2) * WW} y="40" textAnchor="middle" className="fig-label dim">{r.words * 16} bits</text>
          </g>
        ))}
        {block.name === "CpuTimer0Regs" && (
          <>
            <rect x={X0 + 5 * WW + 1.5} y="18" width={WW - 3} height="26" rx="4" className="mm-none" />
            <text x={X0 + 5.5 * WW} y="34" textAnchor="middle" className="fig-label dim">unused</text>
          </>
        )}
        {/* the words */}
        {Array.from({ length: 8 }, (_, w) => {
          const sel = w >= reg.offset && w < reg.offset + reg.words;
          return (
            <g key={w}>
              <rect x={X0 + w * WW + 1.5} y="50" width={WW - 3} height="16" className={`mm-word ${sel ? "sel" : ""}`} />
              <text x={X0 + (w + 0.5) * WW} y="61.5" textAnchor="middle" className="fig-value small" style={{ fill: sel ? undefined : "var(--dim)" }}>{hex(block.base + w, 4)}</text>
              <text x={X0 + (w + 0.5) * WW} y="77" textAnchor="middle" className="fig-label dim">+{w}</text>
            </g>
          );
        })}
        <text x={X0} y="92" className="fig-label dim">address of each word</text>
        <text x={X0} y="103" className="fig-label dim">and its offset from the base</text>
        <text x="392" y="98" textAnchor="end" className="fig-value">
          {hex(block.base, 4)} + {reg.offset} = {hex(addr, 4)}
        </text>
        <text x="392" y="111" textAnchor="end" className="fig-label">base + offset = address of {reg.name}</text>
      </svg>
      <p className="mm-h">The bits of {reg.name}: click a bit to change it</p>
      <div className="mm-grid" role="group" aria-label={`The ${nbits} bits of ${reg.name}, value ${hex(value, nbits / 4)}`}>
        {rows.map((row) => {
          const bits = Array.from({ length: 16 }, (_, i) => row * 16 + 15 - i);
          const cells = [];
          if (Array.isArray(reg.fields)) {
            // Field names over their bits; a field wider than one bit spans its bits.
            let b = 15;
            while (b >= 0) {
              const f = fieldAt(b);
              const w = f ? f.width : 1;
              cells.push(
                <span key={`f${b}`} className={`mm-f${f ? (w === 1 ? " v" : "") : " none"}${f && f === cur ? " cur" : ""}${nib(b)}`} style={{ gridColumn: `span ${w}` }}>{f ? f.name : "-"}</span>,
              );
              b -= w;
            }
          }
          return [
            Array.isArray(reg.fields) && <span key={`fl${row}`} className="mm-lab">.bit name</span>,
            ...cells,
            <span key={`al${row}`} className="mm-lab">{reg.words === 2 ? (row ? `${hex(addr + 1, 4)} high word` : `${hex(addr, 4)} low word`) : hex(addr, 4)}</span>,
            ...bits.map((b) => (
              <button key={b} className={`mm-bit${nib(b)}`} aria-pressed={((value >>> b) & 1) === 1} aria-label={`bit ${b}${fieldAt(b) ? `, ${fieldAt(b)!.name}` : ""}`} onClick={() => flip(b)}>
                {(value >>> b) & 1}
              </button>
            )),
            <span key={`nl${row}`} className="mm-lab">{reg.fields === "gpio" ? "bit = GPIO" : "bit"}</span>,
            ...bits.map((b) => <span key={`n${b}`} className={`mm-num${nib(b)}`}>{b}</span>),
          ];
        })}
      </div>
      <code className="mm-sum">
        {`${block.name}.${reg.name}.all = ${hex(value, nbits / 4)};  // all ${nbits} bits`}
        {cur ? `\n${block.name}.${reg.name}.bit.${cur.name} = ${curVal};  // one field` : ""}
      </code>
      <p className="fig-why" role="status">{why}</p>
      <figcaption>Memory is a row of numbered 16-bit words. A peripheral's registers sit side by side from its base address; a 32-bit register takes two words, so the next one is 2 further on. TI's header files turn every address into a name.</figcaption>
    </figure>
  );
}

export const figure = { id: "memory-map", Component: MemoryMap };
