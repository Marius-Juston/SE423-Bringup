import type { Board } from "../../sim/board";
import type { CanState } from "../../sim/plugins/can";
import type { I2cState } from "../../sim/plugins/i2c";
import type { SpiWord } from "../../sim/plugins/spi";
import type { BenchView, ViewProps } from "./types";

// Recent traffic on the serial buses, in plain words, newest last. Reads
// what the plugins keep: the SPI word log (spi.ts `log`), the I2C transfer
// log (i2c.ts `bus.log`), and for CAN the frames sent, the history of the
// CAN_RX_FRAMES counter and the current contents of the receive objects
// (can.ts keeps no list of received frames).

const CSS = `
.bl-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.15rem; font-size: 0.85rem; }
.bl-list li { display: grid; grid-template-columns: 5.6rem 2.6rem 1fr; gap: 0.4rem; align-items: baseline; padding: 0.1rem 0.3rem; border-radius: 4px; }
.bl-list li:last-child { background: var(--inset); }
.bl-t { font-family: var(--mono); color: var(--dim); font-size: 0.78rem; text-align: right; }
.bl-bus { font-weight: 700; font-size: 0.78rem; }
.bl-bus.spi { color: var(--accent); }
.bl-bus.i2c { color: var(--info); }
.bl-bus.can { color: var(--ok); }
.bl-list code { font-size: 0.8rem; overflow-wrap: anywhere; }
.bl-bad { color: var(--bad); font-weight: 700; }
.bl-sum { color: var(--dim); font-size: 0.8rem; margin: 0.35rem 0 0; }
`;

const MS = 1e6;
/** Lines shown (a line is one SPI transfer, one I2C transfer or one CAN frame). */
const MAX = 6;
const hex = (v: number, d: number) => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(d, "0");

interface SpiBusState {
  log: SpiWord[];
}
interface Entry {
  t: number;
  bus: "spi" | "i2c" | "can";
  body: JSX.Element;
}

const spiOf = (b: Board) => b.plugins.get("spi") as SpiBusState | undefined;
const i2cOf = (b: Board) => b.plugins.get("i2c") as I2cState | undefined;
const canOf = (b: Board) => b.plugins.get("can") as CanState | undefined;

