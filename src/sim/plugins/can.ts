// Controller Area Network: CAN-B (and CAN-A) with the course's CAN library,
// and the two time-of-flight distance sensors of the final project on the
// bus. TRM chapter 22 "Controller Area Network (CAN)".
//
// What is modelled, with the TRM section it follows:
// - 22.4.1 / 22.9: initialization mode. No frame is received or sent while
//   CAN_CTL.Init = 1; CAN_BTR can only be written while Init = CCE = 1.
// - 22.12.1: bit rate = CAN clock / ((BRP + 1) * (1 + (TSEG1 + 1) + (TSEG2
//   + 1))), with BRPE as the upper prescaler bits. The CAN clock is SYSCLK
//   (200 MHz), which is what the course passes to setCANBitRate.
// - 22.14.1: 32 message objects (mask, arbitration, control, 8 data bytes).
// - 22.13 / 22.15.2.22: the IF1 / IF2 register sets. A write to CAN_IFxCMD
//   copies the selected parts between the IFx registers and the message
//   object in MSG_NUM (DIR = 1: to the object; DIR = 0: from the object,
//   where ClrIntPnd and TXRQST clear IntPnd and NewDat).
// - 22.11.2, 22.11.6, 22.11.7: acceptance filtering in ascending object
//   order (MsgVal, Dir = 0, Xtd, identifier, mask if UMask = 1), storing a
//   data frame (data, DLC, identifier, NewDat, MsgLst, IntPnd if RxIE).
// - 22.6: CAN_INT.INT0ID (0x8000 = status, else the lowest-numbered object
//   with IntPnd), the line enables IE0 / SIE, CAN_GLB_INT_EN / _FLG / _CLR,
//   and the PIE interrupt CANB0 = INT9.7 (CANA0 = INT9.5). Reading CAN_ES
//   clears RxOk / TxOk and the status interrupt.
// - 22.10.1: transmit objects (TxRqst, TxOk, IntPnd if TxIE).
// - 22.2: pins as the course starter sets them: CANRXB = GPIO17 and CANTXB
//   = GPIO12, both mux position 2.
//
// The course library (F28379dCAN.c of the final project starter) is provided
// with its own names: InitCANA, InitCANB, setCANBitRate,
// CANsetupMessageObject, CANsendMessage, CANreadMessage,
// CANgetInterruptCause, CANgetStatus, CANclearInterruptStatus,
// CANclearGlobalInterruptStatus, InterruptclearACKGroup, plus rxMsgData and
// txMsgData. They do the same register and IF transfers as the C source.
// As in the course file, setCANBitRate always programs CAN-B.
//
// Not modelled: the bit stream itself (no waveform on the pins, no CRC, bit
// stuffing or error frames; error counters stay 0, so EIE never fires),
// remote frames, FIFO buffers of several objects (EoB), IF3, the second
// interrupt line (CAN_IP_MUX21, IE1), test modes, parity, auto-bus-on,
// other pin choices for CAN-B, and anything connected to CAN-A. The Busy
// bit always reads 0 (a transfer takes 4 to 14 clock cycles on the chip).
// A raw 32-bit write to CAN_IFxCMD that changes only the command bits and
// repeats the previous MSG_NUM is taken as a write of the upper half and
// does not start a transfer (the library functions are not affected).
//
// The world: two SEN-36005 time-of-flight sensors (device IDs 1 and 2, as
// the course starter expects), 1 Mbit/s, extended 29-bit identifiers,
// little-endian fields (SEN-36005 CAN User's Guide):
// - 0x060B01ss "measured distance", 8 bytes, every 100 ms: bytes 0-1
//   distance in mm, byte 2 ranging status (0 = valid), byte 3 quality,
//   bytes 4-7 signal rate * 65536.
// - 0x060B02ss "measurement quality", 8 bytes, right after the distance:
//   bytes 0-3 ambient light * 65536, bytes 4-7 standard deviation * 65536.
// - 0x1F0B01FF heartbeat, once a second.
// - 0x060B04ss "ranging configuration" (received by the sensor): bytes 1-2
//   set the sample period in ms (25 to 1000).
// Distances come from the signal-bus inputs "CAN_DIST1_MM" and
// "CAN_DIST2_MM"; a negative value unplugs that sensor.
//
// Signal-bus outputs: CAN_BITRATE, CAN_RX_FRAMES (frames stored in a
// message object), CAN_TX_FRAMES, CAN_SENSOR1_PERIOD_MS,
// CAN_SENSOR2_PERIOD_MS.

import type { Board } from "../board";
import { SYSCLK_NS } from "../consts";
import type { SimPlugin } from "../plugin";

export const CAN_CLOCK_HZ = 1e9 / SYSCLK_NS;
export const SENSOR_BITRATE = 1_000_000;

