// I2C module B as a bus master, and the devices on its bus. TRM chapter 20
// "Inter-Integrated Circuit Module (I2C)".
//
// What is modelled, with the TRM section it follows:
// - 20.1.4 / 20.1.5: module clock = SYSCLK / (IPSC + 1), which must be 7 to
//   12 MHz and is latched when IRS goes 0 -> 1; SCL low time = Tmod * (ICCL
//   + d), high time = Tmod * (ICCH + d), d = 7, 6, 5 for IPSC = 0, 1, > 1
//   (Table 20-1).
// - 20.2: pins. SDAB = GPIO40, SCLB = GPIO41, mux position 6 (the course
//   board's pin table; Lab 3 uses GPIO_SetupPinMux(40, GPIO_MUX_CPU1, 6)).
// - 20.3.3 / Table 20-3: master-transmitter and master-receiver, nonrepeat
//   mode (I2CCNT bytes) and repeat mode (RM), STT / STP / repeated START.
// - 20.3.4: START, STOP and the bus busy bit BB.
// - 20.3.5.1: 7-bit addressing; R/W = 0 when TRX = 1. BC (1 to 8 data bits).
// - 20.3.6: the master-receiver answers the last byte with a NACK
//   (NACKMOD for an earlier one).
// - 20.4: I2CINT (PIE 8.3) from I2CIER, I2CISRC; FIFO interrupt (PIE 8.4).
// - 20.5: IRS = 0 resets the status bits and releases the pins.
// - 20.6.2: I2CSTR (BB, XRDY, RRDY, ARDY, NACK, SCD, XSMT, RSFULL, NACKSNT;
//   write 1 to clear), I2CMDR, I2CSAR, I2CCNT, I2CDXR, I2CDRR, I2CPSC,
//   I2CCLKL, I2CCLKH, and the 16-deep FIFOs of I2CFFTX / I2CFFRX.
//
// After a NACK the module sets NACK and ARDY and holds SCL low until the
// program writes STP = 1 (or a new START), as TI's i2c_eeprom example
// handles it; the TRM does not spell this out.
//
// Not modelled: slave mode (I2COAR, AAS), a second master (ARBL is never
// set), 10-bit addresses (XA), free data format (FDF), START byte mode
// (STB), digital loopback (DLB), clock stretching by a device, I2CA (its
// pins are used by other things on the course board).
//
// The bus is electrical: SDA and SCL are driven on the pins as open-drain
// outputs, and the devices decode the pin levels. So a master bit-banged on
// GPIO40 / GPIO41 reaches the same devices. The simulated board has no
// external pull-up resistors: the pins' internal pull-ups must be enabled
// (TRM 20.2).
//
// Devices on the bus:
// - 0x48: temperature sensor in the style of a TMP102. Register 0 (selected
//   after power-up) holds the temperature, 2 bytes, MSB first: a signed
//   12-bit count of 0.0625 degC in the upper 12 bits, so degC = (int16)raw
//   / 256. Registers 1 to 3 (configuration, low limit, high limit) can be
//   written: pointer byte, then 2 data bytes. Temperature comes from the
//   signal-bus input "TEMP_C".
// - 0x68: real-time clock in the style of the BQ32000 on the course board
//   (seconds, minutes, hours in BCD in registers 0 to 2; starts at 12:34:56).
//
// Signal-bus outputs: I2C_STARTS, I2C_STOPS, I2C_ADDR_ACKS, I2C_ADDR_NACKS,
// I2C_DATA_BYTES (counts seen on the bus), I2C_SCL_HZ, TMP_POINTER,
// TMP_TLOW_C, TMP_THIGH_C.

import type { Board } from "../board";
import { SYSCLK_NS } from "../consts";
import type { SimPlugin } from "../plugin";

export const I2C_SDA_PIN = 40;
export const I2C_SCL_PIN = 41;
export const I2C_MUX = 6;
const SDA = I2C_SDA_PIN;
const SCL = I2C_SCL_PIN;
const P = "I2cbRegs";

// I2CMDR bits (TRM 20.6.2.10)
const M_BC = 0x0007;
const M_FDF = 0x0008;
const M_STB = 0x0010;
const M_IRS = 0x0020;
const M_DLB = 0x0040;
const M_RM = 0x0080;
const M_XA = 0x0100;
const M_TRX = 0x0200;
const M_MST = 0x0400;
const M_STP = 0x0800;
const M_STT = 0x2000;
const M_NACKMOD = 0x8000;

