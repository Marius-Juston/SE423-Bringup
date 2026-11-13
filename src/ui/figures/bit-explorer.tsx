import { useState } from "react";

// One 16-bit word, the size of an int on this chip (course L2 and L4; the
// C28x compiler's int and char are 16 bits). Bit n weighs 2^n; read as
// two's complement, bit 15 weighs -2^15 instead of +2^15.

const CSS = `
.bx-grid { display: grid; grid-template-columns: 2.9rem repeat(16, minmax(0, 1fr)); column-gap: 2px; row-gap: 3px; align-items: center; }
.bx-grid .bx-nib { margin-left: 5px; }
.bx-row { color: var(--dim); font-size: 0.72rem; line-height: 1.1; }
.bx-hex { grid-column: span 4; text-align: center; font-family: var(--mono); font-weight: 700; font-size: 1.25rem; color: var(--harvest); border: 1px solid var(--dim); border-bottom: none; border-radius: 6px 6px 0 0; padding-top: 1px; line-height: 1.3; }
.bx-hex small { color: var(--dim); font-size: 0.68rem; font-weight: 400; margin-left: 0.35em; }
.bx-bit { height: 1.9rem; padding: 0; min-width: 0; font-family: var(--mono); font-weight: 700; font-size: 0.95rem; border: 1px solid var(--dim); border-radius: 4px; background: var(--surface); color: var(--dim); }
.bx-bit[aria-pressed="true"] { background: var(--harvest); border-color: var(--harvest); color: var(--bg); }
.bx-num { text-align: center; font-family: var(--mono); font-size: 0.7rem; color: var(--dim); }
.bx-w { justify-self: center; writing-mode: vertical-rl; font-family: var(--mono); font-size: 0.7rem; line-height: 1; color: var(--dim); height: 3.2rem; }
.bx-w.on { color: var(--harvest); font-weight: 700; }
.bx-w.neg { color: var(--text); font-weight: 700; }
.bx-w.neg.on { color: var(--harvest); }
.bx-out { display: grid; grid-template-columns: auto 1fr; gap: 0.1rem 0.7rem; margin: 0.6rem 0 0; font-size: 0.88rem; }
.bx-out dt { color: var(--dim); }
.bx-out dd { margin: 0; font-family: var(--mono); font-weight: 700; color: var(--harvest); overflow-wrap: anywhere; }
.bx-out dd.bx-cur { outline: 1px solid var(--orange); outline-offset: 2px; border-radius: 3px; width: fit-content; }
`;

const BITS = Array.from({ length: 16 }, (_, i) => 15 - i);
const hex4 = (v: number) => "0x" + v.toString(16).toUpperCase().padStart(4, "0");

function BitExplorer() {
  const [v, setV] = useState(0x00a5);
  const [signed, setSigned] = useState(false);
  const bit = (n: number) => (v >> n) & 1;
  const weight = (n: number) => (signed && n === 15 ? -32768 : 1 << n);
  const asSigned = v & 0x8000 ? v - 65536 : v;
  const shown = signed ? asSigned : v;
  const terms = BITS.filter(bit).map(weight);
  const sum = terms.length ? `${terms.join(" + ")} = ${shown}` : "no bit is 1, so the value is 0";
  const binary = [3, 2, 1, 0].map((g) => ((v >> (4 * g)) & 15).toString(2).padStart(4, "0")).join(" ");
  const top = bit(15) === 1;
  const why = !signed
    ? `Unsigned: every 1 bit adds its weight, and bit n weighs 2 to the power n. ${sum}.`
    : top
      ? `Two's complement: bit 15 is 1 and weighs -32768 instead of +32768. ${sum}. That is the unsigned reading minus 65536: ${v} - 65536 = ${asSigned}.`
      : `Two's complement: bit 15 is 0, so nothing negative is added and the value is the same as unsigned. ${sum}. Switch bit 15 on to see the number go negative.`;
  return (
    <figure className="figure" aria-label="Interactive 16-bit word: click bits to see binary, hex and decimal">
      <style>{CSS}</style>
      <div className="fig-controls">
        <div>
          <span>Read as</span>
          <button className="fig-opt" aria-pressed={!signed} onClick={() => setSigned(false)}>unsigned</button>
          <button className="fig-opt" aria-pressed={signed} onClick={() => setSigned(true)}>two's complement</button>
          <code>{signed ? "int16_t" : "uint16_t"} v = {hex4(v)};</code>
        </div>
      </div>
      <div className="bx-grid" role="group" aria-label={`16 bits, value ${hex4(v)}, ${shown} in decimal`}>
        <span className="bx-row">hex digit</span>
        {[3, 2, 1, 0].map((g) => {
          const d = (v >> (4 * g)) & 15;
          return (
            <span key={g} className={`bx-hex ${g < 3 ? "bx-nib" : ""}`}>
              {d.toString(16).toUpperCase()}
              <small>= {d}</small>
            </span>
          );
        })}
        <span className="bx-row">bit value</span>
        {BITS.map((n) => (
          <button key={n} className={`bx-bit ${n % 4 === 3 && n !== 15 ? "bx-nib" : ""}`} aria-pressed={bit(n) === 1} aria-label={`bit ${n}, weight ${weight(n)}, is ${bit(n)}`} onClick={() => setV(v ^ (1 << n))}>
            {bit(n)}
          </button>
        ))}
        <span className="bx-row">bit number</span>
        {BITS.map((n) => (
          <span key={n} className={`bx-num ${n % 4 === 3 && n !== 15 ? "bx-nib" : ""}`}>{n}</span>
        ))}
        <span className="bx-row">weight</span>
        {BITS.map((n) => (
          <span key={n} className={`bx-w ${n % 4 === 3 && n !== 15 ? "bx-nib" : ""} ${weight(n) < 0 ? "neg" : ""} ${bit(n) ? "on" : ""}`}>{weight(n)}</span>
        ))}
      </div>
      <dl className="bx-out">
        <dt>binary</dt>
        <dd>{binary}</dd>
        <dt>hex</dt>
        <dd>{hex4(v)}</dd>
        <dt>unsigned (uint16_t)</dt>
        <dd className={signed ? "" : "bx-cur"}>{v}</dd>
        <dt>two's complement (int16_t)</dt>
        <dd className={signed ? "bx-cur" : ""}>{asSigned}</dd>
      </dl>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Try</span>
          <button className="fig-opt" onClick={() => setV(~v & 0xffff)}>flip every bit</button>
          <button className="fig-opt" onClick={() => setV((v + 1) & 0xffff)}>add 1</button>
          <button className="fig-opt" onClick={() => setV(5)}>load 5</button>
          <button className="fig-opt" onClick={() => setV(0)}>all 0</button>
        </div>
      </div>
      <figcaption>One 16-bit word, the size of an int on this chip. Click a bit to flip it. One hex digit is always four bits, so the word is four hex digits. To negate a number in two's complement, flip every bit and add 1: load 5, press both buttons and read -5 (0xFFFB).</figcaption>
    </figure>
  );
}

export const figure = { id: "bit-explorer", Component: BitExplorer };