// CAN_CTL
const CTL_INIT = 0x0001;
const CTL_IE0 = 0x0002;
const CTL_SIE = 0x0004;
const CTL_CCE = 0x0040;
const CTL_SWR = 0x8000;
const CTL_RESET = 0x1401;
// CAN_ES
const ES_LEC = 0x0007;
const ES_TXOK = 0x0008;
const ES_RXOK = 0x0010;
// CAN_IFxCMD
const CMD_DATA_B = 1 << 16;
const CMD_DATA_A = 1 << 17;
const CMD_TXRQST = 1 << 18;
const CMD_CLRINTPND = 1 << 19;
const CMD_CONTROL = 1 << 20;
const CMD_ARB = 1 << 21;
const CMD_MASK = 1 << 22;
const CMD_DIR = 1 << 23;
// CAN_IFxARB
const ARB_ID = 0x1fffffff;
const ARB_DIR = 0x20000000;
const ARB_XTD = 0x40000000;
const ARB_MSGVAL = 0x80000000;
// CAN_IFxMCTL
const MC_DLC = 0x000f;
const MC_EOB = 0x0080;
const MC_TXRQST = 0x0100;
const MC_RXIE = 0x0400;
const MC_TXIE = 0x0800;
const MC_UMASK = 0x1000;
const MC_INTPND = 0x2000;
const MC_MSGLST = 0x4000;
const MC_NEWDAT = 0x8000;

/** Frames kept in CanModule.received. */
export const RECEIVED_MAX = 200;

export interface CanFrame {
  id: number;
  extended: boolean;
  data: number[];
}

interface MsgObj {
  msk: number;
  arb: number;
  mctl: number;
  data: number[];
}

/** Bits on the wire for a data frame, without stuff bits, plus the 3-bit gap. */
const frameBits = (f: CanFrame) => (f.extended ? 64 : 44) + 8 * f.data.length + 3;

export class CanModule {
  objs: MsgObj[] = [];
  /** Frames this module sent, with the time the frame ended. */
  sent: (CanFrame & { t: number })[] = [];
  /** Frames sent since power-up (the list above is cut short in a long live run). */
  sentTotal = 0;
  /** Frames stored in a message object. */
  stored = 0;
  /** The most recent frames stored in a message object (at most RECEIVED_MAX), oldest first. */
  received: { t: number; id: number; extended: boolean; data: number[]; obj: number }[] = [];
  onTx: ((f: CanFrame, t: number) => void)[] = [];
  onStart: (() => void)[] = [];
  private statusPending = false;
  private txBusy = false;
  private storm = 0;
  private stormId = 0;
  private stormOff = false;
  readonly pre: string;

  constructor(
    private b: Board,
    readonly letter: "a" | "b",
    private pieChannel: number,
    readonly rxPin: number,
    readonly txPin: number,
    readonly mux: number,
  ) {
    this.pre = `Can${letter}Regs`;
    const dev = b.dev;
    const r = (name: string) => dev.reg(`${this.pre}.${name}`).hook;
    this.reset();

    const ctl = r("CAN_CTL");
    ctl.after = (v, before) => {
      if (v & CTL_SWR) {
        // Software reset: self-clearing, leaves the module in initialization mode.
        this.reset();
        return;
      }
      if (before & CTL_INIT && !(v & CTL_INIT)) {
        for (const f of this.onStart) f();
        this.pumpTx();
      }
      this.updateInt();
    };

    // Reading CAN_ES resets RxOk, TxOk and LEC and clears the status interrupt.
    const es = r("CAN_ES");
    es.read = (stored) => {
      if (stored !== 7 || this.statusPending) {
        dev.set(`${this.pre}.CAN_ES`, (stored & ~(ES_TXOK | ES_RXOK)) | ES_LEC);
        this.statusPending = false;
        b.mem.writes++;
        this.updateInt();
      }
      return stored;
    };
    es.write = (_v, stored) => stored;

    const btr = r("CAN_BTR");
    btr.write = (v, stored) => {
      const c = dev.get(`${this.pre}.CAN_CTL`);
      if (c & CTL_INIT && c & CTL_CCE) return v;
      b.warn(b.line, "can-btr-locked", `CAN_BTR can only be written while CAN_CTL.Init and CAN_CTL.CCE are both 1 (TRM 22.4.1), so this write was ignored. Call setCANBitRate before clearing Init.`, "error");
      return stored;
    };
    btr.after = () => b.publish("CAN_BITRATE", Math.round(this.bitRate()));

    for (const name of ["CAN_INT", "CAN_GLB_INT_FLG", "CAN_NDAT_21", "CAN_IPEN_21", "CAN_MVAL_21", "CAN_TXRQ_21"]) r(name).write = (_v, stored) => stored;
    r("CAN_GLB_INT_EN").after = () => this.updateInt();
    // CAN_GLB_INT_CLR: writing 1 clears the flag so the PIE can get another interrupt.
    const clr = r("CAN_GLB_INT_CLR");
    clr.write = () => 0;
    clr.after = (v) => this.clearGlobal(v);

    for (const n of [1, 2] as const) {
      const cmd = r(`CAN_IF${n}CMD`);
      cmd.write = (v) => (v & ~0x8000) >>> 0; // Busy reads 0: transfers are instant here
      cmd.after = (v, before) => {
        // A transfer starts when MSG_NUM (the low half) is written. A write
        // that only changed the upper half was a write of the command bits.
        const upperOnly = (v & 0xffff) === (before & 0xffff) && v >>> 16 !== before >>> 16;
        if (!upperOnly) this.transfer(n, v);
      };
    }
  }