// I2CSTR bits (TRM 20.6.2.3)
const S_ARBL = 0x0001;
const S_NACK = 0x0002;
const S_ARDY = 0x0004;
const S_RRDY = 0x0008;
const S_XRDY = 0x0010;
const S_SCD = 0x0020;
const S_XSMT = 0x0400;
const S_RSFULL = 0x0800;
const S_BB = 0x1000;
const S_NACKSNT = 0x2000;
const S_SDIR = 0x4000;
const S_W1C = S_ARBL | S_NACK | S_ARDY | S_RRDY | S_SCD | S_NACKSNT | S_SDIR;
const STR_RESET = 0x0410;

// I2CFFTX / I2CFFRX bits
const F_IL = 0x001f;
const F_IENA = 0x0020;
const F_INTCLR = 0x0040;
const F_INT = 0x0080;
const F_RST = 0x2000;
const F_EN = 0x4000;

/** A device on the bus. */
export interface I2cDevice {
  address: number;
  /** A START addressed to this device; `read` is the R/W bit. */
  start(read: boolean): void;
  /** The master wrote a byte. Return true to acknowledge it. */
  write(byte: number): boolean;
  /** The master reads the next byte. */
  read(): number;
  stop(): void;
}

/** One transfer seen on the bus (for tests and tools). */
export interface I2cTransfer {
  t: number;
  address: number;
  read: boolean;
  acked: boolean;
  data: number[];
  stopped: boolean;
}

/**
 * The slave side of the bus. It only looks at the two pins, as real devices
 * do: START and STOP are SDA edges while SCL is high, bits are taken on the
 * rising edge of SCL, and the device changes SDA on the falling edge.
 */
export class I2cBus {
  devices = new Map<number, I2cDevice>();
  log: I2cTransfer[] = [];
  private phase: "idle" | "rx" | "ack" | "tx" | "mack" | "skip" = "idle";
  private shift = 0;
  private bits = 0;
  private dev: I2cDevice | null = null;
  private addressed = false;
  private reading = false;
  private txByte = 0;
  private masterAck = false;
  private cur: I2cTransfer | null = null;
  private counts = { I2C_STARTS: 0, I2C_STOPS: 0, I2C_ADDR_ACKS: 0, I2C_ADDR_NACKS: 0, I2C_DATA_BYTES: 0 };

  constructor(private b: Board) {
    b.gpio.listeners.push((pin, level, t) => {
      if (pin === SDA) {
        // SDA moving while SCL is high is a START (falling) or a STOP (rising).
        if (b.gpio.level[SCL] === 1) {
          if (level === 0) this.onStart(t);
          else this.onStop(t);
        }
      } else if (pin === SCL) {
        if (level === 1) this.rising();
        else this.falling(t);
      }
    });
  }

  add(d: I2cDevice): void {
    this.devices.set(d.address, d);
  }

  private count(name: keyof I2cBus["counts"], t: number): void {
    this.b.publish(name, ++this.counts[name], t);
  }

  private pull(low: boolean, t: number): void {
    this.b.gpio.drive(SDA, low ? 0 : null, t);
  }

  private onStart(t: number): void {
    this.phase = "rx";
    this.shift = 0;
    this.bits = 0;
    this.addressed = false;
    this.cur = null;
    this.count("I2C_STARTS", t);
  }

  private onStop(t: number): void {
    if (this.phase === "idle") return;
    if (this.addressed) this.dev?.stop();
    if (this.cur) this.cur.stopped = true;
    this.phase = "idle";
    this.addressed = false;
    this.cur = null;
    this.pull(false, t);
    this.count("I2C_STOPS", t);
  }

  private rising(): void {
    const sda = this.b.gpio.level[SDA] === 0 ? 0 : 1;
    if (this.phase === "rx") {
      this.shift = ((this.shift << 1) | sda) & 0xff;
      this.bits++;
    } else if (this.phase === "mack") this.masterAck = sda === 0;
  }

  private putBit(t: number): void {
    this.pull(((this.txByte >> (7 - this.bits)) & 1) === 0, t);
  }

