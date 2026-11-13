import { useRef, useState } from "react";

// Blobs, moments and the centroid as chapter 19 (lecture 17, homework 5)
// computes them on its 8 x 12 test images:
//   blob = 4-connected group of mask pixels; blobs under MIN_AREA are noise
//   M00 = number of pixels, M10 = sum of columns, M01 = sum of rows
//   cx = M10 / M00, cy = M01 / M00
//   turn = KP_TURN * (CENTRE_COL - cx);   KP_TURN 0.5, CENTRE_COL 6.0
// The starting mask is the one of the level "Blobs and the area filter".

const ROWS = 8;
const COLS = 12;
const KP_TURN = 0.5;
const CENTRE_COL = 6.0;
const START = [
  ". . . . . . . . . . 1 .",
  ". 1 1 1 . . . . . . . .",
  ". 1 1 1 . . . . . . . .",
  ". 1 1 1 1 . . . 1 1 . .",
  ". . . . . 1 . . 1 1 . .",
  ". . . . . . . . 1 1 . .",
  ". 1 1 . . . . . . . . .",
  ". . . . . . . . . . . .",
];
const startMask = () => START.flatMap((r) => r.split(" ").map((c) => c === "1"));

interface Blob {
  cells: number[];
  m00: number;
  m10: number;
  m01: number;
}

function findBlobs(mask: boolean[]): { blobs: Blob[]; label: number[] } {
  const label = new Array<number>(ROWS * COLS).fill(-1);
  const blobs: Blob[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start] >= 0) continue;
    const b: Blob = { cells: [], m00: 0, m10: 0, m01: 0 };
    const stack = [start];
    label[start] = blobs.length;
    while (stack.length) {
      const cur = stack.pop()!;
      const row = Math.floor(cur / COLS);
      const col = cur % COLS;
      b.cells.push(cur);
      b.m00 += 1;
      b.m10 += col;
      b.m01 += row;
      for (const [dr, dc] of [[-1, 0], [0, -1], [0, 1], [1, 0]]) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
        const next = r * COLS + c;
        if (mask[next] && label[next] < 0) {
          label[next] = blobs.length;
          stack.push(next);
        }
      }
    }
    blobs.push(b);
  }
  return { blobs, label };
}

const S = 23; // cell size
const OX = 22;
const OY = 18;
const f2 = (v: number) => v.toFixed(2);

