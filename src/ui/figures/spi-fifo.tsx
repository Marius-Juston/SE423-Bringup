import { useState } from "react";

// TRM 18.3.7 (FIFO operation) and 18.5.2.9 / 18.5.2.10 (SPIFFTX, SPIFFRX):
// 16 words each way; TXFFST / RXFFST count the words waiting; the receive
// interrupt flag RXFFINT sets when RXFFST >= RXFFIL; a 17th received word
// pushes out the oldest and sets RXFFOVF. Reading SPIRXBUF with the FIFO
// empty returns the last word again (what the simulator in this game does).
// The words here come back unchanged, as in the loopback levels.

const CSS = `
.sf-slot { fill: var(--surface); stroke: var(--border-strong); stroke-width: 0.8; }
.sf-slot.full { fill: var(--accent-soft); stroke: var(--accent); stroke-width: 1.2; }
.sf-slot.next { stroke-width: 1.8; }
.sf-word { font-family: var(--mono); font-size: max(8.5px, calc(9px / var(--fig-k, 1))); fill: var(--text); letter-spacing: -0.5px; }
.sf-mark { stroke: var(--value); stroke-width: 2; }
.sf-num { font-family: var(--mono); font-weight: 700; }
.sf-fig input[type=range] { flex: 1 1 7rem; min-width: 6rem; max-width: 12rem; padding: 0; accent-color: var(--accent); }
`;

const h4 = (v: number) => v.toString(16).toUpperCase().padStart(4, "0");

interface S {
  tx: number[];
  rx: number[];
  next: number;
  last: number | null;
  lastSent: number | null;
  note: "" | "empty" | "txfull" | "rxovf" | "read" | "wrote" | "shifted";
}
const START: S = { tx: [], rx: [], next: 1, last: null, lastSent: null, note: "" };

