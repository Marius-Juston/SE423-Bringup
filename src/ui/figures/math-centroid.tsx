import { useState } from "react";

// Maths you need (chapter 19): the centroid of a set of pixels is their
// average position. Lecture 17 / HW5 call the three sums "moments":
//   M00 = number of pixels, M10 = sum of their column numbers,
//   M01 = sum of their row numbers, centroid = (M10 / M00, M01 / M00).

const ROWS = 5;
const COLS = 8;
const START = [1 * COLS + 2, 1 * COLS + 3, 2 * COLS + 2, 2 * COLS + 3];
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

function MathCentroid() {
  const [on, setOn] = useState<Set<number>>(new Set(START));
  const toggle = (i: number) =>
    setOn((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  const px = [...on].sort((a, b) => a - b);
  const m00 = px.length;
  const m10 = px.reduce((s, i) => s + (i % COLS), 0);
  const m01 = px.reduce((s, i) => s + Math.floor(i / COLS), 0);
  const cx = m00 ? m10 / m00 : 0;
  const cy = m00 ? m01 / m00 : 0;
  const list = (vals: number[]) => (vals.length > 8 ? `${vals.slice(0, 7).join(" + ")} + ...` : vals.join(" + "));

  const status =
    m00 === 0
      ? "No pixel is set: M00 = 0. There is nothing to average, and dividing by 0 is not allowed. The code must test for this case before it divides."
      : m00 === 1
        ? `One pixel: the average position is the pixel itself, column ${fmt(cx)}, row ${fmt(cy)}.`
        : `${m00} pixels. Their column numbers add up to ${list(px.map((i) => i % COLS))} = ${m10}, so the average column is ${m10} / ${m00} = ${fmt(cx)}. Their row numbers add up to ${m01}, so the average row is ${m01} / ${m00} = ${fmt(cy)}.${Number.isInteger(cx) && Number.isInteger(cy) ? "" : " An average can fall between two pixels: keep it as a float."}`;

  return (
    <figure className="figure" aria-label="The centroid of a set of pixels is their average position">
      <style>{`
        .mcen-wrap { display: grid; grid-template-columns: auto 1fr; gap: 2px 6px; align-items: center; max-width: 380px; margin: 0 auto; }
        .mcen-head { display: grid; grid-template-columns: repeat(${COLS}, 1fr); gap: 2px; font-size: 0.72rem; color: var(--dim); text-align: center; }
        .mcen-rowlab { font-size: 0.72rem; color: var(--dim); text-align: right; }
        .mcen-grid { position: relative; grid-column: 2; display: grid; grid-template-columns: repeat(${COLS}, 1fr); gap: 2px; }
        .mcen-labs { display: grid; grid-template-rows: repeat(${ROWS}, 1fr); gap: 2px; align-self: stretch; align-items: center; }
        .mcen-cell { aspect-ratio: 1.25; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 3px; cursor: pointer; padding: 0; font-family: var(--mono); font-size: 0.7rem; color: var(--dim); }
        .mcen-cell[aria-pressed="true"] { background: var(--orange); border-color: var(--orange); color: var(--accent-ink); font-weight: 700; }
        .mcen-mark { position: absolute; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; border: 3px solid var(--text); background: var(--harvest); pointer-events: none; box-sizing: border-box; }
        .mcen-sums { margin: 0.5rem 0 0; font-size: 0.82rem; }
        .mcen-sums b { color: var(--harvest); }
      `}</style>
      <div className="mcen-wrap">
        <span />
        <div className="mcen-head" aria-hidden="true">
          {Array.from({ length: COLS }, (_, c) => <span key={c}>{c}</span>)}
        </div>
        <div className="mcen-labs" aria-hidden="true">
          {Array.from({ length: ROWS }, (_, r) => <span key={r} className="mcen-rowlab">row {r}</span>)}
        </div>
        <div className="mcen-grid">
          {Array.from({ length: ROWS * COLS }, (_, i) => (
            <button key={i} className="mcen-cell" aria-pressed={on.has(i)} aria-label={`pixel row ${Math.floor(i / COLS)}, column ${i % COLS}`} onClick={() => toggle(i)}>
              {on.has(i) ? "1" : "0"}
            </button>
          ))}
          {m00 > 0 && <span className="mcen-mark" aria-hidden="true" style={{ left: `${((cx + 0.5) / COLS) * 100}%`, top: `${((cy + 0.5) / ROWS) * 100}%` }} />}
        </div>
      </div>
      <pre className="mcen-sums"><code>
        M00 = <b>{m00}</b>     // how many pixels are 1{"\n"}
        M10 = <b>{m10}</b>     // their column numbers added up{"\n"}
        M01 = <b>{m01}</b>     // their row numbers added up{"\n"}
        cx  = M10 / M00 = <b>{m00 ? fmt(cx) : "?"}</b>    cy = M01 / M00 = <b>{m00 ? fmt(cy) : "?"}</b>
      </code></pre>
      <p className="fig-why" role="status">{status}</p>
      <div className="fig-controls row">
        <button className="btn small" onClick={() => setOn(new Set(START))}>Reset</button>
        <button className="btn small" onClick={() => setOn(new Set())}>Clear</button>
        <button className="btn small" onClick={() => setOn((s) => new Set([...s, 4 * COLS + 7]))}>Add a far pixel</button>
      </div>
      <figcaption>Click pixels to switch them between 0 and 1. Orange pixels are in the mask. The yellow dot is the centroid: the average column and the average row of the orange pixels. Columns are numbered along the top.</figcaption>
    </figure>
  );
}

export const figure = { id: "math-centroid", Component: MathCentroid };
