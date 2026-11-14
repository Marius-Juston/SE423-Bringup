import { useState } from "react";
import { CodePre } from "../CopyButton";

// A ring buffer between one producer (the timer interrupt) and one consumer
// (main), lecture 13. The code shown is the reference solution of the levels
// "Producer and consumer" (a shared count, DINT/EINT around the consumer's
// critical section; TRM 3.4.3 for the interrupt mask INTM) and "A buffer
// without a lock" (no count, one slot always free) in chapter 20.

const BUF_SIZE = 8;

interface Ring {
  /** The array as it is in memory: taking a sample out does not erase it. */
  buf: number[];
  head: number;
  tail: number;
  count: number;
  /** The next sample the interrupt will produce. */
  v: number;
  dropped: number;
  got: number | null;
  last: "" | "put" | "full" | "get" | "empty";
  /** head, tail and count before the last call, for the code lines. */
  was: { head: number; tail: number; count: number; v: number };
}

const fresh = (): Ring => ({ buf: new Array<number>(BUF_SIZE).fill(0), head: 0, tail: 0, count: 0, v: 1, dropped: 0, got: null, last: "", was: { head: 0, tail: 0, count: 0, v: 1 } });

const next = (i: number) => (i + 1) % BUF_SIZE;

function put(r: Ring, lockFree: boolean): Ring {
  const was = { head: r.head, tail: r.tail, count: r.count, v: r.v };
  const full = lockFree ? next(r.head) === r.tail : r.count === BUF_SIZE;
  if (full) return { ...r, v: r.v + 1, dropped: r.dropped + 1, last: "full", was };
  const buf = r.buf.slice();
  buf[r.head] = r.v;
  return { ...r, buf, head: next(r.head), count: r.count + 1, v: r.v + 1, last: "put", was };
}

function get(r: Ring): Ring {
  const was = { head: r.head, tail: r.tail, count: r.count, v: r.v };
  if (r.count === 0) return { ...r, last: "empty", was };
  return { ...r, got: r.buf[r.tail], tail: next(r.tail), count: r.count - 1, last: "get", was };
}

// The text and the code keep the room of their longest state (four lines of text, six or seven in a narrow window, eleven lines of code), so pressing a button never moves what is below.
const CSS = `
.rb-step p { min-height: 4lh; }
@media (max-width: 520px) { .rb-step p { min-height: 6lh; } }
@media (max-width: 380px) { .rb-step p { min-height: 7lh; } }
.rb-step pre { min-height: 12.2lh; }
.rb-slot { fill: var(--surface); stroke: var(--dim); stroke-width: 1; stroke-dasharray: 3 3; }
.rb-slot.used { fill: var(--accent-soft, var(--surface)); stroke: var(--orange); stroke-width: 2; stroke-dasharray: none; }
.rb-head { fill: var(--orange); }
.rb-tail { fill: var(--arches); }
.rb-old { fill: var(--dim); font-size: max(9px, calc(9px / var(--fig-k, 1))); font-family: var(--mono); opacity: 0.8; text-decoration: line-through; }
.rb-badge { font-size: max(10px, calc(9px / var(--fig-k, 1))); font-weight: 700; font-family: var(--sans); fill: var(--text); }
.rb-row { stroke: var(--border); stroke-width: 1; }
`;