  private get(name: string): number {
    return this.b.dev.get(`${this.pre}.${name}`);
  }

  private put(name: string, v: number): void {
    this.b.dev.set(`${this.pre}.${name}`, v >>> 0);
  }

  reset(): void {
    this.objs = [];
    for (let i = 0; i <= 32; i++) this.objs.push({ msk: 0xffffffff, arb: 0, mctl: 0, data: [0, 0, 0, 0, 0, 0, 0, 0] });
    this.put("CAN_CTL", CTL_RESET);
    this.put("CAN_ES", 7);
    this.put("CAN_BTR", 0x2301);
    this.put("CAN_GLB_INT_EN", 0);
    this.put("CAN_GLB_INT_FLG", 0);
    for (const n of [1, 2]) {
      this.put(`CAN_IF${n}CMD`, 1);
      this.put(`CAN_IF${n}MSK`, 0xffffffff);
      this.put(`CAN_IF${n}ARB`, 0);
      this.put(`CAN_IF${n}MCTL`, 0);
      this.put(`CAN_IF${n}DATA`, 0);
      this.put(`CAN_IF${n}DATB`, 0);
    }
    this.statusPending = false;
    this.txBusy = false;
    this.summary();
    this.updateInt();
    this.b.mem.writes++;
  }

  get initMode(): boolean {
    return (this.get("CAN_CTL") & CTL_INIT) !== 0;
  }

  /** Bit rate programmed in CAN_BTR (TRM 22.12.1). */
  bitRate(): number {
    const v = this.get("CAN_BTR");
    const brp = (v & 0x3f) | (((v >>> 16) & 0xf) << 6);
    const tq = 1 + (((v >>> 8) & 0xf) + 1) + (((v >>> 12) & 0x7) + 1);
    return CAN_CLOCK_HZ / ((brp + 1) * tq);
  }

  /** Copies between an IFx register set and a message object (TRM 22.13). */
  transfer(n: 1 | 2, cmd: number): void {
    const b = this.b;
    const num = cmd & 0xff;
    if (num < 1 || num > 32) {
      b.warn(b.line, "can-msg-num", `Message object ${num} does not exist: the CAN module has message objects 1 to 32.`, "error");
      return;
    }
    const o = this.objs[num];
    const ifx = `CAN_IF${n}`;
    if (cmd & CMD_DIR) {
      if (cmd & CMD_MASK) o.msk = this.get(`${ifx}MSK`);
      if (cmd & CMD_ARB) o.arb = this.get(`${ifx}ARB`);
      if (cmd & CMD_CONTROL) o.mctl = this.get(`${ifx}MCTL`) & 0xffff;
      if (cmd & CMD_DATA_A) {
        const v = this.get(`${ifx}DATA`);
        for (let i = 0; i < 4; i++) o.data[i] = (v >>> (8 * i)) & 0xff;
      }
      if (cmd & CMD_DATA_B) {
        const v = this.get(`${ifx}DATB`);
        for (let i = 0; i < 4; i++) o.data[4 + i] = (v >>> (8 * i)) & 0xff;
      }
      if (cmd & CMD_TXRQST) o.mctl |= MC_TXRQST | MC_NEWDAT;
    } else {
      if (cmd & CMD_MASK) this.put(`${ifx}MSK`, o.msk);
      if (cmd & CMD_ARB) this.put(`${ifx}ARB`, o.arb);
      // The control bits read show the state before IntPnd / NewDat are cleared.
      if (cmd & CMD_CONTROL) this.put(`${ifx}MCTL`, o.mctl);
      if (cmd & CMD_DATA_A) this.put(`${ifx}DATA`, o.data[0] | (o.data[1] << 8) | (o.data[2] << 16) | (o.data[3] << 24));
      if (cmd & CMD_DATA_B) this.put(`${ifx}DATB`, o.data[4] | (o.data[5] << 8) | (o.data[6] << 16) | (o.data[7] << 24));
      if (cmd & CMD_CLRINTPND) o.mctl &= ~MC_INTPND;
      if (cmd & CMD_TXRQST) o.mctl &= ~MC_NEWDAT;
    }
    b.mem.writes++;
    this.summary();
    this.updateInt();
    this.pumpTx();
  }