function BusLog({ board, window: [, to] }: ViewProps) {
  const until = to * MS;
  const entries: Entry[] = [];
  const spi = spiOf(board)?.log ?? [];
  const i2c = i2cOf(board)?.bus.log ?? [];
  const can = canOf(board);

  // SPI: words that follow each other closely (same device) are one transfer.
  const tail = spi.filter((w) => w.t <= until).slice(-MAX * 16);
  let minGap = 100_000;
  for (let i = 1; i < tail.length; i++) if (tail[i].t > tail[i - 1].t) minGap = Math.min(minGap, tail[i].t - tail[i - 1].t);
  const groups: SpiWord[][] = [];
  for (const w of tail) {
    const g = groups[groups.length - 1];
    const last = g?.[g.length - 1];
    if (g && last && g.length < 16 && last.device === w.device && last.port === w.port && last.bits === w.bits && w.t - last.t <= 2.6 * minGap) g.push(w);
    else groups.push([w]);
  }
  for (const g of groups.slice(-MAX)) {
    const w = g[g.length - 1];
    const d = Math.ceil(w.bits / 4);
    const loop = !w.device && board.dev.get(`Spi${w.port}Regs.SPICCR`, "SPILBK") === 1;
    const list = (f: (x: SpiWord) => number) => g.map((x) => hex(f(x), d)).join(" ");
    entries.push({
      t: w.t,
      bus: "spi",
      body: (
        <>
          {g.length} {w.bits}-bit word{g.length > 1 ? "s" : ""} {w.device ? `with the ${w.device}` : loop ? "in loopback" : ""}
          {!w.device && !loop && <span className="bl-bad">with no chip select low: nobody answered</span>}
          <br />
          sent <code>{list((x) => x.out)}</code>
          <br />
          received <code>{list((x) => x.in)}</code>
        </>
      ),
    });
  }
  let nI2c = 0;
  for (let i = i2c.length - 1; i >= 0 && nI2c < MAX; i--) {
    const x = i2c[i];
    if (x.t > until) continue;
    nI2c++;
    entries.push({
      t: x.t,
      bus: "i2c",
      body: (
        <>
          START, address <code>{hex(x.address, 2)}</code>, {x.read ? "read" : "write"}:{" "}
          {x.acked ? "ACK" : <span className="bl-bad">NACK, no device there</span>}
          {x.data.length ? (
            <>
              ; {x.data.length} byte{x.data.length > 1 ? "s" : ""} {x.read ? "from the device" : "to the device"}: <code>{x.data.map((v) => hex(v, 2)).join(" ")}</code>
            </>
          ) : null}
          {x.stopped ? "; STOP" : "; no STOP yet"}
        </>
      ),
    });
  }
  const sent = can?.b.sent ?? [];
  for (let i = sent.length - 1; i >= 0 && i >= sent.length - MAX; i--) {
    const f = sent[i];
    if (f.t > until) continue;
    entries.push({
      t: f.t,
      bus: "can",
      body: (
        <>
          sent a frame, identifier <code>{hex(f.id, f.extended ? 8 : 3)}</code>, {f.data.length} byte{f.data.length === 1 ? "" : "s"}
          {f.data.length ? <>: <code>{f.data.map((v) => hex(v, 2).slice(2)).join(" ")}</code></> : null}
        </>
      ),
    });
  }
  const rx = board.outputs.get("CAN_RX_FRAMES") ?? [];
  for (let i = rx.length - 1; i >= 0 && i >= rx.length - MAX; i--) {
    if (rx[i].t > until) continue;
    entries.push({ t: rx[i].t, bus: "can", body: <>frame {rx[i].v} received and stored in a message object</> });
  }
  entries.sort((a, b) => a.t - b.t);
  const shown = entries.slice(-MAX);

  // CAN: what the receive objects hold now (the frames themselves are not logged).
  const objs = (can?.b.objs ?? [])
    .map((o, k) => ({ o, k }))
    .filter(({ o, k }) => k >= 1 && o && o.arb >>> 31 === 1 && !(o.arb & 0x20000000));
  const out = (name: string) => board.output(name, until) ?? 0;
  const i2cCounts = board.outputs.has("I2C_STARTS");

  if (!shown.length && !objs.length && !i2cCounts) return <p className="hint-text">Words, bytes and frames on SPI, I2C and CAN will be listed here.</p>;
  return (
    <div>
      <style>{CSS}</style>
      <ol className="bl-list" role="log" aria-label="Recent bus traffic, newest last">
        {shown.map((e, i) => (
          <li key={i}>
            <span className="bl-t">{(e.t / MS).toFixed(3)} ms</span>
            <span className={`bl-bus ${e.bus}`}>{e.bus.toUpperCase()}</span>
            <span>{e.body}</span>
          </li>
        ))}
      </ol>
      {spi.length > 0 && <p className="bl-sum">SPI: {out("SPIB_WORDS") || spi.filter((w) => w.t <= until).length} words exchanged so far. Every word sent is a word received.</p>}
      {i2cCounts && (
        <p className="bl-sum">
          I2C: {out("I2C_STARTS")} START, {out("I2C_STOPS")} STOP, {out("I2C_ADDR_ACKS")} address ACK, {out("I2C_ADDR_NACKS")} address NACK, {out("I2C_DATA_BYTES")} data bytes.
        </p>
      )}
      {objs.map(({ o, k }) => (
        <p key={k} className="bl-sum">
          CAN message object {k}, identifier <code>{hex(o.arb & 0x1fffffff, o.arb & 0x40000000 ? 8 : 3)}</code>: holds <code>{o.data.slice(0, Math.max(1, o.mctl & 0xf)).map((v) => hex(v, 2).slice(2)).join(" ")}</code>
          {o.mctl & 0x8000 ? ", not read yet" : ""}
          {o.mctl & 0x4000 ? ", a frame was overwritten before it was read" : ""}
        </p>
      ))}
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
    return !!can && (can.b.stored > 0 || can.b.sent.length > 0);
  },
  Component: BusLog,
};
