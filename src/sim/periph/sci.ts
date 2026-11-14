// Serial Communications Interface (UART). TRM chapter 19 "Serial
// Communications Interface (SCI)". Frame: start bit, data bits LSB first,
// optional parity, stop bit(s).
//   baud = LSPCLK / ((BRR + 1) * 8),  BRR = SCIHBAUD:SCILBAUD (LSPCLK / 16 for BRR = 0)
// Modelled: SCICTL1.SWRESET (nothing is sent while it is 0, the reset
// state), the 16-level FIFOs with TXFIFORESET / RXFIFORESET, the receive
// FIFO interrupt (level sensitive, RXFFIL) and the transmit FIFO interrupt
// (TXFFST <= TXFFIL), the one-character buffers without the FIFO (a write
// to a full SCITXBUF replaces the waiting character, a character received
// with RXRDY still set replaces the unread one and sets SCIRXST.OE).
// SCIA is wired to the USB terminal, which reads 115200 baud, 8 data bits,
// no parity, 1 stop bit: another setting gets a diagnostic.
// Not modelled: the waveform on the TX pin, parity, framing and break
// errors, the TXRDY interrupt (SCICTL2.TXINTENA), address-bit and idle-line
// modes, auto-baud, loopback.

import type { Board } from "../board";
import { RuntimeError } from "../cc/compile";

import { LSPCLK_HZ } from "../consts";

export { LSPCLK_HZ };
export const SCI_PORTS = ["a", "b", "c", "d"] as const;
/** PIE group 9 / 8 channels: [rx, tx] per port (TRM Table 3-2). */
const PIE_CH: [number, number, number][] = [
  [9, 1, 2],
  [9, 3, 4],
  [8, 5, 6],
  [8, 7, 8],
];

/** [RX pin, TX pin, mux position] per port, as the course library sets them up. */
export const SCI_PINS: [number, number, number][] = [
  [43, 42, 15],
  [15, 14, 2],
  [139, 56, 6],
  [105, 104, 6],
];

export interface SerialByte {
  t: number;
  ch: number;
}

export class Sci {
  /** Bytes sent by the chip, per port, with the time the stop bit ended. */
  tx: SerialByte[][] = [[], [], [], []];
  /** Bytes received (after being delivered to the program). */
  rx: SerialByte[][] = [[], [], [], []];
  private txBusyUntil = [0, 0, 0, 0];
  /** Characters written to SCITXBUF that have not left the pin yet. */
  private txQueued = [0, 0, 0, 0];
  /** The character waiting behind the one being shifted (it can still be replaced without the FIFO). */
  private txLast: ({ ch: number } | null)[] = [null, null, null, null];
  /** Receive FIFO per port. */
  private fifo: number[][] = [[], [], [], []];
  /** SCIRXBUF was read since the receive interrupt was last requested. */
  private rxRead = [true, true, true, true];
  private refires = [0, 0, 0, 0];
  private txRefires = [0, 0, 0, 0];
  onTx: ((port: number, ch: number, t: number) => void)[] = [];
  /** C callbacks installed by the course library (per port). */
  rxHandler: ((port: number, ch: number) => void) | null = null;

