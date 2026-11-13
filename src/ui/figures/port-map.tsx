import { useState } from "react";

// GPIO number -> port letter and bit (TRM sections 8.1 and 8.9): GPIO0..168
// in ports A..F of 32 pins, port F holding only GPIO160..168. Port index =
// number / 32, bit = number % 32. GPxMUX1 covers bits 0..15 of a port,
// GPxMUX2 bits 16..31. Board pins from the course's robot board (Lab 1, 2).

const MARKS: Record<number, string> = {
  22: "LED1", 94: "LED2", 95: "LED3", 97: "LED4", 111: "LED5",
  157: "button 1", 158: "button 2", 159: "button 3", 160: "button 4",
  31: "LaunchPad blue LED", 34: "LaunchPad red LED",
};
const PRESETS: [string, number][] = [["LED1", 22], ["LED2", 94], ["LED3", 95], ["LED4", 97], ["LED5", 111], ["button 1", 157], ["button 2", 158], ["button 3", 159], ["button 4", 160]];
const LETTERS = "ABCDEF";
const MAX = 168;

const CSS = `
.pm-row { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
.pm-row label { color: var(--dim); font-size: 0.82rem; width: 4.6rem; }
.pm-row input[type="number"] { width: 4.2rem; font-family: var(--mono); font-size: 0.9rem; font-weight: 700; background: var(--inset); color: var(--harvest); border: 1px solid var(--dim); border-radius: 4px; padding: 0.1em 0.3em; }
.pm-row input[type="range"] { flex: 1; min-width: 8rem; accent-color: var(--orange); }
.pm-port { fill: var(--surface); stroke: var(--dim); stroke-width: 1; }
.pm-port.sel { stroke: var(--orange); stroke-width: 2; fill: var(--accent-soft); }
.pm-tick { stroke: var(--harvest); stroke-width: 1.6; }
.pm-cell { fill: var(--surface); stroke: var(--dim); stroke-width: 0.7; }
.pm-cell.none { fill: none; stroke-dasharray: 2 2; opacity: 0.6; }
.pm-cell.mark { fill: var(--harvest); stroke: var(--harvest); }
.pm-cell.sel { fill: var(--orange); stroke: var(--orange); }
.pm-code { display: block; margin: 0.4rem 0 0; padding: 0.4rem 0.5rem; background: var(--inset); border-radius: 6px; font-size: 0.7rem; white-space: pre-wrap; overflow-wrap: anywhere; }
`;

const PW = 60; // width of one port in the strip
const PX = (p: number) => 8 + p * 64.8;
const CW = 12; // width of one bit cell in the zoomed port
const CX = (bit: number) => 8 + (31 - bit) * CW;

