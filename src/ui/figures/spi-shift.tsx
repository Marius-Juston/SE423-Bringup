import { useState } from "react";

// TRM 18.3.2 (master mode) and Figure 18-2: SPIDAT of the master and the
// slave's shift register form one ring through SPISIMO and SPISOMI. Both
// shift left, most significant bit first; the bit that arrives enters at
// bit 0. After one word the two registers have exchanged contents.
// Wires are coloured by level (orange 1, blue 0), as in every figure; where
// a bit came from is shown by shading and by its label (m7..m0, s7..s0).

const CSS = `
.ss-cell { stroke-width: 1.2; }
.ss-m { fill: var(--faint); stroke: var(--text); }
.ss-s { fill: var(--surface); stroke: var(--dim); stroke-dasharray: 3 2; }
.ss-hex { display: inline-flex; align-items: center; gap: 0.15rem; font-family: var(--mono); font-size: 0.85rem; }
.ss-lbl { color: var(--dim); font-size: 0.82rem; }
.ss-hex input { width: 3.2em; padding: 0.1em 0.3em; }
`;

const hex2 = (v: number) => v.toString(16).toUpperCase().padStart(2, "0");

function HexByte({ label, value, set }: { label: string; value: number; set: (v: number) => void }) {
  const [txt, setTxt] = useState(hex2(value));
  const shown = parseInt(txt || "0", 16) === value ? txt : hex2(value);
  return (
    <span className="ss-hex">
      0x
      <input
        value={shown}
        aria-label={label}
        onChange={(e) => {
          const t = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 2).toUpperCase();
          setTxt(t);
          set(parseInt(t || "0", 16));
        }}
      />
    </span>
  );
}