  private falling(t: number): void {
    switch (this.phase) {
      case "rx": {
        if (this.bits < 8) return;
        let ack: boolean;
        if (!this.addressed) {
          const address = this.shift >> 1;
          this.reading = (this.shift & 1) === 1;
          this.dev = this.devices.get(address) ?? null;
          ack = this.dev !== null;
          this.cur = { t, address, read: this.reading, acked: ack, data: [], stopped: false };
          this.log.push(this.cur);
          if (this.dev) {
            this.addressed = true;
            this.dev.start(this.reading);
          }
          this.count(ack ? "I2C_ADDR_ACKS" : "I2C_ADDR_NACKS", t);
        } else {
          ack = this.dev!.write(this.shift);
          this.cur?.data.push(this.shift);
          this.count("I2C_DATA_BYTES", t);
        }
        if (ack) {
          // The receiver pulls SDA low during the ninth clock.
          this.pull(true, t);
          this.phase = "ack";
        } else this.phase = "skip";
        return;
      }
      case "ack":
        this.bits = 0;
        this.shift = 0;
        if (this.reading) {
          this.txByte = this.dev!.read() & 0xff;
          this.phase = "tx";
          this.putBit(t);
        } else {
          this.pull(false, t);
          this.phase = "rx";
        }
        return;
      case "tx":
        if (++this.bits < 8) this.putBit(t);
        else {
          // Byte sent: release SDA so the master can answer.
          this.cur?.data.push(this.txByte);
          this.count("I2C_DATA_BYTES", t);
          this.pull(false, t);
          this.phase = "mack";
        }
        return;
      case "mack":
        if (this.masterAck) {
          this.txByte = this.dev!.read() & 0xff;
          this.bits = 0;
          this.phase = "tx";
          this.putBit(t);
        } else this.phase = "skip";
        return;
    }
  }
}

/** Temperature sensor in the style of a TMP102 (12 bits, 0.0625 degC per count). */
export class TempSensor implements I2cDevice {
  address = 0x48;
  pointer = 0;
  /** Registers 1 to 3: configuration, low limit (75 degC), high limit (80 degC). */
  regs = [0, 0x60a0, 0x4b00, 0x5000];
  private first = true;
  private idx = 0;
  private latch = 0;

  constructor(private b: Board) {}

  /** The 16-bit temperature register for a temperature in degC. */
  static raw(degC: number): number {
    const counts = Math.round(Math.max(-55, Math.min(127.9375, degC)) / 0.0625);
    return (counts << 4) & 0xffff;
  }

  start(read: boolean): void {
    this.first = true;
    this.idx = 0;
    if (read) this.latch = this.pointer === 0 ? TempSensor.raw(this.b.input("TEMP_C", 25)) : this.regs[this.pointer];
  }

  write(byte: number): boolean {
    if (this.first) {
      this.first = false;
      this.pointer = byte & 3;
      this.b.publish("TMP_POINTER", this.pointer);
      return true;
    }
    if (this.pointer === 0 || this.idx > 1) return false; // the temperature is read-only
    const sh = this.idx === 0 ? 8 : 0;
    this.regs[this.pointer] = (this.regs[this.pointer] & ~(0xff << sh)) | (byte << sh);
    if (++this.idx === 2 && this.pointer >= 2) {
      const v = this.regs[this.pointer];
      this.b.publish(this.pointer === 2 ? "TMP_TLOW_C" : "TMP_THIGH_C", ((v << 16) >> 16) / 256);
    }
    return true;
  }

  read(): number {
    return (this.latch >> (this.idx++ % 2 === 0 ? 8 : 0)) & 0xff;
  }

  stop(): void {}
}

/** Real-time clock in the style of the BQ32000: BCD seconds, minutes, hours... */
export class Rtc implements I2cDevice {
  address = 0x68;
  pointer = 0;
  private first = true;

  constructor(private b: Board) {}

  private reg(i: number): number {
    const bcd = (n: number) => ((Math.floor(n / 10) << 4) | (n % 10)) & 0xff;
    const s = 12 * 3600 + 34 * 60 + 56 + Math.floor(this.b.now / 1e9);
    switch (i) {
      case 0: return bcd(s % 60);
      case 1: return bcd(Math.floor(s / 60) % 60);
      case 2: return bcd(Math.floor(s / 3600) % 24);
      case 3: return 6; // day of the week
      case 4: return 0x13;
      case 5: return 0x11;
      case 6: return 0x26;
      default: return 0;
    }
  }

