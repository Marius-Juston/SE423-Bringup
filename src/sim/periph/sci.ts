// Serial Communications Interface (UART). TRM chapter 19 "Serial
// Communications Interface (SCI)". Frame: start bit, data bits LSB first,
// optional parity, stop bit(s).
//   baud = LSPCLK / ((BRR + 1) * 8),  BRR = SCIHBAUD:SCILBAUD

import type { Board } from "../board";

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
  /** Receive FIFO per port. */
  private fifo: number[][] = [[], [], [], []];
  onTx: ((port: number, ch: number, t: number) => void)[] = [];
  /** C callbacks installed by the course library (per port). */
  rxHandler: ((port: number, ch: number) => void) | null = null;

  constructor(private b: Board) {
    SCI_PORTS.forEach((p, i) => {
      const dev = b.dev;
      const pre = `Sci${p}Regs`;
      // Writing SCITXBUF starts a transmission.
      dev.reg(`${pre}.SCITXBUF`).hook.after = (v) => {
        if (!dev.get(`${pre}.SCICTL1`, "TXENA")) {
          b.warn(b.line, "sci-txena", `SCI${p.toUpperCase()} cannot transmit: SCICTL1.bit.TXENA is 0.`);
          return;
        }
        // The transmit FIFO holds 16 characters (TRM 19.13); one more is lost.
        if (this.txQueued[i] >= 16) {
          b.warn(b.line, "sci-tx-overflow", `SCI${p.toUpperCase()}'s transmit FIFO is full (16 characters waiting), so this character was lost. Wait until ${pre}.SCIFFTX.bit.TXFFST is below 16 before writing SCITXBUF.`, "error");
          return;
        }
        this.txQueued[i]++;
        this.txStatus(i);
        this.send(i, v & 0xff, () => {
          this.txQueued[i]--;
          this.txStatus(i);
        });
      };
      // TXRDY and TX EMPTY read 1 after reset.
      dev.set(`${pre}.SCICTL2`, 0xc0);
      const rxbuf = dev.reg(`${pre}.SCIRXBUF`).hook;
      rxbuf.read = () => {
        const f = this.fifo[i];
        const v = f.length ? f.shift()! : 0;
        dev.set(`${pre}.SCIFFRX`, f.length, "RXFFST");
        dev.set(`${pre}.SCIRXST`, f.length ? 1 : 0, "RXRDY");
        b.mem.writes++;
        return v;
      };
      // RXFFINTCLR (bit 6 of SCIFFRX) clears the FIFO interrupt flag.
      const ffrx = dev.reg(`${pre}.SCIFFRX`).hook;
      ffrx.write = (v, stored) => {
        let next = (v & ~0x1f00) | (stored & 0x1f00);
        if (v & 0x40) next &= ~0x00c0;
        else next = (next & ~0x80) | (stored & 0x80);
        return next;
      };
    });
  }

  baud(port: number): number {
    const pre = `Sci${SCI_PORTS[port]}Regs`;
    const brr = (this.b.dev.get(`${pre}.SCIHBAUD`) << 8) | this.b.dev.get(`${pre}.SCILBAUD`);
    return LSPCLK_HZ / ((brr + 1) * 8);
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
    dev.set(`${pre}.SCIFFTX`, n, "TXFFST");
    dev.set(`${pre}.SCICTL2`, n < 16 ? 1 : 0, "TXRDY");
    dev.set(`${pre}.SCICTL2`, n === 0 ? 1 : 0, "TXEMPTY");
    this.b.mem.writes++;
  }

  /** Queues one character; it leaves the pin after the ones already queued. */
  send(port: number, ch: number, done?: () => void): void {
    const b = this.b;
    const [, txPin, mux] = SCI_PINS[port];
    if (b.gpio.mux(txPin) !== mux) {
      b.warn(b.line, `sci-mux-${port}`, `SCI${SCI_PORTS[port].toUpperCase()} is transmitting, but GPIO${txPin} is not switched to its transmit function (mux position ${mux}), so nothing leaves the chip. Use GPIO_SetupPinMux(${txPin}, GPIO_MUX_CPU1, ${mux});`, "error");
      done?.();
      return;
    }
    const charNs = (this.frameBits(port) / this.baud(port)) * 1e9;
    const start = Math.max(b.now, this.txBusyUntil[port]);
    const end = start + charNs;
    this.txBusyUntil[port] = end;
    b.mem.writes++;
    b.at(end, (t) => {
      this.tx[port].push({ t, ch });
      done?.();
      for (const l of this.onTx) l(port, ch, t);
    });
  }

  /** Text sent so far on a port. */
  text(port: number): string {
    return String.fromCharCode(...this.tx[port].map((x) => x.ch));
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
      if (f.length >= 16) {
        dev.set(`${pre}.SCIFFRX`, 1, "RXFFOVF");
        return;
      }
      f.push(ch & 0xff);
      b.mem.writes++;
      dev.set(`${pre}.SCIFFRX`, f.length, "RXFFST");
      dev.set(`${pre}.SCIRXST`, 1, "RXRDY");
      const fifoOn = dev.get(`${pre}.SCIFFTX`, "SCIFFENA");
      const fire = fifoOn
        ? dev.get(`${pre}.SCIFFRX`, "RXFFIENA") && f.length >= dev.get(`${pre}.SCIFFRX`, "RXFFIL")
        : dev.get(`${pre}.SCICTL2`, "RXBKINTENA");
      if (fire) {
        if (fifoOn) dev.set(`${pre}.SCIFFRX`, 1, "RXFFINT");
        const [g, rxCh] = PIE_CH[port];
        b.pie.raise(g, rxCh);
      }
    });
  }
}
