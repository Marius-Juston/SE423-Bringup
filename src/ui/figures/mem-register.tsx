import { useState } from "react";
import { CELL_H, CELL_Y, Cells, MEM_CSS, cellMid, cellX, type Cell } from "./mem-shared";

// The step from variables to hardware registers: a register is a memory box
// at a fixed address whose value the hardware also uses or changes, and a
// struct laid over that address gives each box a name. The lamp peripheral
// and its address 0x7000 are made up for the lesson. The real thing works
// the same way: GpioDataRegs is a struct at 0x7F00 (TRM 8.9, 3.6.1), and
// TI's headers declare it volatile because hardware changes it.

function MemRegister() {
  const [on, setOn] = useState(0);
  const [level, setLevel] = useState(2);
  const [presses, setPresses] = useState(0);
  const [n, setN] = useState<number | null>(null);
  const [last, setLast] = useState<"start" | "on" | "level" | "press" | "read">("start");
  const lit = on === 1;
  const cells: Cell[] = [
    { addr: 0x7000, name: "ON", value: String(on), state: last === "on" ? "hot" : undefined },
    { addr: 0x7001, name: "LEVEL", value: String(level), state: last === "level" ? "hot" : undefined },
    { addr: 0x7002, name: "PRESSES", value: String(presses), state: last === "press" || last === "read" ? "hot" : undefined },
  ];
  const why = {
    start: "Three boxes at a fixed address, 0x7000. They look like variables, but each one is wired to hardware. The struct LampRegs gives each box a name.",
    on: `The program stored ${on} in the box at 0x7000. The lamp's circuit watches that box, so the lamp is ${lit ? "on" : "off"}. To the program it was an ordinary assignment to a struct member.`,
    level: `The program stored ${level} in the box at 0x7001. The hardware uses that value as the brightness${lit ? "" : " (you will see it once ON is 1)"}.`,
    press: `No line of the program ran, and the box at 0x7002 changed anyway: the hardware counted a press. This is why register structs are declared volatile. The program must really read the box each time it wants the value.`,
    read: `The program read the box at 0x7002 and got ${n}. Its copy n will not follow the box: press the button again and compare.`,
  }[last];
  const y0 = CELL_Y + CELL_H;
  return (
    <figure className="figure" aria-label="Interactive diagram: a register is a memory box wired to hardware">
      <style>{MEM_CSS}</style>
      <svg viewBox="0 0 400 138" role="img" aria-label={`A made-up lamp peripheral with three registers at addresses 0x7000 to 0x7002. ON holds ${on}, LEVEL holds ${level}, PRESSES holds ${presses}. The lamp is ${lit ? `on at brightness ${level}` : "off"}.${n === null ? "" : ` The program's variable n holds ${n}.`}`}>
        <text x="8" y="9" className="fig-label dim">memory: LampRegs, a struct LAMP_REGS at address 0x7000</text>
        <Cells cells={cells} />
        {/* hardware side */}
        <rect x="196" y="16" width="198" height="116" rx="8" className="fig-chip" />
        <text x="204" y="28" className="fig-label dim">hardware (not memory)</text>
        {/* lamp, driven by ON and LEVEL */}
        <path d={`M${cellMid(0)},${y0} V118 H352 V84`} className="fig-wire" style={{ stroke: lit ? "var(--orange)" : undefined }} />
        <text x={cellMid(0) + 4} y="114" className="fig-label dim">on or off</text>
        <path d={`M${cellMid(1)},${y0} V100 H340 V83`} className="fig-wire" style={{ stroke: lit ? "var(--harvest)" : undefined }} />
        <text x={cellMid(1) + 4} y="96" className="fig-label dim">brightness</text>
        <circle cx="346" cy="68" r="16" className="fig-box" style={lit ? { fill: "var(--harvest)", fillOpacity: 0.25 + 0.25 * level, stroke: "var(--harvest)" } : { strokeDasharray: "3 2" }} />
        <text x="346" y="46" textAnchor="middle" className="fig-label">{lit ? `lamp: on, level ${level}` : "lamp: off"}</text>
        {/* button, counted into PRESSES */}
        <rect x="210" y="42" width="60" height="20" rx="4" className="fig-box" />
        <text x="240" y="55" textAnchor="middle" className="fig-label">push button</text>
        <path d={`M210,52 H${cellX(3) + 8}`} className="fig-wire" style={{ stroke: last === "press" ? "var(--orange)" : undefined }} />
        <polygon points={`${cellX(3) + 9},47 ${cellX(3) + 9},57 ${cellX(3)},52`} className="fig-arrowhead" style={{ fill: last === "press" ? "var(--orange)" : undefined }} />
        <text x={cellX(3) + 12} y="46" className="fig-label dim">counts</text>
      </svg>
      <code className="mem-out">int n = {n === null ? "?" : n};     // the program's own variable</code>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Program</span>
          <button className="fig-opt" aria-pressed={on === 0} onClick={() => { setOn(0); setLast("on"); }}>0</button>
          <button className="fig-opt" aria-pressed={on === 1} onClick={() => { setOn(1); setLast("on"); }}>1</button>
          <code>LampRegs.ON = {on};</code>
        </div>
        <div>
          <span>Program</span>
          {[1, 2, 3].map((k) => (
            <button key={k} className="fig-opt" aria-pressed={level === k} onClick={() => { setLevel(k); setLast("level"); }}>{k}</button>
          ))}
          <code>LampRegs.LEVEL = {level};</code>
        </div>
        <div>
          <span>Program</span>
          <button className="fig-opt" onClick={() => { setN(presses); setLast("read"); }}>read it</button>
          <code>n = LampRegs.PRESSES;</code>
        </div>
        <div>
          <span>Hardware</span>
          <button className="fig-opt" onClick={() => { setPresses(presses + 1); setLast("press"); }}>Press the push button</button>
        </div>
      </div>
      <figcaption>A made-up peripheral. Its registers are memory boxes at a fixed address. The program writes ON and LEVEL and the hardware reacts; the hardware writes PRESSES and the program reads it. Real registers such as GpioDataRegs work the same way.</figcaption>
    </figure>
  );
}

export const figure = { id: "mem-register", Component: MemRegister };