  /** CAN_NDAT_21, CAN_IPEN_21, CAN_MVAL_21, CAN_TXRQ_21: one bit per object. */
  private summary(): void {
    let nd = 0;
    let ip = 0;
    let mv = 0;
    let tx = 0;
    for (let i = 1; i <= 32; i++) {
      const o = this.objs[i];
      const bit = 2 ** (i - 1);
      if (o.mctl & MC_NEWDAT) nd += bit;
      if (o.mctl & MC_INTPND) ip += bit;
      if (o.arb >>> 31) mv += bit;
      if (o.mctl & MC_TXRQST) tx += bit;
    }
    this.put("CAN_NDAT_21", nd);
    this.put("CAN_IPEN_21", ip);
    this.put("CAN_MVAL_21", mv);
    this.put("CAN_TXRQ_21", tx);
  }

  /** CAN_INT.INT0ID and the interrupt line to the PIE (TRM 22.6). */
  private updateInt(): void {
    let id = 0;
    if (this.statusPending) id = 0x8000;
    else for (let i = 1; i <= 32 && !id; i++) if (this.objs[i].mctl & MC_INTPND) id = i;
    this.put("CAN_INT", id);
    if (!id || !(this.get("CAN_CTL") & CTL_IE0)) return;
    // The line is active. It reaches the PIE once per clearing of the global flag.
    if (this.get("CAN_GLB_INT_FLG") & 1 || !(this.get("CAN_GLB_INT_EN") & 1) || this.stormOff) return;
    this.put("CAN_GLB_INT_FLG", this.get("CAN_GLB_INT_FLG") | 1);
    this.b.pie.raise(9, this.pieChannel);
  }

  private clearGlobal(v: number): void {
    const flags = this.get("CAN_GLB_INT_FLG");
    if (!(flags & v & 3)) return;
    this.put("CAN_GLB_INT_FLG", flags & ~v);
    this.b.mem.writes++;
    // Still pending when the flag is cleared: the line fires again at once.
    const id = this.get("CAN_INT") & 0xffff;
    if (id && id === this.stormId) {
      if (++this.storm > 200) {
        this.stormOff = true;
        const what = id === 0x8000 ? "the status interrupt was never cleared (read CAN_ES, for example with CANgetStatus)" : `message object ${id}'s IntPnd bit was never cleared (CANclearInterruptStatus(CAN${this.letter.toUpperCase()}_BASE, ${id});)`;
        this.b.warn(this.b.line, "can-int-stuck", `The CAN interrupt fired again and again without a new frame: ${what}. The interrupt line stays active until its cause is cleared (TRM 22.6).`, "error");
      }
    } else {
      this.stormId = id;
      this.storm = 0;
    }
    this.updateInt();
  }

  /** A data frame arrives from the bus (called at the end of the frame). */
  receive(f: CanFrame): void {
    const b = this.b;
    if (this.initMode) return;
    const L = this.letter.toUpperCase();
    if (b.gpio.mux(this.rxPin) !== this.mux) {
      b.warn(b.line, `can-rx-mux`, `CAN-${L} is running, but GPIO${this.rxPin} is not switched to CANRX${L} (mux position ${this.mux}), so it hears nothing from the bus. Use GPIO_SetupPinMux(${this.rxPin}, GPIO_MUX_CPU1, ${this.mux});`, "error");
      return;
    }
    const rate = this.bitRate();
    if (Math.abs(rate - SENSOR_BITRATE) > 0.01 * SENSOR_BITRATE) {
      b.warn(b.line, "can-bitrate", `CAN-${L} is set to ${Math.round(rate)} bit/s, but the sensors send at ${SENSOR_BITRATE} bit/s, so every frame is read as an error. Use setCANBitRate(200000000, 1000000);`, "error");
      return;
    }
    if (b.gpio.mux(this.txPin) !== this.mux)
      b.warn(b.line, "can-tx-mux", `GPIO${this.txPin} is not switched to CANTX${L} (mux position ${this.mux}): CAN-${L} cannot acknowledge the frames it receives or send any. Use GPIO_SetupPinMux(${this.txPin}, GPIO_MUX_CPU1, ${this.mux});`);

    this.put("CAN_ES", (this.get("CAN_ES") & ~ES_LEC) | ES_RXOK);
    if (this.get("CAN_CTL") & CTL_SIE) this.statusPending = true;
    this.storm = 0;
    this.stormId = 0;

    // Acceptance filtering, object 1 first (TRM 22.11.6).
    const rxId = f.extended ? f.id & ARB_ID : ((f.id & 0x7ff) << 18) >>> 0;
    for (let i = 1; i <= 32; i++) {
      const o = this.objs[i];
      if (!(o.arb >>> 31) || o.arb & ARB_DIR) continue;
      const umask = (o.mctl & MC_UMASK) !== 0;
      const xtd = (o.arb & ARB_XTD) !== 0;
      if (xtd !== f.extended && !(umask && !(o.msk >>> 31))) continue;
      let care = umask ? o.msk & ARB_ID : ARB_ID;
      if (!f.extended) care &= 0x1ffc0000;
      if (((o.arb ^ rxId) & care) !== 0) continue;
      // Store identifier, DLC and data; NewDat, and MsgLst if the last one was not read.
      o.arb = ((o.arb & ~(ARB_ID | ARB_XTD)) | rxId | (f.extended ? ARB_XTD : 0)) >>> 0;
      for (let k = 0; k < f.data.length && k < 8; k++) o.data[k] = f.data[k] & 0xff;
      let mctl = (o.mctl & ~(MC_DLC | MC_TXRQST)) | Math.min(8, f.data.length);
      if (mctl & MC_NEWDAT) mctl |= MC_MSGLST;
      mctl |= MC_NEWDAT;
      if (mctl & MC_RXIE) mctl |= MC_INTPND;
      o.mctl = mctl;
      b.publish("CAN_RX_FRAMES", ++this.stored);
      this.received.push({ t: b.now, id: f.extended ? f.id & ARB_ID : f.id & 0x7ff, extended: f.extended, data: f.data.slice(0, 8).map((x) => x & 0xff), obj: i });
      if (this.received.length > RECEIVED_MAX) this.received.shift();
      break;
    }
    b.mem.writes++;
    this.summary();
    this.updateInt();
  }

