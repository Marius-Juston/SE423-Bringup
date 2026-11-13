import { useState } from "react";
import { Brace, CELL_H, CELL_Y, Cells, MEM_CSS, cellMid, cellX, hex4, type Cell } from "./mem-shared";

// A struct is one variable made of several named boxes in a row. A member is
// reached by its distance from the start of the struct: with '.' from the
// variable itself, with '->' from a pointer to it. Three int members take
// three 16-bit boxes on the F28379D; the pointer takes two (TMS320C28x
// compiler guide, data types). The addresses are made up.

const MEMBERS = ["speed", "turns", "on"] as const;
type Via = "left" | "right" | "p";

function MemStruct() {
  const [via, setVia] = useState<Via>("left");
  const [target, setTarget] = useState<"left" | "right">("right");
  const [m, setM] = useState(1);
  const [vals, setVals] = useState({ left: [20, 3, 1], right: [50, 7, 0] });
  const which = via === "p" ? target : via;
  const base = which === "left" ? 0x0100 : 0x0103;
  const cells: Cell[] = [
    ...(["left", "right"] as const).flatMap((v, vi) =>
      MEMBERS.map((name, k): Cell => ({ addr: 0x0100 + vi * 3 + k, name, value: String(vals[v][k]), state: v === which && k === m ? "hot" : undefined })),
    ),
    { addr: 0x0106, words: 2, name: "p (pointer)", value: hex4(target === "left" ? 0x0100 : 0x0103), state: undefined },
  ];
  const expr = via === "p" ? `p->${MEMBERS[m]}` : `${via}.${MEMBERS[m]}`;
  const store = () => setVals({ ...vals, [which]: vals[which].map((v, k) => (k === m ? v + 1 : v)) });
  const why =
    via === "p"
      ? `p holds ${hex4(base)}, the address of ${which}. p->${MEMBERS[m]} means: go to the struct p points to, then take its member ${MEMBERS[m]}, ${m} box${m === 1 ? "" : "es"} after its start: ${hex4(base)} + ${m} = ${hex4(base + m)}. Point p at the other motor and the same line works on that one.`
      : `${which} is one variable made of 3 boxes. ${which}.${MEMBERS[m]} is the member ${MEMBERS[m]}, ${m} box${m === 1 ? "" : "es"} after the start of ${which}: ${hex4(base)} + ${m} = ${hex4(base + m)}. It holds ${vals[which][m]}.`;
  const px = cellMid(6, 2);
  const tx = cellX(target === "left" ? 0 : 3) + 12;
  const y0 = CELL_Y + CELL_H;
  return (
    <figure className="figure" aria-label="Interactive diagram: a struct is several named boxes in one variable">
      <style>{MEM_CSS}</style>
      <svg viewBox="0 0 400 128" role="img" aria-label={`Two struct Motor variables. left at 0x0100 holds speed ${vals.left[0]}, turns ${vals.left[1]}, on ${vals.left[2]}. right at 0x0103 holds speed ${vals.right[0]}, turns ${vals.right[1]}, on ${vals.right[2]}. The pointer p holds the address of ${target}. Selected: ${expr}, the box at ${hex4(base + m)}.`}>
        <text x="8" y="9" className="fig-label dim">struct Motor {"{ int speed; int turns; int on; }"};</text>
        <Cells cells={cells} />
        <Brace slot={0} count={3} label="left: one struct Motor" />
        <Brace slot={3} count={3} label="right: one struct Motor" />
        <path d={`M${px},${y0} C${px},${y0 + 58} ${tx},${y0 + 64} ${tx},${y0 + 21}`} className="mem-arrow" style={via === "p" ? undefined : { opacity: 0.45 }} />
        <polygon points={`${tx - 5},${y0 + 23} ${tx + 5},${y0 + 23} ${tx},${y0 + 14}`} className="mem-arrow-head" style={via === "p" ? undefined : { opacity: 0.45 }} />
        <circle cx={px} cy={y0} r="2.5" className="mem-arrow-head" />
        <text x={px - 14} y={y0 + 22} textAnchor="end" className="fig-label dim">p = &amp;{target};</text>
      </svg>
      <code className="mem-out">{expr} = {expr} + 1;</code>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Reach it by</span>
          <button className="fig-opt" aria-pressed={via === "left"} onClick={() => setVia("left")}>left.</button>
          <button className="fig-opt" aria-pressed={via === "right"} onClick={() => setVia("right")}>right.</button>
          <button className="fig-opt" aria-pressed={via === "p"} onClick={() => setVia("p")}>p-&gt;</button>
        </div>
        <div>
          <span>Member</span>
          {MEMBERS.map((name, k) => (
            <button key={name} className="fig-opt" aria-pressed={m === k} onClick={() => setM(k)}>{name}</button>
          ))}
        </div>
        <div>
          <span>p points to</span>
          <button className="fig-opt" aria-pressed={target === "left"} onClick={() => setTarget("left")}>left</button>
          <button className="fig-opt" aria-pressed={target === "right"} onClick={() => setTarget("right")}>right</button>
          <button className="fig-opt" onClick={store}>Run the line</button>
        </div>
      </div>
      <figcaption>Two variables of the same struct type: the same three members, in the same order, in different boxes. A dot picks a member of a struct variable; an arrow (-&gt;) picks a member through a pointer.</figcaption>
    </figure>
  );
}

export const figure = { id: "mem-struct", Component: MemStruct };
