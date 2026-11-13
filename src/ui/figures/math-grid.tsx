import { Fragment, useState } from "react";

// Maths you need (chapter 19): a picture or a map is a grid of rows and
// columns, stored in C as ONE array, row after row.
//   index = row * COLS + col        row = index / COLS        col = index % COLS
// (integer division and remainder). This is the layout of the camera image
// and of the course planner's map in the levels of this chapter.

const ROWS = 4;
const COLS = 6;

function MathGrid() {
  const [sel, setSel] = useState(1 * COLS + 2);
  const row = Math.floor(sel / COLS);
  const col = sel % COLS;

  const status =
    `Row ${row}, column ${col}. ${row === 0 ? "No complete row lies before it" : `${row} complete row${row === 1 ? "" : "s"} of ${COLS} lie before it (${row} x ${COLS} = ${row * COLS} elements)`}, ` +
    `then ${col} more element${col === 1 ? "" : "s"} in its own row: index ${row * COLS} + ${col} = ${sel}. ` +
    `Going back, ${sel} / ${COLS} is ${row} with remainder ${col}: the row and the column.` +
    (col === COLS - 1 && row < ROWS - 1 ? ` The next element, ${sel + 1}, is the first cell of row ${row + 1}: the array has no gap between rows.` : "");

  return (
    <figure className="figure" aria-label="A grid of rows and columns stored as one array">
      <style>{`
        .mgrid-wrap { display: grid; grid-template-columns: auto 1fr; gap: 2px 6px; align-items: center; max-width: 360px; margin: 0 auto; }
        .mgrid-head { display: grid; grid-template-columns: repeat(${COLS}, 1fr); gap: 2px; font-size: 0.72rem; color: var(--dim); text-align: center; }
        .mgrid-rowlab { font-size: 0.72rem; color: var(--dim); text-align: right; white-space: nowrap; }
        .mgrid-row { display: grid; grid-template-columns: repeat(${COLS}, 1fr); gap: 2px; }
        .mgrid-cell { font-family: var(--mono); font-size: 0.8rem; padding: 0.35em 0; background: var(--surface); color: var(--text); border: 1px solid var(--border-strong); border-radius: 3px; cursor: pointer; }
        .mgrid-cell.inrow { border-color: var(--arches); border-width: 2px; }
        .mgrid-cell[aria-pressed="true"] { background: var(--orange); border-color: var(--orange); color: var(--accent-ink); font-weight: 700; }
        .mgrid-title { font-size: 0.8rem; color: var(--dim); margin: 0.6rem 0 0.25rem; }
        .mgrid-strip { display: grid; grid-template-columns: repeat(12, 1fr); gap: 2px; }
        .mgrid-slot { font-family: var(--mono); font-size: 0.72rem; text-align: center; padding: 0.2em 0; background: var(--surface); color: var(--dim); border: 1px solid var(--border); border-radius: 3px; }
        .mgrid-slot.rowstart { border-left: 3px solid var(--text); }
        .mgrid-slot.inrow { border-color: var(--arches); border-width: 2px; color: var(--text); }
        .mgrid-slot.on { background: var(--orange); border-color: var(--orange); color: var(--accent-ink); font-weight: 700; }
        .mgrid-code { margin: 0.5rem 0 0; font-size: 0.74rem; overflow-x: auto; }
        .mgrid-code b { color: var(--harvest); }
      `}</style>
      <p className="mgrid-title">The picture: {ROWS} rows by {COLS} columns. Click a cell.</p>
      <div className="mgrid-wrap">
        <span />
        <div className="mgrid-head" aria-hidden="true">
          {Array.from({ length: COLS }, (_, c) => <span key={c}>col {c}</span>)}
        </div>
        {Array.from({ length: ROWS }, (_, r) => (
          <Fragment key={r}>
            <span className="mgrid-rowlab" aria-hidden="true">row {r}</span>
            <div className="mgrid-row">
              {Array.from({ length: COLS }, (_, c) => {
                const i = r * COLS + c;
                return (
                  <button key={c} className={`mgrid-cell ${r === row ? "inrow" : ""}`} aria-pressed={i === sel} aria-label={`row ${r}, column ${c}, index ${i}`} onClick={() => setSel(i)}>
                    {i}
                  </button>
                );
              })}
            </div>
          </Fragment>
        ))}
      </div>
      <p className="mgrid-title">The same {ROWS * COLS} numbers in memory: one array, row after row. A thick left edge marks where a row starts.</p>
      <div className="mgrid-strip" role="img" aria-label={`The array with ${ROWS * COLS} elements. Element ${sel} is highlighted.`}>
        {Array.from({ length: ROWS * COLS }, (_, i) => (
          <span key={i} className={`mgrid-slot ${i % COLS === 0 ? "rowstart" : ""} ${Math.floor(i / COLS) === row ? "inrow" : ""} ${i === sel ? "on" : ""}`}>{i}</span>
        ))}
      </div>
      <pre className="mgrid-code"><code>
        i   = row * COLS + col;  // {row} * {COLS} + {col} = <b>{sel}</b>{"\n"}
        row = i / COLS;  // {sel} / {COLS} = <b>{row}</b>, whole part{"\n"}
        col = i % COLS;  // {sel} % {COLS} = <b>{col}</b>, remainder
      </code></pre>
      <p className="fig-why" role="status">{status}</p>
      <figcaption>Rows are counted from the top and columns from the left, both from 0. Orange is the chosen cell, the blue outline is its row. The number in each cell is its index in the array.</figcaption>
    </figure>
  );
}

export const figure = {
  id: "math-grid",
  title: "A grid stored as one array",
  description: "Click a cell to see its row and column turn into one array index, and the index turn back into row and column.",
  Component: MathGrid,
};