  constructor(private b: Board) {
    SCI_PORTS.forEach((p, i) => {
      const dev = b.dev;
      const pre = `Sci${p}Regs`;
      const P = p.toUpperCase();
      // Reset values (TRM 19.14.2): TXRDY and TX EMPTY read 1, both FIFOs are out of reset, RXFFIL = 31.
      dev.set(`${pre}.SCICTL2`, 0xc0);
      dev.set(`${pre}.SCIFFTX`, 0xa000);
      dev.set(`${pre}.SCIFFRX`, 0x201f);
      const fifoOn = () => dev.get(`${pre}.SCIFFTX`, "SCIFFENA") === 1;

      // Writing SCITXBUF starts a transmission.
      dev.reg(`${pre}.SCITXBUF`).hook.after = (v) => {
        if (!dev.get(`${pre}.SCICTL1`, "TXENA")) {
          b.warn(b.line, "sci-txena", `SCI${P} cannot transmit: SCICTL1.bit.TXENA is 0.`);
          return;
        }
        if (!dev.get(`${pre}.SCICTL1`, "SWRESET")) {
          b.warn(b.line, `sci-in-reset-${i}`, `SCITXBUF was written while SCI${P} is held in reset (SCICTL1.bit.SWRESET = 0, its value after power-up), so nothing is sent. Finish the set-up with ${pre}.SCICTL1.bit.SWRESET = 1;`);
          return;
        }
        if (fifoOn()) {
          if (!dev.get(`${pre}.SCIFFTX`, "TXFIFORESET")) {
            b.warn(b.line, `sci-txfifo-reset-${i}`, `SCITXBUF was written while the transmit FIFO is held in reset (SCIFFTX.bit.TXFIFORESET = 0), so the character was dropped. Release it with ${pre}.SCIFFTX.bit.TXFIFORESET = 1;`);
            return;
          }
          // The transmit FIFO holds 16 characters (TRM 19.13); one more is lost.
          if (this.txQueued[i] >= 16) {
            b.warn(b.line, "sci-tx-overflow", `SCI${P}'s transmit FIFO is full (16 characters waiting), so this character was lost. Wait until ${pre}.SCIFFTX.bit.TXFFST is below 16 before writing SCITXBUF.`, "error");
            return;
          }
        } else if (this.txQueued[i] >= 2 && this.txLast[i]) {
          // Without the FIFO there is the shift register and SCITXBUF: the waiting character is replaced.
          b.warn(b.line, "sci-tx-overwrite", `SCITXBUF was written while it still held a character that had not been sent (SCICTL2.bit.TXRDY = 0), so that character was lost. Wait for ${pre}.SCICTL2.bit.TXRDY == 1 before each write, or switch the FIFO on with ${pre}.SCIFFTX.bit.SCIFFENA = 1;`, "error");
          this.txLast[i]!.ch = v & 0xff;
          return;
        }
        this.txQueued[i]++;
        this.txRefires[i] = 0;
        this.txStatus(i);
        let sent = false;
        let entry: { ch: number } | null = null;
        entry = this.send(i, v & 0xff, () => {
          sent = true;
          this.txQueued[i]--;
          if (entry && this.txLast[i] === entry) this.txLast[i] = null;
          this.txStatus(i);
        });
        // Not on the wire yet (the pin mux can refuse it at once).
        if (!sent) this.txLast[i] = entry;
      };
      // TXRDY and TX EMPTY are read-only.
      dev.reg(`${pre}.SCICTL2`).hook.write = (v, stored) => (v & 0x03) | (stored & 0xc0);
      dev.reg(`${pre}.SCIRXST`).hook.write = (_v, stored) => stored;
      dev.reg(`${pre}.SCICTL1`).hook.after = (v) => {
        // SWRESET = 0 puts the receiver flags back in their reset state (Table 19-9).
        if (!(v & 0x20)) dev.set(`${pre}.SCIRXST`, 0);
      };
      const rxbuf = dev.reg(`${pre}.SCIRXBUF`).hook;
      rxbuf.read = () => {
        const f = this.fifo[i];
        const v = f.length ? f.shift()! : 0;
        this.rxRead[i] = true;
        dev.set(`${pre}.SCIFFRX`, f.length, "RXFFST");
        dev.set(`${pre}.SCIRXST`, f.length ? 1 : 0, "RXRDY");
        b.mem.writes++;
        return v;
      };
      // TXFFST and TXFFINT are read-only; TXFFINTCLR clears TXFFINT and reads 0.
      const fftx = dev.reg(`${pre}.SCIFFTX`).hook;
      fftx.write = (v, stored) => (v & 0xe03f) | (stored & 0x1f80 & (v & 0x40 ? ~0x80 : ~0));
      fftx.after = () => this.txInterrupt(i);
      // RXFFOVF, RXFFST and RXFFINT are read-only; the two CLR bits clear and read 0.
      const ffrx = dev.reg(`${pre}.SCIFFRX`).hook;
      ffrx.write = (v, stored) => (v & 0x203f) | (stored & 0x9f80 & (v & 0x4000 ? ~0x8000 : ~0) & (v & 0x40 ? ~0x80 : ~0));
      ffrx.after = (v) => {
        // RXFIFORESET = 0 empties the receive FIFO and holds it empty.
        if (!(v & 0x2000) && this.fifo[i].length) {
          this.fifo[i] = [];
          dev.set(`${pre}.SCIFFRX`, 0, "RXFFST");
          dev.set(`${pre}.SCIRXST`, 0, "RXRDY");
          b.mem.writes++;
        }
        const waiting = this.fifo[i].length;
        if (v & 0x40 && b.isrDepth && !this.rxRead[i] && waiting && waiting >= dev.get(`${pre}.SCIFFRX`, "RXFFIL") && dev.get(`${pre}.SCIFFRX`, "RXFFIENA")) {
          const msg = `RXFFINT was cleared, but SCIRXBUF was not read: the receive FIFO still holds ${waiting} character(s), so the SCI${P} receive interrupt fires again at once. Read ${pre}.SCIRXBUF.all in the interrupt function before clearing the flag.`;
          b.warn(b.line, `sci-rx-not-drained-${i}`, msg, "error");
          // The interrupt would now starve the rest of the program for ever.
          if (++this.refires[i] > 200) throw new RuntimeError(b.line, msg);
        } else this.refires[i] = 0;
        // TRM 19.14: the receive FIFO interrupt is requested whenever the fill
        // level is at or above RXFFIL, so clearing the flag with characters
        // still waiting raises it again.
        this.rxInterrupt(i);
      };
    });
  }

