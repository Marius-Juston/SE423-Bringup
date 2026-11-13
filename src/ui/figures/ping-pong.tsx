// Ping-pong buffers with the DMA, as the course sets channel 1 up
// (Lectures 8-9, FFT starter project) and as TRM section 5.4 "Address
// Pointer and Transfer Control" describes it: the active destination
// address is loaded from DST_ADDR_SHADOW at the start of every transfer,
// and with MODE.CHINTMODE = 0 the channel interrupts at the start of a
// transfer (section 5.9, MODE register). So when DMA_ISR runs, the DMA has
// just begun one buffer and the OTHER one was completed one sample ago.
// The buffers are 8 samples long here instead of 1024.
import { useState } from "react";

const SIZE = 8;
const T_MAX = 5 * SIZE;
const MAIN_TIME = 5; // sample periods main needs for one buffer

const NAMES = ["ping", "pong"] as const;

interface Cell {
  sample: number | null;
  transfer: number;
}
interface Read {
  at: number;
  buf: 0 | 1;
  values: (number | null)[];
  ok: boolean;
}

function simulate(t: number, bug: boolean) {
  const bufs: Cell[][] = [0, 1].map(() => Array.from({ length: SIZE }, () => ({ sample: null, transfer: -1 })));
  const reads: Read[] = [];
  for (let s = 1; s <= t; s++) {
    const j = Math.floor((s - 1) / SIZE);
    const c = (s - 1) % SIZE;
    const dest = (j % 2) as 0 | 1;
    bufs[dest][c] = { sample: s, transfer: j };
    if (c === 0) {
      // DMA_ISR, right after the first sample of the transfer was stored
      const target = (bug ? dest : 1 - dest) as 0 | 1;
      if (bug || j > 0) reads.push({ at: s, buf: target, values: bufs[target].map((x) => x.sample), ok: !bug });
    }
  }
  return { bufs, reads };
}

const span = (v: (number | null)[]) => {
  const nums = v.filter((x): x is number => x !== null);
  return nums.length ? `${Math.min(...nums)} to ${Math.max(...nums)}` : "nothing";
};