  start(): void {
    this.first = true;
  }

  write(byte: number): boolean {
    if (this.first) {
      this.first = false;
      this.pointer = byte & 0x0f;
    }
    // The time itself cannot be set in this model; the byte is accepted.
    return true;
  }

  read(): number {
    const v = this.reg(this.pointer);
    this.pointer = (this.pointer + 1) & 0x0f;
    return v;
  }

  stop(): void {}
}

type Step = number | "wait";

/** The I2C module as a master (non-FIFO and FIFO mode). */
export class I2cMaster {
  private gen: Generator<Step, void, void> | null = null;
  private ev: ReturnType<Board["at"]> | null = null;
  /** What the transfer is waiting for while it holds SCL low. */
  private waiting: null | "dxr" | "drr" | "cmd" = null;
  /** We generated a START and no STOP yet. */
  private owned = false;
  private t = 0;
  private tLow = 0;
  private tHigh = 0;
  /** Module clock in Hz, latched when IRS goes 0 -> 1. */
  moduleHz = 0;
  private dxrFull = false;
  private txFifo: number[] = [];
  private rxFifo: number[] = [];

  constructor(private b: Board) {
    const dev = b.dev;
    dev.set(`${P}.I2CSTR`, STR_RESET);
    dev.set(`${P}.I2CSAR`, 0x3ff);

    const mdr = dev.reg(`${P}.I2CMDR`).hook;
    // STT and STP cannot be written while the module is in reset (IRS = 0).
    mdr.write = (v) => ((v & M_IRS ? v : v & ~(M_STT | M_STP)) & ~0x1000) >>> 0;
    mdr.after = (v, before) => this.onMode(v, before);

    const str = dev.reg(`${P}.I2CSTR`).hook;
    str.write = (v, stored) => stored & ~(v & S_W1C);

    dev.reg(`${P}.I2CDXR`).hook.after = (v) => {
      if (this.txFifoOn()) {
        if (this.txFifo.length >= 16) {
          b.warn(b.line, "i2c-fifo-full", "The I2C transmit FIFO holds 16 bytes and is full, so this byte was lost. Check I2cbRegs.I2CFFTX.bit.TXFFST before writing I2CDXR.", "error");
          return;
        }
        this.txFifo.push(v & 0xff);
        this.fifoStatus();
      } else {
        this.dxrFull = true;
        this.clr(S_XRDY);
        this.set(S_XSMT);
      }
      if (this.waiting === "dxr") this.resume();
    };

    const drr = dev.reg(`${P}.I2CDRR`).hook;
    drr.read = (stored) => {
      let v = stored;
      if (this.rxFifoOn()) {
        if (this.rxFifo.length) v = this.rxFifo.shift()!;
        this.fifoStatus();
      } else this.clr(S_RRDY | S_RSFULL);
      b.mem.writes++;
      if (this.waiting === "drr") this.resume();
      return v;
    };
    drr.write = (_v, stored) => stored;

    // I2CISRC: code of the highest-priority pending, enabled request. Reading
    // it clears that flag, except ARDY, RRDY and XRDY (TRM 20.4.1).
    const isrc = dev.reg(`${P}.I2CISRC`).hook;
    isrc.read = () => {
      const pending = dev.get(`${P}.I2CSTR`) & dev.get(`${P}.I2CIER`) & 0x3f;
      for (let i = 0; i < 6; i++) {
        if (!(pending & (1 << i))) continue;
        if (i === 0 || i === 1 || i === 5) this.clr(1 << i);
        b.mem.writes++;
        return i + 1;
      }
      return 0;
    };
    dev.reg(`${P}.I2CIER`).hook.after = () => this.irq(dev.get(`${P}.I2CSTR`));

    dev.reg(`${P}.I2CPSC`).hook.after = () => {
      if (dev.get(`${P}.I2CMDR`) & M_IRS)
        b.warn(b.line, "i2c-psc-late", "I2CPSC only takes effect when IRS goes from 0 to 1 (TRM 20.1.4). Write the prescaler while I2CMDR.bit.IRS is 0, then set IRS = 1.");
    };

    // FIFO registers: the status fields are read-only, the reset bits empty
    // the FIFOs, writing 1 to an INTCLR bit clears the interrupt flag.
    const fifo = (name: "I2CFFTX" | "I2CFFRX", q: () => number[]) => {
      const h = dev.reg(`${P}.${name}`).hook;
      h.write = (v, stored) => {
        let next = (v & ~0x1f80) | (stored & 0x1f80);
        if (v & F_INTCLR) next &= ~F_INT;
        return next & ~F_INTCLR;
      };
      h.after = (v) => {
        if (!(v & F_RST)) q().length = 0;
        this.fifoStatus();
        if (this.waiting === "dxr" && this.txAvailable()) this.resume();
      };
    };
    fifo("I2CFFTX", () => this.txFifo);
    fifo("I2CFFRX", () => this.rxFifo);

    // I2CA exists on the chip but nothing is wired to it here.
    dev.reg("I2caRegs.I2CMDR").hook.after = (v) => {
      if (v & M_IRS)
        b.warn(b.line, "i2c-a", "I2CA is not connected to anything on this board. The bus devices are on I2CB: use I2cbRegs, with GPIO40 as SDAB and GPIO41 as SCLB (mux position 6).");
    };
  }

