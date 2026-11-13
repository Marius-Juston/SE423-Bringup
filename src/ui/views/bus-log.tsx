import type { ReactNode } from "react";
import type { Board } from "../../sim/board";
import type { CanModule, CanState } from "../../sim/plugins/can";
import type { I2cState } from "../../sim/plugins/i2c";
import type { SpiWord } from "../../sim/plugins/spi";
import type { BenchView, ViewProps } from "./types";

// Recent traffic on the serial buses, in plain words, newest last. Reads
// what the plugins keep: the SPI word log (spi.ts `log`), the I2C transfer
// log (i2c.ts `bus.log`: 7-bit address, read/write bit, ACK, data bytes),
// and for CAN the frames sent, the history of the CAN_RX_FRAMES counter and
// the current contents of the receive objects (can.ts keeps no list of
// received frames). A CAN message object keeps an 11-bit identifier in bits
// 28..18 of its arbitration register and a 29-bit one in bits 28..0 (TRM
// 22.14, CAN_IF1ARB).

const CSS = `
.bl-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.15rem; font-size: 0.85rem; }
.bl-list li { display: grid; grid-template-columns: 5.6rem 2.6rem 1fr; gap: 0.4rem; align-items: baseline; padding: 0.1rem 0.3rem; border-radius: 4px; }
.bl-list li:last-child { background: var(--inset); }
.bl-t { font-family: var(--mono); color: var(--dim); font-size: 0.78rem; text-align: right; }
.bl-bus { font-weight: 700; font-size: 0.78rem; color: var(--text); }
.bl-list code { font-size: 0.8rem; overflow-wrap: anywhere; }
.bl-bad { color: var(--bad); font-weight: 700; }
.bl-sum { color: var(--dim); font-size: 0.8rem; margin: 0.35rem 0 0; }
`;

const MS = 1e6;
/** Lines shown (a line is one SPI transfer, one I2C transfer or one CAN frame). */
const MAX = 6;
/** Longest SPI transfer shown as one line, in words. */
const MAX_WORDS = 16;
const hex = (v: number, d: number) => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(d, "0");
const bytes = (data: number[]) => data.map((v) => hex(v, 2).slice(2)).join(" ");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

interface SpiBusState {
  log: SpiWord[];
}
interface Entry {
  t: number;
  bus: "SPI" | "I2C" | "CAN";
  body: ReactNode;
}

const spiOf = (b: Board) => b.plugins.get("spi") as SpiBusState | undefined;
const i2cOf = (b: Board) => b.plugins.get("i2c") as I2cState | undefined;
const canOf = (b: Board) => b.plugins.get("can") as CanState | undefined;

