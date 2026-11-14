// Serial Peripheral Interface, SPIA..SPIC (the course uses SPIB). TRM chapter
// 18 "Serial Peripheral Interface (SPI)", master mode:
//
// - 18.3.2 Master mode: a write to SPITXBUF starts a word, MSB first; one word
//   is received for every word sent.
// - 18.3.4 Data format: SPICHAR + 1 bits per word. Transmit data is taken from
//   the top of SPITXBUF (left-justified); the shift register SPIDAT shifts
//   left, so SPIRXBUF holds the received bits right-justified, with whatever
//   was left of the transmitted word above them (Example 18-1).
// - 18.3.5 Baud rate: LSPCLK / (SPIBRR + 1) for SPIBRR = 3..127, LSPCLK / 4
//   for SPIBRR = 0..2.
// - 18.3.6 Clocking schemes (Table 18-3, Figure 18-7), see `clockScheme`.
// - 18.3.7 FIFOs: 16 words each way, TXDLY SPICLK cycles between words, the
//   receive interrupt when RXFFST >= RXFFIL, the transmit interrupt when
//   TXFFST <= TXFFIL. Register bits as in 18.5.2 (the list in 18.3.7 step 8
//   says the FIFO reset bits reset when set to 1; the register tables, the TI
//   header and the course code agree that writing 0 resets, so 0 it is).
// - 18.2.3 Interrupts (Table 18-2): SPIx_RX is INT6.1 / 6.3 / 6.9 and SPIx_TX
//   INT6.2 / 6.4 / 6.10 for A / B / C (Table 3-2).
//
// Clock modes. The TRM names the four schemes by the edge data is OUTPUT on:
//
//   CLKPOLARITY CLK_PHASE  TRM name                    idle  data changes        data latched     datasheets call it
//        0          0      rising edge without delay   low   rising (1st edge)   falling (2nd)    mode 1 (CPOL 0, CPHA 1)
//        0          1      rising edge with delay      low   falling (2nd edge)  rising (1st)     mode 0 (CPOL 0, CPHA 0)
//        1          0      falling edge without delay  high  falling (1st edge)  rising (2nd)     mode 3 (CPOL 1, CPHA 1)
//        1          1      falling edge with delay     high  rising (2nd edge)   falling (1st)    mode 2 (CPOL 1, CPHA 0)
//
// With CLK_PHASE = 1 the first bit is put on the line half a cycle before the
// first clock edge, so it is latched on the first edge. CLK_PHASE is therefore
// the INVERSE of the CPHA bit of device datasheets. The course sets
// CLK_PHASE = 1, CLKPOLARITY = 0 and calls it "Mode 01" (polarity 0, phase 1
// in TI's bits): that is "rising edge with delay", which datasheets call
// mode 0. The MPU-9250 and the DAN28027 both latch on the rising edge.
//
// Pins. The clock and SIMO pins carry real waveforms only when the bit rate is
// at or below WAVEFORM_MAX_BAUD (500 kHz, SPIBRR >= 99): a 16-bit word is
// about 50 pin events, and the course's 1 MHz burst reads would add several
// hundred thousand events per simulated second. Above the threshold a word is
// exchanged as a whole and the pins only show the clock's idle level.
//
// Devices on the bus register with `registerSpiDevice`. A device is selected
// while its chip-select pin (a plain GPIO output driven by the program) is
// low. A device with `peek` can also be driven by bit-banging the clock and
// SIMO pins as GPIO outputs.

import type { Board } from "../board";
import { RuntimeError } from "../cc/compile";
import { LSPCLK_HZ } from "../consts";
import type { SimPlugin } from "../plugin";

/** Highest bit rate at which SPICLK and SPISIMO are drawn edge by edge. */
export const WAVEFORM_MAX_BAUD = 500_000;

/** A clock mode in the chip's own bits: SPICCR.CLKPOLARITY and SPICTL.CLK_PHASE. */
export interface SpiMode {
  polarity: 0 | 1;
  phase: 0 | 1;
}

/** The course's setting for both of its devices ("Mode 01"): rising edge with delay. */
export const COURSE_MODE: SpiMode = { polarity: 0, phase: 1 };