  // ---- status helpers ----

  private str(): number {
    return this.b.dev.get(`${P}.I2CSTR`);
  }

  private set(bits: number): void {
    const old = this.str();
    this.b.dev.set(`${P}.I2CSTR`, old | bits);
    this.irq(bits & ~old);
  }

  private clr(bits: number): void {
    this.b.dev.set(`${P}.I2CSTR`, this.str() & ~bits);
  }

  private mdr(): number {
    return this.b.dev.get(`${P}.I2CMDR`);
  }

  private mdrClear(bits: number): void {
    this.b.dev.set(`${P}.I2CMDR`, this.mdr() & ~bits);
  }

  /** Requests I2CINT (PIE 8.3) for newly set flags that I2CIER enables. */
  private irq(flags: number): void {
    if (flags & this.b.dev.get(`${P}.I2CIER`) & 0x3f) this.b.pie.raise(8, 3);
  }

  private txFifoOn(): boolean {
    const v = this.b.dev.get(`${P}.I2CFFTX`);
    return (v & F_EN) !== 0 && (v & F_RST) !== 0;
  }

  private rxFifoOn(): boolean {
    return (this.b.dev.get(`${P}.I2CFFTX`) & F_EN) !== 0 && (this.b.dev.get(`${P}.I2CFFRX`) & F_RST) !== 0;
  }

  /** Updates TXFFST / RXFFST and the FIFO interrupt flags (PIE 8.4). */
  private fifoStatus(): void {
    const dev = this.b.dev;
    let fire = false;
    let tx = (dev.get(`${P}.I2CFFTX`) & ~0x1f00) | (this.txFifo.length << 8);
    if (this.txFifoOn() && this.txFifo.length <= (tx & F_IL) && !(tx & F_INT)) {
      tx |= F_INT;
      fire ||= (tx & F_IENA) !== 0;
    }
    dev.set(`${P}.I2CFFTX`, tx);
    let rx = (dev.get(`${P}.I2CFFRX`) & ~0x1f00) | (this.rxFifo.length << 8);
    if (this.rxFifoOn() && this.rxFifo.length >= (rx & F_IL) && this.rxFifo.length > 0 && !(rx & F_INT)) {
      rx |= F_INT;
      fire ||= (rx & F_IENA) !== 0;
    }
    dev.set(`${P}.I2CFFRX`, rx);
    this.b.mem.writes++;
    if (fire) this.b.pie.raise(8, 4);
  }

  private txAvailable(): boolean {
    return this.txFifoOn() ? this.txFifo.length > 0 : this.dxrFull;
  }

  private takeTx(): number {
    if (this.txFifoOn()) {
      const v = this.txFifo.shift()!;
      this.fifoStatus();
      return v;
    }
    this.dxrFull = false;
    // The byte moved to the shift register: I2CDXR can take the next one.
    this.set(S_XRDY);
    return this.b.dev.get(`${P}.I2CDXR`) & 0xff;
  }

  // ---- pins ----

