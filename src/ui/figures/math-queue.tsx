import { useState } from "react";

// Maths you need (chapter 19): a queue, first in first out, made from an
// array and two indexes, exactly as the level "Breadth-first search" uses it:
//   queue[tail] = x; tail++;      add at the back
//   x = queue[head]; head++;      take the oldest from the front
//   head == tail                  the queue is empty
// Nothing is ever moved or erased: taken elements stay in the array, behind head.

const SIZE = 8;
const NAMES = ["A", "B", "C", "D", "E", "F", "G", "H"];

type Last = { op: "add"; who: string } | { op: "take"; who: string } | { op: "empty" } | { op: "full" } | null;

function MathQueue() {
  const [head, setHead] = useState(0);
  const [tail, setTail] = useState(2);
  const [last, setLast] = useState<Last>(null);

  const add = () => {
    if (tail >= SIZE) return setLast({ op: "full" });
    setLast({ op: "add", who: NAMES[tail] });
    setTail(tail + 1);
  };
  const take = () => {
    if (head === tail) return setLast({ op: "empty" });
    setLast({ op: "take", who: NAMES[head] });
    setHead(head + 1);
  };
  const reset = () => {
    setHead(0);
    setTail(2);
    setLast(null);
  };

  const waiting = NAMES.slice(head, tail);
  const state = waiting.length === 0 ? "The queue is empty: head == tail." : `Waiting, oldest first: ${waiting.join(", ")}. The next one out is ${waiting[0]}.`;
  const status =
    last === null
      ? `A and B were added, in that order. ${state} Add more, then take: they always come out in the order they went in.`
      : last.op === "add"
        ? `${last.who} was written at the back, in queue[${tail - 1}], and tail moved on to ${tail}. ${state}`
        : last.op === "take"
          ? `${last.who} was read from the front, queue[${head - 1}], and head moved on to ${head}. It was the one that had waited longest. ${state}`
          : last.op === "empty"
            ? "Nothing to take: head == tail, the queue is empty. A search that finds its queue empty has run out of cells to look at."
            : `The array is full: tail has reached ${SIZE}. In the search every cell is added at most once, so an array with one element per cell is always long enough.`;

  const X0 = 22;
  const W = 46;
  const xOf = (i: number) => X0 + i * W;

  return (
    <figure className="figure" aria-label="A queue made from an array, a head index and a tail index">
      <style>{`
        .mque-slot { fill: var(--surface); stroke: var(--dim); stroke-width: 1; }
        .mque-slot.wait { fill: var(--accent-soft); stroke: var(--orange); stroke-width: 2; }
        .mque-slot.done { stroke-dasharray: 3 2; }
        .mque-head { fill: var(--arches); }
        .mque-tail { fill: var(--orange); }
        .mque-name { font-family: var(--mono); font-size: 13px; font-weight: 700; fill: var(--text); }
        .mque-name.done { fill: var(--dim); font-weight: 400; }
        .mque-svg .fig-label { font-size: 10.5px; }
      `}</style>
      <svg className="mque-svg" viewBox="0 0 412 118" role="img" aria-label={`head is ${head}, tail is ${tail}. ${state}`}>
        {NAMES.map((n, i) => {
          const kind = i < head ? "done" : i < tail ? "wait" : "";
          return (
            <g key={n}>
              <rect x={xOf(i)} y="38" width={W - 4} height="34" rx="3" className={`mque-slot ${kind}`} />
              {i < tail && <text x={xOf(i) + (W - 4) / 2} y="60" textAnchor="middle" className={`mque-name ${kind}`}>{n}</text>}
              <text x={xOf(i) + (W - 4) / 2} y="84" textAnchor="middle" className="fig-label dim">[{i}]</text>
              {i < head && <text x={xOf(i) + (W - 4) / 2} y="33" textAnchor="middle" className="fig-label dim">taken</text>}
            </g>
          );
        })}
        {/* head arrow: from above */}
        <g transform={`translate(${Math.min(xOf(head), xOf(SIZE - 1) + W) + (head < SIZE ? (W - 4) / 2 : -2)} 0)`}>
          <text x="0" y="10" textAnchor={head === 0 ? "start" : head >= SIZE - 1 ? "end" : "middle"} dx={head === 0 ? -12 : 0} className="fig-label">head = {head}</text>
          <polygon points="-5,14 5,14 0,24" className="mque-head" />
        </g>
        {/* tail arrow: from below */}
        <g transform={`translate(${tail < SIZE ? xOf(tail) + (W - 4) / 2 : xOf(SIZE - 1) + W - 6} 0)`}>
          <polygon points="-5,100 5,100 0,90" className="mque-tail" />
          <text x="0" y="112" textAnchor={tail >= SIZE - 1 ? "end" : tail === 0 ? "start" : "middle"} className="fig-label">tail = {tail}{tail >= SIZE ? " (full)" : ""}</text>
        </g>
      </svg>
      <p className="fig-why" role="status">{status}</p>
      <div className="fig-controls">
        <div><span>Back</span><button className="fig-opt" onClick={add}>Add {tail < SIZE ? NAMES[tail] : "one more"}</button><code>queue[tail] = cell;  tail++;</code></div>
        <div><span>Front</span><button className="fig-opt" onClick={take}>Take the oldest</button><code>cell = queue[head];  head++;</code></div>
        <div><span>Empty?</span><code>head == tail  is {head === tail ? "true" : "false"}  ({head} == {tail})</code><button className="btn small" onClick={reset}>Reset</button></div>
      </div>
      <figcaption>A queue is a waiting line: first in, first out. The array holds the line. head (blue arrow) points at the oldest waiting element, tail (orange arrow) at the first free slot. Orange boxes are waiting, dashed ones were already taken.</figcaption>
    </figure>
  );
}

export const figure = { id: "math-queue", Component: MathQueue };
