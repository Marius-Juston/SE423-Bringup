import { useState, type ReactNode } from "react";

// Sender and receiver with different bit clocks. TRM 19.10 "SCI
// Communication Format" (Figure 19-7): the receiver starts timing at the
// falling edge of the start bit and decides each bit in the middle of the
// bit time (the SCI takes three samples on SCICLK periods 4, 5 and 6 of 8
// and uses the majority; one mid-bit sample is drawn here). "Since the
// receiver synchronizes itself to frames", the clocks only have to agree for
// the ten bits of one character. TRM 19.12: baud = LSPCLK / ((BRR + 1) x 8),
// and BRR is a whole number, so the real rate is usually a fraction of a
// percent off the one asked for.

const GAP = 2; // idle bit times between the two characters
const BAUD = 115200;
const hex = (v: number) => `0x${v.toString(16).toUpperCase().padStart(2, "0")}`;
const printable = (v: number) => (v >= 0x21 && v < 0x7f ? ` '${String.fromCharCode(v)}'` : "");

interface Rx {
  start: number;
  /** For k = 0..9 (start, b0..b7, stop): sample time, value read, and whether it was taken inside the right bit. */
  samples: { t: number; v: number; ok: boolean }[];
  value: number;
  sent: number | null;
  framing: boolean;
}

