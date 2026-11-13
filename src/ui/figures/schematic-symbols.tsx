import { useState, type ReactNode } from "react";

// The schematic symbols the game uses (primer A). The resistor is shown in
// both common drawings: the box (IEC style, used in this game's figures and
// wiring puzzles) and the zigzag (ANSI style, used in most US datasheets
// and in the course's lab handouts).

interface Sym {
  id: string;
  name: string;
  why: string;
  draw: ReactNode;
}

const SYMS: Sym[] = [
  {
    id: "battery",
    name: "Battery",
    why: "A battery: a source of voltage. The long line is the + end and the short line is the - end. It pushes current out of + and takes it back in at -.",
    draw: (
      <>
        <path d="M30,4 V16 M30,28 V40" />
        <path d="M16,16 H44" />
        <path d="M23,28 H37" strokeWidth="3.4" />
        <text x="50" y="18">+</text>
      </>
    ),
  },
  {
    id: "supply",
    name: "Supply, 3.3 V",
    why: "A supply label: this point is connected to the power supply, here 3.3 V. Schematics use it so they do not have to draw a wire all the way back to the battery every time.",
    draw: (
      <>
        <path d="M18,16 H42 M30,16 V40" />
        <text x="30" y="11" textAnchor="middle">3.3 V</text>
      </>
    ),
  },
  {
    id: "ground",
    name: "Ground",
    why: "Ground: the point called 0 V. Every ground symbol on a schematic is the same point, joined together even though no wire is drawn between them. It is the way back to the supply's - end.",
    draw: <path d="M30,4 V22 M16,22 H44 M21,28 H39 M26,34 H34" />,
  },
  {
    id: "resistor",
    name: "Resistor",
    why: "A resistor: it limits current. It has two drawings that mean exactly the same part, a box or a zigzag. This game draws the box. A resistor has no direction: it works the same either way round.",
    draw: (
      <>
        <path d="M17,2 V10 M17,34 V42 M43,2 V10 M43,34 V42" />
        <rect x="12" y="10" width="10" height="24" fill="none" />
        <path d="M43,10 l5,2 l-10,4 l10,4 l-10,4 l10,4 l-10,4 l5,2" fill="none" />
      </>
    ),
  },
  {
    id: "led",
    name: "LED",
    why: "An LED (light-emitting diode): it lights when current flows through it, and current can only flow the way the triangle points, towards the bar. The two small arrows are the light coming out.",
    draw: (
      <>
        <path d="M26,2 V14 M26,30 V42" />
        <path d="M16,14 H36 L26,30 Z" fill="none" />
        <path d="M16,30 H36" />
        <path d="M40,18 l8,-6 m-4,0 h4 v4 M40,28 l8,-6 m-4,0 h4 v4" fill="none" strokeWidth="1.4" />
      </>
    ),
  },
  {
    id: "switch",
    name: "Switch",
    why: "A switch: a gap you can close. Drawn open, as here, no current can pass. Flip it and the lever joins the two dots: the gap becomes a wire. It stays where you put it.",
    draw: (
      <>
        <path d="M4,28 H18 M42,28 H56" />
        <circle cx="20" cy="28" r="2.4" />
        <circle cx="40" cy="28" r="2.4" />
        <path d="M21,27 L39,14" />
      </>
    ),
  },
  {
    id: "button",
    name: "Push button",
    why: "A push button: a switch that is closed only while your finger presses it. The bar is pushed down onto the two dots. Let go and it springs back open.",
    draw: (
      <>
        <path d="M4,30 H18 M42,30 H56" />
        <circle cx="20" cy="30" r="2.4" />
        <circle cx="40" cy="30" r="2.4" />
        <path d="M16,20 H44 M30,20 V8" />
      </>
    ),
  },
  {
    id: "junction",
    name: "Wires joined",
    why: "A dot where lines meet: the wires are joined. Everything joined by wire is one electrical point, at one voltage.",
    draw: (
      <>
        <path d="M6,22 H54 M30,4 V40" />
        <circle cx="30" cy="22" r="3.6" />
      </>
    ),
  },
  {
    id: "crossing",
    name: "Wires crossing",
    why: "Lines that cross with no dot: the wires pass over each other and are NOT connected. Always look for the dot.",
    draw: <path d="M6,22 H54 M30,4 V40" />,
  },
];

const CSS = `
.ss-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(5.6rem, 1fr)); gap: 0.4rem; }
.ss-tile { display: flex; flex-direction: column; align-items: center; gap: 0.15rem; padding: 0.35rem 0.2rem 0.3rem; background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--radius); color: var(--text); font-size: 0.8rem; line-height: 1.2; }
.ss-tile[aria-pressed="true"] { border-color: var(--orange); background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--orange); font-weight: 700; }
.ss-tile svg { width: 3.6rem; height: 2.7rem; display: block; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.ss-tile svg circle { fill: currentColor; stroke: none; }
.ss-tile svg text { fill: currentColor; stroke: none; font-size: 9.5px; font-family: var(--sans); }
`;

function SchematicSymbols() {
  const [sel, setSel] = useState("battery");
  const cur = SYMS.find((s) => s.id === sel)!;
  return (
    <figure className="figure" aria-label="Interactive chart of schematic symbols">
      <style>{CSS}</style>
      <div className="ss-grid">
        {SYMS.map((s) => (
          <button key={s.id} className="ss-tile" aria-pressed={s.id === sel} onClick={() => setSel(s.id)}>
            <svg viewBox="0 0 60 44" aria-hidden="true">{s.draw}</svg>
            {s.name}
          </button>
        ))}
      </div>
      <p className="fig-why" role="status"><strong>{cur.name}.</strong> {cur.why}</p>
      <figcaption>A schematic is a drawing of what is connected to what, not of where the parts sit. Select each symbol to see what it stands for.</figcaption>
    </figure>
  );
}

export const figure = { id: "schematic-symbols", Component: SchematicSymbols };