function RingBuffer() {
  const [lockFree, setLockFree] = useState(false);
  const [r, setR] = useState<Ring>(fresh);
  const capacity = lockFree ? BUF_SIZE - 1 : BUF_SIZE;
  const full = r.count === capacity;
  const empty = r.count === 0;
  const w = r.was;

  // Geometry: slot k is the 45 degree sector that starts k * 45 degrees
  // clockwise from the top.
  const CX = 122;
  const CY = 132;
  const RO = 92;
  const RI = 52;
  const pt = (radius: number, deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [CX + radius * Math.cos(a), CY + radius * Math.sin(a)];
  };
  const p = (radius: number, deg: number) => pt(radius, deg).map((n) => n.toFixed(1)).join(" ");
  const sector = (k: number) => {
    const a0 = k * 45 + 1.5;
    const a1 = (k + 1) * 45 - 1.5;
    return `M${p(RO, a0)} A${RO} ${RO} 0 0 1 ${p(RO, a1)} L${p(RI, a1)} A${RI} ${RI} 0 0 0 ${p(RI, a0)} Z`;
  };
  const mid = (k: number) => k * 45 + 22.5;
  const used = (k: number) => (k - r.tail + BUF_SIZE) % BUF_SIZE < r.count;
  // Head marker: outside the ring, pointing in. Tail marker: inside, pointing out.
  const headTri = `M${p(RO + 3, mid(r.head))} L${p(RO + 15, mid(r.head) - 5.5)} L${p(RO + 15, mid(r.head) + 5.5)} Z`;
  const tailTri = `M${p(RI - 3, mid(r.tail))} L${p(RI - 15, mid(r.tail) - 12)} L${p(RI - 15, mid(r.tail) + 12)} Z`;
  const headLabel = pt(RO + 25, mid(r.head));
  const tailLabel = pt(RI - 26, mid(r.tail));

  let status: string;
  let code: string;
  const wrapped = (from: number) => (from === BUF_SIZE - 1 ? " The index wrapped from slot 7 back to slot 0: that is what % BUF_SIZE does." : "");
  if (r.last === "put") {
    status = `The interrupt stored sample ${w.v} in slot ${w.head} and moved head to ${r.head}.${wrapped(w.head)} ${full ? (lockFree ? "The slot after head is now tail: the buffer is full with 7 samples, one slot stays free." : "count is 8: the buffer is full.") : `${r.count} sample${r.count === 1 ? " waits" : "s wait"} for main.`}`;
    code = lockFree
      ? `// buf_put(${w.v}), called by the interrupt
next = (head + 1) % BUF_SIZE;  // (${w.head}+1) % 8 = ${r.head}
if (next == tail) return 0;    // ${r.head} == ${w.tail}? no
buf[head] = v;                 // buf[${w.head}] = ${w.v}
head = next;                   // ${r.head}, after data
return 1;`
      : `// buf_put(${w.v}), called by the interrupt
if (count == BUF_SIZE) return 0;  // ${w.count} == 8? no
buf[head] = v;                    // buf[${w.head}] = ${w.v}
head = (head + 1) % BUF_SIZE;     // ${r.head}
count++;                          // ${r.count}
return 1;`;
  } else if (r.last === "full") {
    status = `Full: buf_put returned 0 and sample ${w.v} was dropped (${r.dropped} dropped so far). ${lockFree ? `Storing it in the free slot ${w.head} would make head equal to tail, which means empty: all 7 waiting samples would seem to vanish.` : `Storing it anyway would overwrite slot ${w.head}, the oldest sample, which main has not read yet.`} Main must take samples out faster, or the buffer must be larger.`;
    code = lockFree
      ? `// buf_put(${w.v}), called by the interrupt
next = (head + 1) % BUF_SIZE;  // (${w.head}+1) % 8 = ${next(w.head)}
if (next == tail) return 0;    // ${next(w.head)} == ${w.tail}: full`
      : `// buf_put(${w.v}), called by the interrupt
if (count == BUF_SIZE) return 0;  // ${w.count} == 8: full`;
  } else if (r.last === "get") {
    status = `Main took sample ${r.got} out of slot ${w.tail} and moved tail to ${r.tail}.${wrapped(w.tail)} The number is still in the array, but the slot is free again. ${empty ? "head == tail: the buffer is empty." : `${r.count} sample${r.count === 1 ? " still waits" : "s still wait"}.`}`;
    code = lockFree
      ? `// buf_get(&x), called by main: no DINT, no EINT
if (tail == head) return 0;    // ${w.tail} == ${w.head}? no
*v = buf[tail];                // x = ${r.got}
tail = (tail + 1) % BUF_SIZE;  // ${r.tail}, after data
return 1;`
      : `// buf_get(&x), called by main
DINT;                          // count is shared
if (count == 0) {              // ${w.count} == 0? no
    EINT;
    return 0;
}
*v = buf[tail];                // x = buf[${w.tail}] = ${r.got}
tail = (tail + 1) % BUF_SIZE;  // ${r.tail}
count--;                       // ${r.count}
EINT;
return 1;`;
  } else if (r.last === "empty") {
    status = `Empty: buf_get returned 0 and main got nothing.${r.v > 1 ? " The numbers still in the slots are old samples that were already taken." : ""} Main simply tries again later.`;
    code = lockFree
      ? `// buf_get(&x), called by main
if (tail == head) return 0;    // ${w.tail} == ${w.head}: empty`
      : `// buf_get(&x), called by main
DINT;
if (count == 0) {   // 0 == 0: empty
    EINT;           // EINT on this path too
    return 0;
}`;
  } else {
    status = lockFree
      ? "No count: empty is head == tail, and full is when the slot after head is tail, so one slot always stays free and 8 slots hold 7 samples. Only the interrupt writes head, only main writes tail."
      : "The buffer is empty: head and tail point at the same slot and count is 0. Press Put a few times, then Get: tail follows head around the ring.";
    code = lockFree
      ? "uint16_t buf[BUF_SIZE];  // BUF_SIZE is 8\nuint16_t head = 0;       // interrupt writes it\nuint16_t tail = 0;       // main writes it"
      : "uint16_t buf[BUF_SIZE];  // BUF_SIZE is 8\nuint16_t head = 0;       // next slot to write\nuint16_t tail = 0;       // next slot to read\nuint16_t count = 0;      // samples waiting";
  }

  const rows: [string, string][] = [
    ["head (interrupt writes here)", String(r.head)],
    ["tail (main reads here)", String(r.tail)],
    [lockFree ? "(head + 8 - tail) % 8" : "count", String(r.count)],
    ["dropped because full", String(r.dropped)],
    ["next sample to put", String(r.v)],
    ["main got last", r.got === null ? "--" : String(r.got)],
  ];
  const badge = empty ? "EMPTY" : full ? "FULL" : `${r.count} of ${capacity} used`;

  return (
    <figure className="figure" aria-label="Interactive ring buffer with a producer and a consumer">
      <style>{CSS}</style>
      <svg viewBox="0 0 420 250" role="img" aria-label={`Ring buffer of 8 slots, ${lockFree ? "lock-free variant" : "variant with a count"}. head is ${r.head}, tail is ${r.tail}, ${r.count} sample${r.count === 1 ? "" : "s"} inside${empty ? ", empty" : full ? ", full" : ""}. Slots in use: ${Array.from({ length: BUF_SIZE }, (_, k) => k).filter(used).map((k) => `slot ${k} holds ${r.buf[k]}`).join(", ") || "none"}. ${r.dropped} sample${r.dropped === 1 ? "" : "s"} dropped.`}>
        {Array.from({ length: BUF_SIZE }, (_, k) => {
          const [vx, vy] = pt(66, mid(k));
          const [ix, iy] = pt(83, mid(k));
          return (
            <g key={k}>
              <path d={sector(k)} className={`rb-slot ${used(k) ? "used" : ""}`} />
              <text x={ix} y={iy + 3} textAnchor="middle" className="fig-label dim">{k}</text>
              <text x={vx} y={vy + 4} textAnchor="middle" className={used(k) ? "fig-value" : "rb-old"}>{r.buf[k]}</text>
            </g>
          );
        })}
        <path d={headTri} className="rb-head" />
        <text x={headLabel[0]} y={headLabel[1] + 3} textAnchor="middle" className="fig-label">head</text>
        <path d={tailTri} className="rb-tail" />
        <text x={tailLabel[0]} y={tailLabel[1] + 3} textAnchor="middle" className="fig-label">tail</text>
        {/* numbers */}
        {rows.map(([name, value], i) => (
          <g key={name}>
            <text x={266} y={38 + i * 27} className="fig-label">{name}</text>
            <text x={414} y={39 + i * 27} textAnchor="end" className="fig-value">{value}</text>
            <line x1={266} x2={414} y1={45 + i * 27} y2={45 + i * 27} className="rb-row" />
          </g>
        ))}
        <rect x={266} y={196} width={148} height={24} rx={4} className={`fig-box ${empty || full ? "hot" : ""}`} />
        <text x={340} y={212} textAnchor="middle" className="rb-badge">{badge}</text>
      </svg>
      <div className="fig-step rb-step" role="status">
        <p>{status}</p>
        <CodePre><code>{code}</code></CodePre>
      </div>
      <div className="fig-controls row">
        <button className="btn small primary" onClick={() => setR(put(r, lockFree))}>Put (interrupt)</button>
        <button className="btn small" onClick={() => setR(get(r))}>Get (main)</button>
        <button className="btn small" onClick={() => setR(fresh())} disabled={r.last === ""}>Reset</button>
      </div>
      <div className="fig-controls">
        <div>
          <span>Variant</span>
          <button className="fig-opt" aria-pressed={!lockFree} onClick={() => { setLockFree(false); setR(fresh()); }}>with count</button>
          <button className="fig-opt" aria-pressed={lockFree} onClick={() => { setLockFree(true); setR(fresh()); }}>lock-free, no count</button>
        </div>
      </div>
      <figcaption>
        The interrupt puts samples 1, 2, 3, ... in at head. Main takes them out at tail, in the same order. Both indexes only move forward and wrap from slot 7 to slot 0. Bright slots with a solid edge hold samples that wait for main; dashed slots are free (their old numbers remain).
      </figcaption>
    </figure>
  );
}

export const figure = {
  id: "ring-buffer",
  title: "Ring buffer (circular queue)",
  description: "Put samples in and take them out one at a time to watch head and tail chase each other round eight slots, and what happens when the buffer is full or empty.",
  Component: RingBuffer,
};
