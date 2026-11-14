import { useState } from "react";

// One or two characters on the SCI's TX line. TRM 19.6 "SCI Programmable
// Data Format" and 19.10 "SCI Communication Format" (Figure 19-7): the line
// idles high, one start bit (0), the data bits least significant bit first,
// one stop bit (1). The course uses 8 data bits, no parity, 1 stop bit, so a
// character is 10 bit times of 1 / baud each (TRM 19.12 for the baud rate).

const BAUDS = [9600, 19200, 57600, 115200];
const hex = (v: number) => `0x${v.toString(16).toUpperCase().padStart(2, "0")}`;
const bin = (v: number) => `${v.toString(2).padStart(8, "0").slice(0, 4)} ${v.toString(2).padStart(8, "0").slice(4)}`;
const show = (c: string) => (c === " " ? "' ' (space)" : `'${c}'`);
const us = (s: number) => {
  const v = s * 1e6;
  return v >= 1000 ? `${+(v / 1000).toPrecision(4)} ms` : `${+v.toPrecision(3)} µs`;
};

interface Cell {
  v: 0 | 1;
  name: string;
  kind: "idle" | "start" | "data" | "stop";
}

function UartFrame() {
  const [text, setText] = useState("A");
  const [baud, setBaud] = useState(115200);
  const chars = [...text].slice(0, 2);
  const codes = chars.map((c) => c.charCodeAt(0) & 0xff);
  const wide = chars.some((c) => c.charCodeAt(0) > 0xff);
  const n = codes.length;

  const cells: Cell[] = [{ v: 1, name: "idle", kind: "idle" }];
  for (const code of codes) {
    cells.push({ v: 0, name: "start", kind: "start" });
    for (let i = 0; i < 8; i++) cells.push({ v: ((code >> i) & 1) as 0 | 1, name: `b${i}`, kind: "data" });
    cells.push({ v: 1, name: "stop", kind: "stop" });
  }
  cells.push({ v: 1, name: "idle", kind: "idle" });

  const X0 = 26;
  const X1 = 416;
  const cw = (X1 - X0) / cells.length;
  const small = cw < 26;
  const x = (i: number) => X0 + i * cw;
  const HI = 76;
  const LO = 100;
  const bit = 1 / baud;

  const sent = codes.map((c) => Array.from({ length: 8 }, (_, i) => (c >> i) & 1).join(""));
  const why =
    n === 0
      ? "Type a character. While nothing is sent the line simply stays high."
      : `${show(chars[0])} is ${hex(codes[0])}, written ${bin(codes[0])} with bit 7 on the left. The line rests high, the start bit pulls it low, then bit 0 goes first: on an oscilloscope the data bits appear as ${sent[0]}, the written number in reverse order. The stop bit puts the line back high.` +
        (n === 2 ? ` ${show(chars[1])} (${hex(codes[1])}) follows immediately: the stop bit of the first character is the only high time before the next start bit.` : "");

  return (
    <figure className="figure uf-fig" aria-label="Interactive diagram of a serial frame on the TX line">
      <style>{`
        .uf-fig .uf-in { width: 3.2em; font: inherit; font-family: var(--mono); font-size: 1.1rem; text-align: center; background: var(--inset); color: var(--text); border: 1px solid var(--border-strong, var(--dim)); border-radius: 4px; padding: 0.05em 0.2em; }
        .uf-fig .uf-start { fill: var(--arches); opacity: 0.16; }
        .uf-fig .uf-stop { fill: var(--orange); opacity: 0.16; }
        .uf-fig .uf-fan { stroke: var(--harvest); stroke-width: 0.8; opacity: 0.75; fill: none; }
        .uf-fig .uf-nums { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.4rem; margin: 0.5rem 0; }
        .uf-fig .uf-nums div { background: var(--surface); border-radius: 6px; padding: 0.3rem 0.5rem; font-size: 0.8rem; color: var(--dim); }
        .uf-fig .uf-nums b { display: block; font-family: var(--mono); font-size: 1rem; color: var(--text); }
        @media (max-width: 420px) { .uf-fig .uf-nums { grid-template-columns: 1fr; } }
      `}</style>
      <svg viewBox="0 0 420 142" role="img" aria-label={n ? `TX line: idle high, ${codes.map((c, k) => `start bit low, data bits ${sent[k].split("").join(" ")} (bit 0 first, character ${hex(c)}), stop bit high`).join(", then ")}, idle high. One bit lasts ${us(bit)}.` : "TX line idle high."}>
        {codes.map((code, k) => {
          const first = 2 + k * 10; // index of the b0 cell
          return (
            <g key={k}>
              <text x={x(first) + 4 * cw} y={10} textAnchor="middle" className="fig-label">
                {show(chars[k])} = <tspan className="fig-value small">{hex(code)}</tspan> = {code}, written:
              </text>
              {Array.from({ length: 8 }, (_, j) => {
                const b = 7 - j; // written order: bit 7 on the left
                const bx = x(first + j);
                return (
                  <g key={j}>
                    <rect x={bx + 1} y={15} width={cw - 2} height={15} rx={2} className="fig-box" />
                    <text x={bx + cw / 2} y={26} textAnchor="middle" className="fig-value small">{(code >> b) & 1}</text>
                    <text x={bx + cw / 2} y={39} textAnchor="middle" className="fig-label dim">{small ? b : `b${b}`}</text>
                    <path d={`M${bx + cw / 2},42 L${x(first + b) + cw / 2},${HI - 8}`} className="uf-fan" />
                  </g>
                );
              })}
            </g>
          );
        })}
        <text x={4} y={HI + 3} className="fig-label">1</text>
        <text x={4} y={LO + 3} className="fig-label">0</text>
        <text x={12} y={HI + 15} className="fig-label dim">TX</text>
        {cells.map((c, i) => (
          <g key={i}>
            {c.kind === "start" && <rect x={x(i)} y={HI - 5} width={cw} height={LO - HI + 10} className="uf-start" />}
            {c.kind === "stop" && <rect x={x(i)} y={HI - 5} width={cw} height={LO - HI + 10} className="uf-stop" />}
            {i > 0 && <line x1={x(i)} x2={x(i)} y1={HI - 5} y2={LO + 5} stroke="var(--dim)" strokeWidth={0.5} strokeDasharray="1.5 2" />}
            <line x1={x(i)} x2={x(i + 1)} y1={c.v ? HI : LO} y2={c.v ? HI : LO} stroke={c.v ? "var(--orange)" : "var(--arches)"} strokeWidth={2.2} />
            {i > 0 && cells[i - 1].v !== c.v && <line x1={x(i)} x2={x(i)} y1={HI} y2={LO} stroke="var(--dim)" strokeWidth={1.4} />}
            {c.kind !== "idle" && <text x={x(i) + cw / 2} y={c.v ? HI + 14 : LO - 6} textAnchor="middle" className="fig-value small">{c.v}</text>}
            <text x={x(i) + cw / 2} y={LO + 16} textAnchor="middle" className={`fig-label ${c.kind === "data" ? "" : "dim"}`}>
              {c.kind === "data" ? (small ? c.name[1] : c.name) : c.kind === "idle" ? (small ? "" : "idle") : small ? (c.kind === "start" ? "S" : "P") : c.name}
            </text>
          </g>
        ))}
        {n > 0 && (
          <g>
            <path d={`M${x(1)},${LO + 21} v4 H${x(11)} v-4`} className="fig-wire" />
            <text x={(x(1) + x(11)) / 2} y={LO + 33} textAnchor="middle" className="fig-label dim">
              one character = 10 bits = {us(10 * bit)}
            </text>
          </g>
        )}
      </svg>
      <div className="uf-nums">
        <div>One bit<b>{us(bit)}</b>1 / {baud} s</div>
        <div>{n === 2 ? "Both characters" : "One character"}<b>{us(Math.max(1, n) * 10 * bit)}</b>{Math.max(1, n) * 10} bits on the wire</div>
        <div>At most<b>{Math.floor(baud / 10)}</b>characters per second</div>
      </div>
      <p className="fig-why" role="status">
        {why}
        {wide ? " (This character is not ASCII; only its low 8 bits are shown.)" : ""}
      </p>
      <div className="fig-controls">
        <div>
          <span id="uf-c">Send</span>
          <input className="uf-in" type="text" maxLength={2} value={text} aria-labelledby="uf-c" aria-describedby="uf-h" onChange={(e) => setText(e.target.value)} />
          {["A", "a", "0", "U", "Hi"].map((t) => (
            <button key={t} className="fig-opt" aria-pressed={text === t} aria-label={`send ${t}`} onClick={() => setText(t)}>{t}</button>
          ))}
          <code id="uf-h">{n ? `serial_printf(&SerialA, "${text.replace(/["\\]/g, "\\$&").replace(/%/g, "%%")}");` : "one or two characters"}</code>
        </div>
        <div>
          <span>Baud rate</span>
          {BAUDS.map((b) => (
            <button key={b} className="fig-opt" aria-pressed={baud === b} onClick={() => setBaud(b)}>{b}</button>
          ))}
        </div>
      </div>
      <figcaption>
        Blue is low (0 V), orange is high (3.3 V). {small ? "S is the start bit, P the stop bit, 0 to 7 the data bits. " : ""}The thin lines join each written bit to its place on the wire. They cross because bit 0 is sent first.
      </figcaption>
    </figure>
  );
}

export const figure = {
  id: "uart-frame",
  title: "Serial (UART) frame",
  description: "Type one or two characters to see the start bit, the eight data bits and the stop bit they become on the TX line.",
  Component: UartFrame,
};