  baud(port: number): number {
    const pre = `Sci${SCI_PORTS[port]}Regs`;
    const brr = ((this.b.dev.get(`${pre}.SCIHBAUD`) & 0xff) << 8) | (this.b.dev.get(`${pre}.SCILBAUD`) & 0xff);
    return brr === 0 ? LSPCLK_HZ / 16 : LSPCLK_HZ / ((brr + 1) * 8);
  }

  /** Bits on the wire per character: start + data + parity + stop. */
  frameBits(port: number): number {
    const pre = `Sci${SCI_PORTS[port]}Regs`;
    const dev = this.b.dev;
    return 1 + (dev.get(`${pre}.SCICCR`, "SCICHAR") + 1) + dev.get(`${pre}.SCICCR`, "PARITYENA") + 1 + dev.get(`${pre}.SCICCR`, "STOPBITS");
  }

  private txStatus(port: number): void {
    const dev = this.b.dev;
    const pre = `Sci${SCI_PORTS[port]}Regs`;
    const n = this.txQueued[port];
    const fifo = dev.get(`${pre}.SCIFFTX`, "SCIFFENA") === 1;
    dev.set(`${pre}.SCIFFTX`, fifo ? n : 0, "TXFFST");
    dev.set(`${pre}.SCICTL2`, n < (fifo ? 16 : 2) ? 1 : 0, "TXRDY");
    dev.set(`${pre}.SCICTL2`, n === 0 ? 1 : 0, "TXEMPTY");
    this.b.mem.writes++;
    this.txInterrupt(port);
  }

  /** Requests the transmit FIFO interrupt while TXFFST <= TXFFIL and the flag is clear (TRM 19.13.2). */
  private txInterrupt(port: number): void {
    const dev = this.b.dev;
    const pre = `Sci${SCI_PORTS[port]}Regs`;
    if (!dev.get(`${pre}.SCIFFTX`, "SCIFFENA") || !dev.get(`${pre}.SCIFFTX`, "TXFFIENA")) return;
    if (dev.get(`${pre}.SCIFFTX`, "TXFFST") > dev.get(`${pre}.SCIFFTX`, "TXFFIL") || dev.get(`${pre}.SCIFFTX`, "TXFFINT")) return;
    dev.set(`${pre}.SCIFFTX`, 1, "TXFFINT");
    // Requested again from inside the interrupt function, with nothing written: it would never end.
    if (this.b.isrDepth && ++this.txRefires[port] > 200) {
      const msg = `The SCI${SCI_PORTS[port].toUpperCase()} transmit interrupt fires again and again: the transmit FIFO is at or below TXFFIL and the interrupt function writes nothing to SCITXBUF. When there is nothing left to send, switch it off: ${pre}.SCIFFTX.bit.TXFFIENA = 0;`;
      this.b.warn(this.b.line, `sci-tx-int-stuck-${port}`, msg, "error");
      throw new RuntimeError(this.b.line, msg);
    }
    this.b.pie.raise(PIE_CH[port][0], PIE_CH[port][2]);
  }

