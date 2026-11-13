import { useState } from "react";

// TRM 18.3.4 "Data format" and Example 18-1: SPICHAR + 1 bits per word.
// Transmit data must be written left-justified (the top bits of SPITXBUF
// are the ones sent, most significant first). SPIDAT shifts left, so the
// received bits end up right-justified in SPIRXBUF, with whatever was left
// of the transmitted word above them.

const CSS = `
.sj-cell { fill: var(--surface); stroke: var(--border-strong); stroke-width: 0.8; }
.sj-cell.sent { fill: var(--accent-soft); stroke: var(--accent); stroke-width: 1.3; }
.sj-cell.got { fill: var(--surface); stroke: var(--info); stroke-width: 1.6; }
.sj-cell.junk { stroke-dasharray: 2 2; }
.sj-bit { font-family: var(--mono); font-size: 10px; font-weight: 700; fill: var(--value); }
.sj-bit.off { fill: var(--dim); font-weight: 400; }
.sj-hex { display: inline-flex; align-items: center; gap: 0.15rem; font-family: var(--mono); font-size: 0.85rem; }
.sj-lbl { color: var(--dim); font-size: 0.82rem; }
.sj-hex input { width: 3.2em; padding: 0.1em 0.3em; }
`;

const hex = (v: number, d: number) => v.toString(16).toUpperCase().padStart(d, "0");

function HexIn({ label, value, digits, set }: { label: string; value: number; digits: number; set: (v: number) => void }) {
  const [txt, setTxt] = useState(hex(value, digits));
  const shown = parseInt(txt || "0", 16) === value ? txt : hex(value, digits);
  return (
    <span className="sj-hex">
      0x
      <input
        value={shown}
        aria-label={label}
        onChange={(e) => {
          const t = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, digits).toUpperCase();
          setTxt(t);
          set(parseInt(t || "0", 16));
        }}
      />
    </span>
  );
}