function BaudMismatch() {
  const [err, setErr] = useState(3);
  const [text, setText] = useState("UA");
  const codes = [...(text + "UA")].slice(0, 2).map((c) => c.charCodeAt(0) & 0xff);

  // Sender: time in sender bit times, 0 = first start edge.
  const frameStart = [0, 10 + GAP];
  const end = frameStart[1] + 10 + 1.5;
  const level = (t: number): number => {
    for (let f = 0; f < 2; f++) {
      const u = t - frameStart[f];
      if (u >= 0 && u < 10) {
        const k = Math.floor(u);
        return k === 0 ? 0 : k === 9 ? 1 : (codes[f] >> (k - 1)) & 1;
      }
    }
    return 1;
  };
  // Falling edges of the sender's line.
  const falls: number[] = [];
  for (let h = -1; h < end * 2; h++) {
    const t = h / 2;
    if (Number.isInteger(t) && level(t - 0.01) === 1 && level(t + 0.01) === 0) falls.push(t);
  }

  // Receiver: its bit lasts 1 / (1 + err) sender bits.
  const r = 1 / (1 + err / 100);
  const rx: Rx[] = [];
  let from = -1;
  for (let guard = 0; guard < 4; guard++) {
    const start = falls.find((f) => f > from);
    if (start === undefined || start + 9.5 * r > end) break;
    const f = frameStart.indexOf(start);
    const samples = Array.from({ length: 10 }, (_, k) => {
      const t = start + (k + 0.5) * r;
      return { t, v: level(t), ok: f >= 0 && Math.floor(t - start) === k };
    });
    let value = 0;
    for (let k = 1; k <= 8; k++) value |= samples[k].v << (k - 1);
    rx.push({ start, samples, value, sent: f >= 0 ? codes[f] : null, framing: samples[9].v === 0 });
    from = samples[9].t;
  }
  const bad = rx.filter((q) => q.sent === null || q.value !== q.sent || q.framing);
  const drift = 9.5 * Math.abs(r - 1);
  const firstMiss = rx[0]?.samples.findIndex((s) => !s.ok) ?? -1;
  const slipName = firstMiss === 9 ? "the stop bit" : firstMiss === 0 ? "the start bit" : `data bit ${firstMiss - 1}`;
  const dir = err > 0 ? "fast" : "slow";
  const rxBaud = Math.round(BAUD * (1 + err / 100));

  const why =
    err === 0
      ? "Both clocks agree: every sample lands exactly in the middle of its bit."
      : bad.length === 0 && firstMiss < 0
        ? `The receiver's clock is ${Math.abs(err)} % ${dir}, so every sample lands a little ${err > 0 ? "earlier" : "later"} than the one before. By the stop bit it is off by ${drift.toFixed(2)} of a bit, still inside the right bit, so both characters are read correctly. The next start edge starts the timing afresh: the error never grows beyond one character.`
        : bad.length === 0
          ? `The receiver's clock is ${Math.abs(err)} % ${dir}. Its sample for ${slipName} already lands in the neighbouring bit. These characters happen to read correctly because the neighbouring bit has the same value; other data will not.`
          : `The receiver's clock is ${Math.abs(err)} % ${dir}. The samples slide ${err > 0 ? "earlier" : "later"} by ${(Math.abs(r - 1) * 100).toFixed(1)} % of a bit each time, and by ${slipName} they land in the wrong bit: the receiver reads ${rx.map((q) => hex(q.value) + (q.framing ? " with a framing error" : "")).join(" and ")} instead of ${codes.map(hex).join(" and ")}. The limit is about 5 %: 9.5 bits x 5 % is half a bit.`;

  const X0 = 30;
  const X1 = 416;
  const T0 = -1;
  const x = (t: number) => X0 + ((t - T0) / (end - T0)) * (X1 - X0);
  const HI = 30;
  const LO = 50;
  const bw = x(1) - x(0);
  const names = ["S", "0", "1", "2", "3", "4", "5", "6", "7", "P"];
  // Sender trace
  const trace: ReactNode[] = [];
  const edges = [T0];
  for (let h = 0; h <= end; h++) if (level(h - 0.01) !== level(h + 0.01)) edges.push(h);
  edges.push(end);
  for (let i = 0; i < edges.length - 1; i++) {
    const v = level((edges[i] + edges[i + 1]) / 2);
    trace.push(<line key={`h${i}`} x1={x(edges[i])} x2={x(edges[i + 1])} y1={v ? HI : LO} y2={v ? HI : LO} stroke={v ? "var(--orange)" : "var(--arches)"} strokeWidth={2.2} />);
    if (i > 0) trace.push(<line key={`v${i}`} x1={x(edges[i])} x2={x(edges[i])} y1={HI} y2={LO} stroke="var(--dim)" strokeWidth={1.2} />);
  }

  return (
    <figure className="figure bm-fig" aria-label="Interactive diagram of a receiver sampling a serial line with a different baud rate">
      <style>{`
        .bm-fig .bm-cell { fill: var(--surface); stroke: var(--dim); stroke-width: 0.7; }
        .bm-fig .bm-cell.bad { fill: var(--bad-soft, rgba(255, 138, 115, 0.2)); stroke: var(--bad); stroke-width: 1.4; }
        .bm-fig .bm-tick { stroke: var(--text); stroke-width: 0.9; }
        .bm-fig .bm-tick.bad { stroke: var(--bad); stroke-width: 1.6; }
        .bm-fig .bm-res { font-size: 8.5px; font-family: var(--mono); font-weight: 700; fill: var(--ok); }
        .bm-fig .bm-res.bad { fill: var(--bad); }
        .bm-fig input[type=range] { flex: 1 1 8rem; min-width: 6rem; accent-color: var(--orange); }
        .bm-fig .bm-in { width: 3.2em; font: inherit; font-family: var(--mono); text-align: center; background: var(--inset); color: var(--text); border: 1px solid var(--border-strong, var(--dim)); border-radius: 4px; }
      `}</style>
      <svg viewBox="0 0 420 135" role="img" aria-label={`Sender at ${BAUD} baud sends ${codes.map(hex).join(" and ")}. Receiver clock ${Math.abs(err)} percent ${dir}: it reads ${rx.map((q) => hex(q.value)).join(" and ")}${bad.length ? ", wrong" : ", correct"}.`}>
        <text x={4} y={8} className="fig-label">Sender: {BAUD} baud, sends {codes.map((c) => hex(c) + printable(c)).join(" then ")}</text>
        <text x={4} y={HI + 3} className="fig-label">1</text>
        <text x={4} y={LO + 3} className="fig-label">0</text>
        {frameStart.map((s, f) =>
          names.map((nm, k) => (
            <g key={`${f}${k}`}>
              <line x1={x(s + k)} x2={x(s + k)} y1={HI - 6} y2={LO + 4} stroke="var(--dim)" strokeWidth={0.5} strokeDasharray="1.5 2" />
              <text x={x(s + k) + bw / 2} y={HI - 9} textAnchor="middle" className="fig-label dim">{nm}</text>
            </g>
          )),
        )}
        {trace}
        {/* samples */}
        {rx.map((q, f) =>
          q.samples.map((sm, k) => (
            <g key={`${f}${k}`}>
              <line x1={x(sm.t)} x2={x(sm.t)} y1={HI - 3} y2={64} className={`bm-tick ${sm.ok ? "" : "bad"}`} />
              <circle cx={x(sm.t)} cy={sm.v ? HI : LO} r={2.3} fill={sm.ok ? "var(--text)" : "var(--bad)"} stroke="var(--inset)" strokeWidth={0.6} />
            </g>
          )),
        )}
        {/* the receiver's idea of the bits */}
        {rx.map((q, f) => (
          <g key={f}>
            {q.samples.map((sm, k) => (
              <g key={k}>
                <rect x={x(q.start + k * r)} y={64} width={bw * r} height={17} className={`bm-cell ${sm.ok ? "" : "bad"}`} />
                <text x={x(sm.t)} y={76} textAnchor="middle" className="fig-value small" style={sm.ok ? undefined : { fill: "var(--bad)" }}>{sm.v}</text>
                <text x={x(sm.t)} y={91} textAnchor="middle" className="fig-label dim">{sm.ok ? names[k] : "✗"}</text>
              </g>
            ))}
            <text x={x(q.start)} y={104} className={`bm-res ${q.sent === q.value && !q.framing ? "" : "bad"}`}>
              {q.sent === q.value && !q.framing ? `✓ read ${hex(q.value)}${printable(q.value)}` : `✗ read ${hex(q.value)}${printable(q.value)}${q.framing ? ", framing error" : ""}`}
            </text>
          </g>
        ))}
        <text x={4} y={76} className="fig-label">rx</text>
        <text x={4} y={119} className="fig-label">Receiver: {rxBaud} baud. Each box is one of its bit times, read in the middle.</text>
        <text x={4} y={131} className="fig-label dim">Drift at the stop bit: 9.5 bits x {(Math.abs(r - 1) * 100).toFixed(1)} % = {drift.toFixed(2)} bit (must stay under 0.5)</text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span id="bm-e">Receiver</span>
          <input type="range" min={-12} max={12} step={0.5} value={err} aria-labelledby="bm-e" aria-valuetext={`${Math.abs(err)} percent ${dir}`} onChange={(e) => setErr(+e.target.value)} />
          <strong>{err > 0 ? "+" : ""}{err} %</strong>
        </div>
        <div>
          <span>Try</span>
          <button className="fig-opt" aria-pressed={err === 0.5} onClick={() => setErr(0.5)}>+0.5 %: a typical rounding error</button>
          <button className="fig-opt" aria-pressed={err === 3} onClick={() => setErr(3)}>+3 %</button>
          <button className="fig-opt" aria-pressed={err === 6} onClick={() => setErr(6)}>+6 %</button>
          <button className="fig-opt" aria-pressed={err === -8} onClick={() => setErr(-8)}>-8 %</button>
        </div>
        <div>
          <span id="bm-c">Characters</span>
          <input className="bm-in" type="text" maxLength={2} value={text} aria-labelledby="bm-c" onChange={(e) => setText(e.target.value)} />
        </div>
      </div>
      <figcaption>
        There is no clock wire, so the receiver measures time from the falling edge of each start bit with its own clock. S is the start bit, 0 to 7 the data bits, P the stop bit. A red box is a sample taken in the wrong bit. The real SCI takes three samples around the middle of each bit and uses the majority.
      </figcaption>
    </figure>
  );
}

export const figure = { id: "baud-mismatch", Component: BaudMismatch };