  private sda(high: boolean): void {
    this.b.gpio.drivePeripheral(SDA, high ? null : 0, this.t);
  }

  private scl(high: boolean): void {
    this.b.gpio.drivePeripheral(SCL, high ? null : 0, this.t);
  }

  // ---- I2CMDR ----

  private onMode(v: number, before: number): void {
    const b = this.b;
    if (!(v & M_IRS)) {
      if (before & M_IRS) this.reset();
      return;
    }
    if (!(before & M_IRS)) this.enable();
    for (const [bit, name, what] of [
      [M_XA, "XA", "10-bit addressing"], [M_FDF, "FDF", "the free data format"],
      [M_STB, "STB", "START byte mode"], [M_DLB, "DLB", "digital loopback"],
    ] as const) {
      if (v & bit) b.warn(b.line, "i2c-unsupported", `I2CMDR.${name} is set, but this simulator does not model ${what}. Leave ${name} at 0.`);
    }
    if (v & M_STT) {
      // The START condition is generated at once, so STT reads 0 again.
      this.mdrClear(M_STT);
      if (!(v & M_MST)) {
        b.warn(b.line, "i2c-not-master", "STT was set with MST = 0. Only a master generates a START condition: set MST (bit 10) in the same write, for example I2cbRegs.I2CMDR.all = 0x6E20;");
        return;
      }
      if (this.gen && this.waiting !== "cmd") {
        // On the chip this disturbs the transfer in progress in ways that
        // cannot be predicted (TRM 20.6.2.10, STP). Here the write is undone.
        b.dev.set(`${P}.I2CMDR`, before);
        b.warn(
          b.line,
          "i2c-busy",
          "A new transfer was started while the previous one was still on the bus. On the chip that corrupts both; here this write was ignored. Wait first: while (I2cbRegs.I2CMDR.bit.STP == 1) {} and check I2cbRegs.I2CSTR.bit.BB.",
          "error",
        );
        return;
      }
      this.begin();
      return;
    }
    // STP written while a transfer holds the bus: generate the STOP now.
    // (Written before STT, it simply waits for the transfer to come.)
    if (v & M_STP && this.gen && (this.waiting === "cmd" || (this.waiting === "dxr" && v & M_RM))) this.resume();
  }

  /** IRS 0 -> 1: the prescaler takes effect (TRM 20.1.4). */
  private enable(): void {
    const b = this.b;
    const ipsc = b.dev.get(`${P}.I2CPSC`) & 0xff;
    this.moduleHz = 1e9 / (SYSCLK_NS * (ipsc + 1));
    if (this.moduleHz < 7e6 || this.moduleHz > 12e6) {
      b.warn(
        b.line,
        "i2c-module-clock",
        `The I2C module clock is ${+(this.moduleHz / 1e6).toFixed(2)} MHz (200 MHz / (I2CPSC + 1), I2CPSC = ${ipsc}). It must be between 7 and 12 MHz to meet the I2C timing (TRM 20.1.4). Write I2CPSC while IRS = 0, for example I2cbRegs.I2CPSC.all = 19; for 10 MHz.`,
        "error",
      );
    }
  }

  /** IRS = 0: status bits to their reset values, pins released (TRM 20.5). */
  private reset(): void {
    this.b.cancel(this.ev);
    this.ev = null;
    this.gen = null;
    this.waiting = null;
    this.owned = false;
    this.dxrFull = false;
    this.t = this.b.now;
    this.scl(true);
    this.sda(true);
    this.b.dev.set(`${P}.I2CSTR`, STR_RESET);
    this.mdrClear(M_STT | M_STP);
    this.b.mem.writes++;
  }