  /** Characters accepted but not yet on the wire, per port. */
  backlog = [0, 0, 0, 0];

  /**
   * The course library's send: it keeps a software buffer (buffer.h:
   * 1024 characters for SCIA, 136 for B and C, 512 for D) and drops what
   * does not fit. Returns false when the character was dropped.
   */
  sendBuffered(port: number, ch: number): boolean {
    const cap = [1024, 136, 136, 512][port];
    if (this.backlog[port] >= cap) {
      this.b.warn(
        this.b.line,
        `serial-flood-${port}`,
        `The program prints faster than Serial${"ABCD"[port]} can send: its ${cap}-character buffer is full, so text is being lost. Print only when a flag asks for it (for example every 100 ms from a timer interrupt) and clear the flag after printing.`,
      );
      return false;
    }
    this.backlog[port]++;
    this.send(port, ch, () => this.backlog[port]--);
    return true;
  }

  /** Queues one character; it leaves the pin after the ones already queued. */
  send(port: number, ch: number, done?: () => void): { ch: number } {
    const b = this.b;
    const entry = { ch };
    const [, txPin, mux] = SCI_PINS[port];
    if (port === 0) this.checkTerminal();
    if (b.gpio.mux(txPin) !== mux) {
      b.warn(b.line, `sci-mux-${port}`, `SCI${SCI_PORTS[port].toUpperCase()} is transmitting, but GPIO${txPin} is not switched to its transmit function (mux position ${mux}), so nothing leaves the chip. Use GPIO_SetupPinMux(${txPin}, GPIO_MUX_CPU1, ${mux});`, "error");
      done?.();
      return entry;
    }
    const charNs = (this.frameBits(port) / this.baud(port)) * 1e9;
    const start = Math.max(b.now, this.txBusyUntil[port]);
    const end = start + charNs;
    this.txBusyUntil[port] = end;
    b.mem.writes++;
    b.at(end, (t) => {
      this.tx[port].push({ t, ch: entry.ch });
      // A live run keeps the recent output only (115200 baud is 11 520 characters a second).
      const limit = this.b.historyLimit;
      if (limit && this.tx[port].length > limit) this.tx[port].splice(0, this.tx[port].length - (limit >> 1));
      done?.();
      for (const l of this.onTx) l(port, entry.ch, t);
    });
    return entry;
  }

  /** SCIA goes to the USB terminal, which is fixed at 115200 baud, 8N1. */
  private checkTerminal(): void {
    const b = this.b;
    const dev = b.dev;
    const baud = this.baud(0);
    if (Math.abs(baud - 115200) > 0.03 * 115200)
      b.warn(
        b.line,
        "sci-baud-0",
        `SCIA is sending at ${Math.round(baud)} baud, but the terminal reads at 115200 baud, so it would show garbage. BRR = 50000000 / (115200 x 8) - 1 = 53: SCIHBAUD = 0, SCILBAUD = 53.`,
        "error",
      );
    else if (dev.get("SciaRegs.SCICCR", "SCICHAR") !== 7 || dev.get("SciaRegs.SCICCR", "PARITYENA") || dev.get("SciaRegs.SCICCR", "STOPBITS"))
      b.warn(
        b.line,
        "sci-frame-0",
        `SCIA is not sending 8 data bits, no parity, 1 stop bit, which is what the terminal expects, so it would show garbage. Use SciaRegs.SCICCR.all = 0x0007;`,
        "error",
      );
  }