function BlobCentroid() {
  const [mask, setMask] = useState<boolean[]>(startMask);
  const [minArea, setMinArea] = useState(4);
  const [filter, setFilter] = useState(true);
  const [cursor, setCursor] = useState(0);
  const paint = useRef<boolean | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  const { blobs, label } = findBlobs(mask);
  const kept = blobs.filter((b) => b.m00 >= minArea);
  const best = kept.reduce<Blob | null>((a, b) => (!a || b.m00 > a.m00 ? b : a), null);
  const all: Blob = { cells: [], m00: 0, m10: 0, m01: 0 };
  for (const b of blobs) {
    all.m00 += b.m00;
    all.m10 += b.m10;
    all.m01 += b.m01;
  }
  const used = filter ? best : all.m00 > 0 ? all : null;
  const cx = used ? used.m10 / used.m00 : 0;
  const cy = used ? used.m01 / used.m00 : 0;
  const turn = used ? KP_TURN * (CENTRE_COL - cx) : 0;
  const noise = blobs.filter((b) => b.m00 < minArea);
  const noisePixels = noise.reduce((n, b) => n + b.m00, 0);

  const setCell = (i: number, v: boolean) => setMask((m) => (m[i] === v ? m : m.map((x, k) => (k === i ? v : x))));
  const cellAt = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const scale = 420 / r.width;
    const col = Math.floor(((e.clientX - r.left) * scale - OX) / S);
    const row = Math.floor(((e.clientY - r.top) * scale - OY) / S);
    return row >= 0 && row < ROWS && col >= 0 && col < COLS ? row * COLS + col : -1;
  };
  const down = (e: React.PointerEvent) => {
    const i = cellAt(e);
    if (i < 0) return;
    e.preventDefault();
    svg.current!.focus();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    paint.current = !mask[i];
    setCursor(i);
    setCell(i, paint.current);
  };
  const move = (e: React.PointerEvent) => {
    if (paint.current === null) return;
    const i = cellAt(e);
    if (i >= 0) setCell(i, paint.current);
  };
  const key = (e: React.KeyboardEvent) => {
    const row = Math.floor(cursor / COLS);
    const col = cursor % COLS;
    let next = cursor;
    if (e.key === "ArrowLeft" && col > 0) next--;
    else if (e.key === "ArrowRight" && col < COLS - 1) next++;
    else if (e.key === "ArrowUp" && row > 0) next -= COLS;
    else if (e.key === "ArrowDown" && row < ROWS - 1) next += COLS;
    else if (e.key === " " || e.key === "Enter") setCell(cursor, !mask[cursor]);
    else return;
    e.preventDefault();
    setCursor(next);
  };

  const x = (col: number) => OX + (col + 0.5) * S; // centre of a column
  const y = (row: number) => OY + (row + 0.5) * S;
  const gridW = COLS * S;
  const gridH = ROWS * S;
  const dir = turn < -0.005 ? "turn right" : turn > 0.005 ? "turn left" : "straight on";
  const status = !used
    ? filter && all.m00 > 0
      ? `No blob has ${minArea} pixels or more, so there is no target: M00 is 0. The code must not divide by it, and turn stays 0.`
      : "The mask is empty: M00 is 0. The code must not divide by it, and turn stays 0. Paint some pixels."
    : filter
      ? `${blobs.length} blob${blobs.length === 1 ? "" : "s"} in the mask. ${noise.length ? `${noise.length} of them (${noisePixels} pixel${noisePixels === 1 ? "" : "s"}) ${noise.length === 1 ? "is" : "are"} smaller than MIN_AREA = ${minArea} and ${noise.length === 1 ? "is" : "are"} thrown away as noise. ` : ""}The largest blob has ${used.m00} pixels; its centroid is at column ${f2(cx)}, row ${f2(cy)}, ${Math.abs(CENTRE_COL - cx) < 0.005 ? "exactly at the image centre" : `${f2(Math.abs(CENTRE_COL - cx))} columns ${cx > CENTRE_COL ? "right" : "left"} of the image centre`}: ${dir}.`
      : `Area filter off: all ${all.m00} mask pixels are summed as if they were one object. ${best ? `The centroid lands at column ${f2(cx)}, row ${f2(cy)}; the largest blob alone is at column ${f2(best.m10 / best.m00)}, row ${f2(best.m01 / best.m00)} (pale ring). Every stray pixel pulls the result towards itself.` : ""}`;

  return (
    <figure className="figure" aria-label="Paintable pixel mask with blobs, moments, centroid and steering command">
      <style>{`
        .blobc-grid { touch-action: none; cursor: crosshair; outline-offset: 2px; }
        .blobc-bg { fill: var(--surface); stroke: var(--dim); stroke-width: 1; }
        .blobc-lines { stroke: var(--border); stroke-width: 0.7; fill: none; }
        .blobc-best { fill: var(--orange); }
        .blobc-kept { fill: var(--arches); }
        .blobc-noise { fill: none; stroke: var(--dim); stroke-width: 1.3; stroke-dasharray: 3 2; }
        .blobc-num { fill: var(--accent-ink); font-size: 9px; font-family: var(--mono); font-weight: 700; pointer-events: none; }
        .blobc-num.out { fill: var(--dim); }
        .blobc-centre { stroke: var(--dim); stroke-width: 1.2; stroke-dasharray: 5 3; }
        .blobc-cross { stroke: var(--text); stroke-width: 1.4; }
        .blobc-dot { fill: var(--harvest); stroke: var(--text); stroke-width: 1.5; }
        .blobc-ghost { fill: var(--surface); fill-opacity: 0.75; stroke: var(--text); stroke-width: 1.8; }
        .blobc-cursor { fill: none; stroke: var(--focus); stroke-width: 2; display: none; }
        .blobc-grid:focus-visible .blobc-cursor { display: inline; }
        .blobc-steer { stroke: var(--harvest); stroke-width: 2.5; fill: none; }
        .blobc-steerhead { fill: var(--harvest); }
        .blobc-row input[type=range] { accent-color: var(--orange); flex: 1 1 6rem; min-width: 5rem; padding: 0; }
      `}</style>
      <div className="fig-controls">
        <div className="blobc-row">
          <span><label htmlFor="blobc-min">MIN_AREA</label></span>
          <input id="blobc-min" type="range" min={1} max={12} value={minArea} disabled={!filter} onChange={(e) => setMinArea(+e.target.value)} />
          <code>#define MIN_AREA {minArea}</code>
        </div>
        <div>
          <span>Area filter</span>
          <button className="fig-opt" aria-pressed={filter} onClick={() => setFilter(true)}>Filter on</button>
          <button className="fig-opt" aria-pressed={!filter} onClick={() => setFilter(false)}>Filter off</button>
          <button className="btn small" onClick={() => setMask(new Array(ROWS * COLS).fill(false))}>Clear</button>
          <button className="btn small" onClick={() => setMask(startMask())}>Example</button>
        </div>
      </div>
      <svg
        ref={svg}
        className="blobc-grid"
        viewBox="0 0 420 232"
        role="application"
        tabIndex={0}
        aria-label={`Mask of ${ROWS} rows by ${COLS} columns, ${all.m00} pixels set in ${blobs.length} blobs. ${used ? `Centroid at column ${f2(cx)}, row ${f2(cy)}, turn ${f2(turn)}, ${dir}.` : "No target."} Arrow keys move the cursor (now row ${Math.floor(cursor / COLS)}, column ${cursor % COLS}, ${mask[cursor] ? "set" : "clear"}), space toggles the pixel.`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => (paint.current = null)}
        onPointerCancel={() => (paint.current = null)}
        onKeyDown={key}
      >
        <rect x={OX} y={OY} width={gridW} height={gridH} className="blobc-bg" />
        {mask.map((on, i) => {
          if (!on) return null;
          const b = blobs[label[i]];
          const cls = !filter ? "blobc-best" : b === best ? "blobc-best" : b.m00 >= minArea ? "blobc-kept" : "blobc-noise";
          const inset = cls === "blobc-noise" ? 2.5 : 0.5;
          return <rect key={i} x={OX + (i % COLS) * S + inset} y={OY + Math.floor(i / COLS) * S + inset} width={S - 2 * inset} height={S - 2 * inset} rx="2" className={cls} />;
        })}
        <path
          d={Array.from({ length: COLS - 1 }, (_, c) => `M${OX + (c + 1) * S},${OY} v${gridH}`).join(" ") + Array.from({ length: ROWS - 1 }, (_, r) => `M${OX},${OY + (r + 1) * S} h${gridW}`).join(" ")}
          className="blobc-lines"
        />
        {/* area of each blob, written in its first pixel */}
        {filter &&
          blobs.map((b, k) => {
            const first = Math.min(...b.cells);
            return (
              <text key={k} x={x(first % COLS)} y={y(Math.floor(first / COLS)) + 3} textAnchor="middle" className={`blobc-num ${b.m00 < minArea ? "out" : ""}`}>{b.m00}</text>
            );
          })}
        {Array.from({ length: COLS }, (_, c) => (
          <text key={c} x={x(c)} y={OY - 5} textAnchor="middle" className="fig-label dim">{c}</text>
        ))}
        {Array.from({ length: ROWS }, (_, r) => (
          <text key={r} x={OX - 6} y={y(r) + 3} textAnchor="end" className="fig-label dim">{r}</text>
        ))}
        {/* image centre and centroid */}
        <line x1={x(CENTRE_COL)} x2={x(CENTRE_COL)} y1={OY} y2={OY + gridH + 22} className="blobc-centre" />
        {!filter && best && <circle cx={x(best.m10 / best.m00)} cy={y(best.m01 / best.m00)} r="5.5" className="blobc-ghost" />}
        {used && (
          <>
            <line x1={x(cx)} x2={x(cx)} y1={OY} y2={OY + gridH + 22} className="blobc-cross" />
            <line x1={OX} x2={OX + gridW} y1={y(cy)} y2={y(cy)} className="blobc-cross" />
            <circle cx={x(cx)} cy={y(cy)} r="4" className="blobc-dot" />
          </>
        )}
        <rect x={OX + (cursor % COLS) * S} y={OY + Math.floor(cursor / COLS) * S} width={S} height={S} className="blobc-cursor" />
        {/* steering: from the image centre to the centroid's column */}
        {used && Math.abs(cx - CENTRE_COL) > 0.2 && (
          <>
            <line x1={x(CENTRE_COL)} x2={x(cx) + (cx > CENTRE_COL ? -6 : 6)} y1={OY + gridH + 14} y2={OY + gridH + 14} className="blobc-steer" />
            <path d={cx > CENTRE_COL ? `M${x(cx)},${OY + gridH + 14} l-8,-4.5 v9 Z` : `M${x(cx)},${OY + gridH + 14} l8,-4.5 v9 Z`} className="blobc-steerhead" />
          </>
        )}
        <text x={x(CENTRE_COL) + (cx > CENTRE_COL ? -4 : 4)} y={OY + gridH + 11} textAnchor={cx > CENTRE_COL ? "end" : "start"} className="fig-label dim">image centre, column {CENTRE_COL.toFixed(1)}</text>
        {used && <text x={x(cx) + (cx > CENTRE_COL ? 4 : -4)} y={OY + gridH + 28} textAnchor={cx > CENTRE_COL ? "start" : "end"} className="fig-label">{dir}</text>}
        {/* numbers */}
        <text x="310" y="26" className="fig-label dim">{filter ? "LARGEST BLOB" : "ALL MASK PIXELS"}</text>
        <text x="310" y="44" className="fig-label">M00 (pixels)</text>
        <text x="414" y="44" textAnchor="end" className="fig-value">{used ? used.m00 : 0}</text>
        <text x="310" y="60" className="fig-label">M10 (sum of columns)</text>
        <text x="414" y="72" textAnchor="end" className="fig-value">{used ? used.m10 : 0}</text>
        <text x="310" y="88" className="fig-label">M01 (sum of rows)</text>
        <text x="414" y="100" textAnchor="end" className="fig-value">{used ? used.m01 : 0}</text>
        <text x="310" y="122" className="fig-label">cx = M10 / M00</text>
        <text x="414" y="134" textAnchor="end" className="fig-value">{used ? f2(cx) : "none"}</text>
        <text x="310" y="150" className="fig-label">cy = M01 / M00</text>
        <text x="414" y="162" textAnchor="end" className="fig-value">{used ? f2(cy) : "none"}</text>
        <text x="310" y="184" className="fig-label">turn</text>
        <text x="414" y="184" textAnchor="end" className="fig-value">{f2(turn)}</text>
        <text x="414" y="197" textAnchor="end" className="fig-label dim">{used ? (turn < -0.005 ? "negative: right" : turn > 0.005 ? "positive: left" : "zero: straight") : "no target"}</text>
      </svg>
      <div className="fig-step" role="status">
        <p>{status}</p>
        <pre><code>{used ? `cx = ${used.m10} / ${used.m00}.0;   // ${f2(cx)}\n// ${KP_TURN} * (${CENTRE_COL.toFixed(1)} - ${f2(cx)}) = ${f2(turn)}\nturn = KP_TURN * (CENTRE_COL - cx);` : "if (m00 > 0) { cx = m10 / m00; ... } else { turn = 0; }"}</code></pre>
      </div>
      <figcaption>Click or drag on the grid to paint pixels (keyboard: arrow keys and space). Numbers in the grid are blob areas; dashed pixels are blobs below MIN_AREA. Pixels that touch only at a corner are separate blobs. The cross-hair is the centroid, the arrow the steering command.</figcaption>
    </figure>
  );
}

export const figure = { id: "blob-centroid", Component: BlobCentroid };