/** What a clock mode means on the wires (TRM Table 18-3 and Figure 18-7). */
export function clockScheme(m: SpiMode): { name: string; idle: 0 | 1; changes: "rising" | "falling"; latches: "rising" | "falling"; latchOnFirstEdge: boolean } {
  const out = m.polarity === 0 ? "rising" : "falling";
  const other = out === "rising" ? "falling" : "rising";
  // "With delay": data goes out half a cycle before the named edge, so that
  // edge (the first one after idle) latches it and the other edge changes it.
  return m.phase === 0
    ? { name: `${out} edge without delay`, idle: m.polarity, changes: out, latches: other, latchOnFirstEdge: false }
    : { name: `${out} edge with delay`, idle: m.polarity, changes: other, latches: out, latchOnFirstEdge: true };
}

export interface SpiDevice {
  name: string;
  /** GPIO number of the chip select (active low). */
  csPin: number;
  /** Clock mode(s) the device works with, in the chip's bits. */
  mode: SpiMode | SpiMode[];
  /** SPI module the device is wired to (default "b") and its pins (default: that module's course pins). */
  port?: "a" | "b" | "c";
  pins?: { simo: number; somi: number; clk: number };
  /**
   * Exchanges one word, MSB first: `wordOut` is what the master sent
   * (right-justified, `bits` wide), the return value what the device shifted
   * out during the same clocks. `t` / `tEnd` are when the word starts and
   * ends, ns.
   */
  transfer(wordOut: number, bits: number, t: number, tEnd: number): number;
  /** Chip select went low / high. */
  select?(): void;
  deselect?(): void;
  /**
   * For bit-banged access: the device's natural word size, and what it will
   * shift out during its next word (must not change the device's state).
   */
  unitBits?: number;
  peek?(t: number): number;
}

/** One word on the bus, for tests and tools. */
export interface SpiWord {
  t: number;
  port: string;
  bits: number;
  /** Sent by the master / received by the master, right-justified. */
  out: number;
  in: number;
  device: string | null;
  /**
   * Chip-select frame the word belongs to: a counter that goes up each time
   * the chip select of any registered device goes low (0 before the first).
   * Words with the same number were sent under one chip-select low.
   */
  frame: number;
}

type Sig = "simo" | "somi" | "clk";
/** Pins each module's signals can be muxed to: [pin, mux position]; the first is the default (course) choice. */
const PINS: Record<string, Record<Sig, [number, number][]>> = {
  a: { simo: [[58, 15], [16, 1], [54, 1]], somi: [[59, 15], [17, 1], [55, 1]], clk: [[60, 15], [18, 1], [56, 1]] },
  // The course: GPIO63 SPISIMOB, GPIO64 SPISOMIB, GPIO65 SPICLKB, all mux 15 (setupSpib, HW3).
  b: { simo: [[63, 15], [24, 6], [60, 6]], somi: [[64, 15], [25, 6], [61, 6]], clk: [[65, 15], [22, 6], [26, 6], [58, 6]] },
  c: { simo: [[69, 15], [50, 6], [100, 6], [122, 6]], somi: [[70, 15], [51, 6], [101, 6], [123, 6]], clk: [[71, 15], [52, 6], [102, 6], [124, 6]] },
};
/** PIE group 6 channels [receive, transmit] (TRM Table 3-2). */
const PIE_CH: Record<string, [number, number]> = { a: [1, 2], b: [3, 4], c: [9, 10] };

interface Port {
  id: "a" | "b" | "c";
  pre: string;
  /** Words written to SPITXBUF that have not started shifting. */
  txq: { v: number; line: number }[];
  rxq: number[];
  /** A word is on the wire, or the next one is waiting for the TXDLY gap. */
  busy: boolean;
  gapUntil: number;
  /** Bumped to cancel everything scheduled for the current word. */
  gen: number;
  lastRead: number;
  rxLine: boolean;
  txLine: boolean;
  words: number;
  /** Device taking part in the word on the wire, and whether its chip select rose meanwhile. */
  cur: SpiDevice | null;
  aborted: boolean;
  /** Previous word's last bits, for the garbage a wrong clock mode produces. */
  carryOut: number;
  carryIn: number;
  /** Receive interrupts re-raised in a row because the FIFO was not read. */
  refires: number;
}