function PortMap() {
  const [n, setN] = useState(40);
  const set = (v: number) => setN(Math.max(0, Math.min(MAX, Math.round(v) || 0)));
  const port = Math.floor(n / 32);
  const bit = n % 32;
  const L = LETTERS[port];
  const mux = bit < 16 ? 1 : 2;
  const mask = "0x" + (2 ** bit).toString(16).toUpperCase().padStart(8, "0");
  const mark = MARKS[n];
  const lines = [
    [`GpioDataRegs.GP${L}SET.bit.GPIO${n} = 1;`, "high"],
    [`GpioDataRegs.GP${L}CLEAR.bit.GPIO${n} = 1;`, "low"],
    [`GpioDataRegs.GP${L}TOGGLE.bit.GPIO${n} = 1;`, "flip"],
    [`GpioDataRegs.GP${L}DAT.bit.GPIO${n}`, "read"],
    [`GpioCtrlRegs.GP${L}DIR.bit.GPIO${n}`, "direction"],
    [`GpioCtrlRegs.GP${L}MUX${mux}.bit.GPIO${n}`, "mux"],
  ];
  const sx = PX(port) + ((bit + 0.5) / 32) * PW; // selected pin on the strip
  const why = `GPIO${n}${mark ? ` (${mark})` : ""}: ${n} / 32 = ${port} remainder ${bit}. Whole part ${port} is port ${L} (A is 0, B is 1, and so on); the remainder is the bit inside that port's 32-bit registers, so its mask is ${mask}.${port === 5 ? " Port F is short: it only has GPIO160 to GPIO168." : ""}${n === 159 || n === 160 ? " Buttons 3 and 4 are neighbours on the board but sit in different ports, so they are read from different registers." : ""}`;
  return (
    <figure className="figure" aria-label="Interactive map from a GPIO number to its port, bit and registers">
      <style>{CSS}</style>
      <svg viewBox="0 0 400 174" role="img" aria-label={`GPIO${n}${mark ? `, ${mark},` : ""} is bit ${bit} of port ${L}, GPIO${port * 32} to GPIO${port === 5 ? 168 : port * 32 + 31}.`}>
        <text x="8" y="10" className="fig-label dim">All 169 pins, GPIO0 on the left. Marks: the robot board's LEDs and buttons.</text>
        {/* the six ports */}
        {Array.from(LETTERS, (c, p) => {
          const w = p === 5 ? (9 / 32) * PW : PW;
          return (
            <g key={c}>
              <rect x={PX(p)} y="22" width={w} height="18" rx="3" className={`pm-port ${p === port ? "sel" : ""}`} />
              {p === 5 && <rect x={PX(p) + w} y="22" width={PW - w} height="18" className="pm-cell none" />}
              <text x={PX(p) + PW / 2} y="53" textAnchor="middle" className="fig-label dim">
                <tspan className="fig-value">{c}</tspan> {p * 32} to {p === 5 ? 168 : p * 32 + 31}
              </text>
            </g>
          );
        })}
        {PRESETS.map(([name, g]) => {
          const x = PX(Math.floor(g / 32)) + (((g % 32) + 0.5) / 32) * PW;
          return <line key={name} x1={x} y1="23" x2={x} y2="39" className="pm-tick" />;
        })}
        <path d={`M${sx},23 L${sx - 4},13 L${sx + 4},13 Z`} style={{ fill: "var(--orange)" }} />
        {/* zoom lines from the selected port to its 32 bits */}
        <path d={`M${PX(port)},57 L8,84 M${PX(port) + PW},57 L392,84`} className="fig-wire" style={{ strokeDasharray: "3 2" }} />
        {/* the port's 32 bits, bit 31 on the left like a register */}
        {Array.from({ length: 32 }, (_, b) => {
          const g = port * 32 + b;
          const exists = g <= MAX;
          const cls = !exists ? "none" : b === bit ? "sel" : MARKS[g] && g !== 31 && g !== 34 ? "mark" : "";
          return <rect key={b} x={CX(b) + 0.8} y="86" width={CW - 1.6} height="18" rx="2" className={`pm-cell ${cls}`} />;
        })}
        {[31, 24, 16, 8, 0].map((b) => (Math.abs(b - bit) <= 1 ? null : <text key={b} x={CX(b) + CW / 2} y="116" textAnchor="middle" className="fig-label dim">{b}</text>))}
        <text x={CX(bit) + CW / 2} y="116" textAnchor="middle" className="fig-value small" style={{ fill: "var(--orange)" }}>{bit}</text>
        <text x="200" y="128" textAnchor="middle" className="fig-label dim">port {L}'s 32 bits, one per pin, bit 31 on the left as in every GP{L}... register</text>
        <text x="200" y="143" textAnchor="middle" className="fig-value small">{n} / 32 = {port} remainder {bit}</text>
        <text x="200" y="158" textAnchor="middle" className="fig-value">GPIO{n} = port {L}, bit {bit}</text>
        <text x="200" y="170" textAnchor="middle" className="fig-label">{mark ?? "no LED or button of the robot board"}</text>
      </svg>
      <code className="pm-code">
        {lines.map(([c, note]) => `${c}  // ${note}`).join("\n")}
      </code>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div className="pm-row">
          <label htmlFor="pm-n">GPIO</label>
          <input id="pm-n" type="number" min={0} max={MAX} value={n} onChange={(e) => set(+e.target.value)} />
          <input type="range" aria-label="GPIO number, slider" min={0} max={MAX} value={n} onChange={(e) => set(+e.target.value)} />
        </div>
        <div>
          <span>Robot board</span>
          {PRESETS.map(([name, g]) => (
            <button key={name} className="fig-opt" aria-pressed={n === g} onClick={() => setN(g)}>{name}</button>
          ))}
        </div>
      </div>
      <figcaption>Every GPIO pin is one bit of a 32-bit port. The port letter goes into every register name, and the pin keeps its GPIO number as the field name.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "port-map",
  title: "GPIO number to port and bit",
  description: "Choose a GPIO number and see which port and bit it is, and the register names that follow from it.",
  Component: PortMap,
};
