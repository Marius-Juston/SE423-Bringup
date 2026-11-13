import { useState } from "react";
import { Cells, Code, MEM_CSS, Pointer, StepButtons, cellMid, type Cell } from "./mem-shared";

// A pointer is a variable whose value is the address of another variable.
// &x gives the address of x, *p is the box that p points to. On the F28379D
// a pointer is 32 bits wide, so it takes two boxes (TMS320C28x compiler
// guide, data types); the addresses themselves are made up.

const LINES = [
  "int x = 5;",
  "int y = 8;",
  "int *p;         // p can hold the address of an int",
  "p = &x;         // store the address of x in p",
  "y = *p;         // read the box p points to",
  "*p = 9;         // write to the box p points to",
  "p = &y;         // point somewhere else",
  "*p = *p + 1;    // the same line now changes y",
];

interface State { x: number | null; y: number | null; p: "none" | "unset" | "x" | "y"; hot: string; why: string }

const STATES: State[] = [
  { x: null, y: null, p: "none", hot: "", why: "Nothing has run yet. Step through the program and watch the arrow." },
  { x: 5, y: null, p: "none", hot: "x", why: "x is the box at address 0x0100. It holds 5." },
  { x: 5, y: 8, p: "none", hot: "y", why: "y is the box at address 0x0101. It holds 8." },
  { x: 5, y: 8, p: "unset", hot: "p", why: "p is a variable too, with boxes of its own. The * in its declaration says: the value kept here is the address of an int. Nothing has been stored yet, so p points nowhere useful. Using *p now would be a bug." },
  { x: 5, y: 8, p: "x", hot: "p", why: "&x means \"the address of x\", which is 0x0100. That number is now the value of p. The arrow is only a picture of it: p points to x." },
  { x: 5, y: 5, p: "x", hot: "y", why: "*p means \"the box p points to\". p holds 0x0100, so *p is the box of x. Its value, 5, is copied into y." },
  { x: 9, y: 5, p: "x", hot: "x", why: "*p on the left of = writes to the box p points to. x changed to 9, and the name x does not appear in this line at all. p itself still holds 0x0100." },
  { x: 9, y: 5, p: "y", hot: "p", why: "p is an ordinary variable: it can be given a new value. It now holds 0x0101, the address of y." },
  { x: 9, y: 6, p: "y", hot: "y", why: "The same kind of line as before, but p points to y now: read y (5), add 1, store 6 in y. x is untouched. Which box *p means depends on what p holds at that moment." },
];

function MemPointer() {
  const [at, setAt] = useState(0);
  const s = STATES[at];
  const cells: Cell[] = [
    { addr: 0x0100, name: s.x === null ? undefined : "x", value: s.x === null ? "free" : String(s.x), state: s.x === null ? "unused" : s.hot === "x" ? "hot" : undefined },
    { addr: 0x0101, name: s.y === null ? undefined : "y", value: s.y === null ? "free" : String(s.y), state: s.y === null ? "unused" : s.hot === "y" ? "hot" : undefined },
    ...(s.p === "none"
      ? [2, 3].map((k): Cell => ({ addr: 0x0100 + k, value: "free", state: "unused" }))
      : [{ addr: 0x0102, words: 2, name: "p (a pointer: 2 boxes)", value: s.p === "unset" ? "not set yet" : s.p === "x" ? "0x0100" : "0x0101", small: s.p === "unset", state: s.hot === "p" ? "hot" : undefined } satisfies Cell]),
    ...[4, 5, 6, 7].map((k): Cell => ({ addr: 0x0100 + k, value: "free", state: "unused" })),
  ];
  const target = s.p === "x" ? 0 : s.p === "y" ? 1 : -1;
  const said = `${s.x === null ? "" : `x at 0x0100 holds ${s.x}. `}${s.y === null ? "" : `y at 0x0101 holds ${s.y}. `}${s.p === "none" ? "" : s.p === "unset" ? "p at 0x0102 has no value yet." : `p at 0x0102 holds ${s.p === "x" ? "0x0100" : "0x0101"}: it points to ${s.p}.`}`;
  return (
    <figure className="figure" aria-label="Interactive diagram: a pointer holds the address of another variable">
      <style>{MEM_CSS}</style>
      <svg viewBox="0 0 400 112" role="img" aria-label={`Memory boxes from 0x0100. ${said || "No variable exists yet."}`}>
        <text x="8" y="9" className="fig-label dim">address of each box</text>
        <Cells cells={cells} />
        {target >= 0 && <Pointer fromX={cellMid(2, 2)} toX={cellMid(target)} />}
        {target >= 0 && (
          <text x={cellMid(2, 2) + 10} y="106" className="fig-label">
            p holds the address of {s.p}, so *p is {s.p}
          </text>
        )}
      </svg>
      <Code lines={LINES} at={at} />
      <p className="fig-why" role="status">{s.why}</p>
      <StepButtons at={at} total={LINES.length} setAt={setAt} />
      <figcaption>The value in p's boxes is an address. The orange arrow leads from p to the box with that address. &amp;x is "where x lives"; *p is "the box p points to".</figcaption>
    </figure>
  );
}

export const figure = {
  id: "mem-pointer",
  title: "Pointers",
  description: "Run a short program line by line and follow the arrow from a pointer to the box whose address it holds.",
  Component: MemPointer,
};
