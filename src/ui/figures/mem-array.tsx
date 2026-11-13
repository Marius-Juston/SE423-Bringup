import { useState } from "react";
import { Brace, Cells, MEM_CSS, hex4, type Cell } from "./mem-shared";

// An array is a run of neighbouring boxes under one name. level[i] is the
// box i places after the first one, and C does not check that i is in range:
// level[4] of a four-element array is whatever sits behind the array. Here
// that is the next global variable, which is how the simulator (and usually
// the real linker) lays out globals declared one after the other.

const START = [10, 20, 30, 40];
const BASE = 0x0100;

function MemArray() {
  const [i, setI] = useState(2);
  const [level, setLevel] = useState(START);
  const [limit, setLimit] = useState(100);
  const out = i > 3;
  const store = () => {
    if (out) setLimit(0);
    else setLevel(level.map((v, k) => (k === i ? 0 : v)));
  };
  const reset = () => {
    setLevel(START);
    setLimit(100);
  };
  const cells: Cell[] = [
    ...level.map((v, k): Cell => ({ addr: BASE + k, name: `level[${k}]`, value: String(v), state: k === i ? "hot" : undefined })),
    { addr: BASE + 4, name: "limit", value: String(limit), state: out ? "bad" : undefined },
    { addr: BASE + 5, value: "free", state: "unused" },
    { addr: BASE + 6, value: "free", state: "unused" },
    { addr: BASE + 7, value: "free", state: "unused" },
  ];
  const why = out
    ? `level[4] does not exist: the array has 4 elements, numbered 0 to 3. C does not check. It goes 4 boxes past the start, to ${hex4(BASE + 4)}, and that box belongs to limit. Reading gives ${limit}, and storing there changes limit${limit === 0 ? " (it just happened)" : ""}. Nothing warns you.`
    : `level[${i}] is the box ${i} place${i === 1 ? "" : "s"} after the start of the array: ${hex4(BASE)} + ${i} = ${hex4(BASE + i)}. It holds ${level[i]}.${i === 0 ? " The first element has index 0, not 1." : i === 3 ? " This is the last element: 4 elements means indexes 0 to 3." : ""}`;
  return (
    <figure className="figure" aria-label="Interactive diagram: an array is a run of boxes, indexed from 0">
      <style>{MEM_CSS}</style>
      <svg viewBox="0 0 400 100" role="img" aria-label={`The array level holds ${level.join(", ")} at addresses 0x0100 to 0x0103. The variable limit at 0x0104 holds ${limit}. Selected: level[${i}]${out ? ", which is outside the array and lands on limit" : ""}.`}>
        <text x="8" y="9" className="fig-label dim">int level[4] = {"{10, 20, 30, 40}"};   int limit = 100;</text>
        <Cells cells={cells} />
        <Brace slot={0} count={4} label="the array level: 4 boxes, indexes 0 to 3" />
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Index i</span>
          {[0, 1, 2, 3, 4].map((k) => (
            <button key={k} className="fig-opt" aria-pressed={i === k} onClick={() => setI(k)}>
              {k}
            </button>
          ))}
        </div>
        <div>
          <span>Run</span>
          <button className="fig-opt" onClick={store}>store 0</button>
          <code>level[{i}] = 0;</code>
          <button className="fig-opt" onClick={reset}>Start again</button>
        </div>
      </div>
      <figcaption>One name, several boxes in a row. The index counts from 0. Orange is the selected element; red means the index left the array and hit another variable.</figcaption>
    </figure>
  );
}

export const figure = { id: "mem-array", Component: MemArray };
