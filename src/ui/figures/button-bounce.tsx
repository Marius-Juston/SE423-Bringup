import { useMemo, useState, type ReactNode } from "react";

// Contact bounce of a push button (pull-up, pressed = 0 V) and what a
// program that reads the pin every N ms makes of it. The pin itself is read
// through GPxDAT (TRM 8.3); the chip's own input qualification (TRM 8.4.3)
// is the hardware version of the "same for several samples" rule shown here.

const T_END = 60; // ms shown
const PRESS = 8;
const RELEASE = 38;
const STABLE_MS = 5; // the debounced detector wants the new level this long
const PERIODS = [0.05, 0.1, 0.2, 0.5, 1, 2, 3, 5, 8, 10, 15, 20, 30, 40];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Times at which the pin changes level; it starts high. */
function makeEdges(seed: number): { edges: number[]; bounce: number } {
  const r = rng(seed);
  const edges: number[] = [];
  let bounce = 0;
  for (const t0 of [PRESS, RELEASE]) {
    let t = t0;
    edges.push(t);
    const pairs = 3 + Math.floor(r() * 3);
    for (let i = 0; i < pairs; i++) {
      t += 0.12 + r() * 0.45; // contact holds for a moment
      edges.push(t);
      t += 0.1 + r() * 0.3; // and springs open again
      edges.push(t);
    }
    bounce = Math.max(bounce, t - t0);
  }
  return { edges, bounce };
}

const fmt = (ms: number) => `${+ms.toFixed(2)} ms`;