  private begin(): void {
    const b = this.b;
    const dev = b.dev;
    for (const [pin, name] of [[SDA, "SDAB"], [SCL, "SCLB"]] as const) {
      if (b.gpio.mux(pin) !== I2C_MUX) {
        b.warn(b.line, "i2c-mux", `I2CB started a transfer, but GPIO${pin} is not switched to ${name} (mux position ${I2C_MUX}), so nothing reaches the bus. Use GPIO_SetupPinMux(${pin}, GPIO_MUX_CPU1, ${I2C_MUX});`, "error");
        return;
      }
    }
    const iccl = dev.get(`${P}.I2CCLKL`);
    const icch = dev.get(`${P}.I2CCLKH`);
    if (iccl === 0 || icch === 0) {
      b.warn(b.line, "i2c-clk-zero", "I2CCLKL and I2CCLKH must both be non-zero for the clock on SCL to be generated (TRM 20.6.2.4). Set them while IRS = 0.", "error");
      return;
    }
    const ipsc = dev.get(`${P}.I2CPSC`) & 0xff;
    const d = ipsc === 0 ? 7 : ipsc === 1 ? 6 : 5;
    const tmod = 1e9 / this.moduleHz;
    this.tLow = tmod * (iccl + d);
    this.tHigh = tmod * (icch + d);
    const hz = 1e9 / (this.tLow + this.tHigh);
    b.publish("I2C_SCL_HZ", Math.round(hz));
    if (hz > 400e3 * 1.001 && this.moduleHz >= 7e6 && this.moduleHz <= 12e6)
      b.warn(b.line, "i2c-too-fast", `SCL runs at ${+(hz / 1e3).toFixed(1)} kHz. The I2C module and the devices on this bus are specified up to 400 kHz (fast mode, TRM 20.1.1). Raise I2CCLKL / I2CCLKH: SCL = module clock / ((I2CCLKL + ${d}) + (I2CCLKH + ${d})).`);

    this.t = b.now;
    const repeated = this.owned;
    if (!repeated) {
      // A released line must read high: that takes a pull-up.
      this.scl(true);
      this.sda(true);
      for (const [pin, name] of [[SDA, "SDA"], [SCL, "SCL"]] as const) {
        const lv = b.gpio.level[pin];
        if (lv === 1) continue;
        b.warn(
          b.line,
          lv < 0 ? "i2c-pullup" : "i2c-line-low",
          lv < 0
            ? `${name} (GPIO${pin}) has no pull-up, so the line never goes high and no START can be made. I2C outputs only pull low. This board has no external pull-up resistors: enable the internal one with GPIO_SetupPinOptions(${pin}, GPIO_INPUT, GPIO_PULLUP);`
            : `${name} (GPIO${pin}) is held low by something else on the bus, so I2CB cannot make a START condition.`,
          "error",
        );
        return;
      }
    }
    b.cancel(this.ev);
    this.waiting = null;
    this.gen = this.run(repeated);
    this.advance(b.now);
  }

  private resume(): void {
    this.waiting = null;
    this.b.cancel(this.ev);
    this.ev = this.b.at(this.b.now, (t) => this.advance(t));
  }

  private advance(t: number): void {
    this.ev = null;
    if (!this.gen) return;
    this.t = t;
    const r = this.gen.next();
    this.b.mem.writes++;
    if (r.done) {
      this.gen = null;
      return;
    }
    if (r.value !== "wait") this.ev = this.b.at(t + r.value, (at) => this.advance(at));
  }

  // ---- the transfer (TRM Table 20-3, Figure 20-7) ----

  private *sendByte(v: number, n: number): Generator<Step, boolean, void> {
    for (let i = n - 1; i >= 0; i--) {
      this.sda(((v >> i) & 1) === 1);
      yield this.tLow;
      this.scl(true);
      yield this.tHigh;
      this.scl(false);
    }
    // Ninth clock: release SDA and see whether the receiver pulls it low.
    this.sda(true);
    yield this.tLow;
    this.scl(true);
    const ack = this.b.gpio.level[SDA] === 0;
    yield this.tHigh;
    this.scl(false);
    return ack;
  }

  private *recvByte(n: number): Generator<Step, number, void> {
    let v = 0;
    this.sda(true);
    for (let i = 0; i < n; i++) {
      yield this.tLow;
      this.scl(true);
      v = (v << 1) | (this.b.gpio.level[SDA] === 0 ? 0 : 1);
      yield this.tHigh;
      this.scl(false);
    }
    return v;
  }

  private *stop(): Generator<Step, void, void> {
    this.sda(false);
    yield this.tLow;
    this.scl(true);
    yield this.tHigh;
    this.sda(true);
    this.owned = false;
    // Bus free time before the next START.
    yield this.tLow;
    this.clr(S_BB);
    this.set(S_SCD);
    // MST and STP are cleared once the STOP condition has been generated.
    this.mdrClear(M_STP | M_MST);
  }