/** The two 16-word SPI FIFOs and the receive interrupt level. */
function SpiFifo() {
  const [s, setS] = useState<S>(START);
  const [ffil, setFfil] = useState(2);
  const write = (k: number) =>
    setS((p) => {
      let { tx, next } = p;
      let note: S["note"] = "wrote";
      for (let i = 0; i < k; i++) {
        if (tx.length >= 16) {
          note = "txfull";
          break;
        }
        tx = [...tx, 0x00a0 + next];
        next = (next % 0xfff) + 1;
      }
      return { ...p, tx, next, note };
    });
  const shift = (all: boolean) =>
    setS((p) => {
      let { tx, rx, lastSent } = p;
      let note: S["note"] = "shifted";
      do {
        if (!tx.length) break;
        lastSent = tx[0];
        tx = tx.slice(1);
        if (rx.length >= 16) {
          rx = rx.slice(1);
          note = "rxovf";
        }
        rx = [...rx, lastSent];
      } while (all);
      return { ...p, tx, rx, lastSent, note };
    });
  const read = () => setS((p) => (p.rx.length ? { ...p, rx: p.rx.slice(1), last: p.rx[0], note: "read" } : { ...p, note: "empty" }));

  const irq = s.rx.length >= ffil;
  const X0 = 14;
  const W = 24.5;
  const TY = 30;
  const RY = 118;
  const row = (q: number[], y: number, label: string) =>
    Array.from({ length: 16 }, (_, i) => (
      <g key={i}>
        <rect x={X0 + i * W} y={y} width={W - 2} height={20} rx="2" className={`sf-slot ${i < q.length ? "full" : ""} ${i === 0 && q.length ? "next" : ""}`} />
        {i < q.length && <text x={X0 + i * W + (W - 2) / 2} y={y + 13.5} textAnchor="middle" className="sf-word">{q[i].toString(16).toUpperCase()}</text>}
        {i === 0 && <title>{label}</title>}
      </g>
    ));
  const tailX = X0 + Math.min(15, s.rx.length) * W + (W - 2) / 2;
  const markX = X0 + ffil * W - 1;
  const why =
    s.note === "empty"
      ? `SPIRXBUF was read with the receive FIFO empty (RXFFST = 0). It does not wait: it hands back the old word${s.last !== null ? ` 0x${h4(s.last)}` : ""} again. A program that reads before the words have arrived, or reads more words than it sent, gets stale data.`
      : s.note === "txfull"
        ? "The transmit FIFO is full: 16 words are waiting. A 17th write is lost. Let the words leave first (TXFFST below 16)."
        : s.note === "rxovf"
          ? "Receive overflow: 16 words were waiting and another arrived, so the oldest one was pushed out and lost (RXFFOVF = 1). Every word sent is a word received: read SPIRXBUF once for each word."
          : irq && s.tx.length
            ? `RXFFST (${s.rx.length}) has reached RXFFIL (${ffil}), so the interrupt fires now, but ${s.tx.length} word${s.tx.length > 1 ? "s are" : " is"} still on the way out. An interrupt function that reads all the words of the message now finds the FIFO empty on its last reads. RXFFIL must equal the number of words sent.`
            : irq
              ? `RXFFST (${s.rx.length}) >= RXFFIL (${ffil}): RXFFINT is set and the SPIB receive interrupt is requested. The interrupt function should read ${s.rx.length === ffil ? `${ffil} word${ffil > 1 ? "s" : ""}` : `all ${s.rx.length} words: ${s.rx.length - ffil} more than RXFFIL arrived, and words left behind are first in line next time`}. If it clears the flag without reading, the interrupt fires again at once.`
              : s.rx.length
                ? `${s.rx.length} word${s.rx.length > 1 ? "s are" : " is"} waiting, fewer than RXFFIL (${ffil}), so no interrupt${s.tx.length ? " yet" : ": if the message is over, " + (s.rx.length > 1 ? "these words stay" : "this word stays") + " here and the next read returns 0x" + h4(s.rx[0]) + ", an answer from an earlier message"}.`
                : s.tx.length
                  ? `${s.tx.length} word${s.tx.length > 1 ? "s are" : " is"} queued. The shifter sends them one after the other, oldest first; for each one sent, one word arrives in the receive FIFO.`
                  : s.note === "read"
                    ? "Both FIFOs are empty: everything that was sent has been read out. This is how every transfer should end."
                    : "Both FIFOs are empty. Write some words to SPITXBUF, clock them out, and watch RXFFST climb to the RXFFIL mark.";
  return (
    <figure className="figure sf-fig" aria-label="Interactive diagram of the SPI transmit and receive FIFOs">
      <style>{CSS}</style>
      <svg viewBox="0 0 420 172" role="img" aria-label={`Transmit FIFO holds ${s.tx.length} word${s.tx.length === 1 ? "" : "s"}, receive FIFO holds ${s.rx.length} word${s.rx.length === 1 ? "" : "s"}, RXFFIL is ${ffil}, receive interrupt ${irq ? "requested" : "not requested"}.`}>
        <text x={X0} y={12} className="fig-label">transmit FIFO: words written to SPITXBUF wait here</text>
        <text x={404} y={12} textAnchor="end" className="fig-value small">TXFFST = {s.tx.length}</text>
        <text x={X0} y={24} className="fig-label dim">next out</text>
        {row(s.tx, TY, "transmit FIFO")}
        {/* shifter */}
        <path d={`M${X0 + 10},${TY + 20} V${TY + 33}`} className="fig-wire" />
        <polygon points={`${X0 + 10},${TY + 37} ${X0 + 6},${TY + 31} ${X0 + 14},${TY + 31}`} className="fig-arrowhead" />
        <rect x={X0} y={TY + 37} width="172" height="22" rx="4" className="fig-box active" />
        <text x={X0 + 6} y={TY + 51} className="fig-label">shift register: 16 clocks per word</text>
        <text x={X0 + 180} y={TY + 46} className="fig-label dim">out on SIMO, and at the same time</text>
        <text x={X0 + 180} y={TY + 57} className="fig-label dim">a word comes in on SOMI{s.lastSent !== null ? `: last 0x${h4(s.lastSent)}` : ""}</text>
        <path d={`M${X0 + 140},${TY + 59} V${RY - 22} H${tailX} V${RY - 6}`} className="fig-wire" />
        <polygon points={`${tailX},${RY - 1} ${tailX - 4},${RY - 7} ${tailX + 4},${RY - 7}`} className="fig-arrowhead" />
        {/* receive */}
        {row(s.rx, RY, "receive FIFO")}
        <line x1={markX} x2={markX} y1={RY - 5} y2={RY + 25} className="sf-mark" />
        <text x={X0} y={RY + 33} className="fig-label dim">next read</text>
        <text x={Math.max(X0 + 48, markX + (markX > 300 ? -3 : 3))} y={RY + 33} textAnchor={markX > 300 ? "end" : "start"} className="fig-value small">RXFFIL = {ffil}</text>
        <text x={X0} y={RY + 48} className="fig-label">receive FIFO: RXFFST = <tspan className="sf-num" style={{ fill: "var(--value)" }}>{s.rx.length}</tspan></text>
        <text x={404} y={RY + 48} textAnchor="end" className="fig-label" style={{ fill: irq ? "var(--accent)" : "var(--dim)", fontWeight: irq ? 700 : 400 }}>
          {irq ? "RXFFST >= RXFFIL: receive interrupt" : "RXFFST < RXFFIL: no interrupt"}
        </text>
      </svg>
      <p className="fig-why" role="status">{why}</p>
      <div className="fig-controls">
        <div>
          <span>Program</span>
          <button className="fig-opt" onClick={() => write(1)}>write SPITXBUF</button>
          <button className="fig-opt" onClick={() => write(3)}>write 3 words</button>
          <button className="fig-opt" onClick={read}>read SPIRXBUF</button>
          <code>{s.note === "read" || s.note === "empty" ? `x = SpibRegs.SPIRXBUF;  // 0x${s.last !== null ? h4(s.last) : "0000"}${s.note === "empty" ? ", stale" : ""}` : `SpibRegs.SPITXBUF = 0x${h4(0x00a0 + s.next)};`}</code>
        </div>
        <div>
          <span>Bus</span>
          <button className="fig-opt" disabled={!s.tx.length} onClick={() => shift(false)}>clock out one word</button>
          <button className="fig-opt" disabled={!s.tx.length} onClick={() => shift(true)}>clock out all</button>
          <button className="fig-opt" disabled={s === START} onClick={() => setS(START)}>Reset</button>
        </div>
        <div>
          <span>RXFFIL</span>
          <input type="range" min={1} max={16} value={ffil} aria-label="Receive FIFO interrupt level RXFFIL" onChange={(e) => setFfil(+e.target.value)} />
          <code>SpibRegs.SPIFFRX.bit.RXFFIL = {ffil};</code>
        </div>
      </div>
      <figcaption>Each FIFO is a queue of 16 words: the thick slot is the oldest word, the next to leave. Try the bugs: send 3 words with RXFFIL = 2 (the interrupt comes one word early), or send 2 words and read only 1 (the leftover is what the next read returns).</figcaption>
    </figure>
  );
}

export const figure = {
  id: "spi-fifo",
  title: "SPI transmit and receive FIFOs",
  description: "Send words, read them back and move the interrupt level to see how the two queues fill and when the receive interrupt comes.",
  Component: SpiFifo,
};
