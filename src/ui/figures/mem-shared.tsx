import type { ReactNode } from "react";

// Shared drawing code for the "mem-" figures of primer C (C for hardware):
// a row of memory boxes with addresses, names and values, and a short code
// listing that is run line by line. Not a figure itself (no `figure` export).
//
// What the pictures rely on, all true on the F28379D: the smallest piece of
// memory the CPU can address is one 16-bit word, so char, int, int16_t and
// uint16_t take one box, and long, int32_t, uint32_t, float and pointers take
// two neighbouring boxes (TMS320C28x compiler guide, data types; TRM 3.6.1
// for register addresses in 16-bit words). The addresses 0x0100... are made up.

export const MEM_CSS = `
.mem-cell { fill: var(--surface); stroke: var(--dim); stroke-width: 1; }
.mem-cell.hot { fill: var(--accent-soft); stroke: var(--orange); stroke-width: 2; }
.mem-cell.bad { fill: var(--bad-soft); stroke: var(--bad); stroke-width: 2; }
.mem-cell.unused { fill: none; stroke-dasharray: 3 2; }
.mem-addr { fill: var(--dim); font-size: 8.5px; font-family: var(--mono); }
.mem-addr.hot { fill: var(--text); font-weight: 700; }
.mem-brace { fill: none; stroke: var(--dim); stroke-width: 1.2; }
.mem-arrow { fill: none; stroke: var(--orange); stroke-width: 2; }
.mem-arrow-head { fill: var(--orange); }
.mem-code { list-style: none; margin: 0.5rem 0; padding: 0.4rem 0.5rem; background: var(--surface); border-radius: 6px; font-family: var(--mono); font-size: 0.8rem; line-height: 1.5; overflow-x: auto; }
.mem-code li { white-space: pre; padding: 0 0.4rem; border-left: 3px solid transparent; color: var(--dim); }
.mem-code li.done { color: var(--text); }
.mem-code li.now { color: var(--text); font-weight: 700; border-left-color: var(--orange); background: var(--accent-soft); }
.mem-out { display: block; margin: 0.4rem 0; padding: 0.35rem 0.6rem; background: var(--surface); border-radius: 6px; font-size: 0.8rem; white-space: pre-wrap; overflow-wrap: anywhere; }
`;

export const hex4 = (a: number) => "0x" + a.toString(16).toUpperCase().padStart(4, "0");

export interface Cell {
  /** Address of the first box. */
  addr: number;
  /** Boxes this variable takes: 1 (16 bits) or 2 (32 bits). */
  words?: 1 | 2;
  name?: string;
  value: string;
  state?: "hot" | "bad" | "unused";
  /** Draw the value in the small size (for values of more than 5 characters). */
  small?: boolean;
}

export const CELL_W = 48;
export const CELL_X0 = 8;
export const CELL_Y = 28;
export const CELL_H = 44;

/** Left edge of the box at position `slot` (0 to 7) in the row. */
export const cellX = (slot: number) => CELL_X0 + slot * CELL_W;
/** Horizontal centre of a cell that starts at `slot`. */
export const cellMid = (slot: number, words = 1) => cellX(slot) + (words * CELL_W) / 2;

/** A row of memory boxes. The first cell sits at slot 0; a two-word cell takes two slots. */
export function Cells({ cells, y = CELL_Y }: { cells: Cell[]; y?: number }) {
  const out: ReactNode[] = [];
  let slot = 0;
  for (const c of cells) {
    const words = c.words ?? 1;
    const x = cellX(slot);
    const w = words * CELL_W;
    for (let k = 0; k < words; k++) {
      out.push(
        <text key={`a${c.addr + k}`} x={x + k * CELL_W + CELL_W / 2} y={y - 6} textAnchor="middle" className={`mem-addr ${c.state === "hot" || c.state === "bad" ? "hot" : ""}`}>
          {hex4(c.addr + k)}
        </text>,
      );
    }
    out.push(<rect key={`r${c.addr}`} x={x + 1} y={y} width={w - 2} height={CELL_H} rx="3" className={`mem-cell ${c.state ?? ""}`} />);
    if (words === 2) out.push(<line key={`s${c.addr}`} x1={x + CELL_W} y1={y + CELL_H - 8} x2={x + CELL_W} y2={y + CELL_H} className="fig-wire" />);
    if (c.name) {
      out.push(
        <text key={`n${c.addr}`} x={x + w / 2} y={y + 13} textAnchor="middle" className="fig-label">
          {c.name}
        </text>,
      );
    }
    out.push(
      <text key={`v${c.addr}`} x={x + w / 2} y={y + (c.name ? 33 : 27)} textAnchor="middle" className={`fig-value ${c.state === "unused" || c.small ? "small" : ""}`} style={c.state === "unused" ? { fill: "var(--dim)" } : undefined}>
        {c.value}
      </text>,
    );
    slot += words;
  }
  return <g>{out}</g>;
}

/** A bracket under `count` boxes starting at `slot`, with a label. */
export function Brace({ slot, count, label, y = CELL_Y + CELL_H + 5 }: { slot: number; count: number; label: string; y?: number }) {
  const x1 = cellX(slot) + 3;
  const x2 = cellX(slot + count) - 3;
  return (
    <g>
      <path d={`M${x1},${y} v6 H${x2} v-6`} className="mem-brace" />
      <text x={(x1 + x2) / 2} y={y + 17} textAnchor="middle" className="fig-label">
        {label}
      </text>
    </g>
  );
}

/** An arrow that leaves the bottom of one box and ends at the bottom of another. */
export function Pointer({ fromX, toX, y = CELL_Y + CELL_H, depth = 26 }: { fromX: number; toX: number; y?: number; depth?: number }) {
  return (
    <g>
      <path d={`M${fromX},${y} C${fromX},${y + depth} ${toX},${y + depth} ${toX},${y + 7}`} className="mem-arrow" />
      <polygon points={`${toX - 5},${y + 9} ${toX + 5},${y + 9} ${toX},${y + 1}`} className="mem-arrow-head" />
      <circle cx={fromX} cy={y} r="2.5" className="mem-arrow-head" />
    </g>
  );
}

/** A code listing run line by line: `at` lines have run, the last of them is marked. */
export function Code({ lines, at }: { lines: string[]; at: number }) {
  return (
    <ol className="mem-code" aria-label="The program">
      {lines.map((l, i) => (
        <li key={i} className={i === at - 1 ? "now" : i < at ? "done" : ""} aria-current={i === at - 1 ? "step" : undefined}>
          {l}
        </li>
      ))}
    </ol>
  );
}

/** "Run the next line" and "Start again". */
export function StepButtons({ at, total, setAt }: { at: number; total: number; setAt: (n: number) => void }) {
  return (
    <div className="fig-controls row">
      <button className="fig-opt" onClick={() => setAt(Math.min(total, at + 1))} disabled={at >= total}>
        Run the next line
      </button>
      <button className="fig-opt" onClick={() => setAt(0)} disabled={at === 0}>
        Start again
      </button>
      <span className="fig-dots" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <i key={i} className={i < at ? "on" : ""} />
        ))}
      </span>
    </div>
  );
}