interface BitBang {
  reply: number;
  count: number;
  acc: number;
  t0: number;
  driving: boolean;
}

interface Bus {
  devices: SpiDevice[];
  ports: Map<string, Port>;
  log: SpiWord[];
  /** Words removed from the start of the log (live runs keep the recent ones only). */
  dropped: number;
  /** Number of chip-select falling edges so far, and the chip-select pins that are low now. */
  frame: number;
  csLow: Set<number>;
  selected: Set<SpiDevice>;
  bang: Map<SpiDevice, BitBang>;
}

/** The SPI bus state of a board (created on first use, so plugin load order does not matter). */
export function spiBus(b: Board): Bus {
  let bus = b.plugins.get("spi") as Bus | undefined;
  if (!bus) b.plugins.set("spi", (bus = { devices: [], ports: new Map(), log: [], dropped: 0, frame: 0, csLow: new Set(), selected: new Set(), bang: new Map() }));
  return bus;
}

/** Wires a slave device to an SPI module. It exchanges words while its chip select is low. */
export function registerSpiDevice(b: Board, d: SpiDevice): void {
  spiBus(b).devices.push(d);
}

const portOf = (d: SpiDevice) => d.port ?? "b";
const pinsOf = (d: SpiDevice) => d.pins ?? { simo: PINS[portOf(d)].simo[0][0], somi: PINS[portOf(d)].somi[0][0], clk: PINS[portOf(d)].clk[0][0] };
const modesOf = (d: SpiDevice) => (Array.isArray(d.mode) ? d.mode : [d.mode]);

