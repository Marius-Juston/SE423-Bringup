import { useState } from "react";
import { Cells, Code, MEM_CSS, StepButtons, hex4, type Cell } from "./mem-shared";

// Memory as a row of numbered boxes: every variable is one box (or two) with
// an address. One 16-bit word per box, the unit the F28379D's CPU addresses
// (TRM 3.6.1 counts register offsets in the same 16-bit words). The
// addresses are made up; real variables of this chip sit higher in memory.

const LINES = ["int count = 3;", "int speed = 20;", "count = count + 1;", "speed = count * 5;"];

const WHY = [
  "Nothing has run yet. Memory is a long row of boxes. Each box has a number, its address, and holds one value. The dashed boxes are not used by this program.",
  "The compiler picks a free box for count, here the one at address 0x0100, and stores 3 in it. From now on the name count means this box.",
  "speed gets the next free box, 0x0101, and the value 20.",
  "Read the box of count (3), add 1, store the result back in the same box. The address did not change, only the value in it.",
  "Read the box of count (4), multiply by 5, store 20 in the box of speed. A variable is a box: reading looks into it, assigning replaces what is in it.",
];

function MemCells() {
  const [at, setAt] = useState(0);
  const count = at >= 3 ? 4 : at >= 1 ? 3 : null;
  const speed = at >= 2 ? 20 : null;
  const hot = at === 1 || at === 3 ? 0 : at === 2 || at === 4 ? 1 : -1;
  const cells: Cell[] = [
    { addr: 0x0100, name: count === null ? undefined : "count", value: count === null ? "free" : String(count), state: count === null ? "unused" : hot === 0 ? "hot" : undefined },
    { addr: 0x0101, name: speed === null ? undefined : "speed", value: speed === null ? "free" : String(speed), state: speed === null ? "unused" : hot === 1 ? "hot" : undefined },
    ...[2, 3, 4, 5, 6, 7].map((k): Cell => ({ addr: 0x0100 + k, value: "free", state: "unused" })),
  ];
  const said = `${count === null ? "No variable exists yet" : `count is the box at address ${hex4(0x0100)} and holds ${count}`}${speed === null ? "" : `, speed is the box at address ${hex4(0x0101)} and holds ${speed}`}.`;
  return (
    <figure className="figure" aria-label="Interactive diagram: variables are numbered boxes in memory">
      <style>{MEM_CSS}</style>
      <svg viewBox="0 0 400 84" role="img" aria-label={`Eight memory boxes at addresses 0x0100 to 0x0107. ${said}`}>
        <text x="8" y="9" className="fig-label dim">address of each box</text>
        <Cells cells={cells} />
      </svg>
      <Code lines={LINES} at={at} />
      <p className="fig-why" role="status">{WHY[at]}</p>
      <StepButtons at={at} total={LINES.length} setAt={setAt} />
      <figcaption>Memory is a row of numbered boxes. A variable's name stands for one box; its address is the number of that box. Orange marks the box the last line wrote to.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "mem-cells",
  title: "Memory as numbered boxes",
  description: "Run a short program line by line and watch each variable's value land in its own numbered box.",
  Component: MemCells,
};