/** Word length: left-justified out of SPITXBUF, right-justified into SPIRXBUF. */
function SpiJustify() {
  const [n, setN] = useState(8);
  const [data, setData] = useState(0xa5);
  const [reply, setReply] = useState(0x71);
  const [shiftUp, setShiftUp] = useState(false);
  const mask = n === 16 ? 0xffff : (1 << n) - 1;
  const value = data & mask;
  const written = (shiftUp ? value << (16 - n) : value) & 0xffff;
  const sent = (written >>> (16 - n)) & mask;
  const input = reply & mask;
  const rxbuf = n === 16 ? input : ((written << n) | input) & 0xffff;
  const ok = sent === value;
  const X0 = 62;
  const W = 21.5;
  const bit = (v: number, i: number) => (v >> (15 - i)) & 1;
  const row = (v: number, y: number, cls: (i: number) => string) =>
    Array.from({ length: 16 }, (_, i) => (
      <g key={i}>
        <rect x={X0 + i * W} y={y} width={W - 1.5} height={18} rx="2" className={`sj-cell ${cls(i)}`} />
        <text x={X0 + i * W + (W - 1.5) / 2} y={y + 13} textAnchor="middle" className={`sj-bit ${cls(i) === "sent" || cls(i) === "got" ? "" : "off"}`}>{bit(v, i)}</text>
      </g>
    ));
  const digits = Math.ceil(n / 4);
  const shiftText = n === 16 ? "" : ` << ${16 - n}`;
  const why = n === 16
    ? "With 16-bit words the whole register is sent and the whole register is received: nothing to shift, nothing to mask. This is the course's setting for the MPU-9250."
    : ok
      ? `Right: 0x${hex(value, digits)} sits in the top ${n} bits of SPITXBUF, and those are the bits that go out. The ${n} bits that come back land in the bottom of SPIRXBUF. The ${16 - n} bits above them are leftovers of the word you wrote, so mask them off.`
      : `Wrong: the ${n} bits sent are the top ${n} of SPITXBUF, 0x${hex(sent, digits)}, not your value 0x${hex(value, digits)}, which sits at the bottom and never reaches the wire. Shift it up first: 0x${hex(value, digits)} << ${16 - n}.`;
  return (
    <figure className="figure" aria-label="Interactive diagram of SPI word length and justification">
      <style>{CSS}</style>
      <svg viewBox="0 0 420 176" role="img" aria-label={`${n}-bit words. SPITXBUF holds 0x${hex(written, 4)}; the bits sent are 0x${hex(sent, digits)}. SPIRXBUF holds 0x${hex(rxbuf, 4)}; the received bits are 0x${hex(input, digits)}.`}>
        <text x={X0} y={10} className="fig-label dim">bit 15</text>
        <text x={X0 + 16 * W - 1.5} y={10} textAnchor="end" className="fig-label dim">bit 0</text>
        <text x={4} y={27} className="fig-label">SPITXBUF</text>
        <text x={4} y={38} className="fig-value small">0x{hex(written, 4)}</text>
        {row(written, 14, (i) => (i < n ? "sent" : "junk"))}
        <text x={X0 + (n * W) / 2} y={45} textAnchor="middle" className="fig-label" style={{ fill: "var(--accent)" }}>{n < 4 ? `top ${n}` : `top ${n} bits go out`}</text>
        {n < 16 && n <= 12 && <text x={X0 + n * W + ((16 - n) * W) / 2} y={45} textAnchor="middle" className="fig-label dim">{16 - n < 4 ? "" : "never sent"}</text>}
        {/* wire */}
        <text x={4} y={68} className="fig-label">SIMO, out</text>
        <path d={`M${X0},${72} H${X0 + n * W - 1.5}`} className="fig-wire" style={{ stroke: "var(--accent)", strokeWidth: 2 }} />
        {Array.from({ length: n }, (_, i) => (
          <text key={i} x={X0 + i * W + (W - 1.5) / 2} y={66} textAnchor="middle" className="sj-bit">{(sent >> (n - 1 - i)) & 1}</text>
        ))}
        <text x={X0 + n * W + 4} y={68} className="fig-value small">{n <= 12 ? `= 0x${hex(sent, digits)}, first bit on the left` : ""}</text>
        <text x={4} y={100} className="fig-label">SOMI, in</text>
        <path d={`M${X0 + (16 - n) * W},${104} H${X0 + 16 * W - 1.5}`} className="fig-wire" style={{ stroke: "var(--info)", strokeWidth: 2 }} />
        {Array.from({ length: n }, (_, i) => (
          <text key={i} x={X0 + (16 - n + i) * W + (W - 1.5) / 2} y={98} textAnchor="middle" className="sj-bit">{(input >> (n - 1 - i)) & 1}</text>
        ))}
        {n <= 12 && <text x={X0 + (16 - n) * W - 4} y={100} textAnchor="end" className="fig-value small">{n <= 10 ? "the device answers " : ""}0x{hex(input, digits)} =</text>}
        <text x={4} y={127} className="fig-label">SPIRXBUF</text>
        <text x={4} y={138} className="fig-value small">0x{hex(rxbuf, 4)}</text>
        {row(rxbuf, 114, (i) => (i >= 16 - n ? "got" : "junk"))}
        <text x={X0 + (16 - n) * W + (n * W) / 2} y={146} textAnchor="middle" className="fig-label" style={{ fill: "var(--info)" }}>{n < 5 ? `${n} in` : `bottom ${n} bits came in`}</text>
        {n <= 11 && <text x={X0 + ((16 - n) * W) / 2} y={146} textAnchor="middle" className="fig-label dim">leftovers</text>}
        <text x={X0} y={168} className="fig-value small">
          {n === 16 ? `rx = SpibRegs.SPIRXBUF;  // 0x${hex(rxbuf, 4)}` : `rx = SpibRegs.SPIRXBUF & 0x${hex(mask, 4)};  // 0x${hex(input, digits)}, without the mask: 0x${hex(rxbuf, 4)}`}
        </text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Word length</span>
          <input type="range" min={1} max={16} value={n} aria-label="Bits per word" onChange={(e) => setN(+e.target.value)} />
          <button className="fig-opt" aria-pressed={n === 8} onClick={() => setN(8)}>8 bits</button>
          <button className="fig-opt" aria-pressed={n === 16} onClick={() => setN(16)}>16 bits</button>
          <code>SpibRegs.SPICCR.bit.SPICHAR = {n - 1};  // {n} bits</code>
        </div>
        <div>
          <span>You write</span>
          <HexIn label="Value to send, hexadecimal" value={data} digits={4} set={setData} />
          <button className="fig-opt" aria-pressed={!shiftUp} onClick={() => setShiftUp(false)}>as it is</button>
          <button className="fig-opt" aria-pressed={shiftUp} disabled={n === 16} onClick={() => setShiftUp(true)}>shifted to the top</button>
          <code>SpibRegs.SPITXBUF = 0x{hex(value, digits)}{shiftUp ? shiftText : ""};</code>
        </div>
        <div>
          <span>Device</span>
          <span className="sj-lbl">answers</span>
          <HexIn label="Value the device answers, hexadecimal" value={reply} digits={4} set={setReply} />
        </div>
      </div>
      <figcaption>SPICHAR sets how many bits one word has. Out: the top bits of SPITXBUF (left-justified), top bit first. In: the bits arrive at the bottom of SPIRXBUF (right-justified). Tinted cells are the ones that travel; dashed cells do not.</figcaption>
    </figure>
  );
}

export const figure = { id: "spi-justify", Component: SpiJustify };
