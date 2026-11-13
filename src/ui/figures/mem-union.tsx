import { useState } from "react";
import { MEM_CSS } from "./mem-shared";

// One 16-bit register seen two ways, as TI's headers declare every register:
//   union CTRL_REG { Uint16 all; struct CTRL_BITS bit; };
// .all is the whole box as one number, .bit.NAME is a named group of bits
// inside it. The TI compiler places the first bit field at bit 0 and works
// upwards (TMS320C28x compiler guide, bit fields; the layout TRM 3.6.1 and
// the F2837xD header files rely on). The register itself is made up.

const FIELDS = [
  { name: "ON", lo: 0, width: 1 },
  { name: "MODE", lo: 1, width: 2 },
  { name: "LEVEL", lo: 3, width: 4 },
];
const BW = 23;
const BX = (bit: number) => 16 + (15 - bit) * BW;

function MemUnion() {
  const [v, setV] = useState([1, 2, 5]);
  const [last, setLast] = useState(1);
  const all = v[0] | (v[1] << 1) | (v[2] << 3);
  const hex = "0x" + all.toString(16).toUpperCase().padStart(4, "0");
  const set = (k: number, x: number) => {
    setV(v.map((old, i) => (i === k ? x : old)));
    setLast(k);
  };
  const f = FIELDS[last];
  const fieldOf = (bit: number) => FIELDS.findIndex((x) => bit >= x.lo && bit < x.lo + x.width);
  return (
    <figure className="figure" aria-label="Interactive diagram: one register as a whole number and as named bit fields">
      <style>{MEM_CSS}</style>
      <svg viewBox="0 0 400 112" role="img" aria-label={`A 16-bit register. Field ON holds ${v[0]}, MODE holds ${v[1]}, LEVEL holds ${v[2]}. Read as one number through .all it is ${all}, ${hex} in hex.`}>
        <text x="16" y="10" className="fig-label dim">one box of memory = 16 bits, numbered 15 down to 0</text>
        {/* field brackets */}
        {FIELDS.map((x, k) => {
          const x1 = BX(x.lo + x.width - 1) + 1;
          const x2 = BX(x.lo) + BW - 1;
          return (
            <g key={x.name}>
              <path d={`M${x1},40 v-6 H${x2} v6`} className="mem-brace" style={k === last ? { stroke: "var(--orange)", strokeWidth: 2 } : undefined} />
              <text x={(x1 + x2) / 2} y="30" textAnchor="middle" className="fig-label">{x.name}</text>
              <text x={(x1 + x2) / 2} y="20" textAnchor="middle" className="fig-value small">{v[k]}</text>
            </g>
          );
        })}
        <path d={`M${BX(15) + 1},40 v-6 H${BX(7) + BW - 1} v6`} className="mem-brace" style={{ strokeDasharray: "3 2" }} />
        <text x={(BX(15) + BX(7) + BW) / 2} y="30" textAnchor="middle" className="fig-label dim">not used (reserved)</text>
        {/* the 16 bits */}
        {Array.from({ length: 16 }, (_, i) => 15 - i).map((bit) => {
          const k = fieldOf(bit);
          const b = (all >> bit) & 1;
          return (
            <g key={bit}>
              <rect x={BX(bit) + 1} y="44" width={BW - 2} height="24" rx="2" className={`mem-cell ${k === last ? "hot" : k < 0 ? "unused" : ""}`} />
              <text x={BX(bit) + BW / 2} y="60" textAnchor="middle" className="fig-value" style={k < 0 ? { fill: "var(--dim)" } : undefined}>{b}</text>
              <text x={BX(bit) + BW / 2} y="78" textAnchor="middle" className="mem-addr">{bit}</text>
            </g>
          );
        })}
        <path d={`M${BX(15) + 1},84 v6 H${BX(0) + BW - 1} v-6`} className="mem-brace" />
        <text x="200" y="106" textAnchor="middle" className="fig-label">
          .all: the same 16 bits read as one number = <tspan className="fig-value">{all}</tspan> ({hex})
        </text>
      </svg>
      <code className="mem-out">LampRegs.CTRL.bit.{f.name} = {v[last]};     // now LampRegs.CTRL.all is {all}</code>
      <p className="fig-why" role="status">
        Writing .bit.{f.name} changed only bit{f.width > 1 ? `s ${f.lo + f.width - 1} to ${f.lo}` : ` ${f.lo}`} of the box. The other fields kept their values. .all is not a second box: it is the same 16 bits read as a single number, so it changed too. How the bits add up to that number is the subject of chapter 0.
      </p>
      <div className="fig-controls">
        <div>
          <span>.bit.ON</span>
          {[0, 1].map((x) => (
            <button key={x} className="fig-opt" aria-pressed={v[0] === x} onClick={() => set(0, x)}>{x}</button>
          ))}
          <code>1 bit: 0 or 1</code>
        </div>
        <div>
          <span>.bit.MODE</span>
          {[0, 1, 2, 3].map((x) => (
            <button key={x} className="fig-opt" aria-pressed={v[1] === x} onClick={() => set(1, x)}>{x}</button>
          ))}
          <code>2 bits: 0 to 3</code>
        </div>
        <div>
          <span>.bit.LEVEL</span>
          {[0, 5, 10, 15].map((x) => (
            <button key={x} className="fig-opt" aria-pressed={v[2] === x} onClick={() => set(2, x)}>{x}</button>
          ))}
          <code>4 bits: 0 to 15</code>
        </div>
      </div>
      <figcaption>A union lets two descriptions share the same memory. Here the box can be used as a whole (.all) or one named field at a time (.bit). Orange marks the field written last.</figcaption>
    </figure>
  );
}

export const figure = { id: "mem-union", Component: MemUnion };