function ButtonBounce() {
  const [seed, setSeed] = useState(7);
  const [pi, setPi] = useState(2);
  const [zoom, setZoom] = useState<"press" | "release">("press");
  const N = PERIODS[pi];
  const { edges, bounce } = useMemo(() => makeEdges(seed), [seed]);

  const level = (t: number) => {
    let n = 0;
    while (n < edges.length && edges[n] <= t) n++;
    return n % 2 ? 0 : 1;
  };

  // What the program sees.
  const need = Math.max(1, Math.ceil(STABLE_MS / N));
  const samples: { t: number; v: number }[] = [];
  const naive: number[] = [];
  const naiveRelease: number[] = [];
  const debounced: number[] = [];
  let last = 1;
  let state = 1;
  let run = 0;
  for (let k = 0; k * N + 0.03 <= T_END; k++) {
    const t = k * N + 0.03;
    const v = level(t);
    samples.push({ t, v });
    if (last === 1 && v === 0) (t >= RELEASE ? naiveRelease : naive).push(t);
    last = v;
    if (v !== state) {
      if (++run >= need) {
        state = v;
        run = 0;
        if (v === 0) debounced.push(t);
      }
    } else run = 0;
  }
  const naiveAll = [...naive, ...naiveRelease];
  const nNaive = naiveAll.length;
  const nDeb = debounced.length;
  const delay = nDeb ? debounced[0] - PRESS : 0;

  const why =
    nNaive === 0
      ? `Too slow: the pin is read only every ${fmt(N)}, and this press (${RELEASE - PRESS} ms long) fits between two reads. Nobody notices it. The reads must come more often than the shortest press lasts.`
      : nNaive > 1
        ? `The pin is read every ${fmt(N)}, but the contacts take about ${bounce.toFixed(1)} ms to settle. The plain edge detector sees ${nNaive} falling edges${naiveRelease.length ? ` (${naiveRelease.length} of them while the button is being released)` : ""} and counts ${nNaive} presses for one. The debounced counter only accepts a level that has read the same for ${STABLE_MS} ms (${need} reads in a row), and counts ${nDeb}.`
        : N < bounce
          ? `One press counted, but by luck: the reads are ${fmt(N)} apart and the bounce lasts ${bounce.toFixed(1)} ms, so two reads can still land in one bounce. Try "another press".`
          : `Reading the pin less often than the bounce lasts is already a debounce: two reads can never land in the same bounce, so both counters say 1. The price is reaction time: the press is noticed up to ${fmt(N)} after first contact${nDeb ? ` (here after ${delay.toFixed(1)} ms)` : ""}.`;

  // Drawing
  const X0 = 52;
  const X1 = 412;
  const xo = (t: number) => X0 + (t / T_END) * (X1 - X0);
  const zFrom = (zoom === "press" ? PRESS : RELEASE) - 1;
  const zTo = zFrom + 10;
  const xz = (t: number) => X0 + ((t - zFrom) / (zTo - zFrom)) * (X1 - X0);
  const segs = (x: (t: number) => number, from: number, to: number, hi: number, lo: number) => {
    const out: ReactNode[] = [];
    const ts = [from, ...edges.filter((e) => e > from && e < to), to];
    for (let i = 0; i < ts.length - 1; i++) {
      const v = level((ts[i] + ts[i + 1]) / 2);
      const y = v ? hi : lo;
      out.push(<line key={`h${i}`} x1={x(ts[i])} x2={x(ts[i + 1])} y1={y} y2={y} stroke={v ? "var(--orange)" : "var(--arches)"} strokeWidth={2} />);
      if (i > 0) out.push(<line key={`v${i}`} x1={x(ts[i])} x2={x(ts[i])} y1={hi} y2={lo} stroke="var(--dim)" strokeWidth={1} />);
    }
    return out;
  };
  const inZoom = samples.filter((s) => s.t >= zFrom && s.t <= zTo);
  const tri = (x: number, y: number, key: string, cls: string) => <path key={key} d={`M${x - 3.5},${y + 6} L${x},${y} L${x + 3.5},${y + 6} Z`} className={cls} />;

  return (
    <figure className="figure bb-fig" aria-label="Interactive diagram of push button contact bounce and sampling">
      <style>{`
        .bb-fig .bb-naive { fill: var(--bad); }
        .bb-fig .bb-deb { fill: var(--ok); }
        .bb-fig .bb-zoom { fill: rgba(255,255,255,0.07); stroke: var(--dim); stroke-dasharray: 3 2; stroke-width: 0.8; }
        .bb-fig .bb-counts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.4rem; margin: 0.5rem 0; }
        .bb-fig .bb-counts div { background: var(--surface); border-radius: 6px; padding: 0.3rem 0.5rem; font-size: 0.82rem; color: var(--dim); border-top: 3px solid var(--dim); }
        .bb-fig .bb-counts b { display: block; font-family: var(--mono); font-size: 1.25rem; color: var(--text); }
        .bb-fig .bb-counts .n { border-color: var(--bad); }
        .bb-fig .bb-counts .d { border-color: var(--ok); }
        .bb-fig input[type=range] { flex: 1 1 8rem; min-width: 6rem; accent-color: var(--orange); }
      `}</style>
      <svg viewBox="0 0 420 172" role="img" aria-label={`One button press with contact bounce of ${bounce.toFixed(1)} milliseconds, read every ${fmt(N)}. Plain edge detector counts ${nNaive}, debounced counter counts ${nDeb}.`}>
        {/* overview */}
        <text x={X0} y={10} className="fig-label dim">the pin during one press and release (60 ms)</text>
        <text x={4} y={21} className="fig-label">3.3 V</text>
        <text x={4} y={41} className="fig-label">0 V</text>
        <rect x={xo(zFrom)} y={13} width={xo(zTo) - xo(zFrom)} height={32} className="bb-zoom" />
        {segs(xo, 0, T_END, 18, 38)}
        <text x={xo(23)} y={32} textAnchor="middle" className="fig-label dim">held down</text>
        {naiveAll.map((t, i) => tri(xo(t), 47, `on${i}`, "bb-naive"))}
        {debounced.map((t, i) => tri(xo(t), 47, `od${i}`, "bb-deb"))}
        <path d={`M${xo(zFrom)},45 L${X0},66 M${xo(zTo)},45 L${X1},66`} className="fig-wire" strokeDasharray="3 2" style={{ strokeWidth: 0.8 }} />
        {/* zoom */}
        <rect x={X0} y={66} width={X1 - X0} height={62} className="bb-zoom" />
        <text x={4} y={81} className="fig-label">3.3 V</text>
        <text x={4} y={119} className="fig-label">0 V</text>
        {inZoom.length <= 70 && inZoom.map((s, i) => <line key={`l${i}`} x1={xz(s.t)} x2={xz(s.t)} y1={70} y2={124} className="fig-sample" />)}
        {segs(xz, zFrom, zTo, 78, 116)}
        {inZoom.map((s, i) => (
          <circle key={`c${i}`} cx={xz(s.t)} cy={s.v ? 78 : 116} r={inZoom.length > 70 ? 1.3 : 2.4} fill="var(--text)" stroke="var(--inset)" strokeWidth={0.6} />
        ))}
        <text x={4} y={91} className="fig-label dim">open</text>
        <text x={4} y={109} className="fig-label dim">closed</text>
        <text x={4} y={139} className="fig-label">plain</text>
        <text x={4} y={152} className="fig-label">debounced</text>
        {naiveAll.filter((t) => t >= zFrom && t <= zTo).map((t, i) => tri(xz(t), 132, `zn${i}`, "bb-naive"))}
        {debounced.filter((t) => t >= zFrom && t <= zTo).map((t, i) => tri(xz(t), 145, `zd${i}`, "bb-deb"))}
        <line x1={X0} x2={X1} y1={142.5} y2={142.5} stroke="rgba(255,255,255,0.12)" />
        {Array.from({ length: 11 }, (_, i) => (
          <g key={i}>
            <line x1={xz(zFrom + i)} x2={xz(zFrom + i)} y1={128} y2={131} className="fig-wire" />
            {i % 2 === 1 && <text x={xz(zFrom + i)} y={167} textAnchor="middle" className="fig-label dim">{i - 1} ms</text>}
          </g>
        ))}
        <text x={4} y={167} className="fig-label dim">time</text>
      </svg>
      <div className="bb-counts">
        <div>Real presses<b>1</b></div>
        <div className="n">Plain detector ▲<b>{nNaive}</b></div>
        <div className="d">Debounced ▲<b>{nDeb}</b></div>
      </div>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span id="bb-n">Read every</span>
          <input type="range" min={0} max={PERIODS.length - 1} step={1} value={pi} aria-labelledby="bb-n" aria-valuetext={fmt(N)} onChange={(e) => setPi(+e.target.value)} />
          <strong>{fmt(N)}</strong>
          <code>DELAY_US({Math.round(N * 1000)});</code>
        </div>
        <div>
          <span>Zoom on</span>
          <button className="fig-opt" aria-pressed={zoom === "press"} onClick={() => setZoom("press")}>the press</button>
          <button className="fig-opt" aria-pressed={zoom === "release"} onClick={() => setZoom("release")}>the release</button>
          <button className="fig-opt" onClick={() => setSeed(seed + 1)}>another press</button>
        </div>
      </div>
      <figcaption>
        Dots are the moments the program reads the pin. A triangle marks a read where a counter went up. The plain detector counts every read that is 0 after a read that was 1: <code>if (last == 1 &amp;&amp; now == 0) presses++;</code> The debounced one first waits until the new level has stayed for {STABLE_MS} ms.
      </figcaption>
    </figure>
  );
}

export const figure = { id: "button-bounce", Component: ButtonBounce };