function PingPong() {
  const [t, setT] = useState(0);
  const [bug, setBug] = useState(false);
  const { bufs, reads } = simulate(t, bug);
  const j = t ? Math.floor((t - 1) / SIZE) : 0;
  const c = t ? (t - 1) % SIZE : -1;
  const dest = (j % 2) as 0 | 1;
  const other = (1 - dest) as 0 | 1;
  const last = reads[reads.length - 1];
  const busy = last && t - last.at < MAIN_TIME;
  const isrNow = c === 0;

  let title: string;
  let text: string;
  let code = "";
  if (t === 0) {
    title = "Before the first trigger";
    text = "Both buffers are empty. InitDma() put ping's address in the shadow register. Every trigger from now on copies one sample. Press Next to send one.";
    code = "// in InitDma()\nDmaRegs.CH1.DST_ADDR_SHADOW = (Uint32)ping;";
  } else if (isrNow) {
    title = `Trigger ${t}: a transfer starts, DMA_ISR runs`;
    const start = `The DMA takes the address waiting in the shadow register (${NAMES[dest]}) and stores sample ${t} in ${NAMES[dest]}[0]. Because a transfer has started, it interrupts the CPU. DMA_ISR writes ${NAMES[other]}'s address to the shadow register: that is for the transfer after this one, the running one is not disturbed. `;
    if (bug) {
      const old = last.values.slice(1).filter((x) => x !== null).length;
      text = start + `Then the bug: it raises the flag of ${NAMES[dest]}, the buffer that has just been started. main reads ${NAMES[dest]} while the DMA is filling it: sample ${t} at the front, then ${old ? `samples ${span(last.values.slice(1))}, which are two buffers old` : "empty places"}. The numbers look reasonable, so this mistake is hard to notice.`;
      code = `DmaRegs.CH1.DST_ADDR_SHADOW = (Uint32)${NAMES[other]};\n// BUG: ${NAMES[dest]} has only just been started\n${NAMES[dest]}Ready = 1;`;
    } else if (j === 0) {
      text = start + "No buffer is complete yet, so no flag is raised this first time.";
      code = `DmaRegs.CH1.DST_ADDR_SHADOW = (Uint32)${NAMES[other]};\n// not the first time: ${NAMES[other]} is still empty\nif (DMAcount > 0) { ${NAMES[other]}Ready = 1; }`;
    } else {
      text = start + `Then it raises the flag of ${NAMES[other]}: that buffer was completed one sample ago (samples ${span(last.values)}) and the DMA will not touch it for the next ${SIZE} samples. main processes ${NAMES[other]}.`;
      code = `DmaRegs.CH1.DST_ADDR_SHADOW = (Uint32)${NAMES[other]};\n// ${NAMES[other]} was completed one sample ago\n${NAMES[other]}Ready = 1;`;
    }
  } else {
    title = `Trigger ${t}: one sample copied`;
    text = `Sample ${t} goes to ${NAMES[dest]}[${c}] and the DMA's address moves on by one. No interrupt: the CPU is not involved. ${busy ? `main is still working on ${NAMES[last.buf]}${last.ok ? ", which nobody is writing to" : ", the buffer the DMA is writing to"}.` : last ? "main has finished and waits for the next flag." : "main has nothing to do yet."}${c === SIZE - 1 ? ` That was the last place of ${NAMES[dest]}: the transfer is complete. The next trigger starts a new one.` : ""}`;
  }

  // layout
  const CX = 50;
  const CW = 34;
  const ROW = [62, 104];
  const TX0 = 50;
  const TW = 9;
  const tx = (s: number) => TX0 + s * TW;
  const nextSwap = t === 0 ? 1 : Math.min(T_MAX, Math.floor((t - 1) / SIZE) * SIZE + SIZE + 1);

  return (
    <figure className="figure pingpong" aria-label="Step-through of ping-pong buffering with the DMA">
      <style>{`.pingpong .pp-ok { fill: var(--ok); } .pingpong .pp-bad { fill: var(--bad); }`}</style>
      <svg viewBox="0 0 420 198" role="img" aria-label={`${title}. The DMA writes to ${NAMES[dest]}; the next transfer goes to ${t === 0 ? "ping" : NAMES[other]}. ${last ? `main ${busy ? "is reading" : "last read"} ${NAMES[last.buf]}, ${last.ok ? "a complete buffer" : "a buffer still being filled"}.` : "main waits."}`}>
        {/* DMA */}
        <rect x="6" y="6" width="200" height="40" rx="4" className={`fig-box ${t > 0 ? "hot" : ""}`} />
        <text x="12" y="19" className="fig-label">DMA channel 1</text>
        <text x="12" y="30" className="fig-label dim">writes to (active address):</text>
        <text x="200" y="30" textAnchor="end" className="fig-value small">{t === 0 ? "-" : `${NAMES[dest]}[${c}]`}</text>
        <text x="12" y="41" className="fig-label dim">next transfer (DST_ADDR_SHADOW):</text>
        <text x="200" y="41" textAnchor="end" className="fig-value small">{t === 0 ? "ping" : NAMES[other]}</text>
        {/* main */}
        <rect x="214" y="6" width="200" height="40" rx="4" className={`fig-box ${busy ? (last.ok ? "active" : "hot") : ""}`} />
        <text x="220" y="19" className="fig-label">main</text>
        <text x="220" y="30" className="fig-label dim">{busy ? `flag ${NAMES[last.buf]}Ready seen:` : "waiting for a flag"}</text>
        {busy && <text x="408" y="30" textAnchor="end" className="fig-value small">processing {NAMES[last.buf]}</text>}
        {last && (
          <text x="220" y="41" className={`fig-label ${last.ok ? "pp-ok" : "pp-bad"}`}>
            {last.ok ? `good: samples ${span(last.values)}, one whole buffer` : `wrong: sample ${last.values[0]} + ${last.values[1] === null ? "empty places" : `old ${span(last.values.slice(1))}`}`}
          </text>
        )}
        {/* buffers */}
        {([0, 1] as const).map((bi) => {
          const filling = t > 0 && dest === bi;
          const reading = busy && last.buf === bi;
          const empty = bufs[bi].every((x) => x.sample === null);
          const y = ROW[bi];
          return (
            <g key={bi}>
              <text x="6" y={y + 15} className="fig-value">{NAMES[bi]}</text>
              {bufs[bi].map((cell, i) => {
                const now = filling && i === c;
                const fresh = cell.transfer === j && filling;
                return (
                  <g key={i}>
                    <rect x={CX + i * CW} y={y} width={CW - 2} height="22" rx="3" className={`fig-box ${now ? "hot" : cell.sample === null ? "off" : ""}`} />
                    <text x={CX + i * CW + CW / 2 - 1} y={y + 15} textAnchor="middle" className={cell.sample === null ? "fig-label dim" : filling && !fresh ? "fig-label dim" : "fig-value"}>{cell.sample ?? ""}</text>
                    {now && <path d={`M${CX + i * CW + CW / 2 - 6},${y - 9} h10 l-5,7 z`} fill="var(--orange)" />}
                  </g>
                );
              })}
              {reading && <rect x={CX - 3} y={y - 3} width={SIZE * CW + 4} height="28" rx="5" fill="none" stroke={last.ok ? "var(--ok)" : "var(--bad)"} strokeWidth="1.6" strokeDasharray="5 3" />}
              <text x={CX + SIZE * CW + 6} y={y + 9} className="fig-label" style={{ fill: filling ? "var(--orange)" : undefined }}>{filling ? "DMA is filling" : empty ? "empty" : "complete"}</text>
              <text x={CX + SIZE * CW + 6} y={y + 20} className={`fig-label ${reading ? (last.ok ? "pp-ok" : "pp-bad") : "dim"}`}>{reading ? "main is reading" : filling ? "do not read" : empty ? "" : "safe to read"}</text>
            </g>
          );
        })}
        {/* timeline */}
        <line x1={tx(t)} x2={tx(t)} y1="141" y2="182" stroke="var(--text)" strokeWidth="1.6" />
        <text x="6" y="152" className="fig-label dim">DMA fills</text>
        <text x="6" y="172" className="fig-label dim">main reads</text>
        {[0, 1, 2, 3, 4].map((k) => (
          <g key={k}>
            <rect x={tx(k * SIZE)} y="142" width={SIZE * TW - 1} height="14" rx="2" className={`fig-box ${k * SIZE < t ? "" : "off"}`} />
            <text x={tx(k * SIZE) + (SIZE * TW) / 2} y="152.5" textAnchor="middle" className="fig-label">{NAMES[k % 2]}</text>
            <line x1={tx(k * SIZE) + TW} x2={tx(k * SIZE) + TW} y1="136" y2="158" stroke={k * SIZE < t ? "var(--orange)" : "var(--dim)"} strokeWidth="1.2" strokeDasharray={k * SIZE < t ? undefined : "2 2"} />
            <text x={tx(k * SIZE) + TW + 2} y="139" className={`fig-label ${k * SIZE < t ? "" : "dim"}`} style={k * SIZE < t ? { fill: "var(--orange)" } : undefined}>DMA_ISR</text>
          </g>
        ))}
        {reads.map((r, i) => {
          const w = Math.max(0, Math.min(MAIN_TIME, t - r.at)) * TW;
          return (
            <g key={i}>
              <rect x={tx(r.at)} y="162" width={MAIN_TIME * TW} height="14" rx="2" fill="var(--surface)" stroke={r.ok ? "var(--ok)" : "var(--bad)"} strokeWidth="1" />
              <rect x={tx(r.at)} y="162" width={w} height="14" rx="2" fill={r.ok ? "var(--ok)" : "var(--bad)"} fillOpacity="0.3" />
              <text x={tx(r.at) + (MAIN_TIME * TW) / 2} y="172.5" textAnchor="middle" className={`fig-label ${r.ok ? "pp-ok" : "pp-bad"}`}>{NAMES[r.buf]}{r.ok ? "" : " !"}</text>
            </g>
          );
        })}
        <text x={Math.min(tx(t), 380)} y="192" textAnchor="middle" className="fig-label">{t === 0 ? "start" : `after trigger ${t}`}</text>
      </svg>
      <div className="fig-step" role="status">
        <strong>{title}</strong>
        <p>{text}</p>
        {code && <pre><code>{code}</code></pre>}
      </div>
      <div className="fig-controls row">
        <button className="btn small" onClick={() => setT(Math.max(0, t - 1))} disabled={t === 0}>Back</button>
        <button className="btn small primary" onClick={() => setT(Math.min(T_MAX, t + 1))} disabled={t >= T_MAX} aria-label="Next sample">Next</button>
        <button className="btn small" onClick={() => setT(nextSwap)} disabled={t >= T_MAX}>To the next swap</button>
        <button className="btn small" onClick={() => setT(0)} disabled={t === 0}>Reset</button>
      </div>
      <div className="fig-controls">
        <div>
          <span>main reads</span>
          <button className="fig-opt" aria-pressed={!bug} onClick={() => setBug(false)}>the buffer just completed</button>
          <button className="fig-opt" aria-pressed={bug} onClick={() => setBug(true)}>the buffer just started (bug)</button>
        </div>
      </div>
      <figcaption>Two buffers, 8 samples each here (1024 in the course project). Numbers are sample numbers; grey numbers are old samples that will be overwritten. The interrupt comes when a transfer starts, so main must read the buffer the DMA has just finished, never the one it has just started.</figcaption>
    </figure>
  );
}

export const figure = { id: "ping-pong", Component: PingPong };