  /** Text sent so far on a port. */
  text(port: number): string {
    // In pieces: one call with every character as an argument fails beyond about a hundred thousand.
    const tx = this.tx[port];
    let out = "";
    for (let i = 0; i < tx.length; i += 8192) out += String.fromCharCode(...tx.slice(i, i + 8192).map((x) => x.ch));
    return out;
  }

  /** The outside world sends a character to the chip, arriving at time t. */
  receive(port: number, ch: number, t: number): void {
    const b = this.b;
    const pre = `Sci${SCI_PORTS[port]}Regs`;
    b.at(t, (at) => {
      const dev = b.dev;
      if (!dev.get(`${pre}.SCICTL1`, "RXENA")) return;
      // The character only reaches the SCI if the pin is switched to it.
      if (b.gpio.mux(SCI_PINS[port][0]) !== SCI_PINS[port][2]) return;
      this.rx[port].push({ t: at, ch });
      const f = this.fifo[port];
      const P = SCI_PORTS[port].toUpperCase();
      // Characters that pile up during the set-up, before EINT, are expected to be lost.
      const listening = !b.intm || b.isrDepth > 0;
      b.mem.writes++;
      if (!dev.get(`${pre}.SCIFFTX`, "SCIFFENA")) {
        // One receive buffer: an unread character is replaced (SCIRXST.OE, Table 19-13).
        if (f.length) {
          dev.set(`${pre}.SCIRXST`, 1, "OE");
          dev.set(`${pre}.SCIRXST`, 1, "RXERROR");
          if (listening) b.warn(b.line, `sci-rx-overrun-${port}`, `SCI${P} received a character while the previous one was still unread in SCIRXBUF, so the previous one was lost (SCIRXST.bit.OE). Read SCIRXBUF for every character, in the receive interrupt, or switch the FIFO on.`);
        }
        f.length = 0;
        f.push(ch & 0xff);
        dev.set(`${pre}.SCIRXST`, 1, "RXRDY");
        if (dev.get(`${pre}.SCICTL2`, "RXBKINTENA")) b.pie.raise(PIE_CH[port][0], PIE_CH[port][1]);
        return;
      }
      if (!dev.get(`${pre}.SCIFFRX`, "RXFIFORESET")) return;
      if (f.length >= 16) {
        dev.set(`${pre}.SCIFFRX`, 1, "RXFFOVF");
        if (listening) b.warn(b.line, `sci-rx-overflow-${port}`, `SCI${P}'s receive FIFO overflowed: 16 characters were waiting and another arrived, so it was lost. Read SCIRXBUF in the receive interrupt each time a character arrives.`);
        return;
      }
      f.push(ch & 0xff);
      dev.set(`${pre}.SCIFFRX`, f.length, "RXFFST");
      dev.set(`${pre}.SCIRXST`, 1, "RXRDY");
      this.rxInterrupt(port);
    });
  }

  /** Requests the receive FIFO interrupt if the level condition holds and the flag is clear. */
  private rxInterrupt(port: number): void {
    const dev = this.b.dev;
    const pre = `Sci${SCI_PORTS[port]}Regs`;
    if (!dev.get(`${pre}.SCIFFRX`, "RXFFIENA")) return;
    const level = dev.get(`${pre}.SCIFFRX`, "RXFFIL");
    if (this.fifo[port].length === 0 || this.fifo[port].length < level) return;
    if (dev.get(`${pre}.SCIFFRX`, "RXFFINT")) {
      this.b.pie.uncleared(PIE_CH[port][0], PIE_CH[port][1], `${pre}.SCIFFRX.bit.RXFFINT`, `${pre}.SCIFFRX.bit.RXFFINTCLR = 1;`);
      return;
    }
    dev.set(`${pre}.SCIFFRX`, 1, "RXFFINT");
    this.rxRead[port] = false;
    this.b.pie.raise(PIE_CH[port][0], PIE_CH[port][1]);
  }
}