  /** Sends the lowest-numbered object with TxRqst set (TRM 22.11.2). */
  private pumpTx(): void {
    const b = this.b;
    if (this.txBusy || this.initMode) return;
    const i = this.objs.findIndex((o, k) => k >= 1 && o.mctl & MC_TXRQST && o.arb >>> 31 && o.arb & ARB_DIR);
    if (i < 0) return;
    const L = this.letter.toUpperCase();
    if (b.gpio.mux(this.txPin) !== this.mux) {
      b.warn(b.line, "can-tx-mux", `A frame is waiting to be sent, but GPIO${this.txPin} is not switched to CANTX${L} (mux position ${this.mux}), so it never leaves the chip. Use GPIO_SetupPinMux(${this.txPin}, GPIO_MUX_CPU1, ${this.mux});`, "error");
      return;
    }
    const o = this.objs[i];
    const extended = (o.arb & ARB_XTD) !== 0;
    const frame: CanFrame = { id: extended ? o.arb & ARB_ID : (o.arb >>> 18) & 0x7ff, extended, data: o.data.slice(0, Math.min(8, o.mctl & MC_DLC)) };
    this.txBusy = true;
    b.at(b.now + (frameBits(frame) * 1e9) / this.bitRate(), (t) => {
      this.txBusy = false;
      if (this.initMode) return;
      o.mctl &= ~(MC_TXRQST | MC_NEWDAT);
      if (o.mctl & MC_TXIE) o.mctl |= MC_INTPND;
      this.put("CAN_ES", (this.get("CAN_ES") & ~ES_LEC) | ES_TXOK);
      if (this.get("CAN_CTL") & CTL_SIE) this.statusPending = true;
      this.sent.push({ ...frame, t });
      b.publish("CAN_TX_FRAMES", ++this.sentTotal, t);
      // A live run keeps the recent frames only.
      if (b.historyLimit && this.sent.length > b.historyLimit) this.sent.splice(0, this.sent.length - (b.historyLimit >> 1));
      // Nobody else at this bit rate: the frame is not acknowledged and is lost.
      if (Math.abs(this.bitRate() - SENSOR_BITRATE) <= 0.01 * SENSOR_BITRATE) for (const fn of this.onTx) fn(frame, t);
      b.mem.writes++;
      this.summary();
      this.updateInt();
      this.pumpTx();
    });
  }

  // ---- what the course library functions do ----