function install(b: Board): void {
  const dev = b.dev;
  const gpio = b.gpio;
  const bus = spiBus(b);

  for (const id of ["a", "b", "c"] as const) {
    const pre = `Spi${id}Regs`;
    const NAME = `SPI${id.toUpperCase()}`;
    const p: Port = {
      id, pre, txq: [], rxq: [], busy: false, gapUntil: 0, gen: 0, lastRead: 0, rxLine: false, txLine: false,
      words: 0, cur: null, aborted: false, carryOut: 0, carryIn: 1, refires: 0,
    };
    bus.ports.set(id, p);
    const get = (r: string, f?: string) => dev.get(`${pre}.${r}`, f);
    const set = (r: string, v: number, f?: string) => dev.set(`${pre}.${r}`, v, f);

    // Reset values (TRM 18.5.2.9, 18.5.2.10).
    set("SPIFFTX", 0xa000);
    set("SPIFFRX", 0x201f);

    const fifoOn = () => get("SPIFFTX", "SPIFFENA") === 1 && get("SPIFFTX", "SPIRST") === 1;
    const bits = () => get("SPICCR", "SPICHAR") + 1;
    const baud = () => {
      const brr = get("SPIBRR", "SPI_BIT_RATE");
      return brr < 3 ? LSPCLK_HZ / 4 : LSPCLK_HZ / (brr + 1);
    };
    const mode = (): SpiMode => ({ polarity: get("SPICCR", "CLKPOLARITY") as 0 | 1, phase: get("SPICTL", "CLK_PHASE") as 0 | 1 });
    /** The pin a signal is muxed to right now, if any. */
    const pin = (sig: Sig): number | null => {
      for (const [n, mux] of PINS[id][sig]) if (gpio.mux(n) === mux) return n;
      return null;
    };
    const muxFor = (sig: Sig, n: number) => PINS[id][sig].find((x) => x[0] === n)?.[1];

    /** The clock rests at its idle level while the module is a running master. */
    const idlePins = (t: number) => {
      const clk = pin("clk");
      if (clk === null) return;
      const running = get("SPICCR", "SPISWRESET") === 1 && get("SPICTL", "MASTER_SLAVE") === 1;
      gpio.drivePeripheral(clk, running ? (get("SPICCR", "CLKPOLARITY") as 0 | 1) : null, t);
    };

    // ---- interrupts ----
    const evalRx = (arrived = false) => {
      if (!fifoOn()) return;
      if (get("SPIFFRX", "RXFFST") >= get("SPIFFRX", "RXFFIL")) set("SPIFFRX", 1, "RXFFINT");
      const line = get("SPIFFRX", "RXFFINT") === 1 && get("SPIFFRX", "RXFFIENA") === 1;
      if (line && !p.rxLine) b.pie.raise(6, PIE_CH[id][0]);
      // A word arrived with the flag still set from the last interrupt.
      else if (line && arrived) b.pie.uncleared(6, PIE_CH[id][0], `${pre}.SPIFFRX.bit.RXFFINT`, `${pre}.SPIFFRX.bit.RXFFINTCLR = 1;`);
      p.rxLine = line;
    };
    const evalTx = () => {
      if (!fifoOn()) return;
      if (get("SPIFFTX", "TXFFIENA") === 1 && get("SPIFFTX", "TXFFST") <= get("SPIFFTX", "TXFFIL")) set("SPIFFTX", 1, "TXFFINT");
      const line = get("SPIFFTX", "TXFFINT") === 1 && get("SPIFFTX", "TXFFIENA") === 1;
      if (line && !p.txLine) b.pie.raise(6, PIE_CH[id][1]);
      p.txLine = line;
    };

    const txStatus = () => {
      b.mem.writes++;
      if (fifoOn()) set("SPIFFTX", p.txq.length, "TXFFST");
      else set("SPISTS", p.txq.length ? 1 : 0, "BUFFULL_FLAG");
    };

    // ---- one word on the wire ----
    const startWord = (v: number, line: number, t: number) => {
      const n = bits();
      const mask = n === 16 ? 0xffff : (1 << n) - 1;
      const bitNs = 1e9 / baud();
      const tEnd = t + n * bitNs;
      const m = mode();
      // Left-justified: the top n bits of what was written go out, MSB first.
      const out = (v >>> (16 - n)) & mask;
      let input = mask; // nothing driving SOMI: the pull-up holds it high
      p.cur = null;
      p.aborted = false;
      const gen = p.gen;
      const clk = pin("clk");
      const simo = pin("simo");
      const somi = pin("somi");
      const talk = get("SPICTL", "TALK") === 1;

      // The bits below the top n are never sent: a value that only has those is right-justified.
      if (n < 16 && out === 0 && v & 0xffff)
        b.warn(line, `spi-left-justify-${id}`, `SPITXBUF was written with 0x${(v & 0xffff).toString(16).toUpperCase()}, but with ${n}-bit words only the top ${n} bits of SPITXBUF are sent, so the word that went out is 0. Shift the value up: ${pre}.SPITXBUF = value << ${16 - n};`);
      if (get("SPICCR", "SPILBK")) input = out; // SIMO and SOMI joined inside the chip
      else {
        const missing = [clk === null && "clk", simo === null && "simo", somi === null && "somi"].filter(Boolean) as Sig[];
        if (missing.length) {
          const fix = missing.map((s) => `GPIO_SetupPinMux(${PINS[id][s][0][0]}, GPIO_MUX_CPU1, ${PINS[id][s][0][1]});`).join(" ");
          b.warn(line, `spi-mux-${id}`, `${NAME} is sending a word, but no pin is switched to its ${missing.map((s) => `SPI${s.toUpperCase()}${id.toUpperCase()}`).join(", ")} function, so the word never ${missing.length === 1 && missing[0] === "somi" ? "comes back into" : "leaves"} the chip. Add: ${fix}`, "error");
        }
        if (!talk) b.warn(line, `spi-talk-${id}`, `${NAME} clocked a word with SPICTL.bit.TALK = 0: its SPISIMO pin is switched off, so the device received only 1s. Set ${pre}.SPICTL.bit.TALK = 1;`);
        const here = bus.devices.filter((d) => {
          if (portOf(d) !== id || gpio.level[d.csPin] !== 0) return false;
          const dp = pinsOf(d);
          return clk === dp.clk && simo === dp.simo && muxFor("clk", dp.clk) !== undefined;
        });
        if (!here.length && clk !== null && simo !== null) {
          const wired = bus.devices.filter((d) => portOf(d) === id && pinsOf(d).clk === clk && pinsOf(d).simo === simo);
          if (wired.length)
            b.warn(line, `spi-no-cs-${id}`, `${NAME} sent a word, but no chip select is low, so no device listened and the word read back is all 1s. Pull the chip select of the device low before writing SPITXBUF (${wired.map((d) => `${d.name}: GPIO${d.csPin}`).join(", ")}).`);
        }
        if (here.length > 1) {
          b.warn(line, `spi-bus-conflict-${id}`, `Bus conflict: ${here.map((d) => `${d.name} (GPIO${d.csPin})`).join(" and ")} are selected at the same time, so both drive the SOMI line and the word read is garbage. Only one chip select may be low at a time: raise the other one first.`, "error");
          let both = mask;
          for (const d of here) both &= d.transfer(talk ? out : mask, n, t, tEnd) & mask;
          input = both;
        } else if (here.length === 1) {
          const d = here[0];
          p.cur = d;
          const seen = talk ? out : mask;
          if (modesOf(d).some((x) => x.polarity === m.polarity && x.phase === m.phase)) input = d.transfer(seen, n, t, tEnd) & mask;
          else {
            const want = modesOf(d)[0];
            b.warn(line, `spi-mode-${id}`, `The clock mode does not match the ${d.name}: ${NAME} is set to CLKPOLARITY = ${m.polarity}, CLK_PHASE = ${m.phase} (${clockScheme(m).name}: data latched on the ${clockScheme(m).latches} edge), but the device latches on the ${clockScheme(want).latches} edge. Every word is shifted by one bit. Use CLKPOLARITY = ${want.polarity}, CLK_PHASE = ${want.phase}.`, "error");
            // Each side latches half a bit off: both see the other's word one bit late.
            const reply = d.transfer(((seen >>> 1) | (p.carryOut << (n - 1))) & mask, n, t, tEnd) & mask;
            input = ((reply >>> 1) | (p.carryIn << (n - 1))) & mask;
            p.carryOut = seen & 1;
            p.carryIn = reply & 1;
          }
        }
        if (somi === null) input = mask;
      }

      // Pin waveforms (Figure 18-7), slow bit rates only.
      idlePins(t);
      if (baud() <= WAVEFORM_MAX_BAUD && clk !== null) {
        const half = bitNs / 2;
        const idle = m.polarity;
        const active = (1 - idle) as 0 | 1;
        const driveSomi = p.cur !== null && somi !== null && input !== mask;
        for (let i = 0; i <= 2 * n; i++) {
          b.at(t + i * half, (at) => {
            if (p.gen !== gen) return;
            const k = i >> 1;
            if (i % 2 === 0) {
              // Start of bit k: the data lines take the new bit.
              if (k < n) {
                if (simo !== null) gpio.drivePeripheral(simo, talk ? (((out >>> (n - 1 - k)) & 1) as 0 | 1) : null, at);
                if (driveSomi && gpio.level[p.cur!.csPin] === 0) gpio.drive(somi!, ((input >>> (n - 1 - k)) & 1) as 0 | 1, at);
              }
              // Without delay the clock leaves idle here; with delay it returns to idle here.
              gpio.drivePeripheral(clk, m.phase === 0 && k < n ? active : idle, at);
            } else gpio.drivePeripheral(clk, m.phase === 0 ? idle : active, at);
          });
        }
      }

      b.at(tEnd, (at) => {
        if (p.gen !== gen) return;
        finishWord(v, out, input, n, mask, at, bitNs, line);
      });
    };

    const finishWord = (written: number, out: number, input: number, n: number, mask: number, t: number, bitNs: number, line: number) => {
      b.mem.writes++;
      if (p.cur && p.aborted) {
        b.warn(line, `spi-cs-early-${id}`, `The chip select of the ${p.cur.name} (GPIO${p.cur.csPin}) went high while a word was still being shifted, so the transfer was cut off. Writing SPITXBUF only starts the transfer: wait until the words have been received (RXFFST, or the receive interrupt) before raising the chip select.`, "error");
        input = mask;
      }
      // SPIDAT shifted left n times: what is left of the written word sits above the received bits.
      const rx = n === 16 ? input : ((written << n) | input) & 0xffff;
      set("SPIDAT", rx);
      p.words++;
      bus.log.push({ t, port: id, bits: n, out, in: input, device: p.cur?.name ?? null, frame: bus.frame });
      trimLog(b, bus);
      b.publish(`${NAME}_TX`, out, t);
      b.publish(`${NAME}_RX`, input, t);
      b.publish(`${NAME}_WORDS`, p.words, t);
      p.cur = null;

      if (fifoOn()) {
        if (get("SPIFFRX", "RXFIFORESET") === 1) {
          if (p.rxq.length >= 16) {
            // 18.5.2.10: more than 16 words: the first received word is lost.
            p.rxq.shift();
            set("SPIFFRX", 1, "RXFFOVF");
            b.warn(line, `spi-rx-overflow-${id}`, `${NAME}'s receive FIFO overflowed: 16 words were waiting and another arrived, so the oldest was lost. Every word sent is a word received: read SPIRXBUF once for each word you send.`);
          }
          p.rxq.push(rx);
          set("SPIFFRX", p.rxq.length, "RXFFST");
          set("SPIRXBUF", p.rxq[0]);
          evalRx(true);
        }
      } else {
        if (get("SPISTS", "INT_FLAG")) {
          set("SPISTS", 1, "OVERRUN_FLAG");
          if (get("SPICTL", "OVERRUNINTENA")) b.pie.raise(6, PIE_CH[id][0]);
        }
        set("SPIRXBUF", rx);
        set("SPISTS", 1, "INT_FLAG");
        if (get("SPICTL", "SPIINTENA")) b.pie.raise(6, PIE_CH[id][0]);
      }

      // 18.3.7 step 7: TXDLY SPICLK cycles before the next FIFO word is loaded.
      p.busy = false;
      p.gapUntil = t + (fifoOn() ? get("SPIFFCT", "TXDLY") * bitNs : 0);
      kick(t);
    };

    /** Starts the next waiting word, if the shifter is free. */
    const kick = (t: number) => {
      if (p.busy || !p.txq.length) return;
      p.busy = true;
      const gen = p.gen;
      const go = (at: number) => {
        if (p.gen !== gen) return;
        const w = p.txq.shift();
        if (!w) {
          p.busy = false;
          return;
        }
        txStatus();
        evalTx();
        startWord(w.v, w.line, at);
      };
      if (p.gapUntil > t) b.at(p.gapUntil, go);
      else go(t);
    };

    /** Stops the word on the wire and empties the transmit side. */
    const abort = () => {
      p.gen++;
      p.busy = false;
      p.cur = null;
      p.txq = [];
      p.gapUntil = 0;
      b.mem.writes++;
    };

    const write = (v: number) => {
      const line = b.line;
      if (!get("SPICCR", "SPISWRESET")) {
        b.warn(line, `spi-in-reset-${id}`, `SPITXBUF was written while ${NAME} is held in reset (SPICCR.bit.SPISWRESET = 0), so nothing is sent. Finish the configuration with ${pre}.SPICCR.bit.SPISWRESET = 1; first.`);
        return;
      }
      if (!get("SPICTL", "MASTER_SLAVE")) {
        b.warn(line, `spi-slave-${id}`, `SPITXBUF was written, but ${NAME} is a slave (SPICTL.bit.MASTER_SLAVE = 0): it waits for a clock from another chip and sends nothing by itself. Set ${pre}.SPICTL.bit.MASTER_SLAVE = 1;`);
        return;
      }
      if (fifoOn()) {
        if (!get("SPIFFTX", "TXFIFO")) {
          b.warn(line, `spi-txfifo-reset-${id}`, `SPITXBUF was written while the transmit FIFO is held in reset (SPIFFTX.bit.TXFIFO = 0), so the word was dropped. Release it with ${pre}.SPIFFTX.bit.TXFIFO = 1;`);
          return;
        }
        if (p.txq.length >= 16) {
          b.warn(line, `spi-tx-overflow-${id}`, `${NAME}'s transmit FIFO is full (16 words waiting), so this word was lost. Wait until ${pre}.SPIFFTX.bit.TXFFST is below 16 before writing SPITXBUF.`, "error");
          return;
        }
        p.txq.push({ v, line });
      } else {
        // One-word buffer behind the shift register (18.5.2.7).
        if (p.txq.length) b.warn(line, `spi-tx-overwrite-${id}`, `SPITXBUF was written while it still held a word that had not been sent (SPISTS.bit.BUFFULL_FLAG = 1), so that word was lost. Without the FIFO, wait for each word to finish, or enable the FIFO with ${pre}.SPIFFTX.bit.SPIFFENA = 1;`);
        p.txq = [{ v, line }];
      }
      txStatus();
      kick(b.now);
    };

    // ---- registers ----
    const live = (what: string) =>
      b.warn(b.line, `spi-config-live-${id}`, `${what} was changed while ${NAME} is running (SPICCR.bit.SPISWRESET = 1). TRM 18.4.2: clear SPISWRESET before changing the configuration and set it again afterwards, or the clock pin can glitch and a device sees a false edge.`);

    const ccr = dev.reg(`${pre}.SPICCR`).hook;
    ccr.after = (v, before) => {
      if (!(v & 0x80)) {
        // 18.5.2.1: the operating flags return to their reset state.
        if (before & 0x80) abort();
        set("SPISTS", get("SPISTS") & ~0xe0);
      } else if (before & 0x80 && (v ^ before) & 0x4f) live((v ^ before) & 0x40 ? "CLKPOLARITY" : "SPICHAR");
      idlePins(b.now);
    };
    const ctl = dev.reg(`${pre}.SPICTL`).hook;
    ctl.after = (v, before) => {
      if (get("SPICCR", "SPISWRESET") && (v ^ before) & 0x0c) live((v ^ before) & 0x08 ? "CLK_PHASE" : "MASTER_SLAVE");
      idlePins(b.now);
    };
    dev.reg(`${pre}.SPIBRR`).hook.after = (v, before) => {
      if (get("SPICCR", "SPISWRESET") && v !== before) live("SPIBRR");
    };
    // OVERRUN_FLAG is write-1-to-clear; the other status bits are read-only.
    dev.reg(`${pre}.SPISTS`).hook.write = (v, stored) => stored & ~(v & 0x80);

    dev.reg(`${pre}.SPITXBUF`).hook.after = write;
    // Writing the shift register directly also starts a transfer in master mode (18.5.2.8).
    dev.reg(`${pre}.SPIDAT`).hook.after = write;

    const rxbuf = dev.reg(`${pre}.SPIRXBUF`).hook;
    rxbuf.write = (_v, stored) => stored;
    rxbuf.read = (stored) => {
      b.mem.writes++;
      if (!fifoOn()) {
        set("SPISTS", 0, "INT_FLAG");
        return stored;
      }
      if (!p.rxq.length) {
        b.warn(b.line, `spi-rx-empty-${id}`, `SPIRXBUF was read while the receive FIFO is empty (RXFFST = 0), so the value is an old word, not new data. Read once for each word sent, after the words have arrived.`);
        return p.lastRead;
      }
      p.refires = 0;
      p.lastRead = p.rxq.shift()!;
      set("SPIFFRX", p.rxq.length, "RXFFST");
      if (p.rxq.length) set("SPIRXBUF", p.rxq[0]);
      return p.lastRead;
    };

    const fftx = dev.reg(`${pre}.SPIFFTX`).hook;
    // TXFFST and TXFFINT are read-only; TXFFINTCLR clears TXFFINT and reads 0.
    fftx.write = (v, stored) => (v & 0xe03f) | (stored & 0x1f80 & (v & 0x40 ? ~0x80 : ~0));
    fftx.after = (v) => {
      if (!(v & 0x8000)) {
        // SPIRST = 0 resets the FIFO transmit and receive channels.
        abort();
        p.rxq = [];
        set("SPIFFRX", 0, "RXFFST");
      }
      if (!(v & 0x2000) && p.txq.length && get("SPIFFTX", "SPIFFENA")) p.txq = [];
      if (get("SPIFFTX", "SPIFFENA")) set("SPIFFTX", p.txq.length, "TXFFST");
      if (v & 0x40) p.txLine = false;
      evalTx();
    };
    const ffrx = dev.reg(`${pre}.SPIFFRX`).hook;
    // RXFFOVF, RXFFST and RXFFINT are read-only; the two CLR bits clear and read 0.
    ffrx.write = (v, stored) => (v & 0x203f) | (stored & 0x9f80 & (v & 0x4000 ? ~0x8000 : ~0) & (v & 0x40 ? ~0x80 : ~0));
    ffrx.after = (v) => {
      if (!(v & 0x2000)) {
        p.rxq = [];
        set("SPIFFRX", 0, "RXFFST");
      }
      if (v & 0x40) {
        p.rxLine = false;
        // Level sensitive: the flag sets again at once while RXFFST >= RXFFIL.
        if (fifoOn() && get("SPIFFRX", "RXFFIENA") && get("SPIFFRX", "RXFFST") >= get("SPIFFRX", "RXFFIL")) {
          const msg = `RXFFINT was cleared while the receive FIFO still holds ${get("SPIFFRX", "RXFFST")} word(s) and RXFFIL is ${get("SPIFFRX", "RXFFIL")}, so the ${NAME} receive interrupt fires again at once. Read SPIRXBUF once for every word sent before clearing the flag, and set RXFFIL to the number of words in the transfer.`;
          b.warn(b.line, `spi-rx-not-drained-${id}`, msg, "error");
          // The interrupt would now starve the rest of the program for ever.
          if (++p.refires > 200) throw new RuntimeError(b.line, msg);
        } else p.refires = 0;
      }
      evalRx();
    };
  }

  // ---- chip selects, and devices driven by bit-banged GPIO pins ----
  const somiBit = (d: SpiDevice, s: BitBang, t: number) => {
    const n = d.unitBits ?? 8;
    s.driving = true;
    gpio.drive(pinsOf(d).somi, ((s.reply >>> (n - 1 - s.count)) & 1) as 0 | 1, t);
  };
  gpio.listeners.push((pin, level, t) => {
    // A new chip-select frame starts when a device's chip select goes low.
    if (bus.devices.some((d) => d.csPin === pin)) {
      if (level !== 0) bus.csLow.delete(pin);
      else if (!bus.csLow.has(pin)) {
        bus.csLow.add(pin);
        bus.frame++;
      }
    }
    for (const d of bus.devices) {
      const pins = pinsOf(d);
      if (pin === d.csPin) {
        if (level === 0 && !bus.selected.has(d)) {
          bus.selected.add(d);
          b.mem.writes++;
          d.select?.();
          if (d.peek) {
            const s: BitBang = { reply: d.peek(t), count: 0, acc: 0, t0: t, driving: false };
            bus.bang.set(d, s);
            // Clock pin is a plain GPIO: the program is bit-banging, so SOMI must show the first bit.
            if (gpio.mux(pins.clk) === 0 && gpio.isOutput(pins.clk)) somiBit(d, s, t);
          }
        } else if (level === 1 && bus.selected.has(d)) {
          bus.selected.delete(d);
          b.mem.writes++;
          const p = bus.ports.get(portOf(d));
          if (p && p.cur === d) p.aborted = true;
          const s = bus.bang.get(d);
          if (s?.driving || gpio.mux(pins.somi) !== 0) gpio.drive(pins.somi, null, t);
          bus.bang.delete(d);
          d.deselect?.();
        }
      } else if (pin === pins.clk && d.peek && bus.selected.has(d) && gpio.mux(pin) === 0) {
        const s = bus.bang.get(d);
        if (!s) continue;
        const n = d.unitBits ?? 8;
        const latchRising = clockScheme(modesOf(d)[0]).latches === "rising";
        if ((level === 1) === latchRising) {
          if (s.count === 0) s.t0 = t;
          s.acc = (s.acc << 1) | (gpio.level[pins.simo] === 0 ? 0 : 1);
          if (++s.count === n) {
            const out = s.acc;
            d.transfer(out, n, s.t0, t);
            bus.log.push({ t, port: portOf(d), bits: n, out, in: s.reply, device: d.name, frame: bus.frame });
            trimLog(b, bus);
            s.count = 0;
            s.acc = 0;
            s.reply = d.peek(t);
          }
        } else if (s.count < n) somiBit(d, s, t);
      }
    }
  });
}

export const plugin: SimPlugin = {
  name: "spi",
  install,
};

/** A live run keeps the recent words only: an IMU read every millisecond adds millions of words an hour. */
function trimLog(b: Board, bus: { log: SpiWord[]; dropped: number }): void {
  const limit = b.historyLimit;
  if (!limit || bus.log.length <= limit) return;
  const cut = bus.log.length - (limit >> 1);
  bus.log.splice(0, cut);
  bus.dropped += cut;
}