/** Two shift registers in a ring: every word sent is a word received. */
function SpiShift() {
  const [m0, setM0] = useState(0xa5);
  const [s0, setS0] = useState(0x3c);
  const [n, setN] = useState(0);
  // Bit k of a register after n clocks, with where it came from.
  const cell = (own: number, other: number, ownTag: string, otherTag: string, i: number) => {
    // i = 0 is bit 7. After n shifts, position i holds original bit (7 - i - n) of own, or of the other register.
    const src = 7 - i - n;
    return src >= 0 ? { v: (own >> src) & 1, tag: `${ownTag}${src}`, mine: true } : { v: (other >> (src + 8)) & 1, tag: `${otherTag}${src + 8}`, mine: false };
  };
  const master = Array.from({ length: 8 }, (_, i) => cell(m0, s0, "m", "s", i));
  const slave = Array.from({ length: 8 }, (_, i) => cell(s0, m0, "s", "m", i));
  const val = (c: { v: number }[]) => c.reduce((a, x) => (a << 1) | x.v, 0);
  const mNow = val(master);
  const sNow = val(slave);
  const simo = master[0].v;
  const somi = slave[0].v;
  const lv = (b: number) => (b ? "var(--hi)" : "var(--lo)");
  const done = n === 8;
  const MX = 24;
  const SX = 244;
  const W = 19;
  const Y = 62;
  const reg = (cells: typeof master, x0: number, masterReg: boolean) =>
    cells.map((c, i) => (
      <g key={i}>
        <rect x={x0 + i * W} y={Y} width={W} height={24} className={`ss-cell ${c.mine === masterReg ? "ss-m" : "ss-s"}`} />
        <text x={x0 + i * W + W / 2} y={Y + 16} textAnchor="middle" className="fig-value">{c.v}</text>
        <text x={x0 + i * W + W / 2} y={Y + 35} textAnchor="middle" className="fig-label dim">{c.tag}</text>
      </g>
    ));
  const why = n === 0
    ? `Before the first clock. The master's top bit (${simo}) is already on SIMO and the slave's top bit (${somi}) on SOMI. Press Step for one clock.`
    : done
      ? `8 clocks: the two bytes have swapped places. The master now holds 0x${hex2(mNow)}, the slave's byte, and the slave holds 0x${hex2(sNow)}. Sending and receiving were one and the same action: every word sent is a word received.`
      : `Clock ${n} of 8. Both registers moved one place left: ${n} bit${n > 1 ? "s" : ""} of the master's byte ${n > 1 ? "are" : "is"} now in the slave, and ${n} of the slave's ${n > 1 ? "are" : "is"} in the master. Next on the wires: ${simo} on SIMO, ${somi} on SOMI.`;
  return (
    <figure className="figure" aria-label="Interactive diagram of the two SPI shift registers joined in a ring">
      <style>{CSS}</style>
      <svg viewBox="0 0 420 138" role="img" aria-label={`After ${n} of 8 clocks the master register holds 0x${hex2(mNow)} and the slave register holds 0x${hex2(sNow)}.`}>
        {/* SIMO: master top bit, over the top, into the slave's bit 0 */}
        <path d={`M${MX},${Y + 12} H10 V24 H410 V${Y + 12} H${SX + 8 * W + 5}`} className="fig-wire" style={{ stroke: done ? undefined : lv(simo), strokeWidth: 2 }} />
        <polygon points={`${SX + 8 * W},${Y + 12} ${SX + 8 * W + 6},${Y + 8} ${SX + 8 * W + 6},${Y + 16}`} style={{ fill: done ? "var(--dim)" : lv(simo) }} />
        <text x={210} y={19} textAnchor="middle" className="fig-label">SIMO: master out, slave in{done ? "" : `, carrying ${simo}`}</text>
        {/* SOMI: slave top bit into the master's bit 0 */}
        <line x1={SX} y1={Y + 12} x2={MX + 8 * W + 5} y2={Y + 12} className="fig-wire" style={{ stroke: done ? undefined : lv(somi), strokeWidth: 2 }} />
        <polygon points={`${MX + 8 * W},${Y + 12} ${MX + 8 * W + 6},${Y + 8} ${MX + 8 * W + 6},${Y + 16}`} style={{ fill: done ? "var(--dim)" : lv(somi) }} />
        <text x={210} y={Y + 5} textAnchor="middle" className="fig-label">SOMI</text>
        {!done && <text x={210} y={Y + 26} textAnchor="middle" className="fig-label">carrying {somi}</text>}
        <text x={MX} y={46} className="fig-label">master: F28379D</text>
        <text x={MX + 8 * W} y={46} textAnchor="end" className="fig-value">0x{hex2(mNow)}</text>
        <text x={SX} y={46} className="fig-label">slave: the sensor</text>
        <text x={SX + 8 * W} y={46} textAnchor="end" className="fig-value">0x{hex2(sNow)}</text>
        {reg(master, MX, true)}
        {reg(slave, SX, false)}
        <text x={MX} y={57} className="fig-label dim">top bit leaves</text>
        <text x={MX + 8 * W} y={57} textAnchor="end" className="fig-label dim">new bit enters</text>
        {/* clock */}
        <text x={MX} y={127} className="fig-label">SPICLK, from the master</text>
        {Array.from({ length: 8 }, (_, k) => (
          <path key={k} d={`M${150 + k * 22},130 h6 v-12 h10 v12 h6`} className="fig-trace" style={k < n ? undefined : { stroke: "var(--dim)", strokeDasharray: "2 2", strokeWidth: 1 }} />
        ))}
        <text x={332} y={127} className="fig-label">{n} of 8 clocks</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Clock</span>
          <button className="fig-opt" disabled={n === 0} onClick={() => setN(n - 1)}>Back</button>
          <button className="fig-opt" disabled={done} onClick={() => setN(n + 1)}>Next</button>
          <button className="fig-opt" disabled={done} onClick={() => setN(8)}>all 8 clocks</button>
          <button className="fig-opt" disabled={n === 0} onClick={() => setN(0)}>Reset</button>
        </div>
        <div>
          <span>Bytes</span>
          <span className="ss-lbl">master sends</span>
          <HexByte label="Byte in the master's register, hexadecimal" value={m0} set={(v) => { setM0(v); setN(0); }} />
          <span className="ss-lbl">slave answers</span>
          <HexByte label="Byte in the slave's register, hexadecimal" value={s0} set={(v) => { setS0(v); setN(0); }} />
          <button className="fig-opt" onClick={() => { setM0(0x00); setN(0); }}>master sends zeros</button>
        </div>
      </div>
      <figcaption>The master's shift register and the slave's are one ring of 16 bits. Each clock moves the ring one place, top bit first. Shaded cells (m7 to m0) came from the master, dashed cells (s7 to s0) from the slave. To read a byte the master must clock 8 times, so it must send something, even zeros.</figcaption>
    </figure>
  );
}

export const figure = { id: "spi-shift", Component: SpiShift };