  /** CANsetupMessageObject (F28379dCAN.c). */
  setupMessageObject(objID: number, msgID: number, ext: boolean, msgType: number, mask: number, flags: number, len: number): void {
    let arb = 0;
    let ctl = 0;
    let msk = 0;
    if (msgType === 0) arb = ARB_DIR;
    else if (msgType === 3) {
      arb = ARB_DIR;
      ctl = 0x0200 | MC_UMASK; // RmtEn
    }
    if (ext) {
      if (flags & 1) msk = mask & ARB_ID;
      arb |= (msgID & ARB_ID) | ARB_MSGVAL | ARB_XTD;
    } else {
      if (flags & 1) msk = (mask << 18) & 0x1ffc0000;
      arb |= ((msgID << 18) & 0x1ffc0000) | ARB_MSGVAL;
    }
    msk |= flags & 0xc0000000; // CAN_MSG_OBJ_USE_EXT_FILTER, _USE_DIR_FILTER
    if (flags & 0xc0000001) ctl |= MC_UMASK;
    ctl |= len & MC_DLC;
    if (!(flags & 2)) ctl |= MC_EOB;
    ctl |= flags & (MC_TXIE | MC_RXIE);
    this.put("CAN_IF1MSK", msk);
    this.put("CAN_IF1ARB", arb);
    this.put("CAN_IF1MCTL", ctl);
    const cmd = (CMD_ARB | CMD_CONTROL | CMD_MASK | CMD_DIR | (objID & 0xff)) >>> 0;
    this.put("CAN_IF1CMD", cmd);
    this.transfer(1, cmd);
  }
}

/** One SEN-36005 time-of-flight sensor on the bus. */
class Sensor {
  periodMs = 100;
  private ev: ReturnType<Board["at"]> | null = null;

  constructor(
    private b: Board,
    private can: CanModule,
    readonly id: number,
    /** First measurement, ns. */
    private phase: number,
  ) {}

  /** Starts (or re-times) the measurement cycle from the current time. */
  schedule(): void {
    const b = this.b;
    b.cancel(this.ev);
    const period = this.periodMs * 1e6;
    const next = b.now <= this.phase ? this.phase : this.phase + Math.ceil((b.now - this.phase) / period) * period;
    this.ev = b.at(next, (t) => this.measure(t));
  }

  private measure(t: number): void {
    const b = this.b;
    this.phase = t;
    this.ev = b.at(t + this.periodMs * 1e6, (at) => this.measure(at));
    const mm = b.input(`CAN_DIST${this.id}_MM`, this.id === 1 ? 500 : 1200);
    if (mm < 0) return; // unplugged
    const d = Math.max(0, Math.min(4000, Math.round(mm)));
    const le32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    const distance: CanFrame = { id: 0x060b0100 | this.id, extended: true, data: [d & 0xff, d >> 8, 0, 0, ...le32(Math.round(2.5 * 65536))] };
    const quality: CanFrame = { id: 0x060b0200 | this.id, extended: true, data: [...le32(Math.round(0.25 * 65536)), ...le32(Math.round(1.5 * 65536))] };
    const bit = 1e9 / SENSOR_BITRATE;
    const end1 = t + frameBits(distance) * bit;
    b.at(end1, () => this.can.receive(distance));
    b.at(end1 + frameBits(quality) * bit, () => this.can.receive(quality));
  }

  /** A frame sent by the microcontroller. */
  hear(f: CanFrame, t: number): void {
    if (!f.extended || f.id !== (0x060b0400 | this.id) || f.data.length < 3) return;
    // Ranging configuration: bytes 1-2 are the sample period in ms.
    const period = f.data[1] | (f.data[2] << 8);
    if (period === 0xffff || period < 25 || period > 1000) return;
    this.periodMs = period;
    this.b.publish(`CAN_SENSOR${this.id}_PERIOD_MS`, period, t);
    this.phase = t + period * 1e6;
    this.b.cancel(this.ev);
    this.ev = this.b.at(this.phase, (at) => this.measure(at));
  }
}

export interface CanState {
  a: CanModule;
  b: CanModule;
}