/** Number of entries with t <= tNs in a list ordered by time. */
function upTo<T extends { t: number }>(list: T[], tNs: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t <= tNs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function BusLog({ board, window: [, to] }: ViewProps) {
  const until = to * MS;
  const entries: Entry[] = [];
  const spi = spiOf(board)?.log ?? [];
  const i2c = i2cOf(board)?.bus.log ?? [];
  const can = canOf(board);
  const mods: [string, CanModule][] = can ? [["A", can.a], ["B", can.b]] : [];
  const bothCan = mods.filter(([, m]) => m.sent.length > 0 || m.stored > 0).length > 1;

  // SPI: words that follow each other closely (same device) are one transfer.
  // Only the last few words are looked at, however long the log is.
  const nSpi = upTo(spi, until);
  const tail = spi.slice(Math.max(0, nSpi - MAX * MAX_WORDS), nSpi);
  let minGap = 100_000;
  for (let i = 1; i < tail.length; i++) if (tail[i].t > tail[i - 1].t) minGap = Math.min(minGap, tail[i].t - tail[i - 1].t);
  const groups: SpiWord[][] = [];
  for (const w of tail) {
    const g = groups[groups.length - 1];
    const last = g?.[g.length - 1];
    if (g && last && g.length < MAX_WORDS && last.device === w.device && last.port === w.port && last.bits === w.bits && w.t - last.t <= 2.6 * minGap) g.push(w);
    else groups.push([w]);
  }
  for (const g of groups.slice(-MAX)) {
    const w = g[g.length - 1];
    const d = Math.ceil(w.bits / 4);
    const loop = !w.device && board.dev.get(`Spi${w.port}Regs.SPICCR`, "SPILBK") === 1;
    const list = (f: (x: SpiWord) => number) => g.map((x) => hex(f(x), d)).join(" ");
    entries.push({
      t: w.t,
      bus: "SPI",
      body: (
        <>
          {plural(g.length, `${w.bits}-bit word`)} {w.device ? `with the ${w.device}` : loop ? "in loopback" : ""}
          {!w.device && !loop && <span className="bl-bad">with no chip select low: no device answered</span>}
          <br />
          sent <code>{list((x) => x.out)}</code>
          <br />
          received <code>{list((x) => x.in)}</code>
        </>
      ),
    });
  }
  const nI2c = upTo(i2c, until);
  for (let i = Math.max(0, nI2c - MAX); i < nI2c; i++) {
    const x = i2c[i];
    entries.push({
      t: x.t,
      bus: "I2C",
      body: (
        <>
          START, address <code>{hex(x.address, 2)}</code> + {x.read ? "read" : "write"} bit (byte <code>{hex(((x.address << 1) | (x.read ? 1 : 0)) & 0xff, 2)}</code>):{" "}
          {x.acked ? "ACK" : <span className="bl-bad">NACK, no device at this address</span>}
          {x.data.length ? (
            <>
              ; {plural(x.data.length, "byte")} {x.read ? "from the device" : "to the device"}: <code>{bytes(x.data.slice(0, 16))}{x.data.length > 16 ? " ..." : ""}</code>
            </>
          ) : null}
          {x.stopped ? "; STOP" : "; no STOP yet"}
        </>
      ),
    });
  }
  for (const [letter, m] of mods) {
    const nSent = upTo(m.sent, until);
    for (let i = Math.max(0, nSent - MAX); i < nSent; i++) {
      const f = m.sent[i];
      entries.push({
        t: f.t,
        bus: "CAN",
        body: (
          <>
            {bothCan ? `CAN-${letter} ` : ""}sent a frame, {f.extended ? "29-bit" : "11-bit"} identifier <code>{hex(f.id, f.extended ? 8 : 3)}</code>, {plural(f.data.length, "data byte")}
            {f.data.length ? <>: <code>{bytes(f.data)}</code></> : null}
          </>
        ),
      });
    }
  }
  const rx = board.outputs.get("CAN_RX_FRAMES") ?? [];
  const nRx = upTo(rx, until);
  for (let i = Math.max(0, nRx - MAX); i < nRx; i++) if (rx[i].v > 0 && Number.isFinite(rx[i].v)) entries.push({ t: rx[i].t, bus: "CAN", body: <>received frame number {rx[i].v} and stored it in a message object</> });
  entries.sort((a, b) => a.t - b.t);
  const shown = entries.slice(-MAX);

  // CAN: what the receive objects hold now (the frames themselves are not logged).
  const objs = mods.flatMap(([letter, m]) =>
    m.objs.flatMap((o, k) => (k >= 1 && o && o.arb >>> 31 === 1 && !(o.arb & 0x20000000) ? [{ o, k, letter }] : [])),
  );
  const last = (name: string) => {
    const tr = board.outputs.get(name);
    const n = tr ? upTo(tr, until) : 0;
    return n ? tr![n - 1].v : 0;
  };
  const i2cCounts = board.outputs.has("I2C_STARTS");

  if (!shown.length && !objs.length && !i2cCounts) return <p className="hint-text">Words, bytes and frames on SPI, I2C and CAN will be listed here.</p>;
  return (
    <div>
      <style>{CSS}</style>
      {/* A plain list, not a live region: it is redrawn every frame. */}
      <ol className="bl-list" aria-label="Recent bus traffic, newest last">
        {shown.map((e, i) => (
          <li key={i}>
            <span className="bl-t">{(e.t / MS).toFixed(3)} ms</span>
            <span className="bl-bus">{e.bus}</span>
            <span>{e.body}</span>
          </li>
        ))}
      </ol>
      {nSpi > 0 && <p className="bl-sum">SPI: {plural(nSpi, "word")} exchanged so far. Every word sent is a word received.</p>}
      {i2cCounts && (
        <p className="bl-sum">
          I2C so far: {last("I2C_STARTS")} START, {last("I2C_STOPS")} STOP, {last("I2C_ADDR_ACKS")} address ACK, {last("I2C_ADDR_NACKS")} address NACK, {plural(last("I2C_DATA_BYTES"), "data byte")}.
        </p>
      )}
      {objs.map(({ o, k, letter }) => {
        const extended = (o.arb & 0x40000000) !== 0;
        const id = extended ? o.arb & 0x1fffffff : (o.arb >>> 18) & 0x7ff;
        const dlc = Math.min(8, o.mctl & 0xf);
        return (
          <p key={letter + k} className="bl-sum">
            CAN{bothCan ? `-${letter}` : ""} receive object {k}, {extended ? "29-bit" : "11-bit"} identifier <code>{hex(id, extended ? 8 : 3)}</code>:{" "}
            {dlc ? <>holds {plural(dlc, "byte")} <code>{bytes(o.data.slice(0, dlc))}</code></> : "nothing received yet"}
            {o.mctl & 0x8000 ? ", not read yet" : ""}
            {o.mctl & 0x4000 ? ", a frame was overwritten before it was read" : ""}
          </p>
        );
      })}
    </div>
  );
}

export const view: BenchView = {
  id: "bus-log",
  title: "Bus traffic (SPI, I2C, CAN)",
  order: 40,
  relevant: (board) => {
    if (spiOf(board)?.log.length) return true;
    if (i2cOf(board)?.bus.log.length || board.outputs.has("I2C_STARTS")) return true;
    const can = canOf(board);
    return !!can && (can.a.stored > 0 || can.a.sent.length > 0 || can.b.stored > 0 || can.b.sent.length > 0);
  },
  Component: BusLog,
};