  /** Holds SCL low until the program writes STP (a new START replaces the transfer). */
  private *hold(): Generator<Step, void, void> {
    this.waiting = "cmd";
    yield "wait";
    yield* this.stop();
  }

  private *run(repeated: boolean): Generator<Step, void, void> {
    const dev = this.b.dev;
    this.clr(S_ARDY);
    if (repeated) {
      // Repeated START: SCL is low here.
      this.sda(true);
      yield this.tLow;
      this.scl(true);
      yield this.tHigh;
    }
    this.sda(false);
    this.owned = true;
    this.set(S_BB);
    yield this.tHigh;
    this.scl(false);

    const mode = this.mdr();
    const trx = (mode & M_TRX) !== 0;
    const rm = (mode & M_RM) !== 0;
    // The internal data counter is loaded from I2CCNT (0 means 65536).
    let count = dev.get(`${P}.I2CCNT`) || 65536;
    const address = dev.get(`${P}.I2CSAR`) & 0x7f;
    if (!(yield* this.sendByte((address << 1) | (trx ? 0 : 1), 8))) {
      this.set(S_NACK | S_ARDY);
      yield* this.hold();
      return;
    }
    this.clr(S_NACK);

    if (trx) {
      for (;;) {
        while (!this.txAvailable()) {
          if (rm && this.mdr() & M_STP) {
            yield* this.stop();
            return;
          }
          // Nothing to send: SCL stays low until I2CDXR is written (XSMT = 0).
          this.clr(S_XSMT);
          this.waiting = "dxr";
          yield "wait";
        }
        const n = this.mdr() & M_BC || 8;
        const acked = yield* this.sendByte(this.takeTx() & ((1 << n) - 1), n);
        count--;
        if (!acked) {
          this.set(S_NACK | S_ARDY);
          yield* this.hold();
          return;
        }
        if (rm) this.set(S_ARDY);
        else if (count === 0) break;
      }
    } else {
      for (;;) {
        const n = this.mdr() & M_BC || 8;
        const v = yield* this.recvByte(n);
        if (this.rxFifoOn()) {
          while (this.rxFifo.length >= 16) {
            this.waiting = "drr";
            yield "wait";
          }
          this.rxFifo.push(v);
          this.fifoStatus();
        } else {
          if (this.str() & S_RRDY) {
            // I2CDRR still holds the previous byte: SCL stays low until it is read.
            this.set(S_RSFULL);
            this.waiting = "drr";
            yield "wait";
          }
          dev.set(`${P}.I2CDRR`, v);
          this.set(S_RRDY);
        }
        count--;
        const m = this.mdr();
        const last = rm ? (m & M_STP) !== 0 : count === 0;
        const early = (m & M_NACKMOD) !== 0;
        if (early) {
          this.mdrClear(M_NACKMOD);
          this.set(S_NACKSNT);
        }
        // The master answers the last byte with a NACK (TRM 20.3.6).
        this.sda(last || early);
        yield this.tLow;
        this.scl(true);
        yield this.tHigh;
        this.scl(false);
        this.sda(true);
        if (last || early) break;
      }
    }
    if (this.mdr() & M_STP) {
      yield* this.stop();
      return;
    }
    this.set(S_ARDY);
    yield* this.hold();
  }
}

export interface I2cState {
  bus: I2cBus;
  master: I2cMaster;
  temp: TempSensor;
  rtc: Rtc;
}

export const plugin: SimPlugin = {
  name: "i2c",
  install(b) {
    const bus = new I2cBus(b);
    const temp = new TempSensor(b);
    const rtc = new Rtc(b);
    bus.add(temp);
    bus.add(rtc);
    const master = new I2cMaster(b);
    const state: I2cState = { bus, master, temp, rtc };
    b.plugins.set("i2c", state);
  },
  parts: {
    robot: [{ kind: "knob", id: "TEMP_C", label: "Temperature at the I2C sensor (0x48)", input: "TEMP_C", min: -40, max: 125, step: 0.5, initial: 25, unit: "degC" }],
    redboard: [{ kind: "knob", id: "TEMP_C", label: "Temperature at the I2C sensor (0x48)", input: "TEMP_C", min: -40, max: 125, step: 0.5, initial: 25, unit: "degC" }],
  },
};