const PRELUDE = `
// ---- course CAN library (F28379dCAN.h / F28379dCAN.c, final project starter)
typedef enum { CAN_MSG_FRAME_STD, CAN_MSG_FRAME_EXT } CAN_MsgFrameType;
typedef enum {
    CAN_MSG_OBJ_TYPE_TX, CAN_MSG_OBJ_TYPE_TX_REMOTE, CAN_MSG_OBJ_TYPE_RX, CAN_MSG_OBJ_TYPE_RXTX_REMOTE
} CAN_MsgObjType;
#define CANA_BASE 0x00048000UL
#define CANB_BASE 0x0004A000UL
#define CAN_INT_INT0ID_STATUS 0x8000U
#define CAN_MSG_OBJ_TX_INT_ENABLE 0x00000800UL
#define CAN_MSG_OBJ_RX_INT_ENABLE 0x00000400UL
#define CAN_MSG_OBJ_USE_ID_FILTER 0x00000001UL
#define CAN_MSG_OBJ_USE_DIR_FILTER 0x40000000UL
#define CAN_MSG_OBJ_USE_EXT_FILTER 0x80000000UL
#define CAN_MSG_OBJ_FIFO 0x00000002UL
#define CAN_MSG_OBJ_NO_FLAGS 0x00000000UL
#define CAN_GLOBAL_INT_CANINT0 0x00000001UL
#define CAN_GLOBAL_INT_CANINT1 0x00000002UL
#define INTERRUPT_ACK_GROUP1 0x0001U
#define INTERRUPT_ACK_GROUP2 0x0002U
#define INTERRUPT_ACK_GROUP3 0x0004U
#define INTERRUPT_ACK_GROUP4 0x0008U
#define INTERRUPT_ACK_GROUP5 0x0010U
#define INTERRUPT_ACK_GROUP6 0x0020U
#define INTERRUPT_ACK_GROUP7 0x0040U
#define INTERRUPT_ACK_GROUP8 0x0080U
#define INTERRUPT_ACK_GROUP9 0x0100U
#define INTERRUPT_ACK_GROUP10 0x0200U
#define INTERRUPT_ACK_GROUP11 0x0400U
#define INTERRUPT_ACK_GROUP12 0x0800U
uint16_t txMsgData[8];
uint16_t rxMsgData[8];
void InitCANA(void);
void InitCANB(void);
uint32_t setCANBitRate(uint32_t sourceClock, uint32_t bitRate);
void CANsetupMessageObject(uint32_t base, uint32_t objID, uint32_t msgID, CAN_MsgFrameType frame,
                           CAN_MsgObjType msgType, uint32_t msgIDMask, uint32_t flags, uint16_t msgLen);
void CANsendMessage(uint32_t base, uint32_t objID, uint16_t msgLen, uint16_t *msgData);
uint16_t CANreadMessage(uint32_t base, uint32_t objID, uint16_t *msgData);
uint32_t CANgetInterruptCause(uint32_t base);
uint16_t CANgetStatus(uint32_t base);
void CANclearInterruptStatus(uint32_t base, uint32_t intClr);
void CANclearGlobalInterruptStatus(uint32_t base, uint16_t intFlags);
void InterruptclearACKGroup(uint16_t group);
`;

function install(b: Board): void {
  const can: CanState = {
    a: new CanModule(b, "a", 5, 5, 4, 6),
    b: new CanModule(b, "b", 7, 17, 12, 2),
  };
  b.plugins.set("can", can);

  // The sensors hang on CAN-B. They start their cycle when CAN-B first leaves
  // initialization mode, on a fixed time grid, so programs that never use
  // CAN see no events from them.
  const sensors = [new Sensor(b, can.b, 1, 5e6), new Sensor(b, can.b, 2, 30e6)];
  let started = false;
  can.b.onStart.push(() => {
    if (started) return;
    started = true;
    for (const s of sensors) s.schedule();
    const heartbeat = (t: number) => {
      b.at(t + 1e9, heartbeat);
      can.b.receive({ id: 0x1f0b01ff, extended: true, data: [0, 0x39, 0x30, 0x00, 0x10, 0x01, 0x02, 0x01] });
    };
    b.at((Math.floor(b.now / 1e9) + 1) * 1e9, heartbeat);
  });
  can.b.onTx.push((f, t) => {
    for (const s of sensors) s.hear(f, t);
  });

  const c = b.compiler;
  const dev = b.dev;
  const module = (base: number, line: number): CanModule => {
    if (base === 0x48000) return can.a;
    if (base === 0x4a000) return can.b;
    b.warn(line || b.line, "can-base", "The first argument must be CANA_BASE or CANB_BASE. The course robot's sensors are on CAN-B: use CANB_BASE.", "error");
    return can.b;
  };

  const init = (m: CanModule) => () => {
    // CAN_CTL: Init = 1, SWR = 1, then every message object is written invalid.
    m.reset();
    for (const n of [1, 2]) dev.set(`${m.pre}.CAN_IF${n}CMD`, (CMD_DIR | CMD_ARB | CMD_CONTROL | (n === 1 ? 31 : 32)) >>> 0);
    return 0;
  };
  c.defineNative("InitCANA", init(can.a));
  c.defineNative("InitCANB", init(can.b));

  c.defineNative("setCANBitRate", (a) => {
    const [sourceClock, bitRate] = [a[0] >>> 0, a[1] >>> 0];
    if (!bitRate || !sourceClock) return 0;
    const table = [0x1100, 0x1200, 0x2240, 0x2340, 0x3340, 0x3440, 0x3540, 0x3640, 0x3740];
    let ratio = Math.floor(sourceClock / bitRate);
    if (Math.floor(sourceClock / ratio) > bitRate) ratio++;
    for (; ratio <= 1024 * 13; ratio++) {
      for (let bits = 13; bits >= 5; bits--) {
        const pre = Math.floor(ratio / bits);
        if (pre * bits !== ratio) continue;
        // As in the course file: always CAN-B, with Init and CCE set for the write.
        const ctl = dev.get("CanbRegs.CAN_CTL");
        dev.set("CanbRegs.CAN_CTL", ctl | CTL_INIT | CTL_CCE);
        const reg = table[bits - 5] | ((pre - 1) & 0x3f) | ((((pre - 1) >>> 6) & 0xf) << 16);
        const r = dev.reg("CanbRegs.CAN_BTR");
        b.mem.write(r.addr, 2, reg);
        dev.set("CanbRegs.CAN_CTL", ctl);
        return Math.floor(sourceClock / (pre * bits));
      }
    }
    return 0;
  });

  c.defineNative("CANsetupMessageObject", (a, _t, line) => {
    const objID = a[1] >>> 0;
    if (objID < 1 || objID > 32) {
      b.warn(line || b.line, "can-msg-num", `Message object ${objID} does not exist: the CAN module has message objects 1 to 32.`, "error");
      return 0;
    }
    module(a[0] >>> 0, line).setupMessageObject(objID, a[2] >>> 0, a[3] === 1, a[4], a[5] >>> 0, a[6] >>> 0, a[7]);
    return 0;
  });

  c.defineNative("CANsendMessage", (a, _t, line) => {
    const m = module(a[0] >>> 0, line);
    const obj = a[1] & 0xff;
    const len = Math.min(8, a[2]);
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < len; i++) {
      const v = b.mem.peek(a[3] + i, 1) & 0xff;
      if (i < 4) lo += v * 2 ** (8 * i);
      else hi += v * 2 ** (8 * (i - 4));
    }
    dev.set(`${m.pre}.CAN_IF1DATA`, lo);
    dev.set(`${m.pre}.CAN_IF1DATB`, hi);
    const cmd = ((len ? CMD_DATA_A | CMD_DATA_B : 0) | CMD_DIR | CMD_TXRQST | obj) >>> 0;
    dev.set(`${m.pre}.CAN_IF1CMD`, cmd);
    m.transfer(1, cmd);
    return 0;
  });

  c.defineNative("CANreadMessage", (a, _t, line) => {
    const m = module(a[0] >>> 0, line);
    const obj = a[1] & 0xff;
    const cmd = (CMD_DATA_A | CMD_DATA_B | CMD_CONTROL | CMD_ARB | obj) >>> 0;
    dev.set(`${m.pre}.CAN_IF2CMD`, cmd);
    m.transfer(2, cmd);
    const ctl = dev.get(`${m.pre}.CAN_IF2MCTL`);
    if (!(ctl & MC_NEWDAT)) return 0;
    const lo = dev.get(`${m.pre}.CAN_IF2DATA`);
    const hi = dev.get(`${m.pre}.CAN_IF2DATB`);
    // One byte per array element, as CAN_readDataReg stores them.
    for (let i = 0; i < (ctl & MC_DLC) && i < 8; i++) b.mem.write(a[2] + i, 1, ((i < 4 ? lo : hi) >>> (8 * (i & 3))) & 0xff);
    const clear = (CMD_TXRQST | obj) >>> 0;
    dev.set(`${m.pre}.CAN_IF2CMD`, clear);
    m.transfer(2, clear);
    return 1;
  });

  c.defineNative("CANgetInterruptCause", (a, _t, line) => dev.get(`${module(a[0] >>> 0, line).pre}.CAN_INT`));
  c.defineNative("CANgetStatus", (a, _t, line) => {
    const r = dev.reg(`${module(a[0] >>> 0, line).pre}.CAN_ES`);
    return b.mem.read(r.addr, 2) & 0xffff;
  });
  c.defineNative("CANclearInterruptStatus", (a, _t, line) => {
    const m = module(a[0] >>> 0, line);
    const what = a[1] >>> 0;
    if (what === 0x8000) {
      const r = dev.reg(`${m.pre}.CAN_ES`);
      b.mem.read(r.addr, 2);
    } else {
      const cmd = (CMD_CLRINTPND | (what & 0xff)) >>> 0;
      dev.set(`${m.pre}.CAN_IF1CMD`, cmd);
      m.transfer(1, cmd);
    }
    return 0;
  });
  c.defineNative("CANclearGlobalInterruptStatus", (a, _t, line) => {
    const r = dev.reg(`${module(a[0] >>> 0, line).pre}.CAN_GLB_INT_CLR`);
    b.mem.write(r.addr, 2, a[1] & 3);
    return 0;
  });
  c.defineNative("InterruptclearACKGroup", (a) => {
    const r = dev.reg("PieCtrlRegs.PIEACK");
    b.mem.write(r.addr, 1, a[0] & 0xffff);
    return 0;
  });
}

const distKnob = (n: number, initial: number) =>
  ({ kind: "knob", id: `CAN_DIST${n}_MM`, label: `Distance at CAN sensor ${n}`, input: `CAN_DIST${n}_MM`, min: 0, max: 4000, step: 10, initial, unit: "mm" }) as const;

export const plugin: SimPlugin = {
  name: "can",
  prelude: PRELUDE,
  install,
  parts: {
    robot: [distKnob(1, 500), distKnob(2, 1200)],
  },
};
